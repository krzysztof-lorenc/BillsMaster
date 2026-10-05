import { prisma } from '../db/prisma.js';
import { NotFoundError } from '../core/errors.js';
import { enqueueSync } from '../queue/sync.queue.js';
import { classifySyncError } from '../queue/sync.classifier.js';
import { wsConnectionManager } from '../ws/connectionManager.js';
import { logger } from '../core/logger.js';
import type { SyncJobDto, SyncErrorDetails, ActiveSyncDto } from '@bills-master/shared-types';

export class SyncService {
  private static syncMutex = new Set<string>();

  public static async cleanupStaleSyncJobs(): Promise<void> {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const staleJobs = await prisma.syncJob.findMany({
        where: {
          status: { in: ['QUEUED', 'RUNNING'] },
          createdAt: { lt: fiveMinutesAgo },
        },
      });

      if (staleJobs.length > 0) {
        const staleIds = staleJobs.map((j) => j.id);
        logger.warn(`[SyncService] Cleaning up ${staleJobs.length} stale sync jobs: ${staleIds.join(', ')}`);
        await prisma.syncJob.updateMany({
          where: { id: { in: staleIds } },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            errorMessage: 'Przekroczono maksymalny czas oczekiwania na zakończenie pobierania',
          },
        });

        const portalIds = staleJobs.map((j) => j.portalId);
        await prisma.portal.updateMany({
          where: { id: { in: portalIds }, lastSyncStatus: { in: ['QUEUED', 'RUNNING'] } },
          data: {
            lastSyncStatus: 'FAILED',
            lastSyncMessage: 'Przekroczono limit czasu poprzedniego zadania',
          },
        });
      }
    } catch (err) {
      logger.error('[SyncService] Error cleaning up stale jobs:', err);
    }
  }

  public static async triggerSyncForPortal(portalId: string): Promise<SyncJobDto> {
    const portal = await prisma.portal.findUnique({
      where: { id: portalId },
      include: { provider: true },
    });

    if (!portal) {
      throw new NotFoundError('Nie znaleziono portalu dostawcy');
    }

    // Clean up stale jobs if any
    await this.cleanupStaleSyncJobs();

    // Check if an active sync is already in progress or queued
    const activeJob = await prisma.syncJob.findFirst({
      where: {
        portalId: portal.id,
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (activeJob) {
      logger.info(`[SyncService] Active sync job ${activeJob.id} already exists for portal ${portal.name}. Reusing existing job.`);
      return {
        id: activeJob.id,
        portalId: activeJob.portalId,
        portalName: portal.name,
        status: activeJob.status,
        startedAt: activeJob.startedAt?.toISOString() || null,
        finishedAt: activeJob.finishedAt?.toISOString() || null,
        billsFound: activeJob.billsFound,
        billsImported: activeJob.billsImported,
        errorMessage: activeJob.errorMessage,
        createdAt: activeJob.createdAt.toISOString(),
      };
    }

    // Prevent concurrent enqueues for the same portal
    if (this.syncMutex.has(portal.id)) {
      logger.info(`[SyncService] Sync already being initialized for portal ${portal.name}. Skipping.`);
      const latest = await prisma.syncJob.findFirst({
        where: { portalId: portal.id },
        orderBy: { createdAt: 'desc' },
      });
      if (latest) {
        return {
          id: latest.id,
          portalId: latest.portalId,
          portalName: portal.name,
          status: latest.status,
          startedAt: latest.startedAt?.toISOString() || null,
          finishedAt: latest.finishedAt?.toISOString() || null,
          billsFound: latest.billsFound,
          billsImported: latest.billsImported,
          errorMessage: latest.errorMessage,
          createdAt: latest.createdAt.toISOString(),
        };
      }
    }

    this.syncMutex.add(portal.id);
    try {
      const syncJob = await prisma.syncJob.create({
        data: {
          portalId: portal.id,
          status: 'QUEUED',
        },
      });

      await prisma.portal.update({
        where: { id: portal.id },
        data: {
          lastSyncStatus: 'QUEUED',
          lastSyncMessage: 'Zlecono pobieranie faktur',
        },
      });

      await enqueueSync(portal.id, syncJob.id);

      return {
        id: syncJob.id,
        portalId: syncJob.portalId,
        portalName: portal.name,
        status: syncJob.status,
        startedAt: null,
        finishedAt: null,
        billsFound: 0,
        billsImported: 0,
        errorMessage: null,
        createdAt: syncJob.createdAt.toISOString(),
      };
    } finally {
      this.syncMutex.delete(portal.id);
    }
  }

  public static async triggerSyncForAllUserPortals(userId: string): Promise<SyncJobDto[]> {
    const userGroups = await prisma.userGroup.findMany({
      where: { userId },
      select: { groupId: true },
    });

    if (userGroups.length === 0) return [];

    const groupIds = userGroups.map((ug) => ug.groupId);
    const groupPortals = await prisma.groupPortal.findMany({
      where: { groupId: { in: groupIds } },
      select: { portalId: true },
    });

    const portalIds = Array.from(new Set(groupPortals.map((gp) => gp.portalId)));
    const portals = await prisma.portal.findMany({
      where: {
        id: { in: portalIds },
        isEnabled: true,
      },
    });

    // Clean up stale jobs if any
    await this.cleanupStaleSyncJobs();

    const jobs: SyncJobDto[] = [];

    for (const portal of portals) {
      // Check if this portal already has an active sync job
      const activeJob = await prisma.syncJob.findFirst({
        where: {
          portalId: portal.id,
          status: { in: ['QUEUED', 'RUNNING'] },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (activeJob) {
        logger.info(`[SyncService] Portal ${portal.name} already has active sync job ${activeJob.id}. Skipping duplicate enqueue.`);
        jobs.push({
          id: activeJob.id,
          portalId: activeJob.portalId,
          portalName: portal.name,
          status: activeJob.status,
          startedAt: activeJob.startedAt?.toISOString() || null,
          finishedAt: activeJob.finishedAt?.toISOString() || null,
          billsFound: activeJob.billsFound,
          billsImported: activeJob.billsImported,
          errorMessage: activeJob.errorMessage,
          createdAt: activeJob.createdAt.toISOString(),
        });
        continue;
      }

      if (this.syncMutex.has(portal.id)) {
        continue;
      }

      this.syncMutex.add(portal.id);
      try {
        const syncJob = await prisma.syncJob.create({
          data: {
            portalId: portal.id,
            status: 'QUEUED',
          },
        });

        await prisma.portal.update({
          where: { id: portal.id },
          data: {
            lastSyncStatus: 'QUEUED',
            lastSyncMessage: 'Pobieranie zakolejkowane',
          },
        });

        await enqueueSync(portal.id, syncJob.id);

        jobs.push({
          id: syncJob.id,
          portalId: syncJob.portalId,
          portalName: portal.name,
          status: syncJob.status,
          startedAt: null,
          finishedAt: null,
          billsFound: 0,
          billsImported: 0,
          errorMessage: null,
          createdAt: syncJob.createdAt.toISOString(),
        });
      } finally {
        this.syncMutex.delete(portal.id);
      }
    }

    return jobs;
  }

  public static async triggerDailySyncForAllPortals(): Promise<SyncJobDto[]> {
    const portals = await prisma.portal.findMany({
      where: {
        isEnabled: true,
      },
    });

    // Clean up stale jobs if any
    await this.cleanupStaleSyncJobs();

    const jobs: SyncJobDto[] = [];

    for (const portal of portals) {
      const activeJob = await prisma.syncJob.findFirst({
        where: {
          portalId: portal.id,
          status: { in: ['QUEUED', 'RUNNING'] },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (activeJob) {
        logger.info(`[SyncService] Portal ${portal.name} already has active sync job ${activeJob.id}. Skipping daily sync.`);
        continue;
      }

      if (this.syncMutex.has(portal.id)) {
        continue;
      }

      this.syncMutex.add(portal.id);
      try {
        const syncJob = await prisma.syncJob.create({
          data: {
            portalId: portal.id,
            status: 'QUEUED',
          },
        });

        await prisma.portal.update({
          where: { id: portal.id },
          data: {
            lastSyncStatus: 'QUEUED',
            lastSyncMessage: 'Zaplanowane nocne pobieranie faktur (03:00)',
          },
        });

        await enqueueSync(portal.id, syncJob.id);

        jobs.push({
          id: syncJob.id,
          portalId: syncJob.portalId,
          portalName: portal.name,
          status: syncJob.status,
          startedAt: null,
          finishedAt: null,
          billsFound: 0,
          billsImported: 0,
          errorMessage: null,
          createdAt: syncJob.createdAt.toISOString(),
        });
      } finally {
        this.syncMutex.delete(portal.id);
      }
    }

    logger.info(`[SyncService] Daily 3:00 AM sync scheduled for ${jobs.length} portals.`);
    return jobs;
  }

  public static async triggerScheduledSyncForFrequencies(frequencies: number[]): Promise<SyncJobDto[]> {
    if (!frequencies || frequencies.length === 0) return [];

    const portals = await prisma.portal.findMany({
      where: {
        isEnabled: true,
        syncFrequency: { in: frequencies },
      },
    });

    // Clean up stale jobs if any
    await this.cleanupStaleSyncJobs();

    const jobs: SyncJobDto[] = [];

    for (const portal of portals) {
      const activeJob = await prisma.syncJob.findFirst({
        where: {
          portalId: portal.id,
          status: { in: ['QUEUED', 'RUNNING'] },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (activeJob) {
        logger.info(`[SyncService] Portal ${portal.name} already has active sync job ${activeJob.id}. Skipping scheduled sync.`);
        continue;
      }

      if (this.syncMutex.has(portal.id)) {
        continue;
      }

      this.syncMutex.add(portal.id);
      try {
        const syncJob = await prisma.syncJob.create({
          data: {
            portalId: portal.id,
            status: 'QUEUED',
          },
        });

        await prisma.portal.update({
          where: { id: portal.id },
          data: {
            lastSyncStatus: 'QUEUED',
            lastSyncMessage: `Zaplanowane okresowe odświeżanie (${portal.syncFrequency}x na dobę)`,
          },
        });

        await enqueueSync(portal.id, syncJob.id);

        jobs.push({
          id: syncJob.id,
          portalId: syncJob.portalId,
          portalName: portal.name,
          status: syncJob.status,
          startedAt: null,
          finishedAt: null,
          billsFound: 0,
          billsImported: 0,
          errorMessage: null,
          createdAt: syncJob.createdAt.toISOString(),
        });
      } finally {
        this.syncMutex.delete(portal.id);
      }
    }

    logger.info(`[SyncService] Scheduled sync finished enqueuing: ${jobs.length} portals queued (frequencies: ${frequencies.join(', ')}x/day).`);
    return jobs;
  }

  public static async getRemainingActiveJobsCountForUser(userId: string): Promise<number> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    let portalIds: string[] = [];
    if (user?.role === 'ADMIN') {
      const allPortals = await prisma.portal.findMany({ select: { id: true } });
      portalIds = allPortals.map((p) => p.id);
    } else {
      const userGroups = await prisma.userGroup.findMany({
        where: { userId },
        select: { groupId: true },
      });

      if (userGroups.length === 0) return 0;

      const groupIds = userGroups.map((ug) => ug.groupId);
      const groupPortals = await prisma.groupPortal.findMany({
        where: { groupId: { in: groupIds } },
        select: { portalId: true },
      });

      portalIds = Array.from(new Set(groupPortals.map((gp) => gp.portalId)));
    }

    if (portalIds.length === 0) return 0;

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return prisma.syncJob.count({
      where: {
        portalId: { in: portalIds },
        status: { in: ['QUEUED', 'RUNNING'] },
        createdAt: { gte: fiveMinutesAgo },
      },
    });
  }

  public static async getBatchProgressForUser(
    userId: string,
    currentJobPercent = 0
  ): Promise<{
    currentJobIndex: number;
    totalJobsCount: number;
    overallProgressPercent: number;
  }> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      let portalIds: string[] = [];
      if (user?.role === 'ADMIN') {
        const allPortals = await prisma.portal.findMany({ select: { id: true } });
        portalIds = allPortals.map((p) => p.id);
      } else {
        const userGroups = await prisma.userGroup.findMany({
          where: { userId },
          select: { groupId: true },
        });
        if (userGroups.length === 0) {
          return { currentJobIndex: 1, totalJobsCount: 1, overallProgressPercent: currentJobPercent };
        }
        const groupIds = userGroups.map((ug) => ug.groupId);
        const groupPortals = await prisma.groupPortal.findMany({
          where: { groupId: { in: groupIds } },
          select: { portalId: true },
        });
        portalIds = Array.from(new Set(groupPortals.map((gp) => gp.portalId)));
      }

      if (portalIds.length === 0) {
        return { currentJobIndex: 1, totalJobsCount: 1, overallProgressPercent: currentJobPercent };
      }

      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const activeJobs = await prisma.syncJob.findMany({
        where: {
          portalId: { in: portalIds },
          status: { in: ['QUEUED', 'RUNNING'] },
          createdAt: { gte: tenMinutesAgo },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (activeJobs.length === 0) {
        return { currentJobIndex: 1, totalJobsCount: 1, overallProgressPercent: 100 };
      }

      const batchStart = new Date(activeJobs[0].createdAt.getTime() - 15000);

      const completedJobsCount = await prisma.syncJob.count({
        where: {
          portalId: { in: portalIds },
          status: { in: ['SUCCESS', 'FAILED', 'NEEDS_REAUTH'] },
          createdAt: { gte: batchStart },
        },
      });

      const totalJobsCount = Math.max(1, completedJobsCount + activeJobs.length);
      const currentJobIndex = Math.min(totalJobsCount, completedJobsCount + 1);
      const overallProgressPercent = Math.min(
        100,
        Math.max(
          0,
          Math.round(((completedJobsCount * 100) + currentJobPercent) / totalJobsCount)
        )
      );

      return {
        currentJobIndex,
        totalJobsCount,
        overallProgressPercent,
      };
    } catch (err) {
      logger.error('[SyncService] Error calculating batch progress:', err);
      return {
        currentJobIndex: 1,
        totalJobsCount: 1,
        overallProgressPercent: currentJobPercent,
      };
    }
  }

  public static async getActiveSyncForUser(userId: string): Promise<ActiveSyncDto | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    let portalIds: string[] = [];
    if (user?.role === 'ADMIN') {
      const allPortals = await prisma.portal.findMany({ select: { id: true } });
      portalIds = allPortals.map((p) => p.id);
    } else {
      const userGroups = await prisma.userGroup.findMany({
        where: { userId },
        select: { groupId: true },
      });
      if (userGroups.length === 0) return null;
      const groupIds = userGroups.map((ug) => ug.groupId);
      const groupPortals = await prisma.groupPortal.findMany({
        where: { groupId: { in: groupIds } },
        select: { portalId: true },
      });
      portalIds = Array.from(new Set(groupPortals.map((gp) => gp.portalId)));
    }
    if (portalIds.length === 0) return null;

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const activeJobsCount = await prisma.syncJob.count({
      where: {
        portalId: { in: portalIds },
        status: { in: ['QUEUED', 'RUNNING'] },
        createdAt: { gte: fiveMinutesAgo },
      },
    });

    // 1. Check in-memory tracker in wsConnectionManager
    const memActive = wsConnectionManager.getActiveSyncForPortalIds(portalIds);
    if (memActive) {
      if (memActive.progressPercent >= 100 || memActive.status === 'SUCCESS' || memActive.status === 'FAILED') {
        wsConnectionManager.clearActiveSync(memActive.portalId);
      } else {
        const batchStats = await this.getBatchProgressForUser(userId, memActive.progressPercent);
        return {
          ...memActive,
          hasMoreJobs: activeJobsCount > 1,
          remainingJobsCount: activeJobsCount,
          currentJobIndex: batchStats.currentJobIndex,
          totalJobsCount: batchStats.totalJobsCount,
          overallProgressPercent: batchStats.overallProgressPercent,
        };
      }
    }

    // 2. Check DB for active job in the last 5 minutes
    const activeJob = await prisma.syncJob.findFirst({
      where: {
        portalId: { in: portalIds },
        status: { in: ['QUEUED', 'RUNNING'] },
        createdAt: { gte: fiveMinutesAgo },
      },
      include: {
        portal: {
          include: { provider: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!activeJob) {
      return null;
    }

    const currentPercent = activeJob.status === 'RUNNING' ? 25 : 10;
    const batchStats = await this.getBatchProgressForUser(userId, currentPercent);

    return {
      jobId: activeJob.id,
      portalId: activeJob.portalId,
      portalName: activeJob.portal.name,
      providerId: activeJob.portal.providerId,
      providerName: activeJob.portal.provider.name,
      status: activeJob.status,
      progressPercent: currentPercent,
      message: activeJob.portal.lastSyncMessage || 'Trwa pobieranie danych...',
      startedAt: activeJob.startedAt?.toISOString() || activeJob.createdAt.toISOString(),
      hasMoreJobs: activeJobsCount > 1,
      remainingJobsCount: activeJobsCount,
      currentJobIndex: batchStats.currentJobIndex,
      totalJobsCount: batchStats.totalJobsCount,
      overallProgressPercent: batchStats.overallProgressPercent,
    };
  }

  public static async getRecentSyncJobsForUser(userId: string, limit = 10): Promise<SyncJobDto[]> {
    const userGroups = await prisma.userGroup.findMany({
      where: { userId },
      select: { groupId: true },
    });

    if (userGroups.length === 0) return [];

    const groupIds = userGroups.map((ug) => ug.groupId);
    const groupPortals = await prisma.groupPortal.findMany({
      where: { groupId: { in: groupIds } },
      select: { portalId: true },
    });

    const portalIds = Array.from(new Set(groupPortals.map((gp) => gp.portalId)));

    const jobs = await prisma.syncJob.findMany({
      where: { portalId: { in: portalIds } },
      include: { portal: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return jobs.map((j) => {
      let errorDetails: SyncErrorDetails | null = null;
      if (j.logs && typeof j.logs === 'object') {
        const logs = j.logs as any;
        if (logs.errorTitle && logs.errorMessage) {
          errorDetails = {
            portalId: j.portalId,
            portalName: j.portal.name,
            stage: logs.stage || 'Pobieranie danych',
            errorTitle: logs.errorTitle,
            generalInfo: logs.generalInfo || 'Wystąpił błąd podczas komunikacji z serwisem dostawcy.',
            errorMessage: logs.errorMessage,
            errorStack: logs.errorStack || null,
            timestamp: logs.timestamp || j.createdAt.toISOString(),
            jobId: j.id,
          };
        }
      }

      return {
        id: j.id,
        portalId: j.portalId,
        portalName: j.portal.name,
        status: j.status,
        startedAt: j.startedAt?.toISOString() || null,
        finishedAt: j.finishedAt?.toISOString() || null,
        billsFound: j.billsFound,
        billsImported: j.billsImported,
        errorMessage: j.errorMessage,
        errorDetails,
        createdAt: j.createdAt.toISOString(),
      };
    });
  }

  public static async getActiveErrorForUser(userId: string): Promise<SyncErrorDetails | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    let portalIds: string[] = [];
    if (user?.role === 'ADMIN') {
      const allPortals = await prisma.portal.findMany({ select: { id: true } });
      portalIds = allPortals.map((p) => p.id);
    } else {
      const userGroups = await prisma.userGroup.findMany({
        where: { userId },
        select: { groupId: true },
      });
      if (userGroups.length === 0) return null;
      const groupIds = userGroups.map((ug) => ug.groupId);
      const groupPortals = await prisma.groupPortal.findMany({
        where: { groupId: { in: groupIds } },
        select: { portalId: true },
      });
      portalIds = Array.from(new Set(groupPortals.map((gp) => gp.portalId)));
    }
    if (portalIds.length === 0) return null;

    // Check if any portal has an active error status (FAILED or NEEDS_REAUTH)
    const errorPortals = await prisma.portal.findMany({
      where: {
        id: { in: portalIds },
        lastSyncStatus: { in: ['FAILED', 'NEEDS_REAUTH'] },
      },
      select: { id: true, name: true, lastSyncStatus: true, lastSyncMessage: true },
    });

    if (errorPortals.length === 0) {
      return null;
    }

    const failedPortalIds = errorPortals.map((p) => p.id);

    // Find the latest failed sync job for these portals
    const latestFailedJob = await prisma.syncJob.findFirst({
      where: {
        portalId: { in: failedPortalIds },
        status: { in: ['FAILED', 'NEEDS_REAUTH'] },
      },
      include: { portal: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestFailedJob) {
      const p = errorPortals[0];
      const classification = classifySyncError({ message: p.lastSyncMessage }, 'Pobieranie danych');
      return {
        portalId: p.id,
        portalName: p.name,
        stage: 'Pobieranie danych',
        errorTitle: classification.errorTitle,
        generalInfo: classification.generalInfo,
        errorMessage: p.lastSyncMessage || 'Błąd synchronizacji danych',
        errorStack: null,
        timestamp: new Date().toISOString(),
      };
    }

    if (latestFailedJob.logs && typeof latestFailedJob.logs === 'object') {
      const logs = latestFailedJob.logs as any;
      if (logs.errorTitle && logs.errorMessage) {
        return {
          portalId: latestFailedJob.portalId,
          portalName: latestFailedJob.portal.name,
          stage: logs.stage || 'Pobieranie danych',
          errorTitle: logs.errorTitle,
          generalInfo: logs.generalInfo || 'Wystąpił błąd podczas komunikacji z serwisem dostawcy.',
          errorMessage: logs.errorMessage,
          errorStack: logs.errorStack || null,
          timestamp: logs.timestamp || latestFailedJob.createdAt.toISOString(),
          jobId: latestFailedJob.id,
        };
      }
    }

    const classification = classifySyncError({ message: latestFailedJob.errorMessage }, 'Pobieranie danych');
    return {
      portalId: latestFailedJob.portalId,
      portalName: latestFailedJob.portal.name,
      stage: 'Pobieranie danych',
      errorTitle: classification.errorTitle,
      generalInfo: classification.generalInfo,
      errorMessage: latestFailedJob.errorMessage || 'Błąd synchronizacji',
      errorStack: null,
      timestamp: latestFailedJob.createdAt.toISOString(),
      jobId: latestFailedJob.id,
    };
  }
}

