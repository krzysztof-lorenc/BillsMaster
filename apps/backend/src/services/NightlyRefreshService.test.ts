import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { NightlyRefreshService } from './NightlyRefreshService.js';
import { syncQueue } from '../queue/sync.queue.js';

describe('NightlyRefreshService Unit Tests', () => {
  after(async () => {
    await syncQueue.close();
  });
  test('should record and return recent nightly refresh (< 25 hours) as not overdue', async () => {
    const recentDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    await NightlyRefreshService.recordNightlyRefresh({
      queuedPortals: 4,
      status: 'SUCCESS',
      finishedAt: recentDate,
    });

    const status = await NightlyRefreshService.getNightlyRefreshStatus();
    assert.equal(status.lastNightlyRefreshAt, recentDate.toISOString());
    assert.equal(status.isOverdue, false, 'Should not be overdue when run 2 hours ago');
    assert.ok(status.hoursSinceLastRefresh !== null && status.hoursSinceLastRefresh >= 1.9 && status.hoursSinceLastRefresh <= 2.1);
  });

  test('should flag nightly refresh as overdue when last run was more than 25 hours ago', async () => {
    const oldDate = new Date(Date.now() - 26 * 60 * 60 * 1000); // 26 hours ago
    await NightlyRefreshService.recordNightlyRefresh({
      queuedPortals: 4,
      status: 'SUCCESS',
      finishedAt: oldDate,
    });

    const status = await NightlyRefreshService.getNightlyRefreshStatus();
    assert.equal(status.lastNightlyRefreshAt, oldDate.toISOString());
    assert.equal(status.isOverdue, true, 'Should be overdue when run 26 hours ago (> 25h threshold)');
    assert.ok(status.hoursSinceLastRefresh !== null && status.hoursSinceLastRefresh >= 25.9 && status.hoursSinceLastRefresh <= 26.1);
  });

  test('should flag as overdue when no refresh was ever recorded', async () => {
    const client = (await syncQueue.client) as any;
    const backup = await client.get('bullsmaster:last_nightly_refresh');
    try {
      await client.del('bullsmaster:last_nightly_refresh');

      // Temporarily mock client.keys to simulate empty redis
      const origKeys = client.keys;
      client.keys = async () => [];

      const status = await NightlyRefreshService.getNightlyRefreshStatus();
      assert.equal(status.lastNightlyRefreshAt, null);
      assert.equal(status.isOverdue, true);
      assert.equal(status.hoursSinceLastRefresh, null);

      client.keys = origKeys;
    } finally {
      if (backup) {
        await client.set('bullsmaster:last_nightly_refresh', backup);
      }
    }
  });
});
