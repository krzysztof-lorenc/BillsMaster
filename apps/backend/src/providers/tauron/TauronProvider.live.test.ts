import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { TauronProvider } from './TauronProvider.js';

describe('TauronProvider Live Tests', () => {
  const provider = new TauronProvider();
  const testAccount = {
    login: process.env.TAURON_LOGIN || '',
    password: process.env.TAURON_PASSWORD || '',
  };
  const skipLive = !testAccount.login || !testAccount.password;

  test('should authenticate against logowanie.tauron.pl and land on moj.tauron.pl', { skip: skipLive }, async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext({ acceptDownloads: true });
    const page = await browserContext.newPage();

    const progressReports: string[] = [];

    const authResult = await provider.authenticate(page, testAccount, {
      browserContext,
      downloadDir: '/tmp',
      log: { info: (msg) => console.log(msg), warn: (msg) => console.warn(msg), error: (msg) => console.error(msg) },
      reportProgress: async (_percent, msg) => {
        progressReports.push(msg);
      },
    });

    assert.ok(authResult.sessionState, 'Should produce session state');
    assert.ok(progressReports.length > 0, 'Should report progress');
    assert.ok(authResult.accountSummary?.clientNumber, 'Should extract Tauron client number');

    await browser.close();
  });

  test('should fetch bills and download invoices from Tauron portal', { skip: skipLive }, async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext({ acceptDownloads: true });
    const page = await browserContext.newPage();

    await provider.authenticate(page, testAccount, {
      browserContext,
      downloadDir: '/tmp',
      log: { info: () => {}, warn: () => {}, error: () => {} },
      reportProgress: async () => {},
    });

    const bills = await provider.fetchBills(page, {
      browserContext,
      downloadDir: '/tmp',
      log: { info: (msg) => console.log(msg), warn: (msg) => console.warn(msg), error: (msg) => console.error(msg) },
      reportProgress: async () => {},
    });

    assert.ok(bills.length > 0, 'Should extract bills from Tauron');
    console.log(`[TauronProvider Live Test] Extracted ${bills.length} bills.`);

    for (const b of bills) {
      assert.ok(b.invoiceNumber, 'Invoice number must be present');
      assert.ok(typeof b.amountDue === 'number', 'Amount due must be a number');
      assert.ok(b.issueDate instanceof Date, 'Issue date must be a Date');
      assert.ok(b.dueDate instanceof Date, 'Due date must be a Date');
      assert.ok(['PAID', 'UNPAID', 'OVERDUE'].includes(b.paymentStatus), 'Status must be valid');
    }

    // At least one bill should have downloaded a PDF
    const billsWithPdf = bills.filter(b => b.pdfBuffer && b.pdfBuffer.length > 0);
    assert.ok(billsWithPdf.length > 0, 'At least one bill should have a downloaded PDF buffer');
    const header = Buffer.from(billsWithPdf[0].pdfBuffer!.slice(0, 5)).toString('utf-8');
    assert.equal(header, '%PDF-', 'PDF must have valid header');

    await browser.close();
  });
});
