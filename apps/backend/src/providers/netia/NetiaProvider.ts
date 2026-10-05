import type { Page } from 'playwright';
import type { IBillProvider, ScrapeContext, AuthResult } from '../IBillProvider.js';
import type { ExtractedBill, ProviderCredentials } from '@bills-master/shared-types';
import { NETIA_CONFIG } from './selectors.js';
import { NeedsReauthError, AppError } from '../../core/errors.js';
import { cleanInvoiceNumber, isOlderThan12Months } from '../../core/utils.js';

const POLISH_MONTHS: Record<string, number> = {
  stycznia: 0,
  styczeń: 0,
  lutego: 1,
  luty: 1,
  marca: 2,
  marzec: 2,
  kwietnia: 3,
  kwiecień: 3,
  maja: 4,
  maj: 4,
  czerwca: 5,
  czerwiec: 5,
  lipca: 6,
  lipiec: 6,
  sierpnia: 7,
  sierpień: 7,
  września: 8,
  wrzesień: 8,
  października: 9,
  październik: 9,
  listopada: 10,
  listopad: 10,
  grudnia: 11,
  grudzień: 11,
};

export function parsePolishDate(dateStr?: string | null): Date | null {
  if (!dateStr) return null;
  const clean = dateStr.trim().toLowerCase();

  // Match e.g. "08.09.2026" or "08-09-2026"
  const dotMatch = clean.match(/^(\d{1,2})[.-](\d{1,2})[.-](\d{4})$/);
  if (dotMatch) {
    const day = parseInt(dotMatch[1], 10);
    const month = parseInt(dotMatch[2], 10) - 1;
    const year = parseInt(dotMatch[3], 10);
    return new Date(year, month, day);
  }

  // Match e.g. "2026-09-08"
  const isoMatch = clean.match(/^(\d{4})[.-](\d{1,2})[.-](\d{1,2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    return new Date(year, month, day);
  }

  // Match e.g. "8 września 2026"
  const words = clean.split(/\s+/);
  if (words.length >= 3) {
    const day = parseInt(words[0], 10);
    const monthName = words[1];
    const year = parseInt(words[2], 10);
    const month = POLISH_MONTHS[monthName];
    if (!isNaN(day) && month !== undefined && !isNaN(year)) {
      return new Date(year, month, day);
    }
  }

  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

export function cleanIban(rawIban?: string | null): string {
  if (!rawIban) return '';
  const digits = rawIban.replace(/[^0-9A-Za-z]/g, '');
  if (!digits) return '';
  if (digits.toUpperCase().startsWith('PL')) {
    return digits.toUpperCase();
  }
  return digits.length === 26 ? `PL${digits}` : digits;
}

export interface NetiaAccountDetails {
  clientNumber?: string;
  clientName?: string;
  billingAccount?: string;
  agreementNumber?: string;
  iban?: string;
  address?: string;
  currentBalance?: number;
}

export class NetiaProvider implements IBillProvider {
  public readonly id = 'netia';
  public readonly displayName = 'Netia Online';
  public readonly loginUrl = NETIA_CONFIG.loginUrl;

  public async isAlreadyLoggedIn(page: Page): Promise<boolean> {
    const url = page.url();
    if (url.includes('ebok.netia.pl')) {
      return true;
    }
    return page.evaluate(() => {
      const text = document.body ? document.body.innerText : '';
      if (text.includes('Wyloguj') || text.includes('Konto billingowe') || text.includes('Konto:')) {
        return true;
      }
      return Boolean(document.querySelector('a[href*="logout"], a[href*="zaloguj.jsp?logout"]'));
    }).catch(() => false);
  }

  public async dismissOverlays(page: Page): Promise<void> {
    await page.evaluate(() => {
      const cookieBtn = document.querySelector('#cookieButton, input[name="cookieButton"], .bt_cookies') as HTMLElement;
      if (cookieBtn) {
        try { cookieBtn.click(); } catch {}
      }
      const cookieContainer = document.querySelector('#cookies-message-container, .cookie_div');
      if (cookieContainer) {
        cookieContainer.remove();
      }
    }).catch(() => {});
    await page.waitForTimeout(300);
  }

  public async extractAccountDetails(page: Page): Promise<NetiaAccountDetails> {
    const details: NetiaAccountDetails = {};

    // 1. Try reading from platnosci.jsp
    try {
      if (!page.url().includes('platnosci.jsp')) {
        await page.goto(NETIA_CONFIG.invoicesUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      }

      const platnosciData = await page.evaluate(() => {
        const text = document.body ? document.body.innerText : '';

        // Konto billingowe: 966291
        const billingMatch = text.match(/konto\s+billingowe(?:\s+nr)?:\s*(\d+)/i) || text.match(/konto\s+billingowe:\s*(\d+)/i);
        const billingAccount = billingMatch ? billingMatch[1].trim() : undefined;

        // Saldo aktualne: -69.99 (niedopłata) or Saldo do zapłaty : -69.99 zł
        const balanceMatch = text.match(/saldo\s+(?:aktualne|do\s+zapłaty)\s*:\s*([-\d.,]+)/i);
        let currentBalance: number | undefined;
        if (balanceMatch) {
          currentBalance = parseFloat(balanceMatch[1].replace(',', '.'));
        }

        // Rachunek bankowy: 19-1140-1560-1769-9960-9662-9188
        const ibanMatch = text.match(/rachunek\s+bankowy:\s*([0-9\-\s]{26,36})/i);
        const rawIban = ibanMatch ? ibanMatch[1].trim() : undefined;

        // Umowa: 8011/26/TUA/0244
        const agreementMatch = text.match(/umowa:\s*([A-Za-z0-9\/\-_]+)/i);
        const agreementNumber = agreementMatch ? agreementMatch[1].trim() : undefined;

        return { billingAccount, currentBalance, rawIban, agreementNumber };
      });

      details.billingAccount = platnosciData.billingAccount;
      details.currentBalance = platnosciData.currentBalance;
      details.iban = cleanIban(platnosciData.rawIban);
      details.agreementNumber = platnosciData.agreementNumber;
    } catch {
      // Ignore platnosci extraction errors
    }

    // 2. Try reading customer details from dane_kontaktowe.jsp
    try {
      await page.goto(NETIA_CONFIG.contactUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const contactData = await page.evaluate(() => {
        const text = document.body ? document.body.innerText : '';

        // Imię / Nazwisko
        const firstNameMatch = text.match(/imię:\s*([^\r\n\t]+)/i);
        const lastNameMatch = text.match(/nazwisko:\s*([^\r\n\t]+)/i);
        let clientName: string | undefined;
        if (firstNameMatch && lastNameMatch) {
          clientName = `${firstNameMatch[1].trim()} ${lastNameMatch[1].trim()}`;
        }

        // Id klienta / numer konta abonenta
        const clientMatch = text.match(/id\s+klienta:\s*(\d+)/i) || text.match(/konto:\s*(\d+)/i);
        const clientNumber = clientMatch ? clientMatch[1].trim() : undefined;

        // Adres (ulica/nr + kod/miasto)
        const streetMatch = text.match(/ulica\/nr:?\s*([^\r\n\t]+)/i);
        const cityMatch = text.match(/kod\/miasto:?\s*([^\r\n\t]+)/i);
        let address: string | undefined;
        if (streetMatch && cityMatch) {
          address = `${streetMatch[1].trim()}, ${cityMatch[1].trim()}`;
        }

        return { clientName, clientNumber, address };
      });

      if (contactData.clientName) details.clientName = contactData.clientName;
      if (contactData.clientNumber) details.clientNumber = contactData.clientNumber;
      if (contactData.address) details.address = contactData.address;
    } catch {
      // Ignore contact extraction errors
    }

    return details;
  }

  public async authenticate(
    page: Page,
    creds: ProviderCredentials,
    context: ScrapeContext
  ): Promise<AuthResult> {
    context.log.info('[NetiaProvider] Starting authentication sequence...');
    await context.reportProgress(10, 'Łączenie z portalem Netia Online...');

    // 1. Navigate to portal login page
    await context.reportProgress(15, 'Otwieranie strony logowania Netia Online...');
    await page.goto(NETIA_CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(1000);

    // Check if session is already active
    if (await this.isAlreadyLoggedIn(page)) {
      context.log.info('[NetiaProvider] Active session is already logged in.');
      await context.reportProgress(30, 'Przywrócono aktywną sesję Netia Online.');
      const state = await context.browserContext.storageState();
      const accountDetails = await this.extractAccountDetails(page);
      return { sessionState: state, accountSummary: accountDetails as unknown as Record<string, unknown> };
    }

    // 2. Dismiss cookie overlay if present
    await this.dismissOverlays(page);

    // 3. Locate inputs
    const usernameInput = page.locator(NETIA_CONFIG.selectors.usernameInput).first();
    const passwordInput = page.locator(NETIA_CONFIG.selectors.passwordInput).first();

    await context.reportProgress(35, 'Wprowadzanie danych logowania...');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.fill(creds.login);
    await passwordInput.fill(creds.password);

    // 4. Submit login
    await context.reportProgress(45, 'Wysyłanie formularza logowania...');
    const submitBtn = page.locator(NETIA_CONFIG.selectors.submitButton).first();

    await Promise.all([
      page.waitForURL((url) => url.hostname.includes('ebok.netia.pl') || url.pathname.includes('cas/login'), {
        timeout: 30000,
        waitUntil: 'domcontentloaded',
      }).catch(() => null),
      submitBtn.click(),
    ]);

    await page.waitForTimeout(2000);
    await this.dismissOverlays(page);

    // 5. Check for login failure / invalid credentials
    const currentUrl = page.url();
    const pageText = await page.innerText('body').catch(() => '');

    if (
      pageText.includes('Your account is not recognized') ||
      pageText.includes('Nieprawidłowy login lub hasło') ||
      pageText.includes('Błędny login lub hasło') ||
      pageText.includes('Niepoprawne dane logowania') ||
      pageText.includes('Konto zostało zablokowane') ||
      currentUrl.includes('cas/login')
    ) {
      if (pageText.includes('kod SMS') || pageText.includes('weryfikacja dwuetapowa') || pageText.includes('2FA')) {
        throw new NeedsReauthError('Portal Netia Online wymaga weryfikacji dwuetapowej (2FA / SMS). Wymagane logowanie ręczne.');
      }
      if (pageText.includes('captcha') || pageText.includes('reCAPTCHA') || pageText.includes('Cloudflare')) {
        throw new NeedsReauthError('Portal Netia Online wyświetlił zabezpieczenie CAPTCHA.');
      }
      throw new AppError('Błąd logowania do Netia Online: Nieprawidłowy login lub hasło', 401);
    }

    // 6. Verify successful login
    const isLoggedIn = await this.isAlreadyLoggedIn(page);
    if (!isLoggedIn) {
      await page.waitForTimeout(2000);
      const isLoggedRetry = await this.isAlreadyLoggedIn(page);
      if (!isLoggedRetry) {
        throw new AppError('Logowanie do Netia Online nie powiodło się (brak przekierowania do panelu eBOK)', 401);
      }
    }

    // 7. Extract account summary
    await context.reportProgress(50, 'Odczytywanie danych konta abonenckiego...');
    const accountDetails = await this.extractAccountDetails(page);
    const sessionState = await context.browserContext.storageState();

    await context.reportProgress(55, 'Logowanie do Netia Online zakończone pomyślnie.');
    return { sessionState, accountSummary: accountDetails as unknown as Record<string, unknown> };
  }

  public async fetchBills(
    page: Page,
    context: ScrapeContext
  ): Promise<ExtractedBill[]> {
    context.log.info('[NetiaProvider] Loading invoices from Netia Online...');
    await context.reportProgress(55, 'Ładowanie historii płatności i faktur Netia Online...');

    // 1. Gather account details if not already present
    const accountDetails = await this.extractAccountDetails(page);
    const billingAccount = accountDetails.billingAccount || '';
    const agreementNumber = accountDetails.agreementNumber || '';
    const clientNumber = accountDetails.clientNumber || '';
    const iban = accountDetails.iban || '';
    const address = accountDetails.address || '';
    const clientName = accountDetails.clientName || '';

    // 2. Evaluate agreement filter regex if provided
    let filterRegex: RegExp | null = null;
    if (context.agreementFilter && context.agreementFilter.trim().length > 0) {
      try {
        filterRegex = new RegExp(context.agreementFilter.trim(), 'i');
        context.log.info(`[NetiaProvider] Using agreement/address filter regex: /${context.agreementFilter.trim()}/i`);
      } catch (err) {
        context.log.warn(`[NetiaProvider] Invalid filter regex "${context.agreementFilter}": ${err}`);
      }
    }

    if (filterRegex) {
      const matchAgreement = filterRegex.test(agreementNumber);
      const matchBilling = filterRegex.test(billingAccount);
      const matchClient = filterRegex.test(clientNumber);
      const matchAddress = filterRegex.test(address);
      const matchName = filterRegex.test(clientName);

      if (!matchAgreement && !matchBilling && !matchClient && !matchAddress && !matchName) {
        context.log.info(
          `[NetiaProvider] Skipping Netia account (umowa: ${agreementNumber}, konto: ${billingAccount}, adres: ${address}) — does not match regex /${context.agreementFilter}/i`
        );
        return [];
      }
      context.log.info(`[NetiaProvider] Matched account for filter /${context.agreementFilter}/i`);
    }

    const currentYear = new Date().getFullYear();
    const yearsToScan = [currentYear, currentYear - 1];

    const extractedBills: ExtractedBill[] = [];
    const seenInvoiceNumbers = new Set<string>();

    for (let yIdx = 0; yIdx < yearsToScan.length; yIdx++) {
      const year = yearsToScan[yIdx];
      const progressPct = 60 + Math.floor((yIdx / yearsToScan.length) * 20);
      await context.reportProgress(progressPct, `Odczytywanie faktur za rok ${year}...`);

      const yearUrl = `${NETIA_CONFIG.invoicesUrl}?year=${year}`;
      context.log.info(`[NetiaProvider] Navigating to ${yearUrl}`);

      try {
        await page.goto(yearUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await this.dismissOverlays(page);
      } catch (err) {
        context.log.warn(`[NetiaProvider] Failed to load invoices for year ${year}: ${err}`);
        continue;
      }

      // Extract invoice rows from table
      const rowsData = await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll('table'));
        const table = tables.find((t) =>
          t.classList.contains('displayToRound') ||
          t.querySelector('a[href*="doctype="]') ||
          t.querySelector('a[href*="pobierz_dokument_finansowy"]') ||
          (t as HTMLElement).innerText?.includes('Kwotabrutto') ||
          (t as HTMLElement).innerText?.includes('Kwota brutto')
        );
        if (!table) return [];

        const trs = Array.from(table.querySelectorAll('tr'));
        return trs.map((tr) => {
          const cells = Array.from(tr.querySelectorAll('td, th')).map((td) => ((td as HTMLElement).innerText || td.textContent || '').trim());
          const docLinkEl = tr.querySelector('a[href*="pobierz_dokument_finansowy.jsp"], a[href*="doctype="]');
          const docHref = docLinkEl ? docLinkEl.getAttribute('href') : null;
          const docText = docLinkEl ? (docLinkEl as HTMLElement).innerText.trim() : null;

          return { cells, docHref, docText };
        });
      });

      context.log.info(`[NetiaProvider] Found ${rowsData.length} table rows for year ${year}`);

      let invoicesFoundInYear = 0;
      let allInvoicesInYearOlderThan12Months = true;

      for (const row of rowsData) {
        // We look for rows where first cell indicates "Faktura" (or "Korekta" / "Rachunek")
        const rowType = (row.cells[0] || '').toLowerCase();
        if (!rowType.includes('faktura') && !rowType.includes('rachunek') && !rowType.includes('korekta')) {
          continue;
        }

        const rawInvoiceNumber = row.docText || row.cells[1] || '';
        const cleanInv = cleanInvoiceNumber(rawInvoiceNumber);
        if (!cleanInv || seenInvoiceNumbers.has(cleanInv)) {
          continue;
        }

        invoicesFoundInYear++;
        seenInvoiceNumbers.add(cleanInv);

        // Column indices:
        // [0: "Faktura", 1: "FAV/...", 2: "Kwota brutto", 3: "Data", 4: "Kwota do zapłaty"]
        const grossAmountStr = (row.cells[2] || '').replace(/\s+/g, '').replace(',', '.');
        const grossAmount = parseFloat(grossAmountStr) || 0;

        const dateStr = row.cells[3] || '';
        const issueDate = parsePolishDate(dateStr) || new Date();
        issueDate.setHours(0, 0, 0, 0);

        if (isOlderThan12Months(issueDate)) {
          context.log.info(`[NetiaProvider] Skipping invoice ${cleanInv} older than 12 months (${issueDate.toISOString().slice(0, 10)})`);
          continue;
        }

        allInvoicesInYearOlderThan12Months = false;

        // Payment status:
        // Netia sets column 4 ("Kwota do zapłaty") when unpaid; empty or 0 when paid.
        const dueAmountStr = (row.cells[4] || '').replace(/\s+/g, '').replace(',', '.');
        const dueAmount = parseFloat(dueAmountStr) || 0;

        // Netia payment terms: 14 days from issue date
        const dueDate = new Date(issueDate.getTime() + 14 * 24 * 60 * 60 * 1000);
        dueDate.setHours(0, 0, 0, 0);

        const now = new Date();
        now.setHours(0, 0, 0, 0);

        let paymentStatus: 'PAID' | 'UNPAID' | 'OVERDUE';
        if (dueAmount > 0) {
          paymentStatus = dueDate.getTime() < now.getTime() ? 'OVERDUE' : 'UNPAID';
        } else {
          paymentStatus = 'PAID';
        }

        // Amount due: for unpaid it's dueAmount, for total invoice it's grossAmount
        const amountDue = grossAmount > 0 ? grossAmount : dueAmount;

        // Download invoice PDF
        let pdfBuffer: Uint8Array | undefined;
        let pdfFileName: string | undefined;

        if (row.docHref) {
          try {
            const pdfUrl = new URL(row.docHref, page.url()).toString();
            context.log.info(`[NetiaProvider] Downloading PDF for ${cleanInv}...`);
            const pdfRes = await page.request.get(pdfUrl, { timeout: 15000 });
            if (pdfRes.status() === 200) {
              const buf = await pdfRes.body();
              if (buf && buf.length > 500 && buf.subarray(0, 4).toString() === '%PDF') {
                pdfBuffer = buf;
                pdfFileName = `Netia_${cleanInv.replace(/[\/\\:]/g, '_')}.pdf`;
                context.log.info(`[NetiaProvider] Downloaded PDF ${pdfFileName} (${buf.length} bytes)`);
              }
            }
          } catch (pdfErr) {
            context.log.warn(`[NetiaProvider] Could not download PDF for ${cleanInv}: ${pdfErr}`);
          }
        }

        const paymentTitle = cleanInv;

        extractedBills.push({
          invoiceNumber: cleanInv,
          amountDue,
          currency: 'PLN',
          issueDate,
          dueDate,
          paymentStatus,
          bankAccountNumber: iban || undefined,
          paymentTitle,
          pdfBuffer,
          pdfFileName,
          rawMetadata: {
            portalProvider: 'netia',
            billingAccount,
            agreementNumber,
            clientNumber,
            address,
            clientName,
            grossAmount,
            unpaidAmount: dueAmount,
            issueDateRaw: dateStr,
          },
        });
      }

      // If we found invoices in this year and ALL of them were older than 12 months,
      // no need to scrape even older years.
      if (invoicesFoundInYear > 0 && allInvoicesInYearOlderThan12Months) {
        context.log.info(`[NetiaProvider] All invoices in ${year} are older than 12 months. Stopping year traversal.`);
        break;
      }
    }

    await context.reportProgress(90, `Pobrano ${extractedBills.length} faktur z Netia Online.`);
    context.log.info(`[NetiaProvider] Extracted total ${extractedBills.length} bills from Netia Online.`);
    return extractedBills;
  }
}
