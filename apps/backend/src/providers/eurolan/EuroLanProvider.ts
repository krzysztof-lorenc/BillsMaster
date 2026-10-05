import type { Page } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import type { IBillProvider, ScrapeContext, AuthResult } from '../IBillProvider.js';
import type { ExtractedBill, ProviderCredentials } from '@bills-master/shared-types';
import { EUROLAN_CONFIG } from './selectors.js';
import { NeedsReauthError, AppError } from '../../core/errors.js';
import { cleanInvoiceNumber, isOlderThan12Months } from '../../core/utils.js';

export function cleanEuroLanIban(rawIban?: string | null): string | undefined {
  if (!rawIban) return undefined;
  const digits = rawIban.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (!digits) return undefined;
  if (digits.startsWith('PL')) {
    return digits;
  }
  return digits.length === 26 ? `PL${digits}` : digits;
}

export function parseEuroLanDate(dateStr?: string | null): Date {
  if (!dateStr) {
    const fallback = new Date();
    fallback.setHours(12, 0, 0, 0);
    return fallback;
  }
  const clean = dateStr.trim();
  // YYYY-MM-DD
  const isoMatch = clean.match(/^(\d{4})[.-](\d{1,2})[.-](\d{1,2})/);
  if (isoMatch && isoMatch[1] && isoMatch[2] && isoMatch[3]) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const d = new Date(year, month, day, 12, 0, 0, 0);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  // DD.MM.YYYY
  const dotMatch = clean.match(/^(\d{1,2})[.-](\d{1,2})[.-](\d{4})/);
  if (dotMatch && dotMatch[1] && dotMatch[2] && dotMatch[3]) {
    const day = parseInt(dotMatch[1], 10);
    const month = parseInt(dotMatch[2], 10) - 1;
    const year = parseInt(dotMatch[3], 10);
    const d = new Date(year, month, day, 12, 0, 0, 0);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  const fallback = new Date(clean);
  fallback.setHours(12, 0, 0, 0);
  return isNaN(fallback.getTime()) ? new Date() : fallback;
}

export function parseEuroLanAmount(text?: string | null): number {
  if (!text) return 0;
  const clean = text.replace(/\s+/g, '').replace(/PLN|zł/gi, '');
  const match = clean.match(/([+-]?\d+(?:[.,]\d{2})?)/);
  if (match && match[1]) {
    return Math.abs(parseFloat(match[1].replace(',', '.')));
  }
  return 0;
}

export function parseSignedEuroLanAmount(text?: string | null): number {
  if (!text) return 0;
  const clean = text.replace(/\s+/g, '').replace(/PLN|zł/gi, '');
  const match = clean.match(/([+-]?\d+(?:[.,]\d{2})?)/);
  if (match && match[1]) {
    return parseFloat(match[1].replace(',', '.'));
  }
  return 0;
}

export interface EuroLanAccountSummary {
  clientName?: string;
  clientNumber?: string;
  email?: string;
  address?: string;
  phone?: string;
  pesel?: string;
  iban?: string;
  currentBalance?: number;
  agreementNumber?: string;
}

export class EuroLanProvider implements IBillProvider {
  public readonly id = 'eurolan';
  public readonly displayName = 'Euro-lan Bielsko';
  public readonly loginUrl = EUROLAN_CONFIG.loginUrl;

  private cachedAccountSummary?: EuroLanAccountSummary;

  public async isAlreadyLoggedIn(page: Page): Promise<boolean> {
    const url = page.url();
    if (url.includes('?m=info') || url.includes('?m=finances') || url.includes('?m=tvjambox') || url.includes('?m=helpdesk')) {
      return true;
    }
    return page.evaluate(() => {
      const text = document.body ? document.body.innerText : '';
      return text.includes('Wyloguj') || Boolean(document.querySelector('a[href*="m=logout"]'));
    }).catch(() => false);
  }

  public async authenticate(
    page: Page,
    creds: ProviderCredentials,
    context: ScrapeContext
  ): Promise<AuthResult> {
    context.log.info('[EuroLanProvider] Starting authentication for Euro-lan BOK...');
    await context.reportProgress(10, 'Łączenie z portalem Euro-lan Bielsko (BOK)...');

    // 1. Check if session is already active
    if (await this.isAlreadyLoggedIn(page)) {
      context.log.info('[EuroLanProvider] Active session is already logged in.');
      await context.reportProgress(30, 'Przywrócono aktywną sesję Euro-lan BOK.');
      const accountSummary = await this.extractAccountSummary(page, context);
      this.cachedAccountSummary = accountSummary;
      const sessionState = await context.browserContext.storageState();
      return { sessionState, accountSummary: accountSummary as unknown as Record<string, unknown> };
    }

    // 2. Navigate to login page
    await context.reportProgress(20, 'Otwieranie strony logowania Euro-lan BOK...');
    await page.goto(EUROLAN_CONFIG.loginUrl, { waitUntil: 'networkidle', timeout: 35000 });

    // 3. Fill credentials
    await context.reportProgress(35, 'Wprowadzanie danych logowania...');
    const usernameInput = await page.waitForSelector(EUROLAN_CONFIG.selectors.usernameInput, { timeout: 15000 });
    if (!usernameInput) {
      throw new AppError('Nie znaleziono pola logowania w portalu Euro-lan BOK', 502);
    }
    await usernameInput.fill(creds.login);

    const passwordInput = await page.waitForSelector(EUROLAN_CONFIG.selectors.passwordInput, { timeout: 15000 });
    if (!passwordInput) {
      throw new AppError('Nie znaleziono pola hasła w portalu Euro-lan BOK', 502);
    }
    await passwordInput.fill(creds.password);

    // 4. Click submit
    await context.reportProgress(45, 'Wysyłanie formularza logowania...');
    await Promise.all([
      page.waitForNavigation({ timeout: 30000 }).catch(() => null),
      page.click(EUROLAN_CONFIG.selectors.submitButton),
    ]);

    await page.waitForTimeout(1500);

    // 5. Check for login errors or challenges
    const pageText = await page.innerText('body').catch(() => '');
    if (pageText.includes('Brak dostępu') || pageText.includes('Ostrzeżenie') || page.url().endsWith('?')) {
      const isLoginVisible = await page.$(EUROLAN_CONFIG.selectors.usernameInput);
      if (isLoginVisible) {
        context.log.warn('[EuroLanProvider] Login rejected: Brak dostępu / invalid credentials.');
        throw new AppError('Błąd logowania do portalu Euro-lan Bielsko: Brak dostępu (nieprawidłowy ID klienta lub PIN)', 401);
      }
    }

    // Check for CAPTCHA or 2FA
    if (pageText.includes('recaptcha') || pageText.includes('weryfikacja dwuetapowa') || pageText.includes('kod SMS')) {
      throw new NeedsReauthError('Portal Euro-lan wymaga weryfikacji dwuetapowej lub zabezpieczenia CAPTCHA.');
    }

    // 6. Verify successful login
    const isLoggedIn = await this.isAlreadyLoggedIn(page);
    if (!isLoggedIn) {
      await page.waitForSelector(EUROLAN_CONFIG.selectors.loggedInIndicator, { timeout: 15000 }).catch(() => null);
      if (!(await this.isAlreadyLoggedIn(page))) {
        throw new AppError('Nie udało się zalogować do portalu Euro-lan Bielsko. Sprawdź poprawność loginu i hasła.', 401);
      }
    }

    const accountSummary = await this.extractAccountSummary(page, context);
    this.cachedAccountSummary = accountSummary;
    const sessionState = await context.browserContext.storageState();

    await context.reportProgress(50, 'Logowanie do Euro-lan BOK zakończone pomyślnie.');
    return {
      sessionState,
      accountSummary: accountSummary as unknown as Record<string, unknown>,
    };
  }

  public async fetchBills(
    page: Page,
    context: ScrapeContext
  ): Promise<ExtractedBill[]> {
    context.log.info('[EuroLanProvider] Navigating to Finances section...');
    await context.reportProgress(60, 'Wczytywanie listy rachunków i faktur Euro-lan...');

    // Extract account summary first (uses cached if already extracted)
    const accountSummary = this.cachedAccountSummary || (await this.extractAccountSummary(page, context));
    const clientNumber = accountSummary.clientNumber;
    const iban = accountSummary.iban;
    const clientAddress = accountSummary.address || '';
    const clientName = accountSummary.clientName || '';
    const agreementNumber = accountSummary.agreementNumber || '';

    // Ensure we are on the Finances page
    if (!page.url().includes('?m=finances')) {
      await page.goto(`${EUROLAN_CONFIG.baseUrl}/?m=finances`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      await page.waitForTimeout(1500);
    }

    // 1. Extract current balance from #balance
    let currentBalance = 0;
    try {
      const balanceText = await page.innerText(EUROLAN_CONFIG.selectors.balanceSection).catch(() => '');
      const balanceMatch = balanceText.match(/Bieżące saldo:\s*([+-]?\d+(?:[.,]\d{2})?)\s*PLN/i);
      if (balanceMatch && balanceMatch[1]) {
        currentBalance = parseFloat(balanceMatch[1].replace(',', '.'));
      }
      context.log.info(`[EuroLanProvider] Current account balance: ${currentBalance} PLN`);
    } catch (balErr) {
      context.log.warn(`[EuroLanProvider] Could not read current balance: ${balErr}`);
    }

    // 2. Extract table rows from #userbalancebox
    await page.waitForSelector(EUROLAN_CONFIG.selectors.invoiceRows, { timeout: 20000 }).catch(() => null);

    const rawRows = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#userbalancebox tr.table-click'));
      return rows.map((tr) => {
        const dataHref = tr.getAttribute('data-href') || '';
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => (td.innerText || td.textContent || '').trim());
        const printBtn = tr.querySelector('button[onclick*="f=invoice"], a[href*="f=invoice"]');
        const printOnClick = printBtn ? printBtn.getAttribute('onclick') || printBtn.getAttribute('href') || '' : '';

        return {
          dataHref,
          cells,
          printOnClick,
        };
      });
    });

    context.log.info(`[EuroLanProvider] Found ${rawRows.length} transaction rows on finances page`);
    await context.reportProgress(70, `Przetwarzanie ${rawRows.length} wpisów rozrachunków Euro-lan...`);

    // Setup agreement filter regex if configured
    let filterRegex: RegExp | null = null;
    if (context.agreementFilter && context.agreementFilter.trim().length > 0) {
      try {
        filterRegex = new RegExp(context.agreementFilter.trim(), 'i');
        context.log.info(`[EuroLanProvider] Using agreement filter regex: /${context.agreementFilter.trim()}/i`);
      } catch (err) {
        context.log.warn(`[EuroLanProvider] Invalid agreement filter regex "${context.agreementFilter}": ${err}`);
      }
    }

    // Filter rows that represent invoices (debit row with data-href or print button for invoice)
    const invoiceRows: Array<{
      dateStr: string;
      debitStr: string;
      title: string;
      invoiceId: string;
      downloadUrl: string;
    }> = [];

    for (const r of rawRows) {
      // Must be an invoice link
      let invoiceId = '';
      const hrefMatch = (r.dataHref + ' ' + r.printOnClick).match(/id=(\d+)/);
      if (hrefMatch && hrefMatch[1]) {
        invoiceId = hrefMatch[1];
      }

      const dateStr = r.cells[0] || '';
      const debitStr = r.cells[1] || '';
      const rowTitle = r.cells[4] || '';

      // Skip non-invoice rows (payments, adjustments without invoice download)
      if (!invoiceId) {
        continue;
      }
      if (!debitStr && !r.dataHref.includes('f=invoice')) {
        continue;
      }

      invoiceRows.push({
        dateStr,
        debitStr,
        title: rowTitle,
        invoiceId,
        downloadUrl: `${EUROLAN_CONFIG.baseUrl}/?m=finances&f=invoice&id=${invoiceId}`,
      });
    }

    context.log.info(`[EuroLanProvider] Identified ${invoiceRows.length} invoice records`);

    const extractedBills: ExtractedBill[] = [];
    const seenInvoiceNumbers = new Set<string>();

    // For payment status FIFO logic:
    // If currentBalance < 0, remainingDebt is how much the customer owes
    let remainingDebt = currentBalance < 0 ? Math.abs(currentBalance) : 0;
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    for (let i = 0; i < invoiceRows.length; i++) {
      const invRow = invoiceRows[i];
      if (!invRow) continue;

      const progressPct = 70 + Math.floor((i / invoiceRows.length) * 25);
      await context.reportProgress(progressPct, `Pobieranie faktury ${i + 1}/${invoiceRows.length}...`);

      const issueDate = parseEuroLanDate(invRow.dateStr);

      // Skip invoices older than 12 months (BillsMaster standard)
      if (isOlderThan12Months(issueDate)) {
        context.log.info(
          `[EuroLanProvider] Invoices from ${issueDate.toISOString().slice(0, 10)} (id=${invRow.invoiceId}) onwards are older than 12 months. Stopping traversal.`
        );
        break;
      }

      const amountDue = parseEuroLanAmount(invRow.debitStr) || 60.0;
      if (amountDue <= 0) {
        continue;
      }

      // Euro-lan payment term: 7 days from issue date (typically due on the 8th)
      const dueDate = new Date(issueDate.getTime() + 7 * 86400000);
      dueDate.setHours(12, 0, 0, 0);

      // Determine payment status using FIFO accounting against current balance
      let paymentStatus: 'PAID' | 'UNPAID' | 'OVERDUE';
      if (currentBalance >= 0) {
        paymentStatus = 'PAID';
      } else if (remainingDebt >= 0.01) {
        if (dueDate.getTime() < now.getTime()) {
          paymentStatus = 'OVERDUE';
        } else {
          paymentStatus = 'UNPAID';
        }
        remainingDebt = Math.max(0, remainingDebt - amountDue);
      } else {
        paymentStatus = 'PAID';
      }

      // Download PDF and extract exact invoice number from PDF title / metadata
      let pdfBuffer: Uint8Array | undefined;
      let pdfFileName: string | undefined;
      let invoiceNumber = `FV-${invRow.dateStr.replace(/-/g, '')}-${invRow.invoiceId}`;

      try {
        const res = await page.request.get(invRow.downloadUrl, { timeout: 25000 });
        if (res.status() === 200) {
          const buf = await res.body();
          if (buf && buf.length > 500 && buf.slice(0, 4).toString('ascii') === '%PDF') {
            pdfBuffer = new Uint8Array(buf);

            // Extract invoice title from PDF
            try {
              const pdfDoc = await PDFDocument.load(buf, { updateMetadata: false });
              const title = pdfDoc.getTitle();
              if (title) {
                const invMatch = title.match(/Faktura\s+nr\s+([A-Za-z0-9\/\-_]+)/i);
                if (invMatch && invMatch[1]) {
                  invoiceNumber = invMatch[1].trim();
                } else if (title.trim().startsWith('FV/')) {
                  invoiceNumber = title.trim();
                }
              }
            } catch (metaErr) {
              context.log.warn(`[EuroLanProvider] Could not load PDF metadata for id=${invRow.invoiceId}: ${metaErr}`);
            }

            // Fallback: check raw buffer for XMP title tag if title was not extracted
            if (invoiceNumber.startsWith('FV-')) {
              const strBuf = buf.toString('latin1');
              const xmpMatch = strBuf.match(/<rdf:li xml:lang="x-default">Faktura nr\s+([^<]+)<\/rdf:li>/i);
              if (xmpMatch && xmpMatch[1]) {
                invoiceNumber = xmpMatch[1].trim();
              }
            }

            const cleanInv = cleanInvoiceNumber(invoiceNumber);
            if (cleanInv) {
              invoiceNumber = cleanInv;
            }

            pdfFileName = `EuroLan_${invoiceNumber.replace(/[\/\\:]/g, '_')}.pdf`;
            context.log.info(`[EuroLanProvider] Downloaded ${pdfFileName} (${buf.length} bytes, Invoice: ${invoiceNumber})`);
          }
        }
      } catch (pdfErr) {
        context.log.warn(`[EuroLanProvider] Could not download PDF for id=${invRow.invoiceId}: ${pdfErr}`);
      }

      if (seenInvoiceNumbers.has(invoiceNumber)) {
        continue;
      }
      seenInvoiceNumbers.add(invoiceNumber);

      // Agreement filter evaluation
      if (filterRegex) {
        const matchesInvoice = filterRegex.test(invoiceNumber);
        const matchesAddress = clientAddress ? filterRegex.test(clientAddress) : false;
        const matchesClient = clientNumber ? filterRegex.test(clientNumber) : false;
        const matchesName = clientName ? filterRegex.test(clientName) : false;
        const matchesAgreement = agreementNumber ? filterRegex.test(agreementNumber) : false;
        const matchesTitle = invRow.title ? filterRegex.test(invRow.title) : false;

        if (!matchesInvoice && !matchesAddress && !matchesClient && !matchesName && !matchesAgreement && !matchesTitle) {
          context.log.info(
            `[EuroLanProvider] Skipping invoice ${invoiceNumber} — does not match agreement filter /${context.agreementFilter}/i`
          );
          continue;
        }
      }

      const paymentTitle = invoiceNumber;

      extractedBills.push({
        invoiceNumber,
        amountDue,
        currency: 'PLN',
        issueDate,
        dueDate,
        paymentStatus,
        bankAccountNumber: iban,
        paymentTitle,
        pdfBuffer,
        pdfFileName,
        rawMetadata: {
          clientNumber,
          clientName,
          address: clientAddress,
          agreementNumber,
          invoiceId: invRow.invoiceId,
          title: invRow.title,
          currentBalance,
        },
      });
    }

    await context.reportProgress(95, `Pomyślnie odczytano ${extractedBills.length} faktur z portalu Euro-lan Bielsko.`);
    return extractedBills;
  }

  public async extractAccountSummary(
    page: Page,
    context: ScrapeContext
  ): Promise<EuroLanAccountSummary> {
    const summary: EuroLanAccountSummary = {};

    try {
      // 1. Client name from header: "Zalogowany jako: KOWALSKI Jan,"
      const headerText = (await page.innerText('body').catch(() => '')) || '';
      const headerMatch = headerText.match(/Zalogowany jako:\s*([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż\s]+),/i);
      if (headerMatch && headerMatch[1]) {
        summary.clientName = headerMatch[1].trim();
      }

      // 2. Fetch "Informacje" (?m=info) for contact details & bank account
      if (!page.url().includes('?m=info')) {
        await page.goto(`${EUROLAN_CONFIG.baseUrl}/?m=info`, {
          waitUntil: 'networkidle',
          timeout: 25000,
        }).catch(() => null);
        await page.waitForTimeout(1000);
      }

      const infoText = (await page.innerText('body').catch(() => '')) || '';

      // Client name
      const nameMatch = infoText.match(/Nazwisko i imię:\s*([^\n]+)/i);
      if (nameMatch && nameMatch[1]) {
        summary.clientName = nameMatch[1].trim();
      }

      // Email
      const emailMatch = infoText.match(/E-mail:\s*([^\n]+)/i);
      if (emailMatch && emailMatch[1]) {
        summary.email = emailMatch[1].trim();
      }

      // Address
      const addrMatch = infoText.match(/Adres:\s*([^\n]+)/i);
      if (addrMatch && addrMatch[1]) {
        summary.address = addrMatch[1].trim();
      }

      // Telephones
      const phoneMatch = infoText.match(/Telefony:\s*([^\n]+)/i);
      if (phoneMatch && phoneMatch[1]) {
        summary.phone = phoneMatch[1].trim();
      }

      // PESEL
      const peselMatch = infoText.match(/PESEL:\s*([^\n]+)/i);
      if (peselMatch && peselMatch[1]) {
        summary.pesel = peselMatch[1].trim();
      }

      // Bank account: "Konta bankowe:\nXX XXXX XXXX XXXX XXXX XXXX XXXX"
      const ibanMatch = infoText.match(/Konta bankowe:\s*([0-9\s]{26,38})/i);
      if (ibanMatch && ibanMatch[1]) {
        summary.iban = cleanEuroLanIban(ibanMatch[1]);
      }

      // Client number (derived from bank account suffix or info text)
      if (summary.iban && summary.iban.length === 28) {
        const clientSuffix = summary.iban.slice(-4);
        summary.clientNumber = clientSuffix;
      }
      const clientMatch = infoText.match(/ID-(\d+)|ID:\s*(\d+)|ID klienta:\s*(\d+)/i);
      if (clientMatch) {
        summary.clientNumber = clientMatch[1] || clientMatch[2] || clientMatch[3];
      }

      // Balance
      const balanceMatch = infoText.match(/Bilans:\s*([+-]?\d+(?:[.,]\d{2})?)\s*PLN/i);
      if (balanceMatch && balanceMatch[1]) {
        summary.currentBalance = parseFloat(balanceMatch[1].replace(',', '.'));
      }

      // Agreement number from userdocsbox tab if available
      const docMatch = infoText.match(/(UM\/\d{4}\/\d+)/i);
      if (docMatch && docMatch[1]) {
        summary.agreementNumber = docMatch[1].trim();
      }

      context.log.info(
        `[EuroLanProvider] Extracted account summary: Name=${summary.clientName || 'N/A'}, ID=${summary.clientNumber || 'N/A'}, IBAN=${summary.iban || 'N/A'}, Balance=${summary.currentBalance ?? 'N/A'} PLN`
      );
    } catch (err) {
      context.log.warn(`[EuroLanProvider] Error extracting account summary: ${err}`);
    }

    return summary;
  }
}
