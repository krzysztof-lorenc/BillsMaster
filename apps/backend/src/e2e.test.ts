import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.js';
import { prisma } from './db/prisma.js';
import { seedProviders } from './db/seed.js';
import { createSyncWorker } from './queue/sync.worker.js';
import { syncQueue } from './queue/sync.queue.js';
import type { FastifyInstance } from 'fastify';

describe('BillsMaster End-to-End Integration Tests', () => {
  let app: FastifyInstance;
  let worker: ReturnType<typeof createSyncWorker>;
  let adminToken: string;
  let userToken: string;
  let createdUserId: string;
  let createdGroupId: string;
  let createdPortalId: string;
  let group2Id: string;

  before(async () => {
    const dbUrl = process.env.DATABASE_URL || '';
    if (!dbUrl.includes('test') && !process.env.ALLOW_PROD_TEST) {
      throw new Error(`[CRITICAL SAFEGUARD] e2e tests cannot run against non-test database: ${dbUrl}`);
    }

    // Clean database tables for testing
    await prisma.bill.deleteMany();
    await prisma.syncJob.deleteMany();
    await prisma.groupPortal.deleteMany();
    await prisma.userGroup.deleteMany();
    await prisma.portal.deleteMany();
    await prisma.group.deleteMany();
    await prisma.user.deleteMany();

    await seedProviders();

    worker = createSyncWorker();
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
    if (worker) await worker.close();
    await syncQueue.close();
    await prisma.$disconnect();
  });

  test('1. Should report isConfigured=true after seeding admin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/status',
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.isConfigured, true);
  });

  test('2. Admin should login and receive JWT token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'admin@billsmaster.local',
        password: 'AdminSuperPassword2026!',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.user.role, 'ADMIN');
    assert.ok(body.token);
    adminToken = body.token;
  });

  test('3. Admin should create a standard user account', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Jan Kowalski',
        email: 'jan.test@kowalski.pl',
        password: 'JanPassword123!',
        role: 'USER',
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.user.email, 'jan.test@kowalski.pl');
    assert.equal(body.user.role, 'USER');
    createdUserId = body.user.id;
  });

  test('4. Admin cannot create another admin account', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Second Admin',
        email: 'admin2@billsmaster.local',
        password: 'Admin2Password!',
        role: 'ADMIN',
      },
    });

    assert.equal(res.statusCode, 400);
  });

  test('5. Admin creates a Group and assigns user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/groups',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Grupa Domowa',
        description: 'Mieszkanie testowe',
        userIds: [createdUserId],
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.group.name, 'Grupa Domowa');
    createdGroupId = body.group.id;
  });

  test('6. Admin creates a Portal with credentials and assigns to Group', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/portals',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Domowy Mock Portal',
        providerId: 'mock-provider',
        login: 'jan.kowalski@poczta.pl',
        password: 'ExternalSecretPassword123',
        groupIds: [createdGroupId],
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.portal.name, 'Domowy Mock Portal');
    assert.equal(body.portal.loginMasked, 'j***i@poczta.pl');
    createdPortalId = body.portal.id;
  });

  test('7. Standard user logs in and sees their group portals', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'jan.test@kowalski.pl',
        password: 'JanPassword123!',
      },
    });

    assert.equal(loginRes.statusCode, 200);
    const loginBody = JSON.parse(loginRes.body);
    userToken = loginBody.token;

    const portalsRes = await app.inject({
      method: 'GET',
      url: '/api/portals',
      headers: { authorization: `Bearer ${userToken}` },
    });

    assert.equal(portalsRes.statusCode, 200);
    const portalsBody = JSON.parse(portalsRes.body);
    assert.equal(portalsBody.portals.length, 1);
    assert.equal(portalsBody.portals[0].id, createdPortalId);
    assert.equal(portalsBody.portals[0].loginMasked, 'j***i@poczta.pl');
  });

  test('7b. Standard user updates theme preference to light and verifies persistence', async () => {
    // 1. Initial theme is dark
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${userToken}` },
    });
    assert.equal(meRes.statusCode, 200);
    assert.equal(JSON.parse(meRes.body).user.theme, 'dark');

    // 2. Change theme to light
    const updateRes = await app.inject({
      method: 'PATCH',
      url: '/api/auth/theme',
      headers: {
        authorization: `Bearer ${userToken}`,
        'content-type': 'application/json',
      },
      payload: { theme: 'light' },
    });
    assert.equal(updateRes.statusCode, 200);
    assert.equal(JSON.parse(updateRes.body).theme, 'light');

    // 3. Verify /api/auth/me reflects light theme
    const meRes2 = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${userToken}` },
    });
    assert.equal(meRes2.statusCode, 200);
    assert.equal(JSON.parse(meRes2.body).user.theme, 'light');

    // 4. Invalid theme should return 400
    const invalidRes = await app.inject({
      method: 'PATCH',
      url: '/api/auth/theme',
      headers: {
        authorization: `Bearer ${userToken}`,
        'content-type': 'application/json',
      },
      payload: { theme: 'invalid_theme' },
    });
    assert.equal(invalidRes.statusCode, 400);
  });

  test('8. Worker executes sync and imports bills for portal', async () => {
    // Trigger sync via portal endpoint with application/json header and empty body
    const triggerRes = await app.inject({
      method: 'POST',
      url: `/api/portals/${createdPortalId}/sync`,
      headers: {
        authorization: `Bearer ${userToken}`,
        'content-type': 'application/json',
      },
    });
    assert.equal(triggerRes.statusCode, 200);

    // Wait up to 10 seconds for worker to finish
    let completed = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const portal = await prisma.portal.findUnique({
        where: { id: createdPortalId },
      });
      const count = await prisma.bill.count({
        where: { portalId: createdPortalId },
      });
      if (portal?.lastSyncStatus === 'SUCCESS' && count >= 3) {
        completed = true;
        break;
      }
    }

    assert.equal(completed, true, 'Sync worker should finish with SUCCESS status');

    const billsCount = await prisma.bill.count({
      where: { portalId: createdPortalId },
    });
    assert.equal(billsCount, 3, 'Should have imported 3 mock bills');
  });

  test('9. Admin CANNOT view bills (403 Forbidden)', async () => {
    const billsRes = await app.inject({
      method: 'GET',
      url: '/api/bills',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(billsRes.statusCode, 403);

    const summaryRes = await app.inject({
      method: 'GET',
      url: '/api/bills/summary',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(summaryRes.statusCode, 403);
  });

  test('10. Standard user views bills and summary', async () => {
    const billsRes = await app.inject({
      method: 'GET',
      url: '/api/bills',
      headers: { authorization: `Bearer ${userToken}` },
    });

    assert.equal(billsRes.statusCode, 200);
    const billsBody = JSON.parse(billsRes.body);
    assert.equal(billsBody.bills.length, 3);

    // Test PAY_30 filter: must include upcoming unpaid AND unpaid after due date (overdue), but exclude PAID
    const pay30Res = await app.inject({
      method: 'GET',
      url: '/api/bills?status=PAY_30',
      headers: { authorization: `Bearer ${userToken}` },
    });
    assert.equal(pay30Res.statusCode, 200);
    const pay30Body = JSON.parse(pay30Res.body);
    assert.equal(pay30Body.bills.length, 2);
    const pay30Statuses = pay30Body.bills.map((b: any) => b.paymentStatus);
    assert.ok(pay30Statuses.includes('UNPAID'));
    assert.ok(pay30Statuses.includes('OVERDUE'));
    assert.ok(!pay30Statuses.includes('PAID'));

    const summaryRes = await app.inject({
      method: 'GET',
      url: '/api/bills/summary',
      headers: { authorization: `Bearer ${userToken}` },
    });

    assert.equal(summaryRes.statusCode, 200);
    const summaryBody = JSON.parse(summaryRes.body);
    assert.ok(summaryBody.summary.totalUnpaidAmount > 0);
    assert.equal(summaryBody.summary.recentBills.length, 3);
  });

  test('11. Standard user downloads bill PDF invoice', async () => {
    const bill = await prisma.bill.findFirst({
      where: { portalId: createdPortalId },
    });
    assert.ok(bill);

    const pdfRes = await app.inject({
      method: 'GET',
      url: `/api/bills/${bill.id}/pdf`,
      headers: { authorization: `Bearer ${userToken}` },
    });

    assert.equal(pdfRes.statusCode, 200);
    assert.equal(pdfRes.headers['content-type'], 'application/pdf');
    assert.ok(pdfRes.rawPayload.length > 500);

    // Verify PDF header magic bytes %PDF-
    const header = pdfRes.rawPayload.slice(0, 5).toString();
    assert.equal(header, '%PDF-');
  });

  test('12. Standard user checks /api/sync/active-error when healthy (returns null)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sync/active-error',
      headers: { authorization: `Bearer ${userToken}` },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.error, null);
  });

  test('13. When a portal sync fails, /api/sync/active-error returns rich error diagnostics', async () => {
    // Simulate failed portal
    await prisma.portal.update({
      where: { id: createdPortalId },
      data: {
        lastSyncStatus: 'FAILED',
        lastSyncMessage: 'Błąd połączenia ze stroną portalu dostawcy: net::ERR_CONNECTION_REFUSED',
      },
    });

    await prisma.syncJob.create({
      data: {
        portalId: createdPortalId,
        status: 'FAILED',
        errorMessage: 'Nie można połączyć się ze stroną portalu: net::ERR_CONNECTION_REFUSED',
        logs: {
          portalId: createdPortalId,
          portalName: 'Domowy Mock Portal',
          stage: 'Łączenie ze stroną portalu',
          errorTitle: 'Nie można połączyć się ze stroną portalu dostawcy',
          generalInfo: 'Wystąpił problem z nawiązaniem połączenia sieciowego z serwerem portalu dostawcy mediów.',
          errorMessage: 'net::ERR_CONNECTION_REFUSED at https://demo-portal.local/login',
          errorStack: 'Error: net::ERR_CONNECTION_REFUSED\n    at MockProvider.authenticate\n    at sync.worker.ts:130',
          timestamp: new Date().toISOString(),
          jobId: 'mock-job-id',
        },
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/sync/active-error',
      headers: { authorization: `Bearer ${userToken}` },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.error);
    assert.equal(body.error.stage, 'Łączenie ze stroną portalu');
    assert.equal(body.error.errorTitle, 'Nie można połączyć się ze stroną portalu dostawcy');
    assert.ok(body.error.errorStack.includes('net::ERR_CONNECTION_REFUSED'));
    assert.ok(body.error.generalInfo.includes('połączenia sieciowego'));
  });

  test('14. Standard user in multiple groups switches groups and views bills just from that group', async () => {
    // Create second group
    const group2Res = await app.inject({
      method: 'POST',
      url: '/api/admin/groups',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Działka Rekreacyjna',
        description: 'Domek letniskowy',
        userIds: [createdUserId],
      },
    });
    assert.equal(group2Res.statusCode, 201);
    group2Id = JSON.parse(group2Res.body).group.id;

    // Create portal for second group
    const portal2Res = await app.inject({
      method: 'POST',
      url: '/api/admin/portals',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Działka Tauron',
        providerId: 'mock-provider',
        login: 'dzialka_user',
        password: 'password123',
        groupIds: [group2Id],
      },
    });
    assert.equal(portal2Res.statusCode, 201);
    const portal2Id = JSON.parse(portal2Res.body).portal.id;

    // Insert a bill directly for second group's portal
    await prisma.bill.create({
      data: {
        portalId: portal2Id,
        invoiceNumber: 'FA/DZIALKA/2026/01',
        amountDue: 150.50,
        currency: 'PLN',
        issueDate: new Date('2026-09-01'),
        dueDate: new Date('2026-09-25'),
        paymentStatus: 'UNPAID',
      },
    });

    // Check /api/groups returns both groups for user
    const groupsRes = await app.inject({
      method: 'GET',
      url: '/api/groups',
      headers: { authorization: `Bearer ${userToken}` },
    });
    assert.equal(groupsRes.statusCode, 200);
    const userGroups = JSON.parse(groupsRes.body).groups;
    assert.equal(userGroups.length, 2);

    // Query bills filtered by group 1
    const billsGroup1Res = await app.inject({
      method: 'GET',
      url: `/api/bills?groupId=${createdGroupId}`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    assert.equal(billsGroup1Res.statusCode, 200);
    const billsGroup1 = JSON.parse(billsGroup1Res.body).bills;
    assert.equal(billsGroup1.length, 3);
    assert.ok(billsGroup1.every((b: any) => b.portalId === createdPortalId));

    // Query bills filtered by group 2
    const billsGroup2Res = await app.inject({
      method: 'GET',
      url: `/api/bills?groupId=${group2Id}`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    assert.equal(billsGroup2Res.statusCode, 200);
    const billsGroup2 = JSON.parse(billsGroup2Res.body).bills;
    assert.equal(billsGroup2.length, 1);
    assert.equal(billsGroup2[0].invoiceNumber, 'FA/DZIALKA/2026/01');
    assert.equal(billsGroup2[0].portalId, portal2Id);

    // Summary filtered by group 2
    const summaryGroup2Res = await app.inject({
      method: 'GET',
      url: `/api/bills/summary?groupId=${group2Id}`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    assert.equal(summaryGroup2Res.statusCode, 200);
    const summaryGroup2 = JSON.parse(summaryGroup2Res.body).summary;
    assert.equal(summaryGroup2.totalUnpaidAmount, 150.50);
    assert.equal(summaryGroup2.unpaidCount, 1);
  });

  test('15. Admin duplicates a Portal and inherits credentials without re-entering password', async () => {
    // 1. Standard user cannot duplicate (403 Forbidden)
    const forbiddenRes = await app.inject({
      method: 'POST',
      url: `/api/admin/portals/${createdPortalId}/duplicate`,
      headers: { authorization: `Bearer ${userToken}` },
      payload: {},
    });
    assert.equal(forbiddenRes.statusCode, 403);

    // 2. Admin duplicates portal with default parameters
    const defaultDupRes = await app.inject({
      method: 'POST',
      url: `/api/admin/portals/${createdPortalId}/duplicate`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    assert.equal(defaultDupRes.statusCode, 201);
    const defaultDupBody = JSON.parse(defaultDupRes.body);
    assert.ok(defaultDupBody.portal.id);
    assert.notEqual(defaultDupBody.portal.id, createdPortalId);
    assert.equal(defaultDupBody.portal.name, 'Domowy Mock Portal (kopia)');
    assert.equal(defaultDupBody.portal.providerId, 'mock-provider');
    assert.equal(defaultDupBody.portal.loginMasked, 'j***i@poczta.pl');
    assert.equal(defaultDupBody.portal.lastSyncStatus, 'IDLE');
    assert.deepEqual(defaultDupBody.portal.groupIds, [createdGroupId]);

    // 3. Admin duplicates portal with custom overrides (name, agreementFilter, groupIds)
    const customDupRes = await app.inject({
      method: 'POST',
      url: `/api/admin/portals/${createdPortalId}/duplicate`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Mock Portal - Lokal B',
        agreementFilter: 'Lokal-B',
        groupIds: [group2Id],
        isEnabled: false,
      },
    });
    assert.equal(customDupRes.statusCode, 201);
    const customDupBody = JSON.parse(customDupRes.body);
    assert.equal(customDupBody.portal.name, 'Mock Portal - Lokal B');
    assert.equal(customDupBody.portal.agreementFilter, 'Lokal-B');
    assert.equal(customDupBody.portal.isEnabled, false);
    assert.deepEqual(customDupBody.portal.groupIds, [group2Id]);
    assert.equal(customDupBody.portal.providerId, 'mock-provider');
    assert.equal(customDupBody.portal.loginMasked, 'j***i@poczta.pl');
  });

  test('16. Standard user triggers /api/sync/all and returns jobs and initial activeSync without closing modal', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/all',
      headers: { authorization: `Bearer ${userToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.jobs);
    assert.ok(Array.isArray(body.jobs));
    assert.ok(body.activeSync);
    assert.ok(body.activeSync.jobId);
    assert.equal(typeof body.activeSync.progressPercent, 'number');
    assert.equal(typeof body.activeSync.hasMoreJobs, 'boolean');
  });

  test('17. Standard login does NOT trigger background sync', async () => {
    // Count sync jobs before login
    const countBefore = await prisma.syncJob.count();

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'jan.test@kowalski.pl',
        password: 'JanPassword123!',
      },
    });
    assert.equal(loginRes.statusCode, 200);

    // Wait 200ms and verify no new sync jobs were created
    await new Promise((r) => setTimeout(r, 200));
    const countAfter = await prisma.syncJob.count();
    assert.equal(countAfter, countBefore, 'Login must not trigger any background sync jobs');
  });

  test('18. Admin triggers /api/admin/portals/sync-all for all enabled portals', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/portals/sync-all',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.message);
    assert.ok(Array.isArray(body.jobs));
  });

  test('19. Should return nightly refresh status via /api/sync/nightly-status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sync/nightly-status',
      headers: { authorization: `Bearer ${userToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok('isOverdue' in body);
    assert.equal(typeof body.isOverdue, 'boolean');
    assert.ok('lastNightlyRefreshAt' in body);
    assert.ok('hoursSinceLastRefresh' in body);
  });
});



