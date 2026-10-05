import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { AquaProvider } from './AquaProvider.js';

describe('AquaProvider Live Integration Tests', () => {
  const provider = new AquaProvider();
  const testAccount = {
    login: process.env.AQUA_LOGIN || '',
    password: process.env.AQUA_PASSWORD || '',
  };
  const skipLive = !testAccount.login || !testAccount.password;

  test('should authenticate against Aqua Bielsko eBOK and extract account summary', { skip: skipLive }, async () => {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const browserContext = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    });
    const page = await browserContext.newPage();
    const progressReports: string[] = [];

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
    console.log('[Aqua Live] Account summary:', authResult.accountSummary);

    const summary = authResult.accountSummary as any;
    assert.ok(summary?.clientNumber, 'Should extract Aqua client ID');
    assert.ok(summary?.clientName, 'Should extract client name');
    assert.ok(summary?.iban, 'Should compute correct Aqua IBAN');

    await browser.close();
  });

  test('should fetch bills, parse cards, and download invoice PDFs from Aqua Bielsko', { skip: skipLive }, async () => {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const browserContext = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    });
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
      log: {
        info: (msg) => console.log('[INFO]', msg),
        warn: (msg) => console.warn('[WARN]', msg),
        error: (msg) => console.error('[ERROR]', msg),
      },
      reportProgress: async (percent, msg) => {
        console.log(`[PROGRESS ${percent}%] ${msg}`);
      },
    });

    assert.ok(bills.length > 0, 'Should extract bills from Aqua Bielsko');
    console.log(`[Aqua Live] Extracted ${bills.length} bills.`);

    for (const b of bills) {
      assert.ok(b.invoiceNumber, 'Invoice number must be present');
      assert.ok(typeof b.amountDue === 'number' && b.amountDue > 0, `Amount due must be positive (got ${b.amountDue})`);
      assert.ok(b.issueDate instanceof Date, 'Issue date must be a Date');
      assert.ok(b.dueDate instanceof Date, 'Due date must be a Date');
      assert.ok(['PAID', 'UNPAID', 'OVERDUE'].includes(b.paymentStatus), `Status must be valid (got ${b.paymentStatus})`);
      assert.ok(b.bankAccountNumber, 'IBAN must match Aqua account');
    }

    const billsWithPdf = bills.filter((b) => b.pdfBuffer && b.pdfBuffer.length > 0);
    console.log(`[Aqua Live] Bills with PDF: ${billsWithPdf.length} / ${bills.length}`);
    assert.ok(billsWithPdf.length > 0, 'At least one invoice should have a downloaded PDF');

    const pdfHeader = Buffer.from(billsWithPdf[0].pdfBuffer!.slice(0, 5)).toString('utf-8');
    assert.equal(pdfHeader, '%PDF-', 'Downloaded invoice must be a valid PDF');

    await browser.close();
  });
});
