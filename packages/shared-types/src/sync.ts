import { SyncStatus } from './account.js';

export interface SyncErrorDetails {
  portalId: string;
  portalName: string;
  stage: string;
  errorTitle: string;
  generalInfo: string;
  errorMessage: string;
  errorStack?: string | null;
  timestamp: string;
  jobId?: string;
}

export interface SyncJobDto {
  id: string;
  portalId: string;
  portalName?: string;
  status: SyncStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  billsFound: number;
  billsImported: number;
  errorMessage?: string | null;
  errorDetails?: SyncErrorDetails | null;
  createdAt: string;
}

export interface WsSyncProgressEvent {
  type: 'SYNC_PROGRESS';
  payload: {
    jobId: string;
    portalId: string;
    portalName: string;
    providerId: string;
    providerName: string;
    status: SyncStatus;
    progressPercent: number;
    message: string;
    currentJobIndex?: number;
    totalJobsCount?: number;
    overallProgressPercent?: number;
  };
}

export interface WsSyncCompletedEvent {
  type: 'SYNC_COMPLETED';
  payload: {
    jobId: string;
    portalId: string;
    portalName?: string;
    status: 'SUCCESS' | 'FAILED' | 'NEEDS_REAUTH';
    billsFound: number;
    billsImported: number;
    message: string;
    errorDetails?: SyncErrorDetails | null;
    hasMoreJobs?: boolean;
    remainingJobsCount?: number;
    currentJobIndex?: number;
    totalJobsCount?: number;
    overallProgressPercent?: number;
  };
}

export interface WsUserSyncProgressEvent {
  type: 'SYNC_PROGRESS';
  payload: {
    jobId: string;
    portalId: string;
    portalName: string;
    providerId: string;
    providerName: string;
    status: SyncStatus;
    progressPercent: number;
    message: string;
    currentJobIndex?: number;
    totalJobsCount?: number;
    overallProgressPercent?: number;
  };
}

export type WsServerEvent = 
  | WsSyncProgressEvent 
  | WsSyncCompletedEvent;

export interface ActiveSyncDto {
  jobId: string;
  portalId: string;
  portalName: string;
  providerId?: string;
  providerName: string;
  status: SyncStatus;
  progressPercent: number;
  message: string;
  isComplete?: boolean;
  startedAt?: string | null;
  hasMoreJobs?: boolean;
  remainingJobsCount?: number;
  currentJobIndex?: number;
  totalJobsCount?: number;
  overallProgressPercent?: number;
}

export interface ActiveSyncResponse {
  active: boolean;
  activeSync: ActiveSyncDto | null;
  remainingJobsCount?: number;
}

export interface NightlyRefreshStatusDto {
  lastNightlyRefreshAt: string | null;
  isOverdue: boolean;
  hoursSinceLastRefresh: number | null;
  nextScheduledAt?: string | null;
}
