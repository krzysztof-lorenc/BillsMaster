import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db/prisma.js';
import { BillService } from './BillService.js';
import { config } from '../config/index.js';

describe('BillService - 12 Months Automatic Retention and Cleanup', () => {
  let testPortalId: string;
  let testOldPdfPath: string;
  let testRecentPdfPath: string;

  before(async () => {
    // Ensure test provider exists
    let provider = await prisma.provider.findUnique({ where: { id: 'test-retention-provider' } });
    if (!provider) {
      provider = await prisma.provider.create({
        data: {
          id: 'test-retention-provider',
          name: 'Test Retention Provider',
          category: 'OTHER',
          loginUrl: 'https://example.com/login',
        },
      });
    }

    // Create test portal
    const portal = await prisma.portal.create({
      data: {
        name: 'Retention Test Portal',
        providerId: provider.id,
        login: 'retention_test',
        encryptedPass: 'dummy_pass',
      },
    });
    testPortalId = portal.id;

    // Create temporary PDF files
    const portalDir = path.join(config.INVOICES_DIR, testPortalId);
    await fs.mkdir(portalDir, { recursive: true });

    testOldPdfPath = path.join(portalDir, 'old_invoice.pdf');
    testRecentPdfPath = path.join(portalDir, 'recent_invoice.pdf');
    await fs.writeFile(testOldPdfPath, '%PDF-1.4 test old invoice');
    await fs.writeFile(testRecentPdfPath, '%PDF-1.4 test recent invoice');

    const now = new Date();

    // Bill 1: Issued 26 months ago (older than cutoff)
    const oldIssueDate = new Date(now);
    oldIssueDate.setMonth(oldIssueDate.getMonth() - 26);
    const oldDueDate = new Date(oldIssueDate);
    oldDueDate.setDate(oldDueDate.getDate() + 14);

    await prisma.bill.create({
      data: {
        portalId: testPortalId,
        invoiceNumber: 'INV-OLD-14M',
        amountDue: 120.0,
        currency: 'PLN',
        issueDate: oldIssueDate,
        dueDate: oldDueDate,
        paymentStatus: 'PAID',
        pdfFilePath: testOldPdfPath,
        pdfFileName: 'old_invoice.pdf',
      },
    });

    // Bill 2: Issued 2 months ago (within 12 months)
    const recentIssueDate = new Date(now);
    recentIssueDate.setMonth(recentIssueDate.getMonth() - 2);
    const recentDueDate = new Date(recentIssueDate);
    recentDueDate.setDate(recentDueDate.getDate() + 14);

    await prisma.bill.create({
      data: {
        portalId: testPortalId,
        invoiceNumber: 'INV-RECENT-2M',
        amountDue: 85.5,
        currency: 'PLN',
        issueDate: recentIssueDate,
        dueDate: recentDueDate,
        paymentStatus: 'UNPAID',
        pdfFilePath: testRecentPdfPath,
        pdfFileName: 'recent_invoice.pdf',
      },
    });
  });

  after(async () => {
    // Clean up
    if (testPortalId) {
      await prisma.bill.deleteMany({ where: { portalId: testPortalId } });
      await prisma.portal.delete({ where: { id: testPortalId } }).catch(() => {});
      const portalDir = path.join(config.INVOICES_DIR, testPortalId);
      await fs.rm(portalDir, { recursive: true, force: true }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  test('should automatically delete bills older than 12 months from DB and remove PDFs from disk', async () => {
    // Check both files exist before cleanup
    const oldExistsBefore = await fs.stat(testOldPdfPath).then(() => true).catch(() => false);
    const recentExistsBefore = await fs.stat(testRecentPdfPath).then(() => true).catch(() => false);
    assert.equal(oldExistsBefore, true);
    assert.equal(recentExistsBefore, true);

    // Run deletion for this portal
    const deletedCount = await BillService.deleteBillsOlderThan12Months(testPortalId);
    assert.equal(deletedCount, 1);

    // Verify old bill is removed from DB
    const oldBill = await prisma.bill.findFirst({
      where: { portalId: testPortalId, invoiceNumber: 'INV-OLD-14M' },
    });
    assert.equal(oldBill, null);

    // Verify old PDF was unlinked from disk
    const oldExistsAfter = await fs.stat(testOldPdfPath).then(() => true).catch(() => false);
    assert.equal(oldExistsAfter, false, 'Old PDF file should be deleted from disk');

    // Verify recent bill is preserved in DB
    const recentBill = await prisma.bill.findFirst({
      where: { portalId: testPortalId, invoiceNumber: 'INV-RECENT-2M' },
    });
    assert.ok(recentBill, 'Recent bill should be kept in DB');
    assert.equal(recentBill.invoiceNumber, 'INV-RECENT-2M');

    // Verify recent PDF file remains on disk
    const recentExistsAfter = await fs.stat(testRecentPdfPath).then(() => true).catch(() => false);
    assert.equal(recentExistsAfter, true, 'Recent PDF file should remain on disk');
  });

  describe('updateBillPaymentStatus', () => {
    let testUserId: string;
    let testGroupId: string;
    let mailPortalId: string;
    let standardPortalId: string;
    let mailBillId: string;
    let standardBillId: string;

    before(async () => {
      // Create user
      const user = await prisma.user.create({
        data: {
          email: `test-bill-user-${Date.now()}@test.pl`,
          passwordHash: 'dummy',
          name: 'Test Bill User',
        },
      });
      testUserId = user.id;

      // Create group
      const group = await prisma.group.create({
        data: {
          name: `Test Group ${Date.now()}`,
        },
      });
      testGroupId = group.id;

      await prisma.userGroup.create({
        data: {
          userId: testUserId,
          groupId: testGroupId,
        },
      });

      // Mail script portal
      const mailPortal = await prisma.portal.create({
        data: {
          name: 'Mail Test Portal',
          providerId: 'test-retention-provider',
          login: 'mail_portal',
          encryptedPass: 'dummy',
          isMailScript: true,
        },
      });
      mailPortalId = mailPortal.id;

      await prisma.groupPortal.create({
        data: {
          groupId: testGroupId,
          portalId: mailPortalId,
        },
      });

      // Standard portal (not mail script)
      const standardPortal = await prisma.portal.create({
        data: {
          name: 'Standard Test Portal',
          providerId: 'test-retention-provider',
          login: 'standard_portal',
          encryptedPass: 'dummy',
          isMailScript: false,
        },
      });
      standardPortalId = standardPortal.id;

      await prisma.groupPortal.create({
        data: {
          groupId: testGroupId,
          portalId: standardPortalId,
        },
      });

      // Bills
      const futureDue = new Date();
      futureDue.setDate(futureDue.getDate() + 10);

      const mBill = await prisma.bill.create({
        data: {
          portalId: mailPortalId,
          invoiceNumber: 'MAIL-INV-001',
          amountDue: 50.0,
          issueDate: new Date(),
          dueDate: futureDue,
          paymentStatus: 'UNPAID',
        },
      });
      mailBillId = mBill.id;

      const sBill = await prisma.bill.create({
        data: {
          portalId: standardPortalId,
          invoiceNumber: 'STD-INV-001',
          amountDue: 75.0,
          issueDate: new Date(),
          dueDate: futureDue,
          paymentStatus: 'UNPAID',
        },
      });
      standardBillId = sBill.id;
    });

    after(async () => {
      await prisma.bill.deleteMany({ where: { portalId: { in: [mailPortalId, standardPortalId] } } }).catch(() => {});
      await prisma.groupPortal.deleteMany({ where: { groupId: testGroupId } }).catch(() => {});
      await prisma.userGroup.deleteMany({ where: { userId: testUserId } }).catch(() => {});
      await prisma.portal.deleteMany({ where: { id: { in: [mailPortalId, standardPortalId] } } }).catch(() => {});
      await prisma.group.delete({ where: { id: testGroupId } }).catch(() => {});
      await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    });

    test('should reject manual payment status update on standard portal bills', async () => {
      await assert.rejects(
        async () => {
          await BillService.updateBillPaymentStatus(testUserId, standardBillId, { isPaid: true });
        },
        /Ręczna zmiana statusu płatności jest dostępna tylko dla rachunków pobieranych z poczty e-mail/
      );
    });

    test('should mark mail-script bill as PAID when isPaid: true', async () => {
      const updated = await BillService.updateBillPaymentStatus(testUserId, mailBillId, { isPaid: true });
      assert.equal(updated.paymentStatus, 'PAID');
      assert.equal(updated.isMailScript, true);

      const inDb = await prisma.bill.findUnique({ where: { id: mailBillId } });
      assert.equal(inDb?.paymentStatus, 'PAID');
    });

    test('should revert mail-script bill to UNPAID when isPaid: false (future due date)', async () => {
      const updated = await BillService.updateBillPaymentStatus(testUserId, mailBillId, { isPaid: false });
      assert.equal(updated.paymentStatus, 'UNPAID');

      const inDb = await prisma.bill.findUnique({ where: { id: mailBillId } });
      assert.equal(inDb?.paymentStatus, 'UNPAID');
    });

    test('should sanitize dirty filename with newlines and resolve clean pdf path', async () => {
      // Create a test file
      const portalDir = path.join(config.INVOICES_DIR, mailPortalId);
      await fs.mkdir(portalDir, { recursive: true });
      const cleanFilePath = path.join(portalDir, 'Tauron_Test_Clean.pdf');
      await fs.writeFile(cleanFilePath, '%PDF-1.4 test');

      // Create a bill pointing to clean path but with dirty filename containing newline
      const dirtyBill = await prisma.bill.create({
        data: {
          portalId: mailPortalId,
          invoiceNumber: 'E/TM3/PC100452/TEST',
          amountDue: 50.0,
          currency: 'PLN',
          issueDate: new Date(),
          dueDate: new Date(),
          paymentStatus: 'UNPAID',
          pdfFilePath: cleanFilePath,
          pdfFileName: 'Tauron_Test_Clean \n Faktura.pdf',
        },
      });

      const result = await BillService.getBillPdf(testUserId, dirtyBill.id);
      assert.equal(result.fileName, 'Tauron_Test_Clean.pdf');
      assert.equal(result.filePath, cleanFilePath);

      // Clean up bill
      await prisma.bill.delete({ where: { id: dirtyBill.id } });
      await fs.rm(cleanFilePath).catch(() => {});
    });
  });
});
