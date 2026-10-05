import type { Page } from 'playwright';
import type { IBillProvider, ScrapeContext, AuthResult } from '../IBillProvider.js';
import type { ExtractedBill, ProviderCredentials } from '@bills-master/shared-types';
import { AQUA_CONFIG } from './selectors.js';
import { NeedsReauthError, AppError } from '../../core/errors.js';
import { cleanInvoiceNumber, isOlderThan12Months } from '../../core/utils.js';

export function computeAquaIban(clientNumber?: string): string | undefined {
  if (!clientNumber) return undefined;
  const digits = clientNumber.replace(/\D/g, '');
  if (!digits) return undefined;
  // Standard Aqua Bielsko virtual account prefix: 1140 1906 1006 (mBank oddział korporacyjny)
  const paddedClient = digits.padStart(12, '0');
  const bban = `114019061006${paddedClient}`;
  const fullNum = `${bban}252100`; // 'PL' = 2521
  const mod = BigInt(fullNum) % 97n;
  const checkDigits = (98n - mod).toString().padStart(2, '0');
  const rawIban = `PL${checkDigits}${bban}`;
  return rawIban.replace(/^PL(\d{2})(\d{4})(\d{4})(\d{4})(\d{4})(\d{4})(\d{4})$/, 'PL $1 $2 $3 $4 $5 $6 $7');
}

