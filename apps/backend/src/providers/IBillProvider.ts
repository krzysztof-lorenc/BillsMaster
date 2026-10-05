import type { Page, BrowserContext } from 'playwright';
import type { ExtractedBill, ProviderCredentials, ScrapeProgressCallback, ScrapeLogger } from '@bills-master/shared-types';

export interface ScrapeContext {
  browserContext: BrowserContext;
  downloadDir: string;
  log: ScrapeLogger;
  reportProgress: ScrapeProgressCallback;
  setStage?: (stage: string) => void;
  agreementFilter?: string | null;
}

export interface AuthResult {
  sessionState?: object;
  accountSummary?: Record<string, unknown>;
}

export interface IBillProvider {
  readonly id: string;
  readonly displayName: string;
  readonly loginUrl: string;

  /**
   * Authenticates the user with the portal.
   * If existing cookies/tokens are valid, skips typing password.
   * If 2FA or captcha blocking occurs, throws NeedsReauthError.
   */
  authenticate(
    page: Page,
    creds: ProviderCredentials,
    context: ScrapeContext
  ): Promise<AuthResult>;

  /**
   * Navigates to invoices/settlements page, parses bill rows and downloads PDF invoices.
   */
  fetchBills(
    page: Page,
    context: ScrapeContext
  ): Promise<ExtractedBill[]>;
}
