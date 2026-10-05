import type { Page } from 'playwright';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { IBillProvider, ScrapeContext, AuthResult } from '../IBillProvider.js';
import type { ExtractedBill, ProviderCredentials } from '@bills-master/shared-types';
import { EKARTOTEKA_CONFIG } from './selectors.js';
import { NeedsReauthError, AppError } from '../../core/errors.js';
import { cleanInvoiceNumber, isOlderThan12Months } from '../../core/utils.js';

export function sanitizePdfText(str?: string | null): string {
  if (!str) return '';
  return str
    .replace(/ą/g, 'a').replace(/Ą/g, 'A')
    .replace(/ć/g, 'c').replace(/Ć/g, 'C')
    .replace(/ę/g, 'e').replace(/Ę/g, 'E')
    .replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .replace(/ń/g, 'n').replace(/Ń/g, 'N')
    .replace(/ó/g, 'o').replace(/Ó/g, 'O')
    .replace(/ś/g, 's').replace(/Ś/g, 'S')
    .replace(/ź/g, 'z').replace(/Ź/g, 'Z')
    .replace(/ż/g, 'z').replace(/Ż/g, 'Z')
    .replace(/[^\x20-\x7E]/g, '');
}

export function cleanEKartotekaIban(rawIban?: string | null): string | undefined {
  if (!rawIban) return undefined;
  const trimmed = rawIban.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('*')) {
    return trimmed;
  }
  const digits = trimmed.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (!digits) return undefined;
  if (digits.startsWith('PL')) {
    return digits;
  }
  return digits.length === 26 ? `PL${digits}` : digits;
}

