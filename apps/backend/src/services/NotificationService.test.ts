import { describe, it } from 'node:test';
import assert from 'node:assert';
import { NotificationService } from './NotificationService.js';

describe('NotificationService', () => {
  it('formats Warsaw date correctly (YYYY-MM-DD)', () => {
    const testDate = new Date('2026-10-24T12:00:00Z');
    const result = NotificationService.getWarsawDateString(testDate);
    assert.strictEqual(result, '2026-10-24');
  });

  it('formats Day and Month correctly (DD.MM)', () => {
    const testDate = new Date('2026-10-05T12:00:00Z');
    const result = NotificationService.formatDayMonth(testDate);
    assert.strictEqual(result, '05.10');
  });

  it('formats portal bullet list without category headers', () => {
    const items = [
      {
        portalName: 'Tauron',
        count: 1,
        earliestDueDate: new Date('2026-10-24T10:00:00Z'),
      },
      {
        portalName: 'PGNiG',
        count: 2,
        earliestDueDate: new Date('2026-10-28T10:00:00Z'),
      },
      {
        portalName: 'Vectra',
        count: 3,
        earliestDueDate: new Date('2026-10-15T10:00:00Z'),
      },
    ];

    const formatted = NotificationService.formatPortalBulletList(items);

    // Verify each line format: · PortalName (count if > 1): DD.MM
    const lines = formatted.split('\n');
    assert.strictEqual(lines.length, 3);
    assert.strictEqual(lines[0], '· Tauron: 24.10');
    assert.strictEqual(lines[1], '· PGNiG (2): 28.10');
    assert.strictEqual(lines[2], '· Vectra (3): 15.10');

    // Ensure no redundant category headers exist
    assert.ok(!formatted.includes('Nowe faktury'));
    assert.ok(!formatted.includes('Płatność'));
    assert.ok(!formatted.includes('Nieopłacone'));
  });

  it('initializes VAPID and returns a valid public key', () => {
    const pubKey = NotificationService.getVapidPublicKey();
    assert.ok(pubKey, 'Public VAPID key must not be empty');
    assert.ok(pubKey.length > 20, 'Public key should be a base64url string');
  });
});
