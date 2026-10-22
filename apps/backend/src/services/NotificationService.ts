import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { prisma } from '../db/prisma.js';
import { config } from '../config/index.js';
import { logger } from '../core/logger.js';
import { BillService } from './BillService.js';
import type { 
  NotificationEventType, 
  SubscribePushRequest, 
  NotificationStatusResponse,
  SendTestNotificationResponse 
} from '@bills-master/shared-types';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
  eventId?: NotificationEventType | 'TEST';
  actions?: Array<{ action: string; title: string }>;
}

export class NotificationService {
  private static vapidKeys: VapidKeys | null = null;
  private static isInitialized = false;

  /**
   * Initializes VAPID keys. If keys are not present in .env,
   * generates or loads persisted keys from storage/vapid.json.
   */
  public static init(): void {
    if (this.isInitialized) return;

    let pub = config.VAPID_PUBLIC_KEY;
    let priv = config.VAPID_PRIVATE_KEY;

    if (!pub || !priv) {
      // Check persistent storage file
      const vapidFilePath = path.join(config.STORAGE_DIR, 'vapid.json');
      try {
        if (fs.existsSync(vapidFilePath)) {
          const raw = fs.readFileSync(vapidFilePath, 'utf-8');
          const saved = JSON.parse(raw);
          if (saved.publicKey && saved.privateKey) {
            pub = saved.publicKey;
            priv = saved.privateKey;
          }
        }
      } catch (err) {
        logger.warn('[NotificationService] Could not read existing vapid.json, generating new keys:', err);
      }

      if (!pub || !priv) {
        // Auto-generate fresh VAPID keys
        logger.info('[NotificationService] Generating new VAPID keys...');
        const generated = webpush.generateVAPIDKeys();
        pub = generated.publicKey;
        priv = generated.privateKey;

        try {
          if (!fs.existsSync(config.STORAGE_DIR)) {
            fs.mkdirSync(config.STORAGE_DIR, { recursive: true });
          }
          fs.writeFileSync(vapidFilePath, JSON.stringify(generated, null, 2), 'utf-8');
          logger.info(`[NotificationService] Persisted generated VAPID keys to ${vapidFilePath}`);
        } catch (err) {
          logger.error('[NotificationService] Failed to persist vapid.json:', err);
        }
      }
    }

    this.vapidKeys = {
      publicKey: pub,
      privateKey: priv,
    };

    webpush.setVapidDetails(
      config.VAPID_SUBJECT,
      this.vapidKeys.publicKey,
      this.vapidKeys.privateKey
    );

    this.isInitialized = true;
    logger.info('[NotificationService] Web Push VAPID initialized successfully');
  }

  public static getVapidPublicKey(): string {
    this.init();
    return this.vapidKeys?.publicKey || '';
  }

  /**
   * Registers or updates a user's push subscription.
   */
  public static async subscribe(userId: string, data: SubscribePushRequest): Promise<void> {
    this.init();
    await prisma.pushSubscription.upsert({
      where: { endpoint: data.endpoint },
      update: {
        userId,
        p256dh: data.keys.p256dh,
        auth: data.keys.auth,
        userAgent: data.userAgent || null,
        updatedAt: new Date(),
      },
      create: {
        userId,
        endpoint: data.endpoint,
        p256dh: data.keys.p256dh,
        auth: data.keys.auth,
        userAgent: data.userAgent || null,
      },
    });

    logger.info(`[NotificationService] Subscribed endpoint for user ${userId}`);
  }

