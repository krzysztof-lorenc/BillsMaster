import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MockProvider } from './MockProvider.js';

describe('MockProvider', () => {
  const provider = new MockProvider();

  test('should authenticate valid credentials and report progress', async () => {
    const progressReports: string[] = [];
    const authResult = await provider.authenticate(
      {} as any,
      { login: 'user@example.com', password: 'valid-password' },
      {
        browserContext: {} as any,
        downloadDir: '/tmp',
        log: { info: () => {}, warn: () => {}, error: () => {} },
        reportProgress: async (_p, msg) => { progressReports.push(msg); },
      }
    );

    assert.ok(authResult.sessionState);
    assert.ok(progressReports.length > 0);
  });

  test('should throw error on triggered failure', async () => {
    await assert.rejects(async () => {
      await provider.authenticate(
        {} as any,
        { login: 'user@example.com', password: 'trigger-error' },
        {
          browserContext: {} as any,
          downloadDir: '/tmp',
          log: { info: () => {}, warn: () => {}, error: () => {} },
          reportProgress: async () => {},
        }
      );
    });
  });

  test('should extract bills and generate valid PDF invoice buffers', async () => {
    const bills = await provider.fetchBills(
      {} as any,
      {
        browserContext: {} as any,
        downloadDir: '/tmp',
        log: { info: () => {}, warn: () => {}, error: () => {} },
        reportProgress: async () => {},
      }
    );

    assert.equal(bills.length, 3);
    for (const b of bills) {
      assert.ok(b.invoiceNumber);
      assert.ok(b.amountDue > 0);
      assert.ok(b.paymentStatus);
      assert.ok(b.pdfBuffer);
      // Valid PDF files start with "%PDF-" (header bytes 0x25 0x50 0x44 0x46 0x2D)
      const header = Buffer.from(b.pdfBuffer.slice(0, 5)).toString('utf-8');
      assert.equal(header, '%PDF-');
    }
  });
});
