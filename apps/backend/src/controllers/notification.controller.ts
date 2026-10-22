import type { FastifyPluginAsync } from 'fastify';
import { NotificationService } from '../services/NotificationService.js';
import { ForbiddenError, BadRequestError } from '../core/errors.js';
import type { 
  SubscribePushRequest, 
  UnsubscribePushRequest 
} from '@bills-master/shared-types';

export const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  // Enforce authentication for all notification routes
  fastify.addHook('preHandler', async (request) => {
    await fastify.authenticate(request);
  });

  // Get public VAPID key
  fastify.get('/notifications/vapid-key', async (_request, reply) => {
    const publicKey = NotificationService.getVapidPublicKey();
    return reply.send({ publicKey });
  });

  // Check device/user notification status
  fastify.get<{ Querystring: { endpoint?: string } }>('/notifications/status', async (request, reply) => {
    const status = await NotificationService.getStatus(request.user.id, request.query?.endpoint);
    return reply.send(status);
  });

  // Subscribe current device
  fastify.post<{ Body: SubscribePushRequest }>('/notifications/subscribe', async (request, reply) => {
    const { endpoint, keys } = request.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      throw new BadRequestError('Nieprawidłowe dane subskrypcji Web Push');
    }

    await NotificationService.subscribe(request.user.id, {
      endpoint,
      keys,
      userAgent: request.headers['user-agent'] || request.body.userAgent,
    });

    return reply.send({ success: true });
  });

  // Unsubscribe device
  fastify.post<{ Body: UnsubscribePushRequest }>('/notifications/unsubscribe', async (request, reply) => {
    const { endpoint } = request.body || {};
    if (!endpoint) {
      throw new BadRequestError('Brak parametru endpoint');
    }

    await NotificationService.unsubscribe(request.user.id, endpoint);
    return reply.send({ success: true });
  });

  // Send immediate test push to current user's registered devices
  fastify.post('/notifications/test', async (request, reply) => {
    const result = await NotificationService.sendTestNotification(request.user.id);
    return reply.send(result);
  });

  // Trigger daily digest manually (Admin only)
  fastify.post('/notifications/run-digest', async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
      throw new ForbiddenError('Tylko administrator może ręcznie uruchomić generator powiadomień');
    }

    const result = await NotificationService.runDailyNotificationDigest();
    return reply.send({ success: true, ...result });
  });
};
