import { syncQueue } from '../queue/sync.queue.js';
import { logger } from '../core/logger.js';
import type { NightlyRefreshStatusDto } from '@bills-master/shared-types';

const REDIS_LAST_NIGHTLY_REFRESH_KEY = 'bullsmaster:last_nightly_refresh';

export class NightlyRefreshService {
  /**
   * Records a completed or attempted nightly refresh run into Redis.
   */
  public static async recordNightlyRefresh(data?: {
    queuedPortals?: number;
    status?: 'SUCCESS' | 'FAILED';
    finishedAt?: Date;
  }): Promise<void> {
    try {
      const client = await syncQueue.client;
      const payload = {
        finishedAt: (data?.finishedAt || new Date()).toISOString(),
        status: data?.status || 'SUCCESS',
        queuedPortals: data?.queuedPortals ?? 0,
      };
      await client.set(REDIS_LAST_NIGHTLY_REFRESH_KEY, JSON.stringify(payload));
      logger.info(`[NightlyRefreshService] Recorded nightly refresh at ${payload.finishedAt}`);
    } catch (err) {
      logger.error('[NightlyRefreshService] Failed to record nightly refresh in Redis:', err);
    }
  }

  /**
   * Retrieves the current status of the nightly refresh job,
   * including the timestamp of the last run, whether it is overdue (> 25h),
   * and the next scheduled execution.
   */
  public static async getNightlyRefreshStatus(): Promise<NightlyRefreshStatusDto> {
    let lastFinishedAt: string | null = null;

    try {
      const client = await syncQueue.client;

      // 1. Try reading from dedicated key
      const raw = await client.get(REDIS_LAST_NIGHTLY_REFRESH_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.finishedAt) {
            lastFinishedAt = parsed.finishedAt;
          }
        } catch {
          // ignore parsing error
        }
      }

      // 2. If not found in dedicated key, discover from BullMQ repeat job records in Redis
      if (!lastFinishedAt) {
        const redis = client as any;
        const repeatKeys: string[] = await redis.keys('bull:bill-sync-queue:repeat:daily-3am-sync:*');
        let latestTimestamp = 0;

        for (const key of repeatKeys) {
          try {
            const jobData = await redis.hgetall(key);
            // Only consider completed/processed repeat instances
            if (jobData && (jobData.finishedOn || jobData.processedOn)) {
              const finishedTime = Number(jobData.finishedOn || jobData.processedOn);
              if (finishedTime && finishedTime > latestTimestamp) {
                latestTimestamp = finishedTime;
              }
            }
          } catch {
            // ignore individual key lookup errors
          }
        }

        if (latestTimestamp > 0) {
          lastFinishedAt = new Date(latestTimestamp).toISOString();
          // Backfill dedicated key so subsequent queries are fast
          await client.set(
            REDIS_LAST_NIGHTLY_REFRESH_KEY,
            JSON.stringify({
              finishedAt: lastFinishedAt,
              status: 'SUCCESS',
              autoDiscovered: true,
            })
          );
        }
      }
    } catch (err) {
      logger.error('[NightlyRefreshService] Error fetching nightly refresh status from Redis:', err);
    }

    // 3. Find next scheduled execution from BullMQ schedulers
    let nextScheduledAt: string | null = null;
    try {
      const schedulers = await syncQueue.getJobSchedulers();
      const dailySched = schedulers.find((s) => s.key === 'daily-3am-sync');
      if (dailySched && dailySched.next) {
        nextScheduledAt = new Date(dailySched.next).toISOString();
      }
    } catch (err) {
      logger.warn('[NightlyRefreshService] Could not retrieve next scheduled execution:', err);
    }

    // 4. Calculate hours difference and overdue status (> 25 hours threshold)
    if (lastFinishedAt) {
      const lastTime = new Date(lastFinishedAt).getTime();
      const diffMs = Math.max(0, Date.now() - lastTime);
      const hoursSinceLastRefresh = Math.round((diffMs / (1000 * 60 * 60)) * 10) / 10;
      const isOverdue = hoursSinceLastRefresh > 25;

      return {
        lastNightlyRefreshAt: lastFinishedAt,
        isOverdue,
        hoursSinceLastRefresh,
        nextScheduledAt,
      };
    }

    // No run recorded yet: mark as overdue (alert style needed)
    return {
      lastNightlyRefreshAt: null,
      isOverdue: true,
      hoursSinceLastRefresh: null,
      nextScheduledAt,
    };
  }
}
