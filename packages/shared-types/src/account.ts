import { ProviderDto } from './provider.js';

export type SyncStatus = 'IDLE' | 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'NEEDS_REAUTH';

export interface UserProviderAccountDto {
  id: string;
  userId: string;
  providerId: string;
  accountLabel: string;
  loginMasked: string;
  lastSyncStatus: SyncStatus;
  lastSyncMessage?: string | null;
  lastSyncedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  provider?: ProviderDto;
}

export interface CreateAccountRequest {
  providerId: string;
  accountLabel: string;
  login: string;
  password: string;
}

export interface UpdateAccountRequest {
  accountLabel?: string;
  login?: string;
  password?: string;
}
