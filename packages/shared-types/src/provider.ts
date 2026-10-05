export type ProviderCategory = 'ELECTRICITY' | 'GAS' | 'INTERNET' | 'WATER' | 'HOUSING' | 'TELECOM' | 'GSM' | 'OTHER';

export interface ProviderDto {
  id: string;
  name: string;
  category: ProviderCategory;
  loginUrl: string;
  isEnabled: boolean;
  iconUrl?: string | null;
  groupCount?: number;
  accountCount?: number;
}

export interface CreateProviderRequest {
  id: string;
  name: string;
  category: ProviderCategory;
  loginUrl: string;
  isEnabled?: boolean;
  iconUrl?: string | null;
}

export interface UpdateProviderRequest {
  name?: string;
  category?: ProviderCategory;
  loginUrl?: string;
  isEnabled?: boolean;
  iconUrl?: string | null;
}

export interface ExtractedBill {
  invoiceNumber: string;
  amountDue: number;
  currency: string;
  issueDate: Date | string;
  dueDate: Date | string;
  paymentStatus: 'PAID' | 'UNPAID' | 'OVERDUE' | 'PROCESSING';
  bankAccountNumber?: string;
  paymentTitle?: string;
  pdfBuffer?: Uint8Array;
  pdfFileName?: string;
  rawMetadata?: Record<string, unknown>;
}

export interface ProviderCredentials {
  login: string;
  password: string;
  sessionStatePath?: string;
}

export interface ScrapeProgressCallback {
  (percent: number, message: string): Promise<void> | void;
}

export interface ScrapeLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}
