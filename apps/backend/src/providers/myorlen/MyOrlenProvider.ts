import type { Page } from 'playwright';
import type { IBillProvider, ScrapeContext, AuthResult } from '../IBillProvider.js';
import type { ExtractedBill, ProviderCredentials } from '@bills-master/shared-types';
import { MYORLEN_CONFIG } from './selectors.js';
import { NeedsReauthError, AppError } from '../../core/errors.js';
import { cleanInvoiceNumber, isOlderThan12Months } from '../../core/utils.js';


interface OrlenAddress {
  Ulica?: string;
  UlicaTyp?: string;
  NrBudynku?: string;
  NrLokalu?: string;
  KodPocztowy?: string;
  Miejscowosc?: string;
  HasAnyValue?: boolean;
}

interface OrlenAgreement {
  Type?: string;
  AgreementNumber: string;
  ClientNumber?: string;
  ClientName?: string;
  Iban?: string;
  Address?: OrlenAddress;
  ClientAddress?: OrlenAddress;
  InvoiceAddress?: OrlenAddress;
  AgreementName?: string;
  Tariff?: string;
  Active?: boolean;
}

interface OrlenInvoiceItem {
  Number: string;
  Date: string;
  SellDate?: string;
  GrossAmount: number;
  AmountToPay: number;
  Wear?: number;
  WearKWH?: number;
  WearM3?: number | null;
  PayingDeadlineDate: string;
  StartDate?: string;
  EndDate?: string;
  IsPaid: boolean;
  IdPP?: string;
  Type?: string;
  Iban?: string;
  Status?: string;
  IsInterestNote?: boolean;
  AgreementNumber?: string;
}

export class MyOrlenProvider implements IBillProvider {
  public readonly id = 'myorlen';
  public readonly displayName = 'myORLEN (eBOK Gaz)';
  public readonly loginUrl = MYORLEN_CONFIG.loginUrl;

  private async isAlreadyLoggedIn(page: Page): Promise<boolean> {
    const url = page.url();
    if (url.includes('/home') || url.includes('/faktury') || url.includes('/odczyty')) {
      return true;
    }
    return page.evaluate(() => {
      const text = document.body ? document.body.innerText : '';
      if (text.includes('Zalogowany:') || text.includes('Wyloguj') || text.includes('Przejdź do faktur')) {
        return true;
      }
      return Boolean(
        document.querySelector('button[data-testid*="logout"], a[href*="wyloguj"]') ||
        Array.from(document.querySelectorAll('button, a')).some((el) => el.textContent?.includes('Wyloguj'))
      );
    }).catch(() => false);
  }

  private async dismissOverlays(page: Page): Promise<void> {
    await page.evaluate(() => {
      // 1. Marketing popup close button
      const modalBtn = document.querySelector('.modalCloseButton, button.modalCloseButton') as HTMLElement;
      if (modalBtn) {
        try { modalBtn.click(); } catch {}
        try { modalBtn.closest('span')?.remove(); } catch {}
      }
      document.querySelectorAll('.ModalContent, [class*="ModalContent"]').forEach((el) => {
        el.parentElement?.parentElement?.remove();
        el.remove();
      });
      document.querySelectorAll('.modal-backdrop, [class*="backdrop"]').forEach((b) => b.remove());

      // 2. Cookiebot allow all button
      const cookieBtn = document.querySelector('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll') as HTMLElement;
      if (cookieBtn) {
        try { cookieBtn.click(); } catch {}
      }
      document.querySelectorAll('[id*="Cookiebot"], [class*="Cookiebot"]').forEach((el) => el.remove());
      document.body.style.overflow = 'auto';
    }).catch(() => {});
    await page.waitForTimeout(500);
  }

