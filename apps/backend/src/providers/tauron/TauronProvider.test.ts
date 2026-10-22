import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TauronProvider } from './TauronProvider.js';

describe('TauronProvider Unit Tests - Dates & Status Extraction', () => {
  const provider = new TauronProvider();

  test('should parse overdue invoice with relative days text (e.g. "14 dni temu minął termin płatności.")', () => {
    const rowText = 'E/TM3/PC031995/0008/26\nFaktura\n\t21.08.2026\t-\t14 dni temu minął termin płatności.\t\n107,25 zł\nZapłać';
    const result = provider.extractDatesAndStatus(rowText, false, true);

    assert.equal(result.paymentStatus, 'OVERDUE');
    assert.equal(result.issueDate.getFullYear(), 2026);
    assert.equal(result.issueDate.getMonth(), 7); // August (0-indexed)
    assert.equal(result.issueDate.getDate(), 21);

    // Due date should be ~14 days ago from today
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diffDays = Math.round((now.getTime() - result.dueDate.getTime()) / (1000 * 60 * 60 * 24));
    assert.equal(diffDays, 14, 'Due date must be exactly 14 days ago');
    assert.ok(result.dueDate.getTime() < now.getTime());
  });

  test('should parse unpaid invoice with explicit future due date', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);
    const day = String(futureDate.getDate()).padStart(2, '0');
    const month = String(futureDate.getMonth() + 1).padStart(2, '0');
    const year = futureDate.getFullYear();
    const dateStr = `${day}.${month}.${year}`;

    const rowText = `E/TM3/PC031995/0009/26\nFaktura\n\t16.09.2026\t-\t${dateStr}\t\n114,06 zł\nZapłać`;
    const result = provider.extractDatesAndStatus(rowText, false, true);

    assert.equal(result.paymentStatus, 'UNPAID');
    assert.equal(result.issueDate.getFullYear(), 2026);
    assert.equal(result.issueDate.getMonth(), 8); // September
    assert.equal(result.issueDate.getDate(), 16);

    assert.equal(result.dueDate.getFullYear(), year);
    assert.equal(result.dueDate.getMonth(), futureDate.getMonth());
    assert.equal(result.dueDate.getDate(), futureDate.getDate());
  });

  test('should parse paid archived invoice', () => {
    const rowText = 'E/TM3/PC100452/0002/26\nFaktury\n\t11.06.2026\t29.06.2026\t\n342.49 zł\nOpłacona';
    const result = provider.extractDatesAndStatus(rowText, true, false);

    assert.equal(result.paymentStatus, 'PAID');
    assert.equal(result.issueDate.getFullYear(), 2026);
    assert.equal(result.issueDate.getMonth(), 5); // June
    assert.equal(result.issueDate.getDate(), 11);

    assert.equal(result.dueDate.getFullYear(), 2026);
    assert.equal(result.dueDate.getMonth(), 5); // June
    assert.equal(result.dueDate.getDate(), 29);
  });

  test('should handle various overdue phrasing variations', () => {
    const variations = [
      'Termin minął 5 dni temu',
      'Termin płatności minął 3 dni temu.',
      '1 dzień temu minął termin płatności',
      '7 dni po terminie',
    ];

    for (const phrase of variations) {
      const row = `F/123\nFaktura\t01.08.2026\t${phrase}\t100 zł\nZapłać`;
      const res = provider.extractDatesAndStatus(row, false, true);
      assert.equal(res.paymentStatus, 'OVERDUE', `Phrase "${phrase}" should result in OVERDUE`);
      assert.ok(res.dueDate.getTime() < Date.now(), `Due date for "${phrase}" should be in the past`);
    }
  });

  test('should handle upcoming relative days text', () => {
    const rowText = 'F/124\nFaktura\t15.09.2026\tDo zapłaty za 5 dni\t200 zł\nZapłać';
    const result = provider.extractDatesAndStatus(rowText, false, true);

    assert.equal(result.paymentStatus, 'UNPAID');
    const expected = new Date();
    expected.setDate(expected.getDate() + 5);
    expected.setHours(0, 0, 0, 0);
    assert.equal(result.dueDate.getTime(), expected.getTime(), 'Due date must be 5 calendar days in future');
  });

  test('should fallback to issueDate + 14 days if no due date specified', () => {
    const rowText = 'F/125\nFaktura\t10.01.2026\tBrak terminu\t150 zł';
    const result = provider.extractDatesAndStatus(rowText, false, false);

    assert.equal(result.issueDate.getDate(), 10);
    assert.equal(result.issueDate.getMonth(), 0); // January
    assert.equal(result.dueDate.getDate(), 24);
    assert.equal(result.dueDate.getMonth(), 0); // January
  });

  test('should parse amounts correctly with single or double decimals and attributes', () => {
    assert.equal(provider.parseAmount('Faktura 135.5 zł'), 135.5);
    assert.equal(provider.parseAmount('Faktura 107,25 zł'), 107.25);
    assert.equal(provider.parseAmount('E/TM3 21.08.2026 Opłacona', null, '135.5'), 135.5);
    assert.equal(provider.parseAmount('E/TM3 21.08.2026 Opłacona', '114.06', null), 114.06);
    assert.equal(provider.parseAmount('Korekta -85.09 zł Rozliczono'), -85.09);
  });
});
