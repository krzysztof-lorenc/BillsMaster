import type { ProviderCategory } from './provider.js';

export interface MailScriptTemplate {
  id: string;
  name: string;
  displayName: string;
  category: ProviderCategory;
  senderFilter: string;
  titleFilter: string;
  paymentReceiver?: string;
  description?: string;
}