  /**
   * Unregisters a specific push subscription.
   */
  public static async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await prisma.pushSubscription.deleteMany({
      where: {
        userId,
        endpoint,
      },
    });
    logger.info(`[NotificationService] Unsubscribed endpoint for user ${userId}`);
  }

  /**
   * Returns current subscription status for a user.
   */
  public static async getStatus(userId: string, endpoint?: string): Promise<NotificationStatusResponse> {
    this.init();
    const count = await prisma.pushSubscription.count({
      where: { userId },
    });

    let enabledOnDevice = false;
    if (endpoint) {
      const match = await prisma.pushSubscription.findFirst({
        where: { userId, endpoint },
      });
      enabledOnDevice = Boolean(match);
    }

    return {
      enabledOnDevice,
      activeSubscriptionsCount: count,
      vapidConfigured: Boolean(this.vapidKeys?.publicKey),
    };
  }

  /**
   * Helper to format Warsaw date as YYYY-MM-DD.
   */
  public static getWarsawDateString(date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Warsaw',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;

    return `${year}-${month}-${day}`;
  }

  /**
   * Helper to format a Date as DD.MM (e.g. 24.10) in Europe/Warsaw timezone.
   */
  public static formatDayMonth(date: Date): string {
    const parts = new Intl.DateTimeFormat('pl-PL', {
      timeZone: 'Europe/Warsaw',
      day: '2-digit',
      month: '2-digit',
    }).formatToParts(date);

    const day = parts.find((p) => p.type === 'day')?.value || '01';
    const month = parts.find((p) => p.type === 'month')?.value || '01';
    return `${day}.${month}`;
  }

  /**
   * Formats the list of portals and dates into the required bullet format:
   * · Tauron: 24.10
   * · PGNiG (2): 28.10
   */
  public static formatPortalBulletList(items: Array<{ portalName: string; count: number; earliestDueDate: Date }>): string {
    return items
      .map((item) => {
        const dateStr = this.formatDayMonth(item.earliestDueDate);
        const countBadge = item.count > 1 ? ` (${item.count})` : '';
        return `· ${item.portalName}${countBadge}: ${dateStr}`;
      })
      .join('\n');
  }

  /**
   * Dispatches push payload to all registered subscriptions of a user.
   * Stale subscriptions (404/410) are removed automatically.
   */
  public static async sendPushToUser(userId: string, payload: PushNotificationPayload): Promise<number> {
    this.init();
    const subs = await prisma.pushSubscription.findMany({
      where: { userId },
    });

    if (subs.length === 0) return 0;

    let deliveredCount = 0;
    const bodyStr = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/pwa-192x192.png',
      badge: payload.badge || '/favicon.svg',
      tag: payload.tag,
      url: payload.url || '/',
      eventId: payload.eventId,
      actions: payload.actions || [
        { action: 'open', title: 'Otwórz BillsMaster' },
      ],
    });

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          bodyStr
        );
        deliveredCount++;
      } catch (err: any) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          logger.info(`[NotificationService] Removing expired push subscription: ${sub.id}`);
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          logger.warn(`[NotificationService] Failed to deliver push to subscription ${sub.id}:`, err?.message || err);
        }
      }
    }

    return deliveredCount;
  }

  /**
   * Sends an interactive test notification to all devices registered by the user.
   */
  public static async sendTestNotification(userId: string): Promise<SendTestNotificationResponse> {
    const delivered = await this.sendPushToUser(userId, {
      title: '🔔 BillsMaster • Test powiadomień',
      body: '· Test: powiadomienia na telefon działają prawidłowo!',
      eventId: 'TEST',
      tag: `billsmaster-test-${Date.now()}`,
      url: '/',
    });

    if (delivered === 0) {
      return {
        success: false,
        message: 'Brak zarejestrowanych urządzeń lub błąd dostarczenia powiadomienia.',
        deliveredCount: 0,
      };
    }

    return {
      success: true,
      message: `Powiadomienie testowe wysłane pomyślnie na ${delivered} urządzeń.`,
      deliveredCount: delivered,
    };
  }

  /**
   * Main daily digest processor (scheduled at 08:30 Europe/Warsaw).
   * Evaluates all 3 event types, applies per-portal switches,
   * enforces the max 1 notification per event per day constraint via Redis,
   * and formats the clean bullet list.
   */
  public static async runDailyNotificationDigest(targetDate = new Date()): Promise<{
    usersProcessed: number;
    notificationsSent: number;
  }> {
    this.init();
    const dateStr = this.getWarsawDateString(targetDate);
    logger.info(`[NotificationService] Running daily notification digest for ${dateStr}...`);

    // 1. Find all users who have active push subscriptions
    const usersWithSubs = await prisma.user.findMany({
      where: {
        isActive: true,
        pushSubscriptions: { some: {} },
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    if (usersWithSubs.length === 0) {
      logger.info('[NotificationService] No users with active push subscriptions found.');
      return { usersProcessed: 0, notificationsSent: 0 };
    }

    const { syncQueue } = await import('../queue/sync.queue.js');
    const redis = await syncQueue.client;
    let totalNotificationsSent = 0;

    for (const user of usersWithSubs) {
      try {
        const portalIds = await BillService.getAccessiblePortalIds(user.id);
        if (portalIds.length === 0) continue;

        // Fetch enabled portals accessible to the user
        const portals = await prisma.portal.findMany({
          where: {
            id: { in: portalIds },
            isEnabled: true,
          },
          select: {
            id: true,
            name: true,
            notifyNewBill: true,
            notifyDueSoon: true,
            notifyOverdue: true,
          },
        });

        const portalMap = new Map(portals.map((p) => [p.id, p]));

        // Fetch all unpaid bills for these portals
        const unpaidBills = await prisma.bill.findMany({
          where: {
            portalId: { in: portals.map((p) => p.id) },
            paymentStatus: { not: 'PAID' },
          },
          orderBy: { dueDate: 'asc' },
        });

        // -------------------------------------------------------------
        // Event 1: NEW_BILL (new bill available in the last 24 hours)
        // -------------------------------------------------------------
        const newBillPortals = portals.filter((p) => p.notifyNewBill);
        if (newBillPortals.length > 0) {
          const redisKey = `billsmaster:notif:${user.id}:NEW_BILL:${dateStr}`;
          const alreadySent = await redis.get(redisKey);

          if (!alreadySent) {
            // Bills created within the last 24h
            const oneDayAgo = new Date(targetDate.getTime() - 24 * 60 * 60 * 1000);
            const newBills = unpaidBills.filter(
              (b) => newBillPortals.some((p) => p.id === b.portalId) && b.createdAt >= oneDayAgo
            );

            if (newBills.length > 0) {
              const grouped = this.groupBillsByPortal(newBills, portalMap);
              const body = this.formatPortalBulletList(grouped);

              const delivered = await this.sendPushToUser(user.id, {
                title: '📄 BillsMaster • Nowe rachunki',
                body,
                tag: `billsmaster-new-bill-${dateStr}`,
                url: '/?status=UNPAID',
                eventId: 'NEW_BILL',
              });

              if (delivered > 0) {
                await (redis as any).set(redisKey, '1', 'EX', 86400);
                totalNotificationsSent++;
                logger.info(`[NotificationService] Sent NEW_BILL digest to user ${user.id} (${delivered} devices)`);
              }
            }
          }
        }

        // -------------------------------------------------------------
        // Event 2: DUE_SOON (due date is close, within 1 to 3 days)
        // -------------------------------------------------------------
        const dueSoonPortals = portals.filter((p) => p.notifyDueSoon);
        if (dueSoonPortals.length > 0) {
          const redisKey = `billsmaster:notif:${user.id}:DUE_SOON:${dateStr}`;
          const alreadySent = await redis.get(redisKey);

          if (!alreadySent) {
            // Target window: today 00:00:00 to today + 3 days 23:59:59
            const startOfToday = new Date(targetDate);
            startOfToday.setHours(0, 0, 0, 0);

            const in3DaysEnd = new Date(startOfToday);
            in3DaysEnd.setDate(in3DaysEnd.getDate() + 3);
            in3DaysEnd.setHours(23, 59, 59, 999);

            const dueSoonBills = unpaidBills.filter((b) => {
              if (!dueSoonPortals.some((p) => p.id === b.portalId)) return false;
              const due = new Date(b.dueDate);
              return due >= startOfToday && due <= in3DaysEnd;
            });

            if (dueSoonBills.length > 0) {
              const grouped = this.groupBillsByPortal(dueSoonBills, portalMap);
              const body = this.formatPortalBulletList(grouped);

              const delivered = await this.sendPushToUser(user.id, {
                title: '⏰ BillsMaster • Zbliża się termin płatności',
                body,
                tag: `billsmaster-due-soon-${dateStr}`,
                url: '/?status=PAY_30',
                eventId: 'DUE_SOON',
              });

              if (delivered > 0) {
                await (redis as any).set(redisKey, '1', 'EX', 86400);
                totalNotificationsSent++;
                logger.info(`[NotificationService] Sent DUE_SOON digest to user ${user.id} (${delivered} devices)`);
              }
            }
          }
        }

        // -------------------------------------------------------------
        // Event 3: OVERDUE (unpaid bill past due date)
        // -------------------------------------------------------------
        const overduePortals = portals.filter((p) => p.notifyOverdue);
        if (overduePortals.length > 0) {
          const redisKey = `billsmaster:notif:${user.id}:OVERDUE:${dateStr}`;
          const alreadySent = await redis.get(redisKey);

          if (!alreadySent) {
            const startOfToday = new Date(targetDate);
            startOfToday.setHours(0, 0, 0, 0);

            const overdueBills = unpaidBills.filter((b) => {
              if (!overduePortals.some((p) => p.id === b.portalId)) return false;
              const due = new Date(b.dueDate);
              return due < startOfToday;
            });

            if (overdueBills.length > 0) {
              const grouped = this.groupBillsByPortal(overdueBills, portalMap);
              const body = this.formatPortalBulletList(grouped);

              const delivered = await this.sendPushToUser(user.id, {
                title: '🚨 BillsMaster • Rachunki po terminie',
                body,
                tag: `billsmaster-overdue-${dateStr}`,
                url: '/?status=OVERDUE',
                eventId: 'OVERDUE',
              });

              if (delivered > 0) {
                await (redis as any).set(redisKey, '1', 'EX', 86400);
                totalNotificationsSent++;
                logger.info(`[NotificationService] Sent OVERDUE digest to user ${user.id} (${delivered} devices)`);
              }
            }
          }
        }
      } catch (userErr) {
        logger.error(`[NotificationService] Error processing notifications for user ${user.id}:`, userErr);
      }
    }

    return {
      usersProcessed: usersWithSubs.length,
      notificationsSent: totalNotificationsSent,
    };
  }

  /**
   * Helper to group bills by portal and pick the earliest dueDate.
   */
  private static groupBillsByPortal(
    bills: Array<{ portalId: string; dueDate: Date }>,
    portalMap: Map<string, { id: string; name: string }>
  ): Array<{ portalName: string; count: number; earliestDueDate: Date }> {
    const portalGroups = new Map<string, { portalName: string; count: number; earliestDueDate: Date }>();

    for (const b of bills) {
      const portal = portalMap.get(b.portalId);
      const name = portal?.name || 'Inny dostawca';
      const existing = portalGroups.get(b.portalId);

      if (!existing) {
        portalGroups.set(b.portalId, {
          portalName: name,
          count: 1,
          earliestDueDate: new Date(b.dueDate),
        });
      } else {
        existing.count++;
        const currentDue = new Date(b.dueDate);
        if (currentDue < existing.earliestDueDate) {
          existing.earliestDueDate = currentDue;
        }
      }
    }

    return Array.from(portalGroups.values()).sort((a, b) => 
      a.earliestDueDate.getTime() - b.earliestDueDate.getTime()
    );
  }
}
