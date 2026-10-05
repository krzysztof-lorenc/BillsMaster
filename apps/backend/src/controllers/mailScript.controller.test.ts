import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { seedProviders } from '../db/seed.js';
import { MailScriptService } from '../services/MailScriptService.js';
import { syncQueue } from '../queue/sync.queue.js';
import type { FastifyInstance } from 'fastify';

describe('MailScript Controller Integration Tests', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let secretToken: string;
  let mailPortalId: string;

  before(async () => {
    await seedProviders();

    app = await buildApp();
    await app.ready();

    // Log in as admin to get token
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'admin@billsmaster.local',
        password: 'AdminSuperPassword2026!',
      },
    });

    assert.equal(loginRes.statusCode, 200);
    const loginBody = JSON.parse(loginRes.body);
    adminToken = loginBody.token;

    const cfg = await MailScriptService.getConfig();
    secretToken = cfg.secretToken;
  });

  after(async () => {
    if (mailPortalId) {
      await prisma.portal.delete({ where: { id: mailPortalId } }).catch(() => {});
    }
    await app.close();
    await syncQueue.close();
    await prisma.$disconnect();
  });

  test('POST /api/admin/portals should create a mail script portal without login or password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/portals',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        name: 'UPC Faktury z Gmaila',
        providerId: 'mail-script',
        isMailScript: true,
        senderFilter: '.*@upc\\.pl|.*@play\\.pl',
        titleFilter: '.*faktura.*',
        category: 'INTERNET',
        syncFrequency: 2,
        isEnabled: true,
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.ok(body.portal);
    assert.equal(body.portal.name, 'UPC Faktury z Gmaila');
    assert.equal(body.portal.isMailScript, true);
    assert.equal(body.portal.senderFilter, '.*@upc\\.pl|.*@play\\.pl');
    assert.equal(body.portal.titleFilter, '.*faktura.*');
    assert.equal(body.portal.category, 'INTERNET');
    assert.equal(body.portal.loginMasked, 'Poczta (Google Script)');
    mailPortalId = body.portal.id;
  });

  test('GET /api/admin/portals should return portals and scriptNeedsUpdate flag', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/portals',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.portals));
    assert.equal(typeof body.scriptNeedsUpdate, 'boolean');
  });

  test('GET /api/admin/mail-script/config should return complete config and script code', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/mail-script/config',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.config);
    assert.ok(body.config.endpointUrl);
    assert.ok(body.config.secretToken);
    assert.ok(body.config.scriptCode.includes('runMailSync'));
  });

  test('PUT /api/admin/mail-script/config should acknowledge script update and reset last run', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/mail-script/config',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        acknowledgeScriptUpdate: true,
        resetLastRunDate: true,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.config.scriptNeedsUpdate, false);
    assert.equal(body.config.lastRunDate, null);
  });

  test('GET /api/admin/mail-script/script should return raw downloadable .gs file', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/mail-script/script',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-disposition']?.includes('BillsMaster_Gmail_Sync.gs'));
    assert.ok(res.body.includes('runMailSync'));
  });

  test('GET /api/mail-script/status should authenticate token and return status', async () => {
    // 1. Missing token
    const resNoToken = await app.inject({
      method: 'GET',
      url: '/api/mail-script/status',
    });
    assert.equal(resNoToken.statusCode, 401);

    // 2. Invalid token
    const resBadToken = await app.inject({
      method: 'GET',
      url: '/api/mail-script/status?token=wrong_token',
    });
    assert.equal(resBadToken.statusCode, 401);

    // 3. Valid token
    const resValid = await app.inject({
      method: 'GET',
      url: `/api/mail-script/status?token=${secretToken}`,
    });
    assert.equal(resValid.statusCode, 200);
    const body = JSON.parse(resValid.body);
    assert.ok(body.cutoffDate);
    assert.ok(Array.isArray(body.activePortals));
  });

  test('POST /api/mail-script/ingest should ingest email invoices into database', async () => {
    const fakePdfBytes = Buffer.from('%PDF-1.4 test invoice content');
    const fakePdfBase64 = fakePdfBytes.toString('base64');

    const res = await app.inject({
      method: 'POST',
      url: '/api/mail-script/ingest',
      payload: {
        secretToken,
        items: [
          {
            portalId: mailPortalId,
            sender: 'awizo@upc.pl',
            subject: 'Faktura VAT nr FV/2026/UPC/001 kwota do zapłaty 89,90 zł',
            date: new Date().toISOString(),
            fileName: 'Faktura_UPC_001.pdf',
            pdfBase64: fakePdfBase64,
            bodySnippet: 'Termin płatności: 2026-10-20. Numer rachunku: PL98765432109876543210987654',
          },
        ],
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.importedCount, 1);
    assert.ok(body.lastRunDate);

    // Verify bill was saved in database
    const bill = await prisma.bill.findFirst({
      where: { portalId: mailPortalId },
    });
    assert.ok(bill);
    assert.equal(Number(bill.amountDue), 89.90);
    assert.ok(bill.pdfFilePath);
  });

  test('POST /api/admin/mail-script/trigger-remote should return 400 when gasWebAppUrl is not configured', async () => {
    const initialConfig = await MailScriptService.getConfig();
    await prisma.mailScriptConfig.update({
      where: { id: 'default' },
      data: { gasWebAppUrl: null },
    });

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/mail-script/trigger-remote',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.match(body.message, /nie został skonfigurowany/);
    } finally {
      if (initialConfig.gasWebAppUrl) {
        await prisma.mailScriptConfig.update({
          where: { id: 'default' },
          data: { gasWebAppUrl: initialConfig.gasWebAppUrl },
        });
      }
    }
  });
});
