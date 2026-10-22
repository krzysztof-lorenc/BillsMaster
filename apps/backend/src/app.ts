import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { config } from './config/index.js';
import { logger } from './core/logger.js';
import { AppError } from './core/errors.js';
import { wsConnectionManager } from './ws/connectionManager.js';
import { authRoutes } from './controllers/auth.controller.js';
import { adminRoutes } from './controllers/admin.controller.js';
import { accountsRoutes } from './controllers/accounts.controller.js';
import { billsRoutes } from './controllers/bills.controller.js';
import { syncRoutes } from './controllers/sync.controller.js';
import { mailScriptAdminRoutes, mailScriptPublicRoutes } from './controllers/mailScript.controller.js';
import { notificationRoutes } from './controllers/notification.controller.js';
import { SyncService } from './services/SyncService.js';
import { prisma } from './db/prisma.js';
import type { AuthUser } from '@bills-master/shared-types';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply?: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: false,
    bodyLimit: 2 * 1024 * 1024, // 2MB default body limit across API routes
  });

  // Support empty or whitespace-only bodies for application/json (e.g. POST requests without payload)
  fastify.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 50 * 1024 * 1024 }, (_req, body: string, done) => {
    if (!body || body.trim() === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body));
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // CORS setup
  await fastify.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (e.g. mobile apps, curl, docker-internal)
      if (!origin) return cb(null, true);
      // Allow configured origins or standard localhost development ports
      const allowedLocalhost = [
        'http://localhost:3000',
        'http://localhost:5173',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:5173',
      ];
      if (
        config.corsOrigins.includes(origin) ||
        allowedLocalhost.includes(origin)
      ) {
        return cb(null, true);
      }
      return cb(null, false);
    },
    credentials: true,
  });

  // Cookie plugin
  await fastify.register(cookie, {
    secret: config.JWT_SECRET,
  });

  // JWT plugin
  await fastify.register(jwt, {
    secret: config.JWT_SECRET,
    cookie: {
      cookieName: 'token',
      signed: false,
    },
  });

  // WebSocket plugin
  await fastify.register(websocket, {
    options: { maxPayload: 1048576 },
  });

  // Authentication decorator
  fastify.decorate('authenticate', async (request: FastifyRequest, reply?: FastifyReply) => {
    try {
      // 1. Try JWT from cookie
      if (request.cookies.token) {
        request.user = fastify.jwt.verify<AuthUser>(request.cookies.token);
      } else {
        // 2. Try Authorization header
        await request.jwtVerify();
      }

      if (!request.user || !request.user.id) {
        throw new AppError('Wymagane logowanie', 401);
      }

      // 3. Verify user active state in database (protects against deactivated users using valid 7-day tokens)
      const dbUser = await prisma.user.findUnique({
        where: { id: request.user.id },
        select: { isActive: true, role: true },
      });

      if (!dbUser || !dbUser.isActive) {
        throw new AppError('Konto zostało zablokowane lub usunięte', 401);
      }

      request.user.role = dbUser.role;
    } catch {
      if (reply) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Wymagane logowanie' });
      }
      throw new AppError('Wymagane logowanie', 401);
    }
  });

  // Global Error Handler
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.name,
        message: error.message,
        code: error.code,
      });
    }

    if (error.validation) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: error.message,
        details: error.validation,
      });
    }

    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({
        error: error.name || 'ClientError',
        message: error.message,
        code: error.code,
      });
    }

    logger.error('Unhandled server error:', error);
    return reply.status(500).send({
      error: 'InternalServerError',
      message: process.env.NODE_ENV === 'production' ? 'Wewnętrzny błąd serwera' : error.message,
    });
  });

  // Register API routes
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(adminRoutes, { prefix: '/api/admin' });
  await fastify.register(accountsRoutes, { prefix: '/api' });
  await fastify.register(billsRoutes, { prefix: '/api' });
  await fastify.register(syncRoutes, { prefix: '/api' });
  await fastify.register(mailScriptAdminRoutes, { prefix: '/api/admin/mail-script' });
  await fastify.register(mailScriptPublicRoutes, { prefix: '/api/mail-script' });
  await fastify.register(notificationRoutes, { prefix: '/api' });


  // WebSocket real-time sync streaming endpoint
  fastify.get('/ws/sync-stream', { websocket: true }, async (socket, req) => {
    try {
      // Query param token or cookie
      const query = req.query as { token?: string };
      const token = query?.token || req.cookies?.token;

      if (!token) {
        socket.close(4001, 'Unauthorized: token missing');
        return;
      }

      const decoded = fastify.jwt.verify<AuthUser>(token);
      if (!decoded || !decoded.id) {
        socket.close(4001, 'Unauthorized: invalid token');
        return;
      }

      // Verify active user status in database
      const dbUser = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { isActive: true },
      });

      if (!dbUser || !dbUser.isActive) {
        socket.close(4001, 'Unauthorized: account deactivated');
        return;
      }

      wsConnectionManager.register(decoded.id, socket);
      
      socket.send(JSON.stringify({
        type: 'CONNECTED',
        payload: { userId: decoded.id, message: 'Połączono ze strumieniem synchronizacji BillsMaster' },
      }));

      // If there is an active sync for this user, send it immediately so newly opened device connects seamlessly
      SyncService.getActiveSyncForUser(decoded.id)
        .then((active) => {
          if (active && socket.readyState === 1) {
            socket.send(JSON.stringify({
              type: 'SYNC_PROGRESS',
              payload: active,
            }));
          }
        })
        .catch((err) => {
          logger.warn('[WS] Error checking active sync on connect:', err);
        });
    } catch (err) {
      logger.warn('[WS] Connection auth error:', err);
      socket.close(4001, 'Unauthorized');
    }
  });

  // Health check endpoint
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  return fastify;
}
