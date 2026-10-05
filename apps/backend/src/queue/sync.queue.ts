import { Queue } from 'bullmq';
import { config } from '../config/index.js';
import { logger } from '../core/logger.js';

export interface SyncJobData {
  portalId?: string;
  syncJobId?: string;
  isDailyScheduler?: boolean;
  isIntradayScheduler?: boolean;
  frequencies?: number[];
}

export function getDueFrequenciesForHour(hour: number): number[] {
  switch (hour) {
    case 3:
      return [1, 2, 3, 4];
    case 9:
      return [4];
    case 11:
      return [3];
    case 15:
      return [2, 4];
    case 19:
      return [3];
    case 21:
      return [4];
    default:
      return [];
  }
}

export function getWarsawHour(date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Warsaw',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hourPart = parts.find((p) => p.type === 'hour');
  return hourPart ? parseInt(hourPart.value, 10) : date.getUTCHours();
}

export const SYNC_QUEUE_NAME =
  process.env.DATABASE_URL?.includes('test') || process.env.NODE_ENV === 'test'
    ? 'bill-sync-queue-test'
    : (process.env.SYNC_QUEUE_NAME || 'bill-sync-queue');

export const syncQueue = new Queue<SyncJobData>(SYNC_QUEUE_NAME, {
  connection: {
    url: config.REDIS_URL,
    maxRetriesPerRequest: null,
  },
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  },
});

export async function enqueueSync(portalId: string, syncJobId: string) {
  logger.info(`[Queue] Enqueuing sync job for portal: ${portalId} (job: ${syncJobId})`);
  return syncQueue.add(
    `sync-${portalId}`,
    {
      portalId,
      syncJobId,
    },
    {
      jobId: syncJobId,
    }
  );
}

export async function setupDailySyncScheduler(): Promise<void> {
  try {
    logger.info('[Queue] Configuring daily 3:00 AM sync scheduler (Europe/Warsaw)...');
    await syncQueue.upsertJobScheduler(
      'daily-3am-sync',
      {
        pattern: '0 3 * * *',
        tz: 'Europe/Warsaw',
      },
      {
        name: 'daily-sync-scheduler',
        data: {
          isDailyScheduler: true,
        },
      }
    );

    logger.info('[Queue] Configuring intraday refresh scheduler (09:00, 11:00, 15:00, 19:00, 21:00 Europe/Warsaw)...');
    await syncQueue.upsertJobScheduler(
      'intraday-refresh-sync',
      {
        pattern: '0 9,11,15,19,21 * * *',
        tz: 'Europe/Warsaw',
      },
      {
        name: 'intraday-sync-scheduler',
        data: {
          isIntradayScheduler: true,
        },
      }
    );

    const schedulers = await syncQueue.getJobSchedulers();
    const dailySched = schedulers.find((s) => s.key === 'daily-3am-sync');
    if (dailySched && dailySched.next) {
      const nextDate = new Date(dailySched.next).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
      logger.info(`⏰ Daily sync scheduled successfully. Next execution: ${nextDate} (Warsaw time)`);
    } else {
      logger.info('⏰ Daily sync scheduler registered.');
    }

    const intradaySched = schedulers.find((s) => s.key === 'intraday-refresh-sync');
    if (intradaySched && intradaySched.next) {
      const nextDate = new Date(intradaySched.next).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
      logger.info(`⏰ Intraday refresh scheduled successfully. Next execution: ${nextDate} (Warsaw time)`);
    }
  } catch (err) {
    logger.error('[Queue] Error setting up sync schedulers:', err);
  }
}

export const setupSyncSchedulers = setupDailySyncScheduler;
