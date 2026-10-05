import type { ProviderCategory } from './provider.js';

export interface MailScriptTemplate {
  id: string;
  name: string;
  displayName: string;
  category: ProviderCategory;
  senderFilter: string;
  titleFilter: string;
  description?: string;
}
