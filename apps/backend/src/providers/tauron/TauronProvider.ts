import type { Page } from 'playwright';
import fs from 'node:fs/promises';
import type { IBillProvider, ScrapeContext, AuthResult } from '../IBillProvider.js';
import type { ExtractedBill, ProviderCredentials } from '@bills-master/shared-types';
import { TAURON_CONFIG } from './selectors.js';
import { NeedsReauthError, AppError } from '../../core/errors.js';
import { cleanInvoiceNumber, isOlderThan12Months } from '../../core/utils.js';

export class TauronProvider implements IBillProvider {
  public readonly id = 'tauron';
  public readonly displayName = 'Tauron eBOK';
  public readonly loginUrl = TAURON_CONFIG.loginUrl;

  public async authenticate(
    page: Page,
    creds: ProviderCredentials,
    context: ScrapeContext
  ): Promise<AuthResult> {
    context.log.info('[TauronProvider] Starting authentication sequence...');
    await context.reportProgress(10, 'Łączenie z portalem Tauron eBOK...');

    // 1. If existing session cookies exist, check if we're already logged in
    try {
      await page.goto(TAURON_CONFIG.dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(2000);

      const isAlreadyLoggedIn = await page.$(TAURON_CONFIG.selectors.loggedInIndicator);
      if (isAlreadyLoggedIn) {
        context.log.info('[TauronProvider] Existing session is active and valid.');
        await context.reportProgress(30, 'Przywrócono aktywną sesję Tauron.');
        const state = await context.browserContext.storageState();
        const accountSummary = await this.extractAccountSummary(page);
        return { sessionState: state, accountSummary };
      }
    } catch {
      context.log.info('[TauronProvider] No active session, proceeding with standard login form.');
    }

    // 2. Navigate to login page
    await context.reportProgress(20, 'Otwieranie strony logowania Tauron...');
    await page.goto(TAURON_CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

    // Handle cookie consent if visible
    try {
      const cookieBtn = await page.waitForSelector(TAURON_CONFIG.selectors.cookieAcceptBtn, { timeout: 4000 });
      if (cookieBtn) {
        await cookieBtn.click();
        await page.waitForTimeout(600);
      }
    } catch {
      // Cookie banner not present or already accepted
    }

    // 3. Fill username and password
    await context.reportProgress(35, 'Wprowadzanie danych logowania...');
    const usernameEl = await page.waitForSelector(TAURON_CONFIG.selectors.usernameInput, { timeout: 15000 });
    if (!usernameEl) {
      throw new AppError('Nie znaleziono pola na login w portalu Tauron', 502);
    }
    await usernameEl.fill(creds.login);

    const passwordEl = await page.waitForSelector(TAURON_CONFIG.selectors.passwordInput, { timeout: 15000 });
    if (!passwordEl) {
      throw new AppError('Nie znaleziono pola na hasło w portalu Tauron', 502);
    }
    await passwordEl.fill(creds.password);

    await context.reportProgress(45, 'Wysyłanie formularza logowania...');
    const submitBtn = await page.$(TAURON_CONFIG.selectors.submitBtn);
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }

    // Wait for either landing on dashboard, or error alert/challenge appearing
    try {
      await Promise.race([
        page.waitForURL((url) => url.hostname.includes('moj.tauron.pl'), { timeout: 30000, waitUntil: 'domcontentloaded' }),
        page.waitForSelector(TAURON_CONFIG.selectors.loginError, { timeout: 30000 }),
        page.waitForSelector(TAURON_CONFIG.selectors.twoFactorPrompt, { timeout: 30000 }),
        page.waitForSelector(TAURON_CONFIG.selectors.captchaContainer, { timeout: 30000 }),
      ]);
    } catch {
      // Fallback
    }

    await page.waitForTimeout(1500);

    // 4. Check for 2FA challenge, Captcha, or invalid credentials
    const is2FA = await page.$(TAURON_CONFIG.selectors.twoFactorPrompt);
    if (is2FA) {
      throw new NeedsReauthError('Portal Tauron wymaga weryfikacji kodem SMS / 2FA. Wymagane logowanie ręczne.');
    }

    const isCaptcha = await page.$(TAURON_CONFIG.selectors.captchaContainer);
    if (isCaptcha) {
      throw new NeedsReauthError('Portal Tauron wyświetlił zabezpieczenie CAPTCHA.');
    }

    const loginError = await page.$(TAURON_CONFIG.selectors.loginError);
    if (loginError) {
      const errorText = (await loginError.innerText()) || 'Nieprawidłowy e-mail lub hasło';
      throw new AppError(`Błąd logowania do portalu Tauron: ${errorText.trim()}`, 401);
    }

    // 5. Verify successful login
    await page.waitForSelector(TAURON_CONFIG.selectors.loggedInIndicator, { timeout: 20000 }).catch(() => null);

    const accountSummary = await this.extractAccountSummary(page);
    
    // Save storage state (cookies, localStorage)
    const sessionState = await context.browserContext.storageState();
    await context.reportProgress(50, 'Logowanie zakończone pomyślnie.');

    return { sessionState, accountSummary };
  }

  public async fetchBills(
    page: Page,
    context: ScrapeContext
  ): Promise<ExtractedBill[]> {
    context.log.info('[TauronProvider] Navigating to Tauron bills and payments section...');
    await context.reportProgress(55, 'Pobieranie indywidualnych numerów kont ze strony Tauron...');

    // 1. Fetch bank accounts from /Home/Pages/numery-kont
    const { clientToIban, nameToIban, defaultIban } = await this.fetchBankAccountsFromPage(page, context);

    await context.reportProgress(65, 'Wczytywanie listy faktur i rozliczeń...');

    // 2. Load active invoices page
    await page.goto(TAURON_CONFIG.invoicesUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2500);

    const extractedBills: ExtractedBill[] = [];
    const seenInvoiceNumbers = new Set<string>();

    let filterRegex: RegExp | null = null;
    if (context.agreementFilter && context.agreementFilter.trim().length > 0) {
      try {
        filterRegex = new RegExp(context.agreementFilter.trim(), 'i');
        context.log.info(`[TauronProvider] Using agreement filter regex: /${context.agreementFilter.trim()}/i`);
      } catch (err) {
        context.log.warn(`[TauronProvider] Invalid agreement filter regex "${context.agreementFilter}": ${err}. All agreements will be scraped.`);
      }
    }

    // 3. Check if multiple agreement blocks exist under #itemList
    const agreementBlocks = await page.$$('#itemList .invoice-row');
    const allTables = await page.$$('table[data-invoices-table]');
    const matchedClientNumbers = new Set<string>();
    const clientToAgreementMap = new Map<string, string>();

    if (agreementBlocks.length > 0) {
      context.log.info(`[TauronProvider] Found ${agreementBlocks.length} agreement blocks and ${allTables.length} tables in portal`);

      for (let i = 0; i < agreementBlocks.length; i++) {
        const block = agreementBlocks[i];

        // Extract agreement name from h3
        const h3El = await block.$('h3');
        let agreementName = (await h3El?.innerText())?.trim() || '';

        // Extract client number
        const clientEl = await block.$('.client-numer-label');
        const clientText = (await clientEl?.innerText()) || '';
        const clientMatch = clientText.match(/(?:Numer|Nr)\s+(?:adresata|płatnika)[:\s]+(\d+)/i);
        const clientNumber = clientMatch ? clientMatch[1] : undefined;

        // Fallback name if generic
        if (!agreementName || agreementName.toLowerCase().includes('nazwę') || agreementName.toLowerCase().includes('nadaj')) {
          const addrEl = await block.$('.float-box p');
          const addrText = (await addrEl?.innerText())?.replace(/\n+/g, ' ')?.trim() || '';
          if (addrText) {
            agreementName = addrText;
          } else if (clientNumber) {
            agreementName = `Klient ${clientNumber}`;
          } else {
            agreementName = `Umowa ${i + 1}`;
          }
        }

        // Check against regex filter
        if (filterRegex) {
          const nameMatches = filterRegex.test(agreementName);
          const clientMatches = clientNumber ? filterRegex.test(clientNumber) : false;
          if (!nameMatches && !clientMatches) {
            context.log.info(`[TauronProvider] Skipping agreement "${agreementName}" (client: ${clientNumber || 'N/A'}) — does not match regex /${context.agreementFilter}/i`);
            continue;
          }
        }

        if (clientNumber) {
          matchedClientNumbers.add(clientNumber);
          clientToAgreementMap.set(clientNumber, agreementName);
          clientToAgreementMap.set(clientNumber.slice(-6), agreementName);
        }

        context.log.info(`[TauronProvider] Processing agreement: "${agreementName}" (client: ${clientNumber || 'N/A'})`);
        const progressPct = 65 + Math.floor(((i + 1) / agreementBlocks.length) * 20);
        await context.reportProgress(progressPct, `Odczytywanie faktur dla: ${agreementName}...`);

        // Expand agreement section if collapsed
        const toggleBtn = await block.$('a.toggle-button');
        if (toggleBtn) {
          try {
            await toggleBtn.click();
            await page.waitForTimeout(1200);
          } catch {
            // Ignore
          }
        }

        // Re-query tables after expansion
        const currentTables = await page.$$('table[data-invoices-table]');
        let tableEl: import('playwright').ElementHandle<SVGElement | HTMLElement> | null = null;
        if (currentTables[i]) {
          tableEl = currentTables[i];
        } else if (clientNumber) {
          tableEl = await page.$(`.table-inside[data-contractor-number="${clientNumber}"] table`);
        }

        const ibanForAgreement = (clientNumber && clientToIban.get(clientNumber))
          || (clientNumber && clientToIban.get(clientNumber.slice(-6)))
          || (agreementName && nameToIban.get(agreementName.toLowerCase()))
          || defaultIban;

        if (tableEl) {
          await this.parseInvoicesFromTable(
            page,
            tableEl,
            context,
            extractedBills,
            seenInvoiceNumbers,
            ibanForAgreement,
            agreementName,
            clientNumber,
            false
          );
        } else {
          context.log.warn(`[TauronProvider] Table not found for agreement "${agreementName}"`);
        }
      }
    } else {
      context.log.info('[TauronProvider] No #itemList .invoice-row found; using standard full-page table parsing');
      await this.parseInvoicesFromPage(
        page,
        context,
        extractedBills,
        seenInvoiceNumbers,
        defaultIban,
        false,
        filterRegex,
        matchedClientNumbers,
        clientToAgreementMap,
        clientToIban,
        nameToIban
      );
    }

    // 4. Parse historical / archived invoices
    try {
      await context.reportProgress(88, 'Wczytywanie faktur archiwalnych...');
      await page.goto(TAURON_CONFIG.archiveInvoicesUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector(TAURON_CONFIG.selectors.invoiceRow, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1000);

      // Expand all archive agreement blocks if collapsed
      const archiveToggles = await page.$$('#ebokItems a.toggle-button, .toggle-button');
      for (const t of archiveToggles) {
        try {
          await t.click();
          await page.waitForTimeout(500);
        } catch {
          // Ignore
        }
      }
      await page.waitForSelector(TAURON_CONFIG.selectors.invoiceRow, { timeout: 5000 }).catch(() => {});

      await this.parseInvoicesFromPage(
        page,
        context,
        extractedBills,
        seenInvoiceNumbers,
        defaultIban,
        true,
        filterRegex,
        matchedClientNumbers,
        clientToAgreementMap,
        clientToIban,
        nameToIban
      );

      // Check for additional pages in archive (page 2, 3...)
      let currentPage = 1;
      const maxPages = 5;
      while (currentPage < maxPages) {
        const nextPageNum = currentPage + 1;
        const hasNextPage = await page.evaluate((nextPage) => {
          const pageLink = document.querySelector(`.pagination a[data-page="${nextPage}"], .pagination a:not(.active)`) as HTMLElement | null;
          if (pageLink && pageLink.getAttribute('data-page') === String(nextPage)) {
            pageLink.click();
            return true;
          }
          return false;
        }, nextPageNum);

        if (!hasNextPage) break;

        context.log.info(`[TauronProvider] Navigating to archive page ${nextPageNum}...`);
        await page.waitForTimeout(1500);
        await page.waitForSelector(TAURON_CONFIG.selectors.invoiceRow, { timeout: 10000 }).catch(() => {});
        currentPage++;

        await this.parseInvoicesFromPage(
          page,
          context,
          extractedBills,
          seenInvoiceNumbers,
          defaultIban,
          true,
          filterRegex,
          matchedClientNumbers,
          clientToAgreementMap,
          clientToIban,
          nameToIban
        );
      }
    } catch (e) {
      context.log.warn(`[TauronProvider] Could not load archived invoices: ${e}`);
    }

    await context.reportProgress(95, `Odczytano ${extractedBills.length} faktur z portalu Tauron.`);
    return extractedBills;
  }

  private async parseInvoicesFromTable(
    page: Page,
    tableEl: import('playwright').ElementHandle<SVGElement | HTMLElement>,
    context: ScrapeContext,
    extractedBills: ExtractedBill[],
    seenInvoiceNumbers: Set<string>,
    bankAccountNumber: string | undefined,
    agreementName: string,
    clientNumber?: string,
    isArchive: boolean = false
  ): Promise<void> {
    const rows = await tableEl.$$('tbody tr');
    context.log.info(`[TauronProvider] Parsing ${rows.length} rows for agreement "${agreementName}"`);

    for (let i = 0; i < rows.length; i++) {
      try {
        const row = rows[i];
        const rowText = await row.innerText();
        if (!rowText || rowText.trim().length < 5) continue;

        const docLink = await row.$(TAURON_CONFIG.selectors.invoiceNumber);
        let rawInvoiceNumber: string;
        if (docLink) {
          rawInvoiceNumber = (await docLink.innerText()).trim();
        } else {
          const invMatch = rowText.match(/(?:F\/|FA\/|FV\/|NR\s*|FAKTURA\s*)?([A-Z0-9\/\-_]{6,})/i);
          rawInvoiceNumber = invMatch ? invMatch[1] : `TAU-${isArchive ? 'ARCH-' : ''}${Date.now()}-${i}`;
        }
        const invoiceNumber = cleanInvoiceNumber(rawInvoiceNumber);

        if (!invoiceNumber || seenInvoiceNumbers.has(invoiceNumber)) {
          continue;
        }
        seenInvoiceNumbers.add(invoiceNumber);

        // Extract amount
        const amountEl = await row.$('.amount, input[data-charge-value]');
        const attrVal = amountEl ? ((await amountEl.getAttribute('data-charge-value')) || (await amountEl.innerText().catch(() => ''))) : null;
        const grossEl = await row.$('[data-param="AmountGross"], [data-param*="Amount"]');
        const grossVal = grossEl ? (await grossEl.innerText().catch(() => '')) : null;
        const amountDue = this.parseAmount(rowText, attrVal, grossVal);

        // Extract dates and status
        const extraDates = await row.evaluate((tr) => {
          const found: string[] = [];
          for (const el of tr.querySelectorAll('td, span, div, a')) {
            for (const attr of ['title', 'data-date', 'data-original-title', 'aria-label']) {
              const val = el.getAttribute(attr);
              if (val) {
                const matches = val.match(/\b(\d{2}[.-]\d{2}[.-]\d{4}|\d{4}[.-]\d{2}[.-]\d{2})\b/g);
                if (matches) found.push(...matches);
              }
            }
          }
          return found;
        }).catch(() => [] as string[]);

        const hasPayBtn = Boolean(await row.$('.ebok-button-pay-agreement, a:has-text("Zapłać"), button:has-text("Zapłać")'));

        const { issueDate, dueDate, paymentStatus } = this.extractDatesAndStatus(
          rowText,
          isArchive,
          hasPayBtn,
          extraDates
        );

        if (isOlderThan12Months(issueDate)) {
          context.log.info(`[TauronProvider] Skipping invoice ${invoiceNumber} older than 12 months (${issueDate.toISOString().slice(0, 10)})`);
          continue;
        }

        // Extract PDF invoice buffer (direct internal API fetch with download fallback)
        const { pdfBuffer, pdfFileName } = await this.extractPdfForRow(page, row, invoiceNumber, context);

        let finalIban = bankAccountNumber;
        if (!finalIban && pdfBuffer) {
          const pdfIban = await this.extractIbanFromPdfBuffer(pdfBuffer);
          if (pdfIban) finalIban = pdfIban;
        }

        extractedBills.push({
          invoiceNumber,
          amountDue,
          currency: 'PLN',
          issueDate,
          dueDate,
          paymentStatus,
          bankAccountNumber: finalIban || undefined,
          paymentTitle: invoiceNumber,
          pdfBuffer,
          pdfFileName,
          rawMetadata: {
            isArchive,
            agreementName,
            clientNumber,
            rawRowSnippet: rowText.slice(0, 150),
          },
        });
      } catch (err) {
        context.log.warn(`[TauronProvider] Error parsing table row ${i}: ${err}`);
      }
    }
  }

  private async parseInvoicesFromPage(
    page: Page,
    context: ScrapeContext,
    extractedBills: ExtractedBill[],
    seenInvoiceNumbers: Set<string>,
    bankAccountNumber: string | undefined,
    isArchive: boolean,
    filterRegex?: RegExp | null,
    matchedClientNumbers?: Set<string>,
    clientToAgreementMap?: Map<string, string>,
    clientToIban?: Map<string, string>,
    nameToIban?: Map<string, string>
  ): Promise<void> {
    const rows = await page.$$(TAURON_CONFIG.selectors.invoiceRow);
    context.log.info(`[TauronProvider] Found ${rows.length} rows on ${isArchive ? 'archive' : 'active'} invoices page`);

    for (let i = 0; i < rows.length; i++) {
      try {
        const row = rows[i];
        const rowText = await row.innerText();
        if (!rowText || rowText.trim().length < 5) continue;

        // Extract invoice number using document link or regex
        const docLink = await row.$(TAURON_CONFIG.selectors.invoiceNumber);
        let rawInvoiceNumber: string;
        if (docLink) {
          rawInvoiceNumber = (await docLink.innerText()).trim();
        } else {
          const invMatch = rowText.match(/(?:F\/|FA\/|FV\/|NR\s*|FAKTURA\s*)?([A-Z0-9\/\-_]{6,})/i);
          rawInvoiceNumber = invMatch ? invMatch[1] : `TAU-${isArchive ? 'ARCH-' : ''}${Date.now()}-${i}`;
        }
        const invoiceNumber = cleanInvoiceNumber(rawInvoiceNumber);

        if (!invoiceNumber || seenInvoiceNumbers.has(invoiceNumber)) {
          continue;
        }

        // Determine agreement name and client number if mapped
        let agreementName: string | undefined;
        let clientNumber: string | undefined;
        if (clientToAgreementMap) {
          for (const [key, name] of clientToAgreementMap.entries()) {
            if (invoiceNumber.includes(key) || rowText.includes(key)) {
              agreementName = name;
              if (key.length === 8) clientNumber = key;
              break;
            }
          }
        }

        // If filtering by agreement and client numbers were matched, check if invoice matches
        if (filterRegex && matchedClientNumbers && matchedClientNumbers.size > 0) {
          // In Tauron, invoice numbers typically contain PC followed by last 6 digits of clientNumber, e.g. PC585884 for client 51585884
          let matchesAnyClient = false;
          for (const cn of matchedClientNumbers) {
            const shortCn = cn.slice(-6);
            if (invoiceNumber.includes(shortCn) || rowText.includes(cn) || filterRegex.test(invoiceNumber)) {
              matchesAnyClient = true;
              break;
            }
          }
          if (!matchesAnyClient) {
            continue;
          }
        }

        seenInvoiceNumbers.add(invoiceNumber);

        // Extract amount
        const amountEl = await row.$('.amount, input[data-charge-value]');
        const attrVal = amountEl ? ((await amountEl.getAttribute('data-charge-value')) || (await amountEl.innerText().catch(() => ''))) : null;
        const grossEl = await row.$('[data-param="AmountGross"], [data-param*="Amount"]');
        const grossVal = grossEl ? (await grossEl.innerText().catch(() => '')) : null;
        const amountDue = this.parseAmount(rowText, attrVal, grossVal);

        // Extract dates and status
        const extraDates = await row.evaluate((tr) => {
          const found: string[] = [];
          for (const el of tr.querySelectorAll('td, span, div, a')) {
            for (const attr of ['title', 'data-date', 'data-original-title', 'aria-label']) {
              const val = el.getAttribute(attr);
              if (val) {
                const matches = val.match(/\b(\d{2}[.-]\d{2}[.-]\d{4}|\d{4}[.-]\d{2}[.-]\d{2})\b/g);
                if (matches) found.push(...matches);
              }
            }
          }
          return found;
        }).catch(() => [] as string[]);

        const hasPayBtn = Boolean(await row.$('.ebok-button-pay-agreement, a:has-text("Zapłać"), button:has-text("Zapłać")'));

        const { issueDate, dueDate, paymentStatus } = this.extractDatesAndStatus(
          rowText,
          isArchive,
          hasPayBtn,
          extraDates
        );

        if (isOlderThan12Months(issueDate)) {
          context.log.info(`[TauronProvider] Skipping invoice ${invoiceNumber} older than 12 months (${issueDate.toISOString().slice(0, 10)})`);
          continue;
        }

        // Extract PDF invoice buffer (direct internal API fetch with download fallback)
        const { pdfBuffer, pdfFileName } = await this.extractPdfForRow(page, row, invoiceNumber, context);

        let finalIban = bankAccountNumber;
        if (clientNumber && clientToIban?.has(clientNumber)) {
          finalIban = clientToIban.get(clientNumber);
        } else if (clientNumber && clientToIban?.has(clientNumber.slice(-6))) {
          finalIban = clientToIban.get(clientNumber.slice(-6));
        } else if (agreementName && nameToIban?.has(agreementName.toLowerCase())) {
          finalIban = nameToIban.get(agreementName.toLowerCase());
        }

        if (!finalIban && pdfBuffer) {
          const pdfIban = await this.extractIbanFromPdfBuffer(pdfBuffer);
          if (pdfIban) finalIban = pdfIban;
        }

        extractedBills.push({
          invoiceNumber,
          amountDue,
          currency: 'PLN',
          issueDate,
          dueDate,
          paymentStatus,
          bankAccountNumber: finalIban || undefined,
          paymentTitle: invoiceNumber,
          pdfBuffer,
          pdfFileName,
          rawMetadata: {
            isArchive,
            agreementName,
            clientNumber,
            rawRowSnippet: rowText.slice(0, 150),
          },
        });
      } catch (err) {
        context.log.warn(`[TauronProvider] Error parsing row ${i}: ${err}`);
      }
    }
  }

  private async extractPdfForRow(
    page: Page,
    row: import('playwright').ElementHandle<SVGElement | HTMLElement>,
    invoiceNumber: string,
    context: ScrapeContext
  ): Promise<{ pdfBuffer?: Buffer; pdfFileName?: string }> {
    const safeInv = invoiceNumber.trim().replace(/[\r\n\t]+/g, '').replace(/[\/\\:]/g, '_');
    const pdfFileName = `Tauron_${safeInv}.pdf`;

    // 1. Try direct fetch from data-base attribute (Tauron internal API endpoint)
    try {
      const docLink = await row.$(TAURON_CONFIG.selectors.downloadPdfBtn);
      if (docLink) {
        const dataBase = await docLink.getAttribute('data-base');
        if (dataBase) {
          const docBase64 = await page.evaluate(async (url) => {
            try {
              const res = await fetch(url);
              if (!res.ok) return null;
              const json = await res.json();
              return json && json.Document ? json.Document : null;
            } catch {
              return null;
            }
          }, dataBase);

          if (docBase64 && typeof docBase64 === 'string' && docBase64.length > 50) {
            const pdfBuffer = Buffer.from(docBase64, 'base64');
            context.log.info(`[TauronProvider] Successfully extracted PDF via internal API for invoice ${invoiceNumber} (${pdfBuffer.length} bytes)`);
            return { pdfBuffer, pdfFileName };
          }
        }
      }
    } catch (err) {
      context.log.warn(`[TauronProvider] Direct PDF API fetch error for invoice ${invoiceNumber}: ${err}`);
    }

    // 2. Fallback to standard Playwright download click if available and visible
    try {
      const downloadBtn = await row.$(TAURON_CONFIG.selectors.downloadPdfBtn);
      if (downloadBtn) {
        const isVisible = await downloadBtn.isVisible().catch(() => false);
        if (isVisible) {
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 6000 }),
            downloadBtn.click(),
          ]);

          const tempPath = await download.path();
          if (tempPath) {
            const pdfBuffer = await fs.readFile(tempPath);
            return { pdfBuffer, pdfFileName };
          }
        }
      }
    } catch {
      // Ignore fallback failure
    }

    return {};
  }

  private async extractAccountSummary(page: Page): Promise<{ clientNumber?: string; accountName?: string; tariff?: string }> {
    try {
      const pageText = await page.innerText('body');
      const clientMatch = pageText.match(/(?:Nr|Numer)\s+p[łl]atnika\s*(?:\/\s*adresata)?[:\s]+(\d+)/i);
      const tariffMatch = pageText.match(/Taryfa\s+([A-Z0-9]+)/i);
      const addressMatch = pageText.match(/(Ul\.\s*[^,\n]+,\s*\d{2}-\d{3}\s*[^,\n]+)/i);

      return {
        clientNumber: clientMatch ? clientMatch[1] : undefined,
        tariff: tariffMatch ? tariffMatch[1] : undefined,
        accountName: addressMatch ? addressMatch[1].replace(/\s+/g, ' ') : undefined,
      };
    } catch {
      return {};
    }
  }

  public extractDatesAndStatus(
    rowText: string,
    isArchive: boolean,
    hasPayBtn: boolean = false,
    extraDates: string[] = []
  ): { issueDate: Date; dueDate: Date; paymentStatus: 'PAID' | 'UNPAID' | 'OVERDUE' } {
    const lowerText = rowText.toLowerCase();

    // 1. Check for explicit DD.MM.YYYY / YYYY-MM-DD dates in text
    const textDates = rowText.match(/\b(\d{2}[.-]\d{2}[.-]\d{4}|\d{4}[.-]\d{2}[.-]\d{2})\b/g) || [];

    // Issue date is usually the first date found
    const issueDate = textDates.length > 0 && textDates[0]
      ? this.parseDate(textDates[0])
      : (extraDates.length > 0 && extraDates[0] ? this.parseDate(extraDates[0]) : new Date());
    issueDate.setHours(0, 0, 0, 0);

    let dueDate: Date | null = null;
    let isExplicitlyOverdue = false;
    let isExplicitlyUpcoming = false;

    // 2. Check for relative overdue phrases in rowText
    // e.g.: "14 dni temu minął termin płatności.", "termin minął 3 dni temu", "5 dni po terminie", "wczoraj minął termin"
    const overdueMatch = rowText.match(/(\d+)\s+(?:dni|dzień|dnia|dniach|d)\s+temu\s+min[aą]ł\s+termin/i)
      || rowText.match(/termin\s+(?:płatności\s+)?min[aą]ł\s+(\d+)\s+(?:dni|dzień|dnia|dniach|d)\s+temu/i)
      || rowText.match(/(\d+)\s+(?:dni|dzień|dnia|dniach|d)\s+temu/i)
      || rowText.match(/(\d+)\s+(?:dni|dzień|dnia|dniach|d)\s+po\s+terminie/i);

    if (overdueMatch && overdueMatch[1]) {
      const daysAgo = parseInt(overdueMatch[1], 10);
      if (!isNaN(daysAgo)) {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        dueDate = new Date(now);
        dueDate.setDate(dueDate.getDate() - daysAgo);
        dueDate.setHours(0, 0, 0, 0);
        isExplicitlyOverdue = true;
      }
    } else if (lowerText.includes('wczoraj minął termin') || lowerText.includes('termin minął wczoraj')) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() - 1);
      dueDate.setHours(0, 0, 0, 0);
      isExplicitlyOverdue = true;
    } else if (lowerText.includes('dzisiaj mija termin') || lowerText.includes('termin mija dzisiaj')) {
      dueDate = new Date();
      dueDate.setHours(0, 0, 0, 0);
    } else {
      // 3. Check for relative upcoming phrases
      // e.g.: "za 5 dni upływa termin płatności", "do zapłaty za 10 dni", "za 3 dni"
      const upcomingMatch = rowText.match(/za\s+(\d+)\s+(?:dni|dzień|dnia|dniach|d)\s+(?:upływa|minie|mija)?\s*termin/i)
        || rowText.match(/do\s+zapłaty\s+za\s+(\d+)\s+(?:dni|dzień|dnia|dniach|d)/i)
        || rowText.match(/za\s+(\d+)\s+(?:dni|dzień|dnia|dniach|d)/i);

      if (upcomingMatch && upcomingMatch[1]) {
        const daysAhead = parseInt(upcomingMatch[1], 10);
        if (!isNaN(daysAhead)) {
          const now = new Date();
          now.setHours(0, 0, 0, 0);
          dueDate = new Date(now);
          dueDate.setDate(dueDate.getDate() + daysAhead);
          dueDate.setHours(0, 0, 0, 0);
          isExplicitlyUpcoming = true;
        }
      }
    }

    // 4. If no relative dueDate was determined, check explicit dates
    if (!dueDate) {
      if (textDates.length >= 2 && textDates[1]) {
        dueDate = this.parseDate(textDates[1]);
        dueDate.setHours(0, 0, 0, 0);
      } else {
        // Check extra dates from HTML attributes (title, data-date)
        const candidateExtra = extraDates.find((d) => d && d !== textDates[0]);
        if (candidateExtra) {
          dueDate = this.parseDate(candidateExtra);
          dueDate.setHours(0, 0, 0, 0);
        } else {
          // Fallback: issueDate + 14 days
          dueDate = new Date(issueDate);
          dueDate.setDate(dueDate.getDate() + 14);
          dueDate.setHours(0, 0, 0, 0);
        }
      }
    }

    // 5. Status determination
    const isPaid = isArchive || lowerText.includes('opłac') || lowerText.includes('rozliczon') || lowerText.includes('zapłacono');

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const hasOverdueKeyword = lowerText.includes('minął termin')
      || lowerText.includes('po termin')
      || lowerText.includes('zaległ')
      || lowerText.includes('przeterminowan')
      || isExplicitlyOverdue;

    let paymentStatus: 'PAID' | 'UNPAID' | 'OVERDUE';
    if (isPaid) {
      paymentStatus = 'PAID';
    } else if (hasOverdueKeyword || (!isExplicitlyUpcoming && dueDate.getTime() < now.getTime())) {
      paymentStatus = 'OVERDUE';
    } else {
      paymentStatus = 'UNPAID';
    }

    return { issueDate, dueDate, paymentStatus };
  }

  public parseAmount(rowText: string, attrVal?: string | null, grossVal?: string | null): number {
    if (attrVal) {
      const match = attrVal.match(/(-?\d+(?:[.,]\d{1,2}))/);
      if (match) return parseFloat(match[1].replace(',', '.'));
    }
    if (grossVal) {
      const match = grossVal.match(/(-?\d+(?:[.,]\d{1,2})?)/);
      if (match) return parseFloat(match[1].replace(',', '.'));
    }
    const amountMatch = rowText.match(/(-?\d+(?:[.,]\d{1,2}))\s*(?:zł|PLN)/i);
    if (amountMatch) {
      return parseFloat(amountMatch[1].replace(',', '.'));
    }
    return 0.0;
  }

  public parseDate(dateStr: string): Date {
    if (dateStr.includes('.')) {
      const parts = dateStr.split('.');
      if (parts.length >= 3 && parts[0] && parts[1] && parts[2]) {
        if (parts[0].length === 4) {
          return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 0, 0, 0, 0);
        }
        return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10), 0, 0, 0, 0);
      }
    }
    if (dateStr.includes('-')) {
      const parts = dateStr.split('-');
      if (parts.length >= 3 && parts[0] && parts[1] && parts[2]) {
        if (parts[0].length === 4) {
          return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 0, 0, 0, 0);
        }
        return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10), 0, 0, 0, 0);
      }
    }
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  public async fetchBankAccountsFromPage(
    page: Page,
    context: ScrapeContext
  ): Promise<{ clientToIban: Map<string, string>; nameToIban: Map<string, string>; defaultIban?: string }> {
    const clientToIban = new Map<string, string>();
    const nameToIban = new Map<string, string>();
    let defaultIban: string | undefined;

    try {
      context.log.info('[TauronProvider] Fetching bank account numbers from /Home/Pages/numery-kont...');
      await page.goto(TAURON_CONFIG.accountsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      const accounts = await page.evaluate(() => {
        const results: Array<{ clientNumber?: string; agreementName?: string; iban: string }> = [];
        const rows = Array.from(document.querySelectorAll('#ebokItems > .row, #ebokItems .msp-item, #ebokItems > div'));
        for (const row of rows) {
          const text = (row as HTMLElement).innerText || '';
          const clientMatch = text.match(/(?:Numer|Nr)\s*(?:p[łl]atnika|adresata|\/\s*adresata|\/\s*p[łl]atnika)?[^:\d]*[:\s]+(\d{7,10})/i);
          const nameEl = row.querySelector('h3');
          const name = nameEl ? (nameEl as HTMLElement).innerText.trim() : '';

          const ibanSpan = row.querySelector('.copy-account') ? row.querySelector('.copy-account')?.parentElement?.querySelector('span') : null;
          let iban = ibanSpan ? (ibanSpan as HTMLElement).innerText.trim() : null;
          if (!iban) {
            const m = text.match(/\b(\d{2}\s*\d{4}\s*\d{4}\s*\d{4}\s*\d{4}\s*\d{4}\s*\d{4})\b/);
            if (m) iban = m[1];
          }

          if (iban) {
            let derivedClient = clientMatch ? clientMatch[1] : undefined;
            if (!derivedClient) {
              const digits = iban.replace(/\s+/g, '');
              if (digits.length === 26) {
                derivedClient = digits.slice(14, 22);
              }
            }

            results.push({
              clientNumber: derivedClient,
              agreementName: name,
              iban: iban.replace(/\s+/g, ' ').trim()
            });
          }
        }
        return results;
      });

      for (const acc of accounts) {
        const formattedIban = acc.iban.startsWith('PL ') ? acc.iban : `PL ${acc.iban}`;
        if (!defaultIban) {
          defaultIban = formattedIban;
        }
        if (acc.clientNumber) {
          clientToIban.set(acc.clientNumber, formattedIban);
          clientToIban.set(acc.clientNumber.slice(-6), formattedIban);
        }
        if (acc.agreementName) {
          nameToIban.set(acc.agreementName.toLowerCase(), formattedIban);
        }
      }

      context.log.info(`[TauronProvider] Found ${accounts.length} bank accounts on page.`);
    } catch (err) {
      context.log.warn(`[TauronProvider] Failed to fetch bank accounts from /Home/Pages/numery-kont: ${err}`);
    }

    return { clientToIban, nameToIban, defaultIban };
  }

  public async extractIbanFromPdfBuffer(pdfBuffer: Buffer | Uint8Array): Promise<string | null> {
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
      const doc = await (pdfjs as any).getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
      let fullText = '';
      for (let p = 1; p <= Math.min(doc.numPages, 3); p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        fullText += content.items.map((it: any) => it.str).join(' ') + ' ';
      }
      const match = fullText.match(/\b(\d{2}\s*\d{4}\s*\d{4}\s*\d{4}\s*\d{4}\s*\d{4}\s*\d{4})\b/);
      if (match) {
        return `PL ${match[1].replace(/\s+/g, ' ').trim()}`;
      }
    } catch {
      // PDF text extraction fallback
    }
    return null;
  }
}
