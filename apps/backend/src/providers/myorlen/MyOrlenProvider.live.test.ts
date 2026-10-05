import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { MyOrlenProvider } from './MyOrlenProvider.js';

describe('MyOrlenProvider Live Tests', () => {
  const provider = new MyOrlenProvider();
  const testAccount = {
    login: process.env.MYORLEN_LOGIN || '',
    password: process.env.MYORLEN_PASSWORD || '',
  };
  const skipLive = !testAccount.login || !testAccount.password;

  test('should authenticate against https://ebok.myorlen.pl and extract bills with address regex filter', { skip: skipLive }, async () => {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const browserContext = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await browserContext.newPage();

    const progressReports: string[] = [];

    console.log('--- TEST 1: Authenticate ---');
    const authResult = await provider.authenticate(page, testAccount, {
      browserContext,
      downloadDir: '/tmp',
      log: {
        info: (msg) => console.log('[INFO]', msg),
        warn: (msg) => console.warn('[WARN]', msg),
        error: (msg) => console.error('[ERROR]', msg),
      },
      reportProgress: async (percent, msg) => {
        console.log(`[PROGRESS ${percent}%] ${msg}`);
        progressReports.push(msg);
      },
    });

    assert.ok(authResult.sessionState, 'Should produce session state');
    assert.ok(progressReports.length > 0, 'Should report progress');
    console.log('[MyOrlen Live] Account summary:', authResult.accountSummary);

    const filter = process.env.MYORLEN_FILTER || '.*';
    console.log(`--- TEST 2: Fetch Bills with filter "${filter}" ---`);
    const billsFiltered = await provider.fetchBills(page, {
      browserContext,
      downloadDir: '/tmp',
      log: {
        info: (msg) => console.log('[INFO]', msg),
        warn: (msg) => console.warn('[WARN]', msg),
        error: (msg) => console.error('[ERROR]', msg),
      },
      reportProgress: async (percent, msg) => {
        console.log(`[PROGRESS ${percent}%] ${msg}`);
      },
      agreementFilter: filter,
    });

    assert.ok(billsFiltered.length > 0, 'Should extract bills');
    console.log(`Extracted ${billsFiltered.length} bills.`);

    for (const b of billsFiltered) {
      assert.ok(b.invoiceNumber, 'Invoice number must be present');
      assert.ok(typeof b.amountDue === 'number', 'Amount due must be a number');
      assert.ok(b.issueDate instanceof Date, 'Issue date must be a Date');
      assert.ok(b.dueDate instanceof Date, 'Due date must be a Date');
      assert.ok(['PAID', 'UNPAID', 'OVERDUE'].includes(b.paymentStatus), 'Status must be valid');
    }

    const withPdf = billsFiltered.filter((b) => b.pdfBuffer && b.pdfBuffer.length > 0);
    console.log(`Invoices with PDF: ${withPdf.length} / ${billsFiltered.length}`);
    assert.ok(withPdf.length > 0, 'At least one invoice should have a downloaded PDF buffer');
    const header = Buffer.from(withPdf[0].pdfBuffer!.slice(0, 5)).toString('utf-8');
    assert.equal(header, '%PDF-', 'PDF must have valid header');

    await browser.close();
  });
});