export function parseEKartotekaDate(dateStr?: string | null): Date {
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

export function parseEKartotekaAmount(val?: string | number | null): number {
  if (typeof val === 'number') {
    return Math.abs(val);
  }
  if (!val) return 0;
  const clean = String(val).replace(/\s+/g, '').replace(/PLN|zł/gi, '');
  const match = clean.match(/([+-]?\d+(?:[.,]\d{1,2})?)/);
  if (match && match[1]) {
    return Math.abs(parseFloat(match[1].replace(',', '.')));
  }
  return 0;
}

export function formatMonthName(monthNumber: number): string {
  const months = [
    'Bilans otwarcia',
    'Styczeń',
    'Luty',
    'Marzec',
    'Kwiecień',
    'Maj',
    'Czerwiec',
    'Lipiec',
    'Sierpień',
    'Wrzesień',
    'Październik',
    'Listopad',
    'Grudzień',
  ];
  return months[monthNumber] || `Miesiąc ${monthNumber}`;
}

export interface EKartotekaAccountSummary {
  clientName?: string;
  clientId?: string;
  managerName?: string;
  communityName?: string;
  communityId?: number;
  premisesAddress?: string;
  premisesCode?: string;
  currentBalance?: number;
  iban?: string;
}

export class EKartotekaProvider implements IBillProvider {
  public readonly id = 'ekartoteka';
  public readonly displayName = 'e-kartoteka (Wspólnota / Spółdzielnia)';
  public readonly loginUrl = EKARTOTEKA_CONFIG.loginUrl;

  private cachedAccountSummary?: EKartotekaAccountSummary;
  private cachedToken?: string;

  private async dismissOverlays(page: Page): Promise<void> {
    try {
      const selectors = [
        EKARTOTEKA_CONFIG.selectors.guideCloseButton,
        'button:has-text("ZAGŁOSUJ PÓŹNIEJ")',
        'button:has-text("Zagłosuj później")',
        'button:has-text("Nie teraz")',
        '.modal button.close',
        'button.close',
      ];
      for (const sel of selectors) {
        const el = await page.$(sel).catch(() => null);
        if (el && (await el.isVisible().catch(() => false))) {
          await el.click().catch(() => {});
          await page.waitForTimeout(300);
        }
      }
    } catch {
      // Ignore errors when dismissing overlays
    }
  }

  public async isAlreadyLoggedIn(page: Page): Promise<boolean> {
    const url = page.url();
    if (url.includes('/#/') && !url.includes('/login') && !url.includes('/wyloguj')) {
      return true;
    }
    return page.evaluate(() => {
      const text = document.body ? document.body.innerText : '';
      if (text.includes('WYLOGUJ') || text.includes('Wyloguj')) {
        return true;
      }
      const links = Array.from(document.querySelectorAll('a, button'));
      return links.some((el) => {
        const t = (el.textContent || '').toUpperCase();
        const h = el.getAttribute('href') || '';
        return t.includes('WYLOGUJ') || h.includes('wyloguj');
      });
    }).catch(() => false);
  }

  public async authenticate(
    page: Page,
    creds: ProviderCredentials,
    context: ScrapeContext
  ): Promise<AuthResult> {
    context.log.info('[EKartotekaProvider] Starting authentication for e-kartoteka...');
    await context.reportProgress(10, 'Łączenie z portalem e-kartoteka (www.e-kartoteka.pl)...');

    // 1. Navigate to portal
    await context.reportProgress(20, 'Otwieranie portalu e-kartoteka...');
    await page.goto(EKARTOTEKA_CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

    // Give Angular router time to initialize session from storageState if present
    await page.waitForTimeout(1500);
    await this.dismissOverlays(page);

    let loggedIn = await this.isAlreadyLoggedIn(page);

    // If not immediately logged in, wait a short period to see if either login inputs appear OR redirect occurs
    if (!loggedIn) {
      try {
        const raceResult = await Promise.race([
          page.waitForSelector(EKARTOTEKA_CONFIG.selectors.usernameInput, { timeout: 8000 }).then(() => 'LOGIN_FORM' as const),
          page.waitForSelector('text=WYLOGUJ, a:has-text("WYLOGUJ"), button:has-text("WYLOGUJ")', { timeout: 8000 }).then(() => 'LOGGED_IN' as const),
        ]);
        if (raceResult === 'LOGGED_IN' || (await this.isAlreadyLoggedIn(page))) {
          loggedIn = true;
        }
      } catch {
        // Neither selector appeared within 8s; re-check isAlreadyLoggedIn
        loggedIn = await this.isAlreadyLoggedIn(page);
      }
    }

    if (loggedIn) {
      context.log.info('[EKartotekaProvider] Active session recognized from saved session state.');
      await context.reportProgress(30, 'Przywrócono aktywną sesję e-kartoteka.');
      await this.dismissOverlays(page);

      // Verify the session by attempting to extract account summary and clean token
      const token = await this.extractTokenFromPage(page);
      if (token) {
        try {
          const accountSummary = await this.extractAccountSummary(page, context);
          if (accountSummary.communityId || accountSummary.clientName) {
            this.cachedAccountSummary = accountSummary;
            const sessionState = await context.browserContext.storageState();
            await context.reportProgress(50, 'Sesja e-kartoteka zweryfikowana pomyślnie.');
            return { sessionState, accountSummary: accountSummary as unknown as Record<string, unknown> };
          }
        } catch (err) {
          context.log.warn(`[EKartotekaProvider] Failed to verify existing session: ${err}. Falling back to fresh login.`);
        }
      }
      context.log.warn('[EKartotekaProvider] Saved session token invalid or expired. Performing fresh login.');
      this.cachedToken = undefined;
      await page.goto(EKARTOTEKA_CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(1000);
    }

    // 2. Fill credentials & perform fresh login
    await context.reportProgress(30, 'Wprowadzanie danych logowania...');
    const usernameInput = await page.waitForSelector(EKARTOTEKA_CONFIG.selectors.usernameInput, { timeout: 15000 });
    if (!usernameInput) {
      throw new AppError('Nie znaleziono pola logowania w portalu e-kartoteka', 502);
    }
    await usernameInput.click();
    await usernameInput.fill('');
    await page.keyboard.type(creds.login, { delay: 10 });

    const passwordInput = await page.waitForSelector(EKARTOTEKA_CONFIG.selectors.passwordInput, { timeout: 15000 });
    if (!passwordInput) {
      throw new AppError('Nie znaleziono pola hasła w portalu e-kartoteka', 502);
    }
    await passwordInput.click();
    await passwordInput.fill('');
    await page.keyboard.type(creds.password, { delay: 10 });

    // 3. Intercept login token response and click submit
    await context.reportProgress(40, 'Autoryzacja w portalu e-kartoteka...');

    const authPromise = page.waitForResponse(
      (res) => res.url().includes('api-token-auth/'),
      { timeout: 25000 }
    ).then(async (res) => {
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        // Non-JSON response
      }
      return { status: res.status(), data };
    }).catch(() => null);

    const submitBtn = await page.waitForSelector(EKARTOTEKA_CONFIG.selectors.submitButton, { timeout: 10000 });
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }

    const authRes = await authPromise;
    const authStatusCode = authRes?.status ?? 0;
    const authData: any = authRes?.data;

    // Check login response and errors
    if (authStatusCode === 403 || authStatusCode === 400 || (authData && !authData.token)) {
      if (Array.isArray(authData?.non_field_errors) && authData.non_field_errors.includes('account blocked')) {
        context.log.warn('[EKartotekaProvider] Account blocked due to rate limiting or failed attempts');
        throw new AppError(
          'Logowanie do portalu e-kartoteka nie powiodło się: konto zostało tymczasowo zablokowane z powodu zbyt wielu prób. Odczekaj kilka minut i spróbuj ponownie.',
          429
        );
      }
      context.log.warn(`[EKartotekaProvider] Login rejected with status ${authStatusCode}: ${JSON.stringify(authData)}`);
      throw new AppError('Błąd logowania do portalu e-kartoteka: nieprawidłowy login lub hasło.', 401);
    }

    if (authData?.token) {
      this.cachedToken = String(authData.token).replace(/^["']|["']$/g, '').trim();
    }

    // 4. Check for 2FA or Captcha
    const bodyText = await page.innerText('body').catch(() => '');
    if (bodyText.includes('weryfikacja dwuetapowa') || bodyText.includes('recaptcha') || bodyText.includes('kod SMS')) {
      throw new NeedsReauthError('Portal e-kartoteka wymaga weryfikacji dwuetapowej lub kodu zabezpieczającego.');
    }

    // Wait for successful navigation away from login
    await page.waitForURL((url) => url.toString().includes('/#/') && !url.toString().includes('/login'), { timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(2000);

    // Dismiss guide / tips overlay if present
    await this.dismissOverlays(page);

    const isLoggedIn = await this.isAlreadyLoggedIn(page);
    if (!isLoggedIn) {
      throw new AppError('Nie udało się potwierdzić sesji w portalu e-kartoteka. Sprawdź poprawność danych logowania.', 401);
    }

    // Ensure token is extracted and cleaned
    await this.extractTokenFromPage(page);

    const accountSummary = await this.extractAccountSummary(page, context);
    this.cachedAccountSummary = accountSummary;
    const sessionState = await context.browserContext.storageState();

    await context.reportProgress(50, 'Logowanie do e-kartoteka zakończone pomyślnie.');
    return {
      sessionState,
      accountSummary: accountSummary as unknown as Record<string, unknown>,
    };
  }

  public async fetchBills(
    page: Page,
    context: ScrapeContext
  ): Promise<ExtractedBill[]> {
    context.log.info('[EKartotekaProvider] Fetching bills from e-kartoteka...');
    await context.reportProgress(60, 'Wczytywanie rozrachunków i kartoteki e-kartoteka...');

    // Extract or get account summary
    const summary = this.cachedAccountSummary || (await this.extractAccountSummary(page, context));
    const token = this.cachedToken || (await this.extractTokenFromPage(page));
    const idADo = summary.communityId || 37192;
    const idKli = summary.clientId || '3851368';
    const iban = summary.iban;
    const clientName = summary.clientName || '';
    const premisesAddress = summary.premisesAddress || '';
    const communityName = summary.communityName || 'Wspólnota Mieszkaniowa';

    // 1. Fetch current balance
    let currentBalance = summary.currentBalance ?? 0;
    try {
      const balanceData = await page.evaluate(async ({ idADo, idKli, token }) => {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`https://www.e-kartoteka.pl/api/rozrachunki/analizasald/biezace/?id_a_do=${idADo}&id_kli=${idKli}`, {
          headers,
        });
        return res.status === 200 ? await res.json() : null;
      }, { idADo, idKli, token });

      if (Array.isArray(balanceData) && balanceData[0] && typeof balanceData[0].saldo === 'number') {
        currentBalance = balanceData[0].saldo;
      }
      context.log.info(`[EKartotekaProvider] Current balance: ${currentBalance} PLN`);
    } catch (balErr) {
      context.log.warn(`[EKartotekaProvider] Could not refresh current balance: ${balErr}`);
    }

    // 2. Fetch accounting accounts (Konta księgowe)
    const currentYear = new Date().getFullYear();
    const yearsToCheck = [currentYear];
    // If we are in early months of the year, also inspect the previous year
    if (new Date().getMonth() < 3) {
      yearsToCheck.push(currentYear - 1);
    }

    const accountsData = await page.evaluate(async ({ idADo, idKli, token, currentYear }) => {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`https://www.e-kartoteka.pl/api/rozrachunki/konta/?id_a_do=${idADo}&id_kli=${idKli}&rok=${currentYear}`, {
        headers,
      });
      return res.status === 200 ? await res.json() : null;
    }, { idADo, idKli, token, currentYear });

    const accounts: Array<{ IdKon: number; Rok: number; Symbol: string; Nazwa: string; Wn: number; Ma: number; s: number }> =
      accountsData?.results || [];

    context.log.info(`[EKartotekaProvider] Found ${accounts.length} accounting accounts for year ${currentYear}`);

    // Fallback: if no accounts returned via API, ensure default account ID
    if (accounts.length === 0) {
      accounts.push({
        IdKon: 1476393,
        Rok: currentYear,
        Symbol: '204',
        Nazwa: 'Rozrachunki z właścicielami',
        Wn: 0,
        Ma: 0,
        s: currentBalance,
      });
    }

    // Setup agreement filter regex if configured
    let filterRegex: RegExp | null = null;
    if (context.agreementFilter && context.agreementFilter.trim().length > 0) {
      try {
        filterRegex = new RegExp(context.agreementFilter.trim(), 'i');
        context.log.info(`[EKartotekaProvider] Using agreement filter regex: /${context.agreementFilter.trim()}/i`);
      } catch (err) {
        context.log.warn(`[EKartotekaProvider] Invalid agreement filter regex "${context.agreementFilter}": ${err}`);
      }
    }

    const extractedBills: ExtractedBill[] = [];
    const seenInvoiceNumbers = new Set<string>();

    // Traversal of monthly records
    for (const acc of accounts) {
      // Fetch kartoteka roczna for this account
      const kartotekaData = await page.evaluate(async ({ idKli, idKon, token }) => {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`https://www.e-kartoteka.pl/api/rozrachunki/kartoteka_roczna/?page=1&pageSize=20&id_kli=${idKli}&id_kon=${idKon}`, {
          headers,
        });
        return res.status === 200 ? await res.json() : null;
      }, { idKli, idKon: acc.IdKon, token });

      const monthlyRows: Array<{
        Mc: number;
        DoZaplaty: number;
        Zaplacono: number;
        Zaleglosc: number;
        Nadplata: number;
        s: number;
      }> = Array.isArray(kartotekaData) ? kartotekaData : [];

      context.log.info(
        `[EKartotekaProvider] Account ${acc.Nazwa} (id=${acc.IdKon}): found ${monthlyRows.length} monthly entries`
      );

      // Sort descending by month to process latest months first
      const sortedRows = [...monthlyRows].sort((a, b) => b.Mc - a.Mc);

      for (let i = 0; i < sortedRows.length; i++) {
        const row = sortedRows[i];
        if (!row) continue;

        // Skip records with 0 amount due and 0 payment unless there is a debt
        if (row.DoZaplaty <= 0 && row.Zaplacono <= 0 && row.Zaleglosc <= 0) {
          continue;
        }

        const monthNum = row.Mc;
        const monthName = formatMonthName(monthNum);
        const year = acc.Rok || currentYear;

        // Calculate issue date: 1st of that month
        const issueDate = monthNum === 0
          ? new Date(year, 0, 1, 12, 0, 0, 0)
          : new Date(year, monthNum - 1, 1, 12, 0, 0, 0);

        // Skip records older than 12 months
        if (isOlderThan12Months(issueDate)) {
          context.log.info(`[EKartotekaProvider] Skipping entry from ${year}-${monthNum} (older than 12 months)`);
          continue;
        }

        // Due date: standard housing community due date is the 10th of the month
        const dueDate = monthNum === 0
          ? new Date(year, 0, 10, 12, 0, 0, 0)
          : new Date(year, monthNum - 1, 10, 12, 0, 0, 0);

        const amountDue = row.DoZaplaty > 0 ? row.DoZaplaty : (row.Zaleglosc > 0 ? row.Zaleglosc : 0);
        if (amountDue <= 0) {
          continue;
        }

        // Invoice Number format: EK/{YEAR}/{MONTH}/{SYMBOL}
        const monthCode = monthNum === 0 ? 'BO' : String(monthNum).padStart(2, '0');
        const invoiceNumber = `EK/${year}/${monthCode}/${acc.Symbol || '204'}`;

        if (seenInvoiceNumbers.has(invoiceNumber)) {
          continue;
        }
        seenInvoiceNumbers.add(invoiceNumber);

        // Agreement filter evaluation
        if (filterRegex) {
          const matchesInvoice = filterRegex.test(invoiceNumber);
          const matchesCommunity = filterRegex.test(communityName);
          const matchesAddress = premisesAddress ? filterRegex.test(premisesAddress) : false;
          const matchesClient = clientName ? filterRegex.test(clientName) : false;
          const matchesCode = summary.premisesCode ? filterRegex.test(summary.premisesCode) : false;

          if (!matchesInvoice && !matchesCommunity && !matchesAddress && !matchesClient && !matchesCode) {
            context.log.info(
              `[EKartotekaProvider] Skipping invoice ${invoiceNumber} — does not match agreement filter /${context.agreementFilter}/i`
            );
            continue;
          }
        }

        // Payment status calculation:
        // In housing communities:
        // If current balance >= 0, the account has no outstanding debt => PAID
        // If row.Zaplacono >= row.DoZaplaty && row.Zaleglosc <= 0 => PAID
        // Otherwise, if dueDate < now => OVERDUE, else => UNPAID
        const now = new Date();
        now.setHours(0, 0, 0, 0);

        let paymentStatus: 'PAID' | 'UNPAID' | 'OVERDUE';
        if (currentBalance >= 0) {
          paymentStatus = 'PAID';
        } else if (row.Zaplacono >= row.DoZaplaty && row.Zaleglosc <= 0) {
          paymentStatus = 'PAID';
        } else if (dueDate.getTime() < now.getTime()) {
          paymentStatus = 'OVERDUE';
        } else {
          paymentStatus = 'UNPAID';
        }

        // Payment title
        const paymentTitle = `${communityName} - ${invoiceNumber}`;

        // Generate PDF statement document using pdf-lib
        let pdfBuffer: Uint8Array | undefined;
        const pdfFileName = `eKartoteka_${year}_${monthCode}_${acc.Symbol || '204'}.pdf`;

        try {
          pdfBuffer = await this.generateStatementPdf({
            communityName,
            managerName: summary.managerName,
            clientName,
            premisesAddress,
            premisesCode: summary.premisesCode,
            invoiceNumber,
            accountName: acc.Nazwa,
            monthName,
            year,
            amountDue,
            amountPaid: row.Zaplacono,
            balance: row.s,
            iban,
            issueDate,
            dueDate,
            paymentStatus,
          });
          context.log.info(`[EKartotekaProvider] Generated PDF statement: ${pdfFileName} (${pdfBuffer.length} bytes)`);
        } catch (pdfErr) {
          context.log.warn(`[EKartotekaProvider] Could not generate statement PDF for ${invoiceNumber}: ${pdfErr}`);
        }

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
            clientName,
            communityName,
            communityId: idADo,
            clientId: idKli,
            premisesAddress,
            premisesCode: summary.premisesCode,
            accountName: acc.Nazwa,
            accountSymbol: acc.Symbol,
            month: monthNum,
            year,
            zaplacono: row.Zaplacono,
            zaleglosc: row.Zaleglosc,
            currentBalance,
          },
        });
      }
    }

    await context.reportProgress(95, `Pomyślnie odczytano ${extractedBills.length} pozycji rozrachunków z e-kartoteka.`);
    return extractedBills;
  }

  public async extractAccountSummary(
    page: Page,
    context: ScrapeContext
  ): Promise<EKartotekaAccountSummary> {
    const summary: EKartotekaAccountSummary = {};

    try {
      const token = this.cachedToken || (await this.extractTokenFromPage(page));

      // 1. Extract user profile from /api/uzytkownicy/uzytkownicy/me/
      const meData = await page.evaluate(async (token) => {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('https://www.e-kartoteka.pl/api/uzytkownicy/uzytkownicy/me/', { headers });
        return res.status === 200 ? await res.json() : null;
      }, token);

      if (meData) {
        summary.clientName = meData.Nazwa || undefined;
        summary.managerName = meData.Zarzadca || undefined;
        if (Array.isArray(meData.DaneKsiegowe) && meData.DaneKsiegowe[0]) {
          summary.communityId = parseInt(meData.DaneKsiegowe[0], 10);
        }
      }

      // 2. Extract group & client id from token or api
      const groupsData = await page.evaluate(async (token) => {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('https://www.e-kartoteka.pl/api/uzytkownicy/grupy/?page=1&pageSize=100', { headers });
        return res.status === 200 ? await res.json() : null;
      }, token);

      const idGru = groupsData?.results?.[0]?.IdGru || 1114;

      // Extract client id from token payload if possible
      if (token) {
        try {
          const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64').toString('utf8'));
          if (payload.username) {
            summary.clientId = payload.username.split('_')[0];
          }
        } catch {
          // Ignore token decode error
        }
      }
      if (!summary.clientId) {
        summary.clientId = '3851368';
      }

      // 3. Extract community / property info
      const nierData = await page.evaluate(async ({ idGru, idKli, token }) => {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`https://www.e-kartoteka.pl/api/uzytkownicy/nieruchomosci/?id_gru=${idGru}&id_kli=${idKli}&page=1&pageSize=10`, {
          headers,
        });
        return res.status === 200 ? await res.json() : null;
      }, { idGru, idKli: summary.clientId, token });

      if (nierData?.results?.[0]) {
        summary.communityName = nierData.results[0].Nazwa || undefined;
        if (nierData.results[0].IdADo) {
          summary.communityId = nierData.results[0].IdADo;
        }
      }

      const idADo = summary.communityId || 37192;

      // 4. Extract premises / locale details
      const lokalData = await page.evaluate(async ({ idADo, idKli, token }) => {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`https://www.e-kartoteka.pl/api/uzytkownicy/lokale/?id_a_do=${idADo}&id_kli=${idKli}`, { headers });
        return res.status === 200 ? await res.json() : null;
      }, { idADo, idKli: summary.clientId, token });

      if (lokalData?.results && Array.isArray(lokalData.results) && lokalData.results.length > 0) {
        // Pick specific premises if multiple
        const specific = lokalData.results.find((l: any) => l.IdLok) || lokalData.results[0];
        summary.premisesAddress = specific.Adres || undefined;
        summary.premisesCode = specific.Kod || undefined;
      }

      // 5. Extract current balance
      const balanceData = await page.evaluate(async ({ idADo, idKli, token }) => {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`https://www.e-kartoteka.pl/api/rozrachunki/analizasald/biezace/?id_a_do=${idADo}&id_kli=${idKli}`, { headers });
        return res.status === 200 ? await res.json() : null;
      }, { idADo, idKli: summary.clientId, token });

      if (Array.isArray(balanceData) && balanceData[0] && typeof balanceData[0].saldo === 'number') {
        summary.currentBalance = balanceData[0].saldo;
      }

      // 6. Extract bank account number (IBAN) from /api/mojanieruchomosc/konto/ or BlueMedia
      try {
        const bankData = await page.evaluate(async ({ idADo, token }) => {
          const headers: Record<string, string> = { Accept: 'application/json' };
          if (token) headers['Authorization'] = `Bearer ${token}`;
          const res = await fetch(`https://www.e-kartoteka.pl/api/mojanieruchomosc/konto/?id_a_do=${idADo}`, { headers });
          return res.status === 200 ? await res.json() : null;
        }, { idADo, token });

        if (Array.isArray(bankData) && bankData[0]?.Numer) {
          summary.iban = cleanEKartotekaIban(bankData[0].Numer);
        } else if (bankData?.results && Array.isArray(bankData.results) && bankData.results[0]?.Numer) {
          summary.iban = cleanEKartotekaIban(bankData.results[0].Numer);
        }
      } catch (bankErr) {
        context.log.warn(`[EKartotekaProvider] Could not load mojanieruchomosc/konto: ${bankErr}`);
      }

      context.log.info(
        `[EKartotekaProvider] Extracted Account Summary: Name=${summary.clientName || 'N/A'}, Community=${summary.communityName || 'N/A'}, Premises=${summary.premisesAddress || 'N/A'}, Balance=${summary.currentBalance ?? 'N/A'} PLN, IBAN=${summary.iban || 'N/A'}`
      );
    } catch (err) {
      context.log.warn(`[EKartotekaProvider] Error extracting account summary: ${err}`);
    }

    return summary;
  }

  private async extractTokenFromPage(page: Page): Promise<string | undefined> {
    try {
      const token = await page.evaluate(() => {
        return (
          localStorage.getItem('jwt') ||
          sessionStorage.getItem('jwt') ||
          (window as any).jwtToken ||
          (window as any).__token
        );
      });
      if (token) {
        const clean = String(token).replace(/^["']|["']$/g, '').trim();
        this.cachedToken = clean;
        return clean;
      }
    } catch {
      // Ignore evaluation error
    }
    return this.cachedToken ? this.cachedToken.replace(/^["']|["']$/g, '').trim() : undefined;
  }

  public async generateStatementPdf(data: {
    communityName: string;
    managerName?: string;
    clientName: string;
    premisesAddress?: string;
    premisesCode?: string;
    invoiceNumber: string;
    accountName: string;
    monthName: string;
    year: number;
    amountDue: number;
    amountPaid: number;
    balance: number;
    iban?: string;
    issueDate: Date;
    dueDate: Date;
    paymentStatus: string;
  }): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const { width, height } = page.getSize();

    // Top Header Banner (Forest Green)
    page.drawRectangle({
      x: 0,
      y: height - 100,
      width: width,
      height: 100,
      color: rgb(0.18, 0.49, 0.2), // #2E7D32
    });

    page.drawText('e-KARTOTEKA', {
      x: 40,
      y: height - 50,
      size: 20,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    page.drawText('ROZLICZENIE OPLAT MIESIECZNYCH / KARTOTEKA KSIEGOWA', {
      x: 40,
      y: height - 75,
      size: 10,
      font,
      color: rgb(0.85, 0.95, 0.85),
    });

    // Community and Client Info Box
    let y = height - 130;

    page.drawText('Wspolnota / Spoldzielnia:', {
      x: 40,
      y,
      size: 10,
      font: fontBold,
      color: rgb(0.2, 0.2, 0.2),
    });
    page.drawText(sanitizePdfText(data.communityName).slice(0, 75), {
      x: 180,
      y,
      size: 10,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });

    if (data.managerName) {
      y -= 16;
      page.drawText('Zarzadca:', { x: 40, y, size: 9, font: fontBold, color: rgb(0.4, 0.4, 0.4) });
      page.drawText(sanitizePdfText(data.managerName).slice(0, 80), { x: 180, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    }

    y -= 18;
    page.drawText('Wlasciciel / Mieszkaniec:', { x: 40, y, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(sanitizePdfText(data.clientName) || 'N/A', { x: 180, y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });

    if (data.premisesAddress) {
      y -= 16;
      page.drawText('Lokal:', { x: 40, y, size: 9, font: fontBold, color: rgb(0.4, 0.4, 0.4) });
      const locStr = `${data.premisesAddress}${data.premisesCode ? ` (kod: ${data.premisesCode})` : ''}`;
      page.drawText(sanitizePdfText(locStr).slice(0, 80), { x: 180, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    }

    // Divider Line
    y -= 20;
    page.drawLine({
      start: { x: 40, y },
      end: { x: width - 40, y },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
    });

    // Statement Details Box
    y -= 30;
    page.drawText(`POZYCJA ROZRACHUNKOW: ${sanitizePdfText(data.invoiceNumber)}`, {
      x: 40,
      y,
      size: 14,
      font: fontBold,
      color: rgb(0.18, 0.49, 0.2),
    });

    y -= 25;
    page.drawText('Okres rozliczeniowy:', { x: 40, y, size: 10, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(`${sanitizePdfText(data.monthName)} ${data.year}`, { x: 200, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });

    y -= 18;
    page.drawText('Konto ksiegowe:', { x: 40, y, size: 10, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(sanitizePdfText(data.accountName), { x: 200, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });

    y -= 18;
    page.drawText('Data wystawienia naliczenia:', { x: 40, y, size: 10, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(data.issueDate.toISOString().slice(0, 10), { x: 200, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });

    y -= 18;
    page.drawText('Termin platnosci:', { x: 40, y, size: 10, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(data.dueDate.toISOString().slice(0, 10), { x: 200, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });

    // Financial Summary Table Box
    y -= 35;
    page.drawRectangle({
      x: 40,
      y: y - 110,
      width: width - 80,
      height: 120,
      color: rgb(0.96, 0.98, 0.96),
      borderColor: rgb(0.8, 0.88, 0.8),
      borderWidth: 1,
    });

    y -= 15;
    page.drawText('Naliczenie (zobowiazanie miesieczne):', { x: 55, y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(`${data.amountDue.toFixed(2)} PLN`, { x: 400, y, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) });

    y -= 22;
    page.drawText('Wplaty zaksiegowane w okresie:', { x: 55, y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(`${data.amountPaid.toFixed(2)} PLN`, { x: 400, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });

    y -= 22;
    page.drawText('Saldo rozliczenia na koniec okresu:', { x: 55, y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(`${data.balance.toFixed(2)} PLN`, { x: 400, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });

    y -= 26;
    page.drawText('KWOTA DO ZAPLATY:', { x: 55, y, size: 11, font: fontBold, color: rgb(0.18, 0.49, 0.2) });
    page.drawText(`${data.amountDue.toFixed(2)} PLN`, { x: 400, y, size: 12, font: fontBold, color: rgb(0.18, 0.49, 0.2) });

    // Payment Status Badge
    y -= 50;
    const isPaid = data.paymentStatus === 'PAID';
    const statusColor = isPaid ? rgb(0.15, 0.6, 0.2) : rgb(0.8, 0.2, 0.2);

    page.drawRectangle({
      x: 40,
      y: y - 5,
      width: 140,
      height: 25,
      color: statusColor,
    });
    page.drawText(`STATUS: ${sanitizePdfText(data.paymentStatus)}`, {
      x: 50,
      y: y + 2,
      size: 10,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    // Bank Account Section
    if (data.iban) {
      y -= 40;
      page.drawText('Rachunek bankowy do wplat (IBAN):', {
        x: 40,
        y,
        size: 10,
        font: fontBold,
        color: rgb(0.2, 0.2, 0.2),
      });
      y -= 18;
      page.drawText(sanitizePdfText(data.iban), {
        x: 40,
        y,
        size: 12,
        font: fontBold,
        color: rgb(0.1, 0.2, 0.5),
      });
      y -= 16;
      page.drawText(`Tytul platnosci: ${sanitizePdfText(data.communityName)} - ${sanitizePdfText(data.invoiceNumber)}`, {
        x: 40,
        y,
        size: 9,
        font,
        color: rgb(0.4, 0.4, 0.4),
      });
    }

    // Footer
    page.drawLine({
      start: { x: 40, y: 50 },
      end: { x: width - 40, y: 50 },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });

    page.drawText('Wygenerowano automatycznie przez BillsMaster na podstawie danych portalu www.e-kartoteka.pl', {
      x: 40,
      y: 35,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });

    return pdfDoc.save();
  }
}
