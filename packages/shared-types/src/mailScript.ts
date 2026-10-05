import type { ProviderCategory } from './provider.js';

export interface MailScriptPortalRule {
  id: string;
  name: string;
  senderFilter: string;
  titleFilter: string;
  category?: ProviderCategory;
  lastSyncedAt?: string | null;
}

export interface MailScriptConfigDto {
  endpointUrl: string;
  gasWebAppUrl?: string | null;
  secretToken: string;
  lastRunDate: string | null;
  lastRunStatus: string | null;
  lastRunMessage: string | null;
  lastRunCount: number;
  scriptNeedsUpdate: boolean;
  scriptCode: string;
  portalCount: number;
}

export interface UpdateMailScriptConfigRequest {
  endpointUrl?: string;
  gasWebAppUrl?: string | null;
  regenerateToken?: boolean;
  acknowledgeScriptUpdate?: boolean;
  resetLastRunDate?: boolean;
}

export interface MailScriptIngestItem {
  portalId?: string | null;
  sender: string;
  subject: string;
  date: string;
  fileName?: string;
  pdfBase64?: string;
  bodySnippet?: string;
  amountDue?: number;
  invoiceNumber?: string;
  dueDate?: string;
  bankAccountNumber?: string;
  paymentTitle?: string;
}

export interface MailScriptIngestRequest {
  secretToken?: string;
  items: MailScriptIngestItem[];
}

export interface MailScriptIngestResult {
  success: boolean;
  importedCount: number;
  message: string;
  errors?: string[];
  lastRunDate?: string | null;
}

export interface MailScriptStatusDto {
  lastRunDate: string | null;
  cutoffDate: string;
  activePortals: MailScriptPortalRule[];
}
