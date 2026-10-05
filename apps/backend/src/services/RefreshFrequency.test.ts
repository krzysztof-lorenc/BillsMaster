import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { getDueFrequenciesForHour, getWarsawHour, syncQueue } from '../queue/sync.queue.js';

describe('Portal Refresh Frequency Unit Tests', () => {
  after(async () => {
    await syncQueue.close();
  });
  test('getDueFrequenciesForHour returns expected frequencies for scheduled hours', () => {
    // 03:00: All portals refresh (daily baseline)
    assert.deepEqual(getDueFrequenciesForHour(3), [1, 2, 3, 4]);

    // 09:00: 4x portals refresh
    assert.deepEqual(getDueFrequenciesForHour(9), [4]);

    // 11:00: 3x portals refresh
    assert.deepEqual(getDueFrequenciesForHour(11), [3]);

    // 15:00: 2x and 4x portals refresh (12h interval for 2x, 6h for 4x)
    assert.deepEqual(getDueFrequenciesForHour(15), [2, 4]);

    // 19:00: 3x portals refresh (8h interval)
    assert.deepEqual(getDueFrequenciesForHour(19), [3]);

    // 21:00: 4x portals refresh (6h interval)
    assert.deepEqual(getDueFrequenciesForHour(21), [4]);

    // Non-scheduled hours should return empty array
    const nonScheduledHours = [0, 1, 2, 4, 5, 6, 7, 8, 10, 12, 13, 14, 16, 17, 18, 20, 22, 23];
    for (const h of nonScheduledHours) {
      assert.deepEqual(getDueFrequenciesForHour(h), [], `Hour ${h} should have no due portals`);
    }
  });

  test('each frequency runs the exact expected number of times in a 24-hour cycle', () => {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };

    for (let h = 0; h < 24; h++) {
      const dueFrequencies = getDueFrequenciesForHour(h);
      for (const freq of dueFrequencies) {
        counts[freq as 1 | 2 | 3 | 4]++;
      }
    }

    assert.equal(counts[1], 1, 'Frequency 1 should run exactly 1 time per day');
    assert.equal(counts[2], 2, 'Frequency 2 should run exactly 2 times per day');
    assert.equal(counts[3], 3, 'Frequency 3 should run exactly 3 times per day');
    assert.equal(counts[4], 4, 'Frequency 4 should run exactly 4 times per day');
  });

  test('getWarsawHour correctly calculates Warsaw hour from Date', () => {
    // 2026-06-15T10:00:00Z (UTC is 10:00, Warsaw in summer is UTC+2 = 12:00)
    const summerDate = new Date('2026-06-15T10:00:00Z');
    assert.equal(getWarsawHour(summerDate), 12);

    // 2026-01-15T10:00:00Z (UTC is 10:00, Warsaw in winter is UTC+1 = 11:00)
    const winterDate = new Date('2026-01-15T10:00:00Z');
    assert.equal(getWarsawHour(winterDate), 11);
  });
});
