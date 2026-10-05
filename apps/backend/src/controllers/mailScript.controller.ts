import type { FastifyPluginAsync } from 'fastify';
import { MailScriptService } from '../services/MailScriptService.js';
import { ForbiddenError, UnauthorizedError } from '../core/errors.js';
import type { 
  UpdateMailScriptConfigRequest,
  MailScriptIngestRequest,
} from '@bills-master/shared-types';

export const mailScriptAdminRoutes: FastifyPluginAsync = async (fastify) => {
  // Enforce ADMIN role
  fastify.addHook('preHandler', async (request) => {
    await fastify.authenticate(request);
    if (request.user.role !== 'ADMIN') {
      throw new ForbiddenError('Wymagane uprawnienia administratora');
    }
  });

  // Helper to detect public origin from request headers (Nginx reverse proxy)
  const detectOrigin = (request: any): string => {
    const proto = (request.headers['x-forwarded-proto'] as string) || (request.headers['x-forwarded-ssl'] === 'on' ? 'https' : request.protocol) || 'https';
    const host = (request.headers['x-forwarded-host'] as string) || request.headers.host;
    if (host) {
      return `${proto}://${host}`;
    }
    return process.env.PUBLIC_URL || 'http://localhost:3000';
  };

  // Get current MailScript configuration, status & generated script
  fastify.get('/config', async (request, reply) => {
    const detectedOrigin = detectOrigin(request);
    const config = await MailScriptService.getConfig(detectedOrigin);
    return reply.send({ config });
  });

  // Update MailScript configuration (change endpoint URL, regenerate token, acknowledge update, reset last run date)
  fastify.put<{ Body: UpdateMailScriptConfigRequest }>('/config', async (request, reply) => {
    const config = await MailScriptService.updateConfig(request.body);
    return reply.send({ config });
  });

  fastify.patch<{ Body: UpdateMailScriptConfigRequest }>('/config', async (request, reply) => {
    const config = await MailScriptService.updateConfig(request.body);
    return reply.send({ config });
  });

  // Download generated script as a file
  fastify.get('/script', async (request, reply) => {
    const detectedOrigin = detectOrigin(request);
    const config = await MailScriptService.getConfig(detectedOrigin);
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="BillsMaster_Gmail_Sync.gs"');
    return reply.send(config.scriptCode);
  });

  // Trigger remote sync via Google Apps Script Web App URL
  fastify.post('/trigger-remote', async (_request, reply) => {
    const result = await MailScriptService.triggerRemoteSync();
    return reply.send(result);
  });
};

export const mailScriptPublicRoutes: FastifyPluginAsync = async (fastify) => {
  // Public endpoint for Google Apps Script to fetch status & last run cutoff date
  fastify.get<{ Querystring: { token?: string } }>('/status', async (request, reply) => {
    const token = request.query.token || (request.headers['x-mail-script-token'] as string);
    if (!token) {
      throw new UnauthorizedError('Brakujący token autoryzacyjny');
    }

    const status = await MailScriptService.getStatus(token);
    return reply.send(status);
  });

  // Ingest endpoint called by Google Apps Script with extracted email invoices
  fastify.post<{ Body: MailScriptIngestRequest }>('/ingest', async (request, reply) => {
    const clientIp = request.ip || request.headers['x-forwarded-for'] as string;
    const token = request.body?.secretToken || (request.headers['x-mail-script-token'] as string);

    const payload: MailScriptIngestRequest = {
      secretToken: token,
      items: request.body?.items || [],
    };

    const result = await MailScriptService.ingest(payload, clientIp);
    return reply.send(result);
  });
};