  public async authenticate(
    page: Page,
    creds: ProviderCredentials,
    context: ScrapeContext
  ): Promise<AuthResult> {
    context.log.info('[MyOrlenProvider] Starting authentication sequence...');
    await context.reportProgress(10, 'Łączenie z portalem myORLEN eBOK...');

    // 1. Navigate to portal URL
    await context.reportProgress(15, 'Otwieranie portalu myORLEN...');
    await page.goto(MYORLEN_CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(1500);

    // Check if session is already active (either from session cookies or saved state)
    if (await this.isAlreadyLoggedIn(page)) {
      context.log.info('[MyOrlenProvider] Active session is already logged in.');
      await context.reportProgress(30, 'Przywrócono aktywną sesję myORLEN.');
      const state = await context.browserContext.storageState();
      const accountSummary = await this.extractAccountSummary(page);
      return { sessionState: state, accountSummary };
    }

    // 2. Dismiss marketing popup & Cookiebot if present
    await this.dismissOverlays(page);

    // Double check if dismissed overlays revealed an already-logged in state
    if (await this.isAlreadyLoggedIn(page)) {
      context.log.info('[MyOrlenProvider] Active session recognized after dismissing overlays.');
      await context.reportProgress(30, 'Przywrócono aktywną sesję myORLEN.');
      const state = await context.browserContext.storageState();
      const accountSummary = await this.extractAccountSummary(page);
      return { sessionState: state, accountSummary };
    }

    // 3. Reveal login form if not already visible
    const identInputLocator = page.locator('input[name="identificator"]');
    const isIdentVisible = await identInputLocator.isVisible().catch(() => false);
    if (!isIdentVisible) {
      await context.reportProgress(30, 'Wybór logowania loginem eBOK...');
      const loginChoiceBtn = page.locator('button:has-text("Zaloguj loginem eBOK")');
      if (await loginChoiceBtn.isVisible().catch(() => false)) {
        await loginChoiceBtn.click().catch(async () => {
          await page.evaluate(() => {
            const b = Array.from(document.querySelectorAll('button')).find((btn) => btn.textContent?.includes('Zaloguj loginem eBOK'));
            if (b) b.click();
          });
        });
      }
    }

    // 4. Wait for and fill credentials
    await context.reportProgress(40, 'Wprowadzanie danych logowania...');
    await identInputLocator.waitFor({ state: 'visible', timeout: 10000 });
    await identInputLocator.fill(creds.login);
    await page.fill('input[name="accessPin"]', creds.password);

    // 5. Submit login form
    await context.reportProgress(45, 'Wysyłanie formularza logowania...');
    const submitBtn = page.locator('button:has-text("Zaloguj do eBOK")');
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click();
    } else {
      await page.locator('button[type="submit"]:has-text("Zaloguj")').click().catch(() => {
        return page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const b = btns.find((x) => x.textContent?.includes('Zaloguj do eBOK') || x.textContent?.includes('Zaloguj'));
          if (b) b.click();
        });
      });
    }

    // 6. Wait for dashboard or login indicator
    await page.waitForFunction(
      () => {
        const text = document.body ? document.body.innerText : '';
        return (
          window.location.pathname.includes('/home') ||
          text.includes('Zalogowany:') ||
          text.includes('Wyloguj') ||
          text.includes('Faktury są nieopłacone') ||
          text.includes('Przejdź do faktur')
        );
      },
      { timeout: 25000 }
    ).catch(() => null);
    await page.waitForTimeout(1500);

    // Dismiss any post-login popups that might appear
    await this.dismissOverlays(page);

    // Check 2FA challenge
    const is2FA = await page.$(MYORLEN_CONFIG.selectors.twoFactorPrompt);
    if (is2FA) {
      throw new NeedsReauthError('Portal myORLEN wymaga weryfikacji dwuetapowej (2FA / kod SMS). Wymagane logowanie ręczne.');
    }

    // Check captcha
    const isCaptcha = await page.$(MYORLEN_CONFIG.selectors.captchaContainer);
    if (isCaptcha) {
      throw new NeedsReauthError('Portal myORLEN wyświetlił zabezpieczenie CAPTCHA.');
    }

    // Check for login errors in page text
    const pageBodyText = await page.innerText('body').catch(() => '');
    if (
      pageBodyText.includes('Nieprawidłowy login lub hasło') ||
      pageBodyText.includes('Błędny login lub hasło') ||
      pageBodyText.includes('Niepoprawne dane logowania') ||
      pageBodyText.includes('Konto zostało zablokowane')
    ) {
      throw new AppError('Błąd logowania do portalu myORLEN: Nieprawidłowy e-mail lub hasło', 401);
    }

    // Verify logged in
    const isHome = await this.isAlreadyLoggedIn(page);
    if (!isHome) {
      await page.waitForTimeout(2000);
      const isHomeRetry = await this.isAlreadyLoggedIn(page);
      if (!isHomeRetry) {
        const alertBoxText = await page.evaluate(() => {
          const alert = document.querySelector('.alert-box, .error-message, .form-error, [class*="error"]');
          return alert ? (alert as HTMLElement).innerText : null;
        }).catch(() => null);
        throw new AppError(
          alertBoxText
            ? `Błąd logowania do portalu myORLEN: ${alertBoxText}`
            : 'Logowanie do portalu myORLEN nie powiodło się (brak przekierowania do panelu)',
          401
        );
      }
    }

    const accountSummary = await this.extractAccountSummary(page);
    const sessionState = await context.browserContext.storageState();
    await context.reportProgress(50, 'Logowanie do myORLEN zakończone pomyślnie.');

    return { sessionState, accountSummary };
  }

  public async fetchBills(
    page: Page,
    context: ScrapeContext
  ): Promise<ExtractedBill[]> {
    context.log.info('[MyOrlenProvider] Loading agreements and bills from myORLEN...');
    await context.reportProgress(55, 'Pobieranie listy umów i punktów poboru gazu...');

    // 1. Fetch agreements list from API
    let agreements: OrlenAgreement[] = [];
    try {
      const agreementsRes = await page.request.get(MYORLEN_CONFIG.api.agreements);
      if (agreementsRes.status() === 200) {
        const json = await agreementsRes.json();
        agreements = json.Agreements || [];
      }
    } catch (err) {
      context.log.warn(`[MyOrlenProvider] Error querying get-all-agreements: ${err}`);
    }

    // Fallback if empty
    if (agreements.length === 0) {
      try {
        const fallbackRes = await page.request.get(MYORLEN_CONFIG.api.agreementsFallback);
        if (fallbackRes.status() === 200) {
          const json = await fallbackRes.json();
          agreements = json.Agreements || [];
        }
      } catch (err) {
        context.log.warn(`[MyOrlenProvider] Fallback agreements query failed: ${err}`);
      }
    }

    // 2. Prepare agreement filter regex
    let filterRegex: RegExp | null = null;
    if (context.agreementFilter && context.agreementFilter.trim().length > 0) {
      try {
        filterRegex = new RegExp(context.agreementFilter.trim(), 'i');
        context.log.info(`[MyOrlenProvider] Using agreement/address filter regex: /${context.agreementFilter.trim()}/i`);
      } catch (err) {
        context.log.warn(`[MyOrlenProvider] Invalid agreement filter regex "${context.agreementFilter}": ${err}. All agreements will be scraped.`);
      }
    }

    // 3. Filter agreements based on regex
    const matchedAgreements: OrlenAgreement[] = [];
    if (agreements.length > 0) {
      context.log.info(`[MyOrlenProvider] Found ${agreements.length} total agreements in myORLEN portal`);

      for (const ag of agreements) {
        const formattedAddress = this.formatAgreementAddress(ag);
        const agreementNum = ag.AgreementNumber || '';
        const clientNum = ag.ClientNumber || '';
        const clientName = ag.ClientName || '';
        const agreementName = ag.AgreementName || '';

        if (filterRegex) {
          const addressMatches = filterRegex.test(formattedAddress);
          const streetMatches = ag.Address?.Ulica ? filterRegex.test(ag.Address.Ulica) : false;
          const cityMatches = ag.Address?.Miejscowosc ? filterRegex.test(ag.Address.Miejscowosc) : false;
          const agreementMatches = filterRegex.test(agreementNum);
          const clientMatches = filterRegex.test(clientNum);
          const nameMatches = filterRegex.test(clientName) || filterRegex.test(agreementName);

          if (!addressMatches && !streetMatches && !cityMatches && !agreementMatches && !clientMatches && !nameMatches) {
            context.log.info(
              `[MyOrlenProvider] Skipping agreement "${agreementNum}" (${formattedAddress}) — does not match regex /${context.agreementFilter}/i`
            );
            continue;
          }
        }

        context.log.info(`[MyOrlenProvider] Matched agreement: "${agreementNum}" (${formattedAddress})`);
        matchedAgreements.push(ag);
      }
    }

    const extractedBills: ExtractedBill[] = [];
    const seenInvoiceNumbers = new Set<string>();

    // 4. Fetch invoices for each matched agreement (or all invoices if no agreements mapped)
    const targetAgreements = matchedAgreements.length > 0 ? matchedAgreements : (filterRegex ? [] : [null]);

    for (let i = 0; i < targetAgreements.length; i++) {
      const ag = targetAgreements[i];
      const agreementNum = ag ? ag.AgreementNumber : undefined;
      const formattedAddress = ag ? this.formatAgreementAddress(ag) : 'Wszystkie umowy';

      const progressPct = 60 + Math.floor(((i + 1) / targetAgreements.length) * 25);
      await context.reportProgress(progressPct, `Odczytywanie faktur dla: ${formattedAddress}...`);

      let pageNum = 1;
      let hasMore = true;

      while (hasMore && pageNum <= 10) {
        let apiUrl = `${MYORLEN_CONFIG.api.invoices}&pageNumber=${pageNum}&pageSize=50`;
        if (agreementNum) {
          apiUrl += `&agreementNumber=${encodeURIComponent(agreementNum)}`;
        }

        try {
          const res = await page.request.get(apiUrl);
          if (res.status() !== 200) {
            context.log.warn(`[MyOrlenProvider] get-invoices-v2 returned HTTP ${res.status()}`);
            break;
          }

          const data = await res.json();
          const invoicesList: OrlenInvoiceItem[] = data.InvoicesList || [];
          hasMore = Boolean(data.HasMoreRecords);

          context.log.info(`[MyOrlenProvider] Page ${pageNum} returned ${invoicesList.length} invoices (hasMore: ${hasMore})`);

          for (const inv of invoicesList) {
            const cleanInv = cleanInvoiceNumber(inv.Number);
            if (!cleanInv || seenInvoiceNumbers.has(cleanInv)) {
              continue;
            }
            seenInvoiceNumbers.add(cleanInv);

            // Amount: gross amount of the invoice
            const amountDue = typeof inv.GrossAmount === 'number' ? inv.GrossAmount : Number(inv.AmountToPay) || 0;

            const issueDate = inv.Date ? new Date(inv.Date) : (inv.StartDate ? new Date(inv.StartDate) : new Date());
            issueDate.setHours(0, 0, 0, 0);

            const dueDate = inv.PayingDeadlineDate ? new Date(inv.PayingDeadlineDate) : new Date(issueDate.getTime() + 14 * 86400000);
            dueDate.setHours(0, 0, 0, 0);

            if (isOlderThan12Months(issueDate)) {
              context.log.info(`[MyOrlenProvider] Skipping invoice ${cleanInv} older than 12 months (${issueDate.toISOString().slice(0, 10)})`);
              continue;
            }

            const now = new Date();
            now.setHours(0, 0, 0, 0);

            let paymentStatus: 'PAID' | 'UNPAID' | 'OVERDUE';
            if (inv.IsPaid || inv.Status === 'Posted') {
              paymentStatus = 'PAID';
            } else if (dueDate.getTime() < now.getTime()) {
              paymentStatus = 'OVERDUE';
            } else {
              paymentStatus = 'UNPAID';
            }

            const iban = inv.Iban || (ag ? ag.Iban : undefined) || 'PL 62 1020 1026 9000 0004 0444 4375';
            const paymentTitle = cleanInv;

            // 5. Try downloading invoice PDF
            let pdfBuffer: Uint8Array | undefined;
            let pdfFileName: string | undefined;

            try {
              const pdfUrl = `${MYORLEN_CONFIG.api.invoicePdf}?invoiceNumber=${encodeURIComponent(inv.Number)}&mode=partial`;
              const pdfRes = await page.request.get(pdfUrl, { timeout: 8000 });
              if (pdfRes.status() === 200) {
                const body = await pdfRes.body();
                if (body && body.length > 500 && body.subarray(0, 4).toString() === '%PDF') {
                  pdfBuffer = body;
                  pdfFileName = `myORLEN_${cleanInv.replace(/[\/\\:]/g, '_')}.pdf`;
                }
              }
            } catch {
              // PDF download timeout or unavailable (e.g. interest notes)
            }

            extractedBills.push({
              invoiceNumber: cleanInv,
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
                agreementName: formattedAddress,
                address: ag?.Address,
                agreementNumber: inv.AgreementNumber || agreementNum,
                clientNumber: ag?.ClientNumber,
                wearKWH: inv.WearKWH,
                wearM3: inv.WearM3,
                isInterestNote: Boolean(inv.IsInterestNote),
                status: inv.Status,
              },
            });
          }

          pageNum++;
        } catch (err) {
          context.log.warn(`[MyOrlenProvider] Error querying invoices page ${pageNum}: ${err}`);
          break;
        }
      }
    }

    await context.reportProgress(95, `Odczytano ${extractedBills.length} faktur z portalu myORLEN.`);
    return extractedBills;
  }

  /**
   * Formats an agreement address into a readable Polish string matching the portal combobox format:
   * e.g. "Warszawa, ul. Kwiatowa 2/126" or "Kraków, ul. Słoneczna 15a"
   */
  public formatAgreementAddress(ag: OrlenAgreement): string {
    const addr = ag.Address || ag.ClientAddress || ag.InvoiceAddress;
    if (!addr) {
      return ag.AgreementName || ag.AgreementNumber || 'Brak adresu';
    }

    const city = addr.Miejscowosc ? addr.Miejscowosc.trim() : '';
    const streetType = addr.UlicaTyp ? addr.UlicaTyp.trim() : 'ul.';
    const street = addr.Ulica ? addr.Ulica.trim() : '';
    const building = addr.NrBudynku ? addr.NrBudynku.trim() : '';
    const flat = addr.NrLokalu && addr.NrLokalu.trim().length > 0 ? `/${addr.NrLokalu.trim()}` : '';

    const streetPart = street ? `${streetType} ${street} ${building}${flat}`.trim() : building;
    return city ? `${city}, ${streetPart}` : streetPart;
  }

  private async extractAccountSummary(page: Page): Promise<{ clientNumber?: string; accountName?: string }> {
    try {
      const summaryRes = await page.request.get(MYORLEN_CONFIG.api.balance).catch(() => null);
      let balanceVal: number | undefined;
      if (summaryRes && summaryRes.status() === 200) {
        const json = await summaryRes.json().catch(() => null);
        if (json && typeof json.Value === 'number') {
          balanceVal = json.Value;
        }
      }

      const bodyText = await page.innerText('body').catch(() => '');
      const clientMatch = bodyText.match(/(?:Klient|Nr klienta)[:\s]+(\d+)/i);
      const emailMatch = bodyText.match(/Zalogowany:\s*([^\s]+@[^\s]+)/i);

      return {
        clientNumber: clientMatch ? clientMatch[1] : undefined,
        accountName: emailMatch ? emailMatch[1] : (balanceVal !== undefined ? `Saldo: ${balanceVal} zł` : undefined),
      };
    } catch {
      return {};
    }
  }
}
