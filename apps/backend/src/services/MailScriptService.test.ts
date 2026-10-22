import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { MailScriptService } from './MailScriptService.js';
import { PortalService } from './PortalService.js';
import { prisma } from '../db/prisma.js';
import type { MailScriptPortalRule } from '@bills-master/shared-types';

describe('MailScriptService Unit & Integration Tests', () => {
  let createdPortalId: string | null = null;

  before(async () => {
    // Ensure mail-script provider exists in DB
    const existing = await prisma.provider.findUnique({ where: { id: 'mail-script' } });
    if (!existing) {
      await prisma.provider.create({
        data: {
          id: 'mail-script',
          name: 'Poczta (Google Apps Script)',
          category: 'OTHER',
          loginUrl: 'https://script.google.com',
          isEnabled: true,
        },
      });
    }

    // Create a test mail portal
    const portal = await PortalService.createPortal({
      name: 'Test Tauron Mail Portal',
      providerId: 'mail-script',
      isMailScript: true,
      senderFilter: '.*@tauron\\.pl',
      titleFilter: '.*faktura.*',
      category: 'ELECTRICITY',
      syncFrequency: 1,
      isEnabled: true,
    });
    createdPortalId = portal.id;
  });

  after(async () => {
    if (createdPortalId) {
      await PortalService.deletePortal(createdPortalId).catch(() => {});
    }
    await prisma.$disconnect();
  });

  test('computeRulesHash should produce stable hash and detect changes in rules', () => {
    const rules1: MailScriptPortalRule[] = [
      { id: '1', name: 'Portal 1', senderFilter: '.*@pzu\\.pl', titleFilter: '.*polisa.*', category: 'OTHER' },
    ];
    const rules2: MailScriptPortalRule[] = [
      { id: '1', name: 'Portal 1', senderFilter: '.*@pzu\\.pl', titleFilter: '.*faktura.*', category: 'OTHER' },
    ];

    const hash1a = MailScriptService.computeRulesHash(rules1, 'https://test.local/ingest', 'token-123');
    const hash1b = MailScriptService.computeRulesHash(rules1, 'https://test.local/ingest', 'token-123');
    const hash2 = MailScriptService.computeRulesHash(rules2, 'https://test.local/ingest', 'token-123');
    const hashEndpointChanged = MailScriptService.computeRulesHash(rules1, 'https://different.local/ingest', 'token-123');

    assert.equal(hash1a, hash1b, 'Hashes for identical inputs must match');
    assert.notEqual(hash1a, hash2, 'Hashes must differ when filter changes');
    assert.notEqual(hash1a, hashEndpointChanged, 'Hashes must differ when endpoint URL changes');
  });

  test('generateScriptCode should produce complete Google Apps Script code', () => {
    const rules: MailScriptPortalRule[] = [
      { id: 'portal-1', name: 'Test Portal', senderFilter: '.*@orange\\.pl', titleFilter: '.*rachunek.*', category: 'INTERNET' },
    ];
    const code = MailScriptService.generateScriptCode(
      'https://billsmaster.example.com/api/mail-script/ingest',
      'bm_sec_testtoken',
      rules
    );

    assert.ok(code.includes('https://billsmaster.example.com/api/mail-script/ingest'));
    assert.ok(code.includes('https://billsmaster.example.com/api/mail-script/status'));
    assert.ok(code.includes('bm_sec_testtoken'));
    assert.ok(code.includes('orange'));
    assert.ok(code.includes('runMailSync'));
    assert.ok(code.includes('doGet'));
    assert.ok(code.includes('doPost'));
    assert.ok(code.includes('GmailApp.search'));
  });

  test('getConfig and updateConfig should manage endpoint URL, tokens and last run reset', async () => {
    const initialConfig = await MailScriptService.getConfig();
    assert.ok(initialConfig.secretToken.startsWith('bm_sec_'));

    // Update endpoint URL
    const testUrl = 'https://test-server.billsmaster.org/api/mail-script/ingest';
    const updated = await MailScriptService.updateConfig({ endpointUrl: testUrl });
    assert.equal(updated.endpointUrl, testUrl);

    // Reset last run date
    const resetRes = await MailScriptService.updateConfig({ resetLastRunDate: true });
    assert.equal(resetRes.lastRunDate, null);

    // Acknowledge update to clear scriptNeedsUpdate
    const ackRes = await MailScriptService.updateConfig({ acknowledgeScriptUpdate: true });
    assert.equal(ackRes.scriptNeedsUpdate, false);
  });

  test('getStatus should authenticate secret token and provide cutoff date', async () => {
    const config = await MailScriptService.getConfig();
    const status = await MailScriptService.getStatus(config.secretToken);

    assert.ok(status.cutoffDate);
    const cutoff = new Date(status.cutoffDate);
    const expectedCutoff = new Date();
    expectedCutoff.setDate(expectedCutoff.getDate() - 730);
    // Cutoff should be approximately 730 days ago (within 5 days difference)
    const diffDays = Math.abs((cutoff.getTime() - expectedCutoff.getTime()) / (1000 * 60 * 60 * 24));
    assert.ok(diffDays <= 5, `Cutoff should be ~24 months ago, got diff: ${diffDays}`);
    assert.ok(Array.isArray(status.activePortals));
  });

  test('ingest should process email invoice, decode PDF, upsert bill and update lastRunDate', async () => {
    const config = await MailScriptService.getConfig();
    const fakePdfBytes = Buffer.from('%PDF-1.4 test invoice content');
    const fakePdfBase64 = fakePdfBytes.toString('base64');

    const ingestResult = await MailScriptService.ingest({
      secretToken: config.secretToken,
      items: [
        {
          portalId: createdPortalId!,
          sender: 'faktury@tauron.pl',
          subject: 'Faktura VAT nr FV/TEST/2026/09 za energię kwota 245,50 zł',
          date: new Date().toISOString(),
          fileName: 'Faktura_FV_TEST_2026.pdf',
          pdfBase64: fakePdfBase64,
          bodySnippet: 'Prosimy o zapłatę do 2026-10-15 na konto PL12345678901234567890123456',
        },
      ],
    });

    assert.equal(ingestResult.success, true);
    assert.equal(ingestResult.importedCount, 1);
    assert.ok(ingestResult.lastRunDate);

    // Verify bill was saved in database
    const savedBill = await prisma.bill.findFirst({
      where: { portalId: createdPortalId! },
    });
    assert.ok(savedBill, 'Bill must be created in DB');
    assert.equal(Number(savedBill.amountDue), 245.50);
    assert.ok(savedBill.pdfFilePath, 'PDF file path must be set');

    // Verify lastRunDate was recorded on config
    const updatedConfig = await MailScriptService.getConfig();
    assert.ok(updatedConfig.lastRunDate !== null);
    assert.equal(updatedConfig.lastRunStatus, 'SUCCESS');
  });

  test('ingest should process email WITHOUT attachment, generate PDF and create bill', async () => {
    const config = await MailScriptService.getConfig();

    const ingestResult = await MailScriptService.ingest({
      secretToken: config.secretToken,
      items: [
        {
          portalId: createdPortalId!,
          sender: 'e-rachunek@platnosci.canalplus.pl',
          subject: 'e-rachunek dostępny w internetowym serwisie Strefa CANAL+',
          date: '2025-09-08T20:26:00.000Z',
          bodySnippet: 'TWÓJ RACHUNEK\n\ndo zapłaty\n89,90 zł\ntermin płatności\n18/09/2025\nNumer konta: PL60114019060000000000000001',
        },
      ],
    });

    assert.equal(ingestResult.success, true);
    assert.equal(ingestResult.importedCount, 1);

    const bill = await prisma.bill.findFirst({
      where: {
        portalId: createdPortalId!,
      },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(bill, 'Bill for email without attachment must be created');
    assert.equal(Number(bill.amountDue), 89.90);
    assert.ok(bill.pdfFilePath, 'Generated PDF file path must be set');
    assert.equal(bill.dueDate?.toISOString().slice(0, 10), '2025-09-18');
  });

  test('ingest should extract financial details from real PDF attachment (Canal+ style)', async () => {
    const config = await MailScriptService.getConfig();

    // Create a real PDF with text
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([800, 600]);
    page.drawText('DATA WYSTAWIENIA 03/09/2026', { x: 50, y: 550, size: 12, font });
    page.drawText('Numer konta do wplat 96 1050 0000 0000 0000 0000 0001', { x: 50, y: 500, size: 12, font });
    page.drawText('DO ZAPLATY TERMIN PLATNOSCI KWOTA BIEZACY RACHUNEK 09/2026 18/09/2026 86,99 86,99 RAZEM', { x: 50, y: 450, size: 12, font });
    const pdfBytes = await doc.save();
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

    const ingestResult = await MailScriptService.ingest({
      secretToken: config.secretToken,
      items: [
        {
          portalId: createdPortalId!,
          sender: 'e-rachunek@platnosci.canalplus.pl',
          subject: 'e-rachunek dostępny w internetowym serwisie Strefa CANAL+',
          date: '2026-09-08T10:00:00.000Z',
          fileName: 'mock_invoice_202609.pdf',
          pdfBase64,
          bodySnippet: 'e-rachunek dostępny w internetowym serwisie Strefa CANAL+',
        },
      ],
    });

    assert.equal(ingestResult.success, true);
    assert.equal(ingestResult.importedCount, 1);

    const bill = await prisma.bill.findFirst({
      where: {
        portalId: createdPortalId!,
        invoiceNumber: 'mock_invoice_202609',
      },
    });
    assert.ok(bill, 'Bill for Canal+ PDF must be created in DB');
    assert.equal(Number(bill.amountDue), 86.99, 'Amount due must be extracted from PDF text');
    assert.equal(bill.dueDate?.toISOString().slice(0, 10), '2026-09-18', 'Due date must be extracted from PDF text');
    assert.equal(bill.bankAccountNumber, '96105000000000000000000001', 'IBAN must be extracted from PDF text');
  });

  test('ingest should process Nota Obciążeniowa from Wspólnota Mieszkaniowa Miarki 5, creating payment title "NOTA OBCIĄŻENIOWA 7/2026/ L" and configured paymentReceiver', async () => {
    const wmPortal = await PortalService.createPortal({
      name: 'Wspólnota Mieszkaniowa Miarki 5',
      providerId: 'mail-script',
      isMailScript: true,
      senderFilter: 'nieruchomosci\\@adres\\.pl',
      titleFilter: '.*noty.*Miarki.*',
      paymentReceiver: 'Wspólnota Mieszkaniowa ul. Miarki 5',
      category: 'HOUSING',
      syncFrequency: 1,
      isEnabled: true,
    });

    try {
      const config = await MailScriptService.getConfig();

      // Create PDF matching real document layout
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const page = doc.addPage([600, 800]);
      page.drawText('Nota obciazeniowa', { x: 50, y: 750, size: 14, font });
      page.drawText('Miejsce wystawienia Bielsko-Biala', { x: 300, y: 750, size: 10, font });
      page.drawText('7/2026/ l', { x: 50, y: 720, size: 12, font });
      page.drawText('Data sprzedazy 23.09.2026', { x: 300, y: 720, size: 10, font });
      page.drawText('Sprzedawca Wspolnota Mieszkaniowa ul. Miarki 5 NIP 5472019050', { x: 50, y: 650, size: 10, font });
      page.drawText('Do zaplaty 60,00 zl', { x: 50, y: 500, size: 12, font });
      page.drawText('Bank, numer konta 87 1020 1390 0000 6002 0483 3465', { x: 50, y: 450, size: 10, font });

      const pdfBytes = await doc.save();
      const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

      const ingestResult = await MailScriptService.ingest({
        secretToken: config.secretToken,
        items: [
          {
            portalId: wmPortal.id,
            sender: '"Zarządzanie Nieruchomościami" <nieruchomosci@adres.pl>',
            subject: 'noty obciążeniowe Miarki 5',
            date: '2026-09-23T06:22:30.000Z',
            fileName: '92026.pdf',
            pdfBase64,
            bodySnippet: 'Przesyłam noty obciążeniowe Miarki 5 za wrzesień',
          },
        ],
      });

      assert.equal(ingestResult.success, true);
      assert.equal(ingestResult.importedCount, 1);

      const bill = await prisma.bill.findFirst({
        where: {
          portalId: wmPortal.id,
          invoiceNumber: '7/2026/ L',
        },
      });

      assert.ok(bill, 'Bill with invoice number "7/2026/ L" must be created');
      assert.equal(bill.paymentTitle, 'NOTA OBCIĄŻENIOWA 7/2026/ L', 'Payment title must be "NOTA OBCIĄŻENIOWA 7/2026/ L"');
      assert.equal(Number(bill.amountDue), 60.00, 'Amount must be 60.00');
      assert.equal(bill.bankAccountNumber, '87102013900000600204833465', 'Bank account must be extracted');

      const meta = bill.rawMetadata as any;
      assert.equal(meta.recipient, 'Wspólnota Mieszkaniowa ul. Miarki 5', 'Recipient should match configured portal paymentReceiver');
      assert.equal(meta.nip, '5472019050', 'NIP should be extracted from PDF text');
    } finally {
      await PortalService.deletePortal(wmPortal.id).catch(() => {});
    }
  });
});
