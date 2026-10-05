import { Worker, Job } from 'bullmq';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { SYNC_QUEUE_NAME, type SyncJobData, getWarsawHour, getDueFrequenciesForHour } from './sync.queue.js';
import { config } from '../config/index.js';
import { logger } from '../core/logger.js';
import { prisma } from '../db/prisma.js';
import { CryptoService } from '../security/crypto.service.js';
import { providerRegistry } from '../providers/registry.js';
import { wsConnectionManager } from '../ws/connectionManager.js';
import { NeedsReauthError } from '../core/errors.js';
import { cleanInvoiceNumber, cleanPaymentTitle, isOlderThan12Months } from '../core/utils.js';
import { classifySyncError } from './sync.classifier.js';
import { SyncService } from '../services/SyncService.js';
import { BillService } from '../services/BillService.js';
import { NightlyRefreshService } from '../services/NightlyRefreshService.js';
import { MailScriptService } from '../services/MailScriptService.js';
import type { SyncStatus, SyncErrorDetails } from '@bills-master/shared-types';

export function createSyncWorker() {
  const worker = new Worker<SyncJobData>(
    SYNC_QUEUE_NAME,
    async (job: Job<SyncJobData>) => {
      // Handle scheduled daily sync (runs daily at 3:00 AM)
      if (job.data?.isDailyScheduler || job.name === 'daily-sync-scheduler') {
        logger.info('[Worker] ⏰ Running scheduled daily sync for all active portals (3:00 AM)...');
        try {
          const purgedOld = await BillService.deleteBillsOlderThan12Months();
          if (purgedOld > 0) {
            logger.info(`[Worker] Daily cleanup removed ${purgedOld} bills older than 12 months.`);
          }
        } catch (err) {
          logger.warn('[Worker] Error during daily cleanup of old bills:', err);
        }
        const queuedJobs = await SyncService.triggerDailySyncForAllPortals();
        await NightlyRefreshService.recordNightlyRefresh({
          queuedPortals: queuedJobs.length,
          status: 'SUCCESS',
        });
        logger.info(`[Worker] ✅ Daily sync finished enqueuing: ${queuedJobs.length} portal(s) queued for sync.`);
        return { queuedPortals: queuedJobs.length };
      }

      // Handle scheduled intraday sync (runs at 09:00, 11:00, 15:00, 19:00, 21:00)
      if (job.data?.isIntradayScheduler || job.name === 'intraday-sync-scheduler') {
        const warsawHour = getWarsawHour();
        const frequencies = job.data?.frequencies || getDueFrequenciesForHour(warsawHour);
        logger.info(`[Worker] ⏰ Running scheduled intraday refresh for hour ${warsawHour}:00 (Warsaw time, frequencies: ${frequencies.join(', ') || 'none'})...`);
        if (frequencies.length > 0) {
          const queued = await SyncService.triggerScheduledSyncForFrequencies(frequencies);
          logger.info(`[Worker] ✅ Intraday refresh finished enqueuing: ${queued.length} portal(s) queued for sync.`);
          return { queuedPortals: queued.length };
        }
        return { queuedPortals: 0 };
      }

      const { portalId, syncJobId } = job.data;
      if (!portalId || !syncJobId) {
        logger.warn(`[Worker] Received job ${job.id} without portalId or syncJobId. Skipping.`);
        return;
      }

      logger.info(`[Worker] Starting sync job ${syncJobId} for portal ${portalId}`);

      // 1. Fetch portal & provider details from DB
      const portal = await prisma.portal.findUnique({
        where: { id: portalId },
        include: {
          provider: true,
          groups: {
            include: {
              group: {
                include: {
                  users: true,
                },
              },
            },
          },
        },
      });

      if (!portal) {
        throw new Error(`Portal ${portalId} not found in database`);
      }

      // Handle MailScript Portal (Gmail integration via Google Apps Script)
      if (portal.isMailScript || portal.providerId === 'mail-script') {
        await prisma.syncJob.update({
          where: { id: syncJobId },
          data: { status: 'RUNNING', startedAt: new Date() },
        });

        await prisma.portal.update({
          where: { id: portalId },
          data: { lastSyncStatus: 'RUNNING', lastSyncMessage: 'Odpytywanie Google Apps Script...' },
        });

        const adminUsers = await prisma.user.findMany({
          where: { role: 'ADMIN' },
          select: { id: true },
        });
        const userIds = Array.from(
          new Set([
            ...portal.groups.flatMap((g) => g.group.users.map((u) => u.userId)),
            ...adminUsers.map((a) => a.id),
          ])
        );

        for (const uid of userIds) {
          const batchStats = await SyncService.getBatchProgressForUser(uid, 30);
          wsConnectionManager.broadcastToUser(uid, {
            type: 'SYNC_PROGRESS',
            payload: {
              jobId: syncJobId,
              portalId: portal.id,
              portalName: portal.name,
              providerId: portal.providerId,
              providerName: portal.provider?.name || 'Poczta (Google Apps Script)',
              status: 'RUNNING',
              progressPercent: 30,
              message: 'Odpytywanie Google Apps Script Web App...',
              currentJobIndex: batchStats.currentJobIndex,
              totalJobsCount: batchStats.totalJobsCount,
              overallProgressPercent: batchStats.overallProgressPercent,
            },
          });
        }

        try {
          const result = await MailScriptService.triggerRemoteSync();
          await prisma.syncJob.update({
            where: { id: syncJobId },
            data: {
              status: 'SUCCESS',
              finishedAt: new Date(),
              billsFound: result.importedCount,
              billsImported: result.importedCount,
            },
          });
          const portalUpdateData: any = {
            lastSyncStatus: 'SUCCESS',
            lastSyncMessage: result.message,
          };
          if (result.importedCount > 0) {
            portalUpdateData.lastSyncedAt = new Date();
          }
          await prisma.portal.update({
            where: { id: portalId },
            data: portalUpdateData,
          });

          for (const uid of userIds) {
            const remainingActiveJobs = await SyncService.getRemainingActiveJobsCountForUser(uid);
            const batchStats = await SyncService.getBatchProgressForUser(uid, 100);
            wsConnectionManager.broadcastToUser(uid, {
              type: 'SYNC_COMPLETED',
              payload: {
                jobId: syncJobId,
                portalId: portal.id,
                portalName: portal.name,
                status: 'SUCCESS',
                billsFound: result.importedCount,
                billsImported: result.importedCount,
                message: result.message,
                hasMoreJobs: remainingActiveJobs > 0,
                remainingJobsCount: remainingActiveJobs,
                currentJobIndex: batchStats.currentJobIndex,
                totalJobsCount: batchStats.totalJobsCount,
                overallProgressPercent: batchStats.overallProgressPercent,
              },
            });
          }

          return { success: true, count: result.importedCount };
        } catch (err: any) {
          await prisma.syncJob.update({
            where: { id: syncJobId },
            data: {
              status: 'FAILED',
              finishedAt: new Date(),
              errorMessage: err.message,
            },
          });
          await prisma.portal.update({
            where: { id: portalId },
            data: {
              lastSyncStatus: 'FAILED',
              lastSyncMessage: err.message,
              lastSyncedAt: new Date(),
            },
          });

          for (const uid of userIds) {
            const remainingActiveJobs = await SyncService.getRemainingActiveJobsCountForUser(uid);
            wsConnectionManager.broadcastToUser(uid, {
              type: 'SYNC_COMPLETED',
              payload: {
                jobId: syncJobId,
                portalId: portal.id,
                portalName: portal.name,
                status: 'FAILED',
                billsFound: 0,
                billsImported: 0,
                message: err.message || 'Błąd synchronizacji poczty',
                hasMoreJobs: remainingActiveJobs > 0,
                remainingJobsCount: remainingActiveJobs,
              },
            });
          }
          throw err;
        }
      }

      const provider = providerRegistry.get(portal.providerId);
      if (!provider) {
        throw new Error(`Provider plugin ${portal.providerId} not found in registry`);
      }

      // Update DB job status to RUNNING
      await prisma.syncJob.update({
        where: { id: syncJobId },
        data: { status: 'RUNNING', startedAt: new Date() },
      });

      await prisma.portal.update({
        where: { id: portalId },
        data: { lastSyncStatus: 'RUNNING', lastSyncMessage: 'Pobieranie faktur w toku...' },
      });

      const adminUsers = await prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true },
      });
      const userIds = Array.from(
        new Set([
          ...portal.groups.flatMap((g) => g.group.users.map((u) => u.userId)),
          ...adminUsers.map((a) => a.id),
        ])
      );

      const reportProgress = async (percent: number, message: string) => {
        logger.debug(`[SyncProgress] [${portal.name}] ${percent}% - ${message}`);
        for (const uid of userIds) {
          const batchStats = await SyncService.getBatchProgressForUser(uid, percent);
          wsConnectionManager.broadcastToUser(uid, {
            type: 'SYNC_PROGRESS',
            payload: {
              jobId: syncJobId,
              portalId: portal.id,
              portalName: portal.name,
              providerId: portal.providerId,
              providerName: portal.provider.name,
              status: 'RUNNING',
              progressPercent: percent,
              message,
              currentJobIndex: batchStats.currentJobIndex,
              totalJobsCount: batchStats.totalJobsCount,
              overallProgressPercent: batchStats.overallProgressPercent,
            },
          });
        }
      };

      // 2. Decrypt login and password
      const login = portal.login;
      const password = CryptoService.decrypt(portal.encryptedPass);

      // Prepare directories
      const portalInvoicesDir = path.join(config.INVOICES_DIR, portal.id);
      const portalSessionsDir = path.join(config.SESSIONS_DIR, portal.id);
      await fs.mkdir(portalInvoicesDir, { recursive: true });
      await fs.mkdir(portalSessionsDir, { recursive: true });

      const sessionFilePath = path.join(portalSessionsDir, `${portal.id}.json`);

      let browser: Browser | null = null;
      let browserContext: BrowserContext | null = null;

      let currentStage = 'Łączenie ze stroną portalu';

      const setStage = (stage: string) => {
        currentStage = stage;
      };

      try {
        await reportProgress(5, `Uruchamianie przeglądarki dla ${portal.name}...`);

        browser = await chromium.launch({
          headless: config.PLAYWRIGHT_HEADLESS,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
          ],
        });

        // Check if existing session state exists and validate it
        let storageStateOption: string | undefined;
        try {
          const rawState = await fs.readFile(sessionFilePath, 'utf-8');
          const parsedState = JSON.parse(rawState);
          // Playwright cookie requirement: each cookie must have either 'url' or both 'domain' and 'path'
          const hasInvalidCookies = Array.isArray(parsedState?.cookies) && parsedState.cookies.some(
            (c: any) => !c || (!c.url && (!c.domain || !c.path))
          );
          if (hasInvalidCookies) {
            logger.warn(`[Worker] Saved session state at ${sessionFilePath} contains invalid cookies without url or domain/path. Removing corrupted session file.`);
            await fs.unlink(sessionFilePath).catch(() => {});
            await prisma.portal.update({
              where: { id: portal.id },
              data: { sessionStatePath: null },
            }).catch(() => {});
          } else {
            storageStateOption = sessionFilePath;
            logger.info(`[Worker] Found valid saved session state at ${sessionFilePath}`);
          }
        } catch {
          // File does not exist or JSON is invalid, fresh session
        }

        const contextOptions = {
          acceptDownloads: true,
          viewport: { width: 1280, height: 800 },
          userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          locale: 'pl-PL',
          extraHTTPHeaders: {
            'accept-language': 'pl,en-US;q=0.9,en;q=0.8',
            'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Linux"',
          },
        };

        try {
          browserContext = await browser.newContext({
            ...contextOptions,
            ...(storageStateOption ? { storageState: storageStateOption } : {}),
          });
        } catch (ctxErr: any) {
          if (storageStateOption) {
            logger.warn(
              `[Worker] browser.newContext failed with storageState (${storageStateOption}): ${ctxErr.message}. Clearing corrupted session and retrying with clean context.`
            );
            await fs.unlink(sessionFilePath).catch(() => {});
            await prisma.portal.update({
              where: { id: portal.id },
              data: { sessionStatePath: null },
            }).catch(() => {});
            storageStateOption = undefined;
            browserContext = await browser.newContext(contextOptions);
          } else {
            throw ctxErr;
          }
        }

        const page = await browserContext.newPage();
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
          if (!(window as any).chrome) {
            (window as any).chrome = {
              app: { isInstalled: false },
              webstore: { onInstallStageChanged: {}, onDownloadProgress: {} },
              runtime: { PlatformOs: { LINUX: 'linux' } },
            };
          }
          if (!navigator.plugins || navigator.plugins.length === 0) {
            Object.defineProperty(navigator, 'plugins', {
              get: () => [1, 2, 3, 4, 5],
            });
          }
          try {
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function (parameter: number) {
              if (parameter === 37445) return 'Intel Inc.';
              if (parameter === 37446) return 'Intel Iris OpenGL Engine';
              return getParameter.apply(this, [parameter]);
            };
          } catch {}
          try {
            if (typeof WebGL2RenderingContext !== 'undefined') {
              const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
              WebGL2RenderingContext.prototype.getParameter = function (parameter: number) {
                if (parameter === 37445) return 'Intel Inc.';
                if (parameter === 37446) return 'Intel Iris OpenGL Engine';
                return getParameter2.apply(this, [parameter]);
              };
            }
          } catch {}
        });

        // 3. Authenticate
        currentStage = 'Logowanie do portalu';
        const authResult = await provider.authenticate(
          page,
          {
            login,
            password,
            sessionStatePath: storageStateOption,
          },
          {
            browserContext,
            downloadDir: portalInvoicesDir,
            log: logger,
            reportProgress,
            setStage,
          }
        );

        // Save session state to disk if returned
        if (authResult.sessionState) {
          await fs.writeFile(sessionFilePath, JSON.stringify(authResult.sessionState, null, 2), 'utf-8');
          await prisma.portal.update({
            where: { id: portal.id },
            data: { sessionStatePath: sessionFilePath },
          });
        }

        // 4. Fetch bills and invoices
        currentStage = 'Pobieranie listy faktur';
        const extractedBills = await provider.fetchBills(page, {
          browserContext,
          downloadDir: portalInvoicesDir,
          log: logger,
          reportProgress,
          setStage,
          agreementFilter: portal.agreementFilter,
        });

        currentStage = 'Zapisywanie faktur do bazy danych';
        await reportProgress(90, 'Zapisywanie pobranych faktur do bazy danych...');


        let importedCount = 0;

        for (const bill of extractedBills) {
          const cleanInv = cleanInvoiceNumber(bill.invoiceNumber);
          if (!cleanInv) continue;

          // Do not import any bill older than 12 months
          if (isOlderThan12Months(bill.issueDate)) {
            logger.debug(`[Worker] Skipping bill ${cleanInv} older than 12 months (${new Date(bill.issueDate).toISOString().slice(0, 10)})`);
            continue;
          }

          let pdfFilePath: string | undefined;
          let pdfFileName: string | undefined;
          let pdfFileSize: number | undefined;

          // If provider extracted a PDF invoice buffer, save it
          if (bill.pdfBuffer && bill.pdfBuffer.length > 0) {
            const rawPdfFileName = bill.pdfFileName || `Invoice_${cleanInv.replace(/[\/\\:]/g, '_')}.pdf`;
            pdfFileName = rawPdfFileName.replace(/\s*[\r\n]+.*/g, '.pdf').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, '_').trim();
            pdfFilePath = path.join(portalInvoicesDir, pdfFileName);
            await fs.writeFile(pdfFilePath, bill.pdfBuffer);
            pdfFileSize = bill.pdfBuffer.length;
          }

          const paymentTitle = cleanPaymentTitle(bill.paymentTitle, cleanInv);

          // Upsert bill into PostgreSQL
          await prisma.bill.upsert({
            where: {
              portalId_invoiceNumber: {
                portalId: portal.id,
                invoiceNumber: cleanInv,
              },
            },
            update: {
              amountDue: bill.amountDue,
              currency: bill.currency,
              issueDate: new Date(bill.issueDate),
              dueDate: new Date(bill.dueDate),
              paymentStatus: bill.paymentStatus,
              bankAccountNumber: bill.bankAccountNumber,
              paymentTitle,
              ...(pdfFilePath ? { pdfFilePath, pdfFileName, pdfFileSize } : {}),
              rawMetadata: bill.rawMetadata as any,
            },
            create: {
              portalId: portal.id,
              invoiceNumber: cleanInv,
              amountDue: bill.amountDue,
              currency: bill.currency,
              issueDate: new Date(bill.issueDate),
              dueDate: new Date(bill.dueDate),
              paymentStatus: bill.paymentStatus,
              bankAccountNumber: bill.bankAccountNumber,
              paymentTitle,
              pdfFilePath,
              pdfFileName,
              pdfFileSize,
              rawMetadata: bill.rawMetadata as any,
            },
          });

          importedCount++;
        }

        // Clean up any bills in the database older than 12 months for this portal
        const prunedOldCount = await BillService.deleteBillsOlderThan12Months(portal.id);
        if (prunedOldCount > 0) {
          logger.info(`[Worker] Cleaned up ${prunedOldCount} bills older than 12 months for portal ${portal.id}`);
        }

        // If agreementFilter is active, remove any existing bills for this portal that are not in the extracted bills
        if (portal.agreementFilter && portal.agreementFilter.trim().length > 0) {
          const validInvoiceNumbers = extractedBills
            .map((b) => cleanInvoiceNumber(b.invoiceNumber))
            .filter(Boolean) as string[];

          if (validInvoiceNumbers.length > 0) {
            const billsToPrune = await prisma.bill.findMany({
              where: {
                portalId: portal.id,
                invoiceNumber: { notIn: validInvoiceNumbers },
              },
              select: { id: true, pdfFilePath: true },
            });

            for (const b of billsToPrune) {
              if (b.pdfFilePath) {
                await fs.unlink(b.pdfFilePath).catch(() => {});
              }
            }

            const pruneResult = await prisma.bill.deleteMany({
              where: {
                id: { in: billsToPrune.map((b) => b.id) },
              },
            });
            if (pruneResult.count > 0) {
              logger.info(`[Worker] Pruned ${pruneResult.count} bills for portal ${portal.id} not matching agreement filter "${portal.agreementFilter}"`);
            }
          }
        }

        // 5. Mark success
        await prisma.syncJob.update({
          where: { id: syncJobId },
          data: {
            status: 'SUCCESS',
            finishedAt: new Date(),
            billsFound: extractedBills.length,
            billsImported: importedCount,
          },
        });

        await prisma.portal.update({
          where: { id: portal.id },
          data: {
            lastSyncStatus: 'SUCCESS',
            lastSyncMessage: `Pobieranie zakończone: pobrano ${importedCount} faktur`,
            lastSyncedAt: new Date(),
          },
        });

        for (const uid of userIds) {
          const remainingActiveJobs = await SyncService.getRemainingActiveJobsCountForUser(uid);
          const batchStats = await SyncService.getBatchProgressForUser(uid, 100);
          wsConnectionManager.broadcastToUser(uid, {
            type: 'SYNC_COMPLETED',
            payload: {
              jobId: syncJobId,
              portalId: portal.id,
              portalName: portal.name,
              status: 'SUCCESS',
              billsFound: extractedBills.length,
              billsImported: importedCount,
              message: `Pobieranie zakończone: pomyślnie pobrano ${importedCount} faktur`,
              hasMoreJobs: remainingActiveJobs > 0,
              remainingJobsCount: remainingActiveJobs,
              currentJobIndex: batchStats.currentJobIndex,
              totalJobsCount: batchStats.totalJobsCount,
              overallProgressPercent: batchStats.overallProgressPercent,
            },
          });
        }

        logger.info(`[Worker] Sync job ${syncJobId} finished successfully. Imported: ${importedCount}`);
      } catch (err: any) {
        logger.error(`[Worker] Sync failed for job ${syncJobId} at stage "${currentStage}":`, err);

        const isReauth = err instanceof NeedsReauthError || err.message?.includes('NEEDS_REAUTH');
        const finalStatus: SyncStatus = isReauth ? 'NEEDS_REAUTH' : 'FAILED';
        const errMsg = err.message || 'Nieznany błąd scrapowania danych';
        const errStack = err.stack || String(err);

        if (isReauth || err.statusCode === 401) {
          await fs.unlink(sessionFilePath).catch(() => {});
          await prisma.portal.update({
            where: { id: portal.id },
            data: { sessionStatePath: null },
          }).catch(() => {});
        }

        const { errorTitle, generalInfo } = classifySyncError(err, currentStage);

        const errorDetails: SyncErrorDetails = {
          portalId: portal.id,
          portalName: portal.name,
          stage: currentStage,
          errorTitle,
          generalInfo,
          errorMessage: errMsg,
          errorStack: errStack,
          timestamp: new Date().toISOString(),
          jobId: syncJobId,
        };

        await prisma.syncJob.update({
          where: { id: syncJobId },
          data: {
            status: finalStatus,
            finishedAt: new Date(),
            errorMessage: `${errorTitle}: ${errMsg}`.substring(0, 500),
            logs: errorDetails as any,
          },
        });

        await prisma.portal.update({
          where: { id: portal.id },
          data: {
            lastSyncStatus: finalStatus,
            lastSyncMessage: `${errorTitle}: ${errMsg}`.substring(0, 500),
          },
        });

        for (const uid of userIds) {
          const remainingActiveJobs = await SyncService.getRemainingActiveJobsCountForUser(uid);
          const batchStats = await SyncService.getBatchProgressForUser(uid, 100);
          wsConnectionManager.broadcastToUser(uid, {
            type: 'SYNC_COMPLETED',
            payload: {
              jobId: syncJobId,
              portalId: portal.id,
              portalName: portal.name,
              status: finalStatus as any,
              billsFound: 0,
              billsImported: 0,
              message: `${errorTitle}: ${errMsg}`,
              errorDetails,
              hasMoreJobs: remainingActiveJobs > 0,
              remainingJobsCount: remainingActiveJobs,
              currentJobIndex: batchStats.currentJobIndex,
              totalJobsCount: batchStats.totalJobsCount,
              overallProgressPercent: batchStats.overallProgressPercent,
            },
          });
        }

        throw err;
      } finally {
        if (browserContext) await browserContext.close().catch(() => null);
        if (browser) await browser.close().catch(() => null);
      }
    },
    {
      connection: {
        url: config.REDIS_URL,
        maxRetriesPerRequest: null,
      },
      concurrency: 4,
    }
  );

  worker.on('failed', (job, err) => {
    logger.error(`[BullWorker] Job ${job?.id} failed with error:`, err);
  });

  return worker;
}

export { classifySyncError } from './sync.classifier.js';