export function parseAquaDate(dateStr?: string | null): Date {
  if (!dateStr) {
    const fallback = new Date();
    fallback.setHours(12, 0, 0, 0);
    return fallback;
  }
  const clean = dateStr.trim();
  const isoMatch = clean.match(/(\d{4})[.-](\d{2})[.-](\d{2})/);
  if (isoMatch && isoMatch[1] && isoMatch[2] && isoMatch[3]) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const d = new Date(year, month, day, 12, 0, 0, 0);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  const dotMatch = clean.match(/(\d{2})[.-](\d{2})[.-](\d{4})/);
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

export function parseAquaAmount(text?: string | null): number {
  if (!text) return 0;
  const match = text.match(/(-?\d+(?:[.,]\d{2}))/);
  if (match && match[1]) {
    return parseFloat(match[1].replace(',', '.'));
  }
  return 0;
}

export interface AquaAccountSummary {
  clientName?: string;
  clientNumber?: string;
  address?: string;
  iban?: string;
  places?: Array<{ id: string; name: string }>;
}

export class AquaProvider implements IBillProvider {
  public readonly id = 'aqua';
  public readonly displayName = 'AQUA Bielsko-Biała (eBOK)';
  public readonly loginUrl = AQUA_CONFIG.loginUrl;

  private cachedAccountSummary?: AquaAccountSummary;

  public async isAlreadyLoggedIn(page: Page): Promise<boolean> {
    const url = page.url();
    if (url.includes('/finanse') || url.includes('/pulpit') || url.includes('/dokumenty')) {
      return true;
    }
    return page.evaluate(() => {
      const text = document.body ? document.body.innerText : '';
      return text.includes('Wyloguj') || Boolean(document.querySelector('a:has-text("Wyloguj"), #t_TreeNav'));
    }).catch(() => false);
  }

  public async authenticate(
    page: Page,
    creds: ProviderCredentials,
    context: ScrapeContext
  ): Promise<AuthResult> {
    context.log.info('[AquaProvider] Starting authentication for Aqua Bielsko eBOK...');
    await context.reportProgress(10, 'Łączenie z portalem AQUA Bielsko-Biała eBOK...');

    // 1. Check if session is already active
    if (await this.isAlreadyLoggedIn(page)) {
      context.log.info('[AquaProvider] Active session is already logged in.');
      await context.reportProgress(30, 'Przywrócono aktywną sesję AQUA eBOK.');
      const accountSummary = await this.extractAccountSummary(page, context);
      this.cachedAccountSummary = accountSummary;
      const sessionState = await context.browserContext.storageState();
      return { sessionState, accountSummary: accountSummary as unknown as Record<string, unknown> };
    }

    // 2. Navigate to login page
    await context.reportProgress(20, 'Otwieranie strony logowania AQUA eBOK...');
    await page.goto(AQUA_CONFIG.loginUrl, { waitUntil: 'networkidle', timeout: 35000 });

    // 3. Fill credentials
    await context.reportProgress(35, 'Wprowadzanie danych logowania...');
    const usernameInput = await page.waitForSelector(AQUA_CONFIG.selectors.usernameInput, { timeout: 15000 });
    if (!usernameInput) {
      throw new AppError('Nie znaleziono pola logowania w portalu AQUA eBOK', 502);
    }
    await usernameInput.fill(creds.login);

    const passwordInput = await page.waitForSelector(AQUA_CONFIG.selectors.passwordInput, { timeout: 15000 });
    if (!passwordInput) {
      throw new AppError('Nie znaleziono pola hasła w portalu AQUA eBOK', 502);
    }
    await passwordInput.fill(creds.password);

    // 4. Click submit
    await context.reportProgress(45, 'Wysyłanie formularza logowania...');
    await Promise.all([
      page.waitForNavigation({ timeout: 30000 }).catch(() => null),
      page.click(AQUA_CONFIG.selectors.submitButton),
    ]);

    await page.waitForTimeout(2000);

    // 5. Check for login errors or challenges
    const currentUrl = page.url();
    if (currentUrl.includes('/logowanie')) {
      // Check notification message in URL or alert element
      let errorMsg = '';
      const notificationMatch = currentUrl.match(/notification_msg=([^&]+)/);
      if (notificationMatch && notificationMatch[1]) {
        try {
          const rawBase64 = notificationMatch[1].split('/')[0] || '';
          errorMsg = Buffer.from(rawBase64, 'base64').toString('utf-8');
        } catch {
          // Ignore decode error
        }
      }

      if (!errorMsg) {
        const alertEl = await page.$(AQUA_CONFIG.selectors.loginError);
        if (alertEl) {
          errorMsg = (await alertEl.innerText())?.trim() || '';
        }
      }

      if (errorMsg) {
        context.log.warn(`[AquaProvider] Login failed: ${errorMsg}`);
        throw new AppError(`Błąd logowania do portalu AQUA Bielsko: ${errorMsg}`, 401);
      }

      // Check if Captcha or 2FA is present
      const hasCaptcha = await page.$('.g-recaptcha, iframe[src*="recaptcha"], iframe[src*="turnstile"]');
      if (hasCaptcha) {
        throw new NeedsReauthError('Portal AQUA Bielsko wyświetlił zabezpieczenie CAPTCHA.');
      }

      throw new AppError('Nie udało się zalogować do portalu AQUA Bielsko. Sprawdź poprawność loginu i hasła.', 401);
    }

    // 6. Verify successful login
    await page.waitForSelector(AQUA_CONFIG.selectors.loggedInIndicator, { timeout: 20000 }).catch(() => null);

    const accountSummary = await this.extractAccountSummary(page, context);
    this.cachedAccountSummary = accountSummary;
    const sessionState = await context.browserContext.storageState();

    await context.reportProgress(50, 'Logowanie do AQUA eBOK zakończone pomyślnie.');
    return {
      sessionState,
      accountSummary: accountSummary as unknown as Record<string, unknown>,
    };
  }

  public async fetchBills(
    page: Page,
    context: ScrapeContext
  ): Promise<ExtractedBill[]> {
    context.log.info('[AquaProvider] Navigating to Finanse section...');
    await context.reportProgress(60, 'Wczytywanie listy rachunków i faktur AQUA...');

    // Extract account summary first (uses cached if already extracted)
    const accountSummary = this.cachedAccountSummary || (await this.extractAccountSummary(page, context));
    const clientNumber = accountSummary.clientNumber;
    const iban = accountSummary.iban || computeAquaIban(clientNumber);
    const clientAddress = accountSummary.address || '';

    // Ensure we are on the Finanse page
    if (!page.url().includes('/finanse')) {
      const finanseBtn = await page.$(AQUA_CONFIG.selectors.finanseLink);
      if (finanseBtn) {
        await finanseBtn.click();
      } else {
        const sessionMatch = page.url().match(/session=(\d+)/);
        const session = sessionMatch ? sessionMatch[1] : '';
        await page.goto(`${AQUA_CONFIG.baseUrl}/ords/r/ebok/e/finanse?session=${session}`, {
          waitUntil: 'networkidle',
          timeout: 30000,
        });
      }
      await page.waitForTimeout(2500);
    }

    // Wait for card list to load on Finanse page
    await page.waitForSelector(AQUA_CONFIG.selectors.cards, { timeout: 20000 }).catch(() => null);

    // Setup agreement filter regex if configured
    let filterRegex: RegExp | null = null;
    if (context.agreementFilter && context.agreementFilter.trim().length > 0) {
      try {
        filterRegex = new RegExp(context.agreementFilter.trim(), 'i');
        context.log.info(`[AquaProvider] Using agreement filter regex: /${context.agreementFilter.trim()}/i`);
      } catch (err) {
        context.log.warn(`[AquaProvider] Invalid agreement filter regex "${context.agreementFilter}": ${err}`);
      }
    }

    // Extract all cards
    const rawCards = await page.$$eval(AQUA_CONFIG.selectors.cards, (items) => {
      return items.map((item) => {
        const text = (item as HTMLElement).innerText || item.textContent || '';
        const title = item.querySelector('.a-CardView-title')?.textContent?.trim() || '';
        const subTitle = item.querySelector('.a-CardView-subTitle')?.textContent?.trim() || '';
        const badge = item.querySelector('.a-CardView-badge')?.textContent?.trim() || '';

        const links = Array.from(item.querySelectorAll('a, button'));
        const pobierzA = links.find((l) => l.textContent && l.textContent.toUpperCase().includes('POBIERZ'));
        const pobierzHref = pobierzA ? pobierzA.getAttribute('href') : null;

        return {
          text,
          title,
          subTitle,
          badge,
          pobierzHref,
        };
      });
    });

    context.log.info(`[AquaProvider] Found ${rawCards.length} cards on Finanse page`);
    await context.reportProgress(75, `Przetwarzanie ${rawCards.length} wpisów rozrachunków...`);

    const extractedBills: ExtractedBill[] = [];
    const seenInvoiceNumbers = new Set<string>();

    for (let i = 0; i < rawCards.length; i++) {
      const card = rawCards[i];
      if (!card) continue;

      // 1. Skip bank payments / settlements
      if (card.title.startsWith('/OPF/') || card.title.toUpperCase().includes('WPŁATA')) {
        continue;
      }
      if (!card.title && !card.subTitle) {
        continue;
      }

      // 2. Determine invoice number
      let rawInvoiceNumber = card.title.trim();
      if (card.title.toLowerCase().includes('nota odsetkowa') && card.subTitle) {
        rawInvoiceNumber = card.subTitle.trim();
      }
      const invoiceNumber = cleanInvoiceNumber(rawInvoiceNumber);
      if (!invoiceNumber || seenInvoiceNumbers.has(invoiceNumber)) {
        continue;
      }

      // 3. Issue Date
      let issueDate = new Date();
      const issueMatch = (card.subTitle + ' ' + card.title).match(
        /z dnia\s+(\d{4}[.-]\d{2}[.-]\d{2}|\d{2}[.-]\d{2}[.-]\d{4})/i
      );
      if (issueMatch && issueMatch[1]) {
        issueDate = parseAquaDate(issueMatch[1]);
      }

      // Skip invoices older than 12 months
      if (isOlderThan12Months(issueDate)) {
        context.log.info(
          `[AquaProvider] Skipping invoice ${invoiceNumber} older than 12 months (${issueDate.toISOString().slice(0, 10)})`
        );
        continue;
      }

      // 4. Due Date
      let dueDate = new Date(issueDate.getTime() + 14 * 86400000);
      const dueMatch = card.text.match(/Termin płatności\s*([0-9\.\-]+)/i);
      if (dueMatch && dueMatch[1]) {
        dueDate = parseAquaDate(dueMatch[1]);
      }

      // 5. Amount
      let amountDue = 0;
      const kwotaMatch = card.text.match(/Kwota\s*([-\d.,]+)\s*zł/i);
      if (kwotaMatch && kwotaMatch[1]) {
        amountDue = parseAquaAmount(kwotaMatch[1]);
      }
      if (amountDue <= 0) {
        continue;
      }

      let amountToPay = 0;
      const toPayMatch = card.text.match(/Do zapłaty\s*([-\d.,]+)\s*zł/i);
      if (toPayMatch && toPayMatch[1]) {
        amountToPay = parseAquaAmount(toPayMatch[1]);
      }

      // 6. Payment Status
      const upperText = card.text.toUpperCase();
      const isPaid =
        upperText.includes('ZAPŁACONO') ||
        card.badge.toUpperCase() === 'ZAPŁACONO' ||
        amountToPay === 0;

      const now = new Date();
      now.setHours(0, 0, 0, 0);

      let paymentStatus: 'PAID' | 'UNPAID' | 'OVERDUE';
      if (isPaid) {
        paymentStatus = 'PAID';
      } else if (dueDate.getTime() < now.getTime()) {
        paymentStatus = 'OVERDUE';
      } else {
        paymentStatus = 'UNPAID';
      }

      // 7. Check agreement filter
      if (filterRegex) {
        const matchesInvoice = filterRegex.test(invoiceNumber);
        const matchesAddress = clientAddress ? filterRegex.test(clientAddress) : false;
        const matchesClient = clientNumber ? filterRegex.test(clientNumber) : false;
        const matchesSubTitle = card.subTitle ? filterRegex.test(card.subTitle) : false;

        if (!matchesInvoice && !matchesAddress && !matchesClient && !matchesSubTitle) {
          context.log.info(
            `[AquaProvider] Skipping invoice ${invoiceNumber} — does not match agreement filter /${context.agreementFilter}/i`
          );
          continue;
        }
      }

      seenInvoiceNumbers.add(invoiceNumber);

      // 8. Download PDF if available
      let pdfBuffer: Uint8Array | undefined;
      let pdfFileName: string | undefined;

      if (card.pobierzHref) {
        const p45Match = card.pobierzHref.match(/p45_data=([^&']+)/);
        if (p45Match && p45Match[1]) {
          try {
            const rawPart = p45Match[1]
              .replace(/\\u0025/g, '%')
              .replace(/\\u002F/g, '/')
              .replace(/\\u0026/g, '&')
              .replace(/\\u003D/g, '=');

            let decoded = decodeURIComponent(rawPart);
            if (decoded.includes('%')) {
              decoded = decodeURIComponent(decoded);
            }
            const cleanPath = decoded.replace(/^\.\//, '');
            const fullPdfUrl = `${AQUA_CONFIG.baseUrl}/ords/${cleanPath}`;

            const res = await page.request.get(fullPdfUrl, { timeout: 20000 });
            if (res.status() === 200) {
              const buf = await res.body();
              if (buf.slice(0, 4).toString('ascii') === '%PDF') {
                pdfBuffer = new Uint8Array(buf);
                pdfFileName = `Aqua_${invoiceNumber.replace(/[\/\\:]/g, '_')}.pdf`;
                context.log.info(`[AquaProvider] Downloaded PDF ${pdfFileName} (${buf.length} bytes)`);
              }
            }
          } catch (pdfErr) {
            context.log.warn(`[AquaProvider] Could not download PDF for ${invoiceNumber}: ${pdfErr}`);
          }
        }
      }

      extractedBills.push({
        invoiceNumber,
        amountDue,
        currency: 'PLN',
        issueDate,
        dueDate,
        paymentStatus,
        bankAccountNumber: iban,
        paymentTitle: invoiceNumber,
        pdfBuffer,
        pdfFileName,
        rawMetadata: {
          address: clientAddress,
          clientName: accountSummary.clientName,
          clientNumber,
          subTitle: card.subTitle,
        },
      });
    }

    await context.reportProgress(95, `Pomyślnie odczytano ${extractedBills.length} faktur z portalu AQUA.`);
    return extractedBills;
  }

  public async extractAccountSummary(
    page: Page,
    context: ScrapeContext
  ): Promise<AquaAccountSummary> {
    const summary: AquaAccountSummary = {};

    try {
      // 1. Client name from header
      const headerText = (await page.innerText('.t-Header').catch(() => '')) || '';
      const headerMatch = headerText.match(/ODCZYT\s+([A-ZĄĆĘŁŃÓŚŹŻ\s]+)/i);
      if (headerMatch && headerMatch[1]) {
        summary.clientName = headerMatch[1].trim();
      }

      // 2. Fetch "Moje dane" for client number and address
      const sessionMatch = page.url().match(/session=(\d+)/);
      const session = sessionMatch ? sessionMatch[1] : '';

      if (session) {
        await page.goto(`${AQUA_CONFIG.baseUrl}/ords/r/ebok/e/moje_dane?session=${session}`, {
          waitUntil: 'networkidle',
          timeout: 25000,
        }).catch(() => null);

        await page.waitForTimeout(1000);
        const daneText = (await page.innerText('body').catch(() => '')) || '';

        // Extract client ID (Identyfikator: 100001)
        const idMatch = daneText.match(/Identyfikator:\s*(\d+)/i);
        if (idMatch && idMatch[1]) {
          summary.clientNumber = idMatch[1].trim();
        }

        // Extract address (Adres podstawowy: 00-001 Warszawa, ul. Prosta 12)
        const addrMatch = daneText.match(/Adres podstawowy:\s*([^\n]+(?:\n[^\n]+)?)/i);
        if (addrMatch && addrMatch[1]) {
          summary.address = addrMatch[1].replace(/\n+/g, ', ').trim();
        }

        // Extract places from "Moje miejsca" tab if available
        const placesTab = await page.$('a:has-text("MOJE MIEJSCA"), button:has-text("MOJE MIEJSCA")');
        if (placesTab) {
          await placesTab.click().catch(() => {});
          await page.waitForTimeout(1000);
          const miejscaText = (await page.innerText('body').catch(() => '')) || '';
          const addressMatches = miejscaText.match(/Moje miejsca\s+([^\n]+)/i);
          if (addressMatches && addressMatches[1] && !summary.address) {
            summary.address = addressMatches[1].trim();
          }
        }
      }

      // 3. Compute virtual IBAN from client number
      if (summary.clientNumber) {
        summary.iban = computeAquaIban(summary.clientNumber);
      }

      context.log.info(
        `[AquaProvider] Account summary: ${summary.clientName || 'N/A'}, ID: ${summary.clientNumber || 'N/A'}, IBAN: ${summary.iban || 'N/A'}`
      );
    } catch (err) {
      context.log.warn(`[AquaProvider] Could not fully extract account summary: ${err}`);
    }

    return summary;
  }
}
