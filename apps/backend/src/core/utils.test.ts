import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cleanInvoiceNumber, cleanPaymentTitle, isOlderThan12Months, getTwelveMonthsAgoCutoff } from './utils.js';

describe('Invoice Number and Title Utils', () => {
  test('should clean invoice numbers with document types and newlines', () => {
    assert.equal(
      cleanInvoiceNumber('E/TM3/PC100452/0002/26/3\nFaktura'),
      'E/TM3/PC100452/0002/26/3'
    );
    assert.equal(
      cleanInvoiceNumber('TM3OPC100452/0002\nOdsetki'),
      'TM3OPC100452/0002'
    );
    assert.equal(
      cleanInvoiceNumber('TM3NPC100452/001\nInne'),
      'TM3NPC100452/001'
    );
  });

  test('should clean invoice numbers with portal error tooltips', () => {
    const dirty = `E/TM3/PC100452/0002/26/3
      Faktura
      
        Przepraszamy, w tej chwili nie możemy pobrać dokumentu. Spróbuj ponownie później.`;
    assert.equal(cleanInvoiceNumber(dirty), 'E/TM3/PC100452/0002/26/3');
  });

  test('should clean single line with trailing type or prefix', () => {
    assert.equal(
      cleanInvoiceNumber('E/TM3/PC100452/0002/26/3 Faktura'),
      'E/TM3/PC100452/0002/26/3'
    );
    assert.equal(
      cleanInvoiceNumber('Faktura nr E/TM3/PC100452/0002/26/3'),
      'E/TM3/PC100452/0002/26/3'
    );
  });

  test('should handle standard plain invoice numbers', () => {
    assert.equal(cleanInvoiceNumber('FA/DZIALKA/2026/01'), 'FA/DZIALKA/2026/01');
    assert.equal(cleanInvoiceNumber('INV-2026-001'), 'INV-2026-001');
    assert.equal(cleanInvoiceNumber('12345678'), '12345678');
    assert.equal(cleanInvoiceNumber(''), '');
  });

  test('should clean nota obciążeniowa invoice numbers with series letter', () => {
    assert.equal(cleanInvoiceNumber('7/2026/ l'), '7/2026/ L');
    assert.equal(cleanInvoiceNumber('7/2026/ L'), '7/2026/ L');
    assert.equal(cleanInvoiceNumber('7/2026/l'), '7/2026/ L');
    assert.equal(cleanInvoiceNumber('Nota obciążeniowa 7/2026/ l'), '7/2026/ L');
    assert.equal(cleanInvoiceNumber('NOTA OBCIĄŻENIOWA 7/2026/ L'), '7/2026/ L');
  });

  test('should clean payment titles to invoice number and preserve NOTA OBCIĄŻENIOWA', () => {
    const dirtyTitle = `Tauron Faktura E/TM3/PC100452/0002/26/3
      Faktura
      
        Przepraszamy, w tej chwili nie możemy pobrać dokumentu. Spróbuj ponownie później.`;
    assert.equal(cleanPaymentTitle(dirtyTitle), 'E/TM3/PC100452/0002/26/3');
    assert.equal(cleanPaymentTitle(null, 'E/TM3/PC100452/0002/26/3\nFaktura'), 'E/TM3/PC100452/0002/26/3');
    assert.equal(cleanPaymentTitle('NOTA OBCIĄŻENIOWA 7/2026/ L'), 'NOTA OBCIĄŻENIOWA 7/2026/ L');
    assert.equal(cleanPaymentTitle('Nota obciążeniowa 7/2026/ l'), 'NOTA OBCIĄŻENIOWA 7/2026/ L');
    assert.equal(cleanPaymentTitle(null, 'NOTA OBCIĄŻENIOWA 7/2026/ L'), 'NOTA OBCIĄŻENIOWA 7/2026/ L');
    assert.equal(cleanPaymentTitle(null, '7/2026/ L'), '7/2026/ L');
    assert.equal(cleanPaymentTitle('Wspólnota Mieszkaniowa - 7/2026/ L'), 'Wspólnota Mieszkaniowa - 7/2026/ L');
  });

  test('should correctly identify dates older or newer than 12 months', () => {
    const now = new Date('2026-09-21T12:00:00Z');
    
    // Exactly 13 months ago
    const thirteenMonthsAgo = new Date('2025-08-21T00:00:00Z');
    assert.equal(isOlderThan12Months(thirteenMonthsAgo, now), true);

    // 12 months + 1 day ago
    const twelveMonthsAndOneDayAgo = new Date('2025-09-20T00:00:00Z');
    assert.equal(isOlderThan12Months(twelveMonthsAndOneDayAgo, now), true);

    // 11 months ago
    const elevenMonthsAgo = new Date('2025-10-21T00:00:00Z');
    assert.equal(isOlderThan12Months(elevenMonthsAgo, now), false);

    // Recent date (1 month ago)
    const oneMonthAgo = new Date('2026-08-21T00:00:00Z');
    assert.equal(isOlderThan12Months(oneMonthAgo, now), false);

    // Invalid or null dates should return false
    assert.equal(isOlderThan12Months(null, now), false);
    assert.equal(isOlderThan12Months(undefined, now), false);
    assert.equal(isOlderThan12Months('invalid-date', now), false);
  });
});

