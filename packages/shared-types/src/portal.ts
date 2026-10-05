import type { ProviderCategory } from './provider.js';
import type { SyncStatus } from './account.js';

export interface PortalDto {
  id: string;
  name: string;
  providerId: string;
  providerName?: string;
  providerCategory?: ProviderCategory;
  category?: ProviderCategory;
  loginMasked: string;
  isEnabled: boolean;
  agreementFilter?: string | null;
  syncFrequency: number;
  groupIds: string[];
  groupNames?: string[];
  lastSyncStatus: SyncStatus;
  lastSyncMessage?: string | null;
  lastSyncedAt?: string | null;
  billCount?: number;
  isMailScript?: boolean;
  senderFilter?: string | null;
  titleFilter?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePortalRequest {
  name: string;
  providerId: string;
  login?: string;
  password?: string;
  category?: ProviderCategory;
  agreementFilter?: string | null;
  syncFrequency?: number;
  groupIds?: string[];
  isEnabled?: boolean;
  isMailScript?: boolean;
  senderFilter?: string | null;
  titleFilter?: string | null;
}

export interface UpdatePortalRequest {
  name?: string;
  providerId?: string;
  login?: string;
  password?: string;
  category?: ProviderCategory;
  agreementFilter?: string | null;
  syncFrequency?: number;
  groupIds?: string[];
  isEnabled?: boolean;
  isMailScript?: boolean;
  senderFilter?: string | null;
  titleFilter?: string | null;
}

export interface DuplicatePortalRequest {
  name?: string;
  agreementFilter?: string | null;
  syncFrequency?: number;
  groupIds?: string[];
  isEnabled?: boolean;
  senderFilter?: string | null;
  titleFilter?: string | null;
  category?: ProviderCategory;
}
