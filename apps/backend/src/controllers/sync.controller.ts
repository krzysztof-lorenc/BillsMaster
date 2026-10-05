import type { FastifyPluginAsync } from 'fastify';
import { SyncService } from '../services/SyncService.js';
import { PortalService } from '../services/PortalService.js';
import { NightlyRefreshService } from '../services/NightlyRefreshService.js';
import { ForbiddenError, NotFoundError } from '../core/errors.js';

export const syncRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', async (request) => {
    await fastify.authenticate(request);
  });

  // Trigger sync for all portals assigned to user's groups
  fastify.post('/sync/all', async (request, reply) => {
    if (request.user.role === 'ADMIN') {
      throw new ForbiddenError('Konta administratora nie mogą uruchamiać pobierania faktur z tego endpointu');
    }
    const jobs = await SyncService.triggerSyncForAllUserPortals(request.user.id);
    const activeSync = await SyncService.getActiveSyncForUser(request.user.id);
    return reply.send({ message: `Uruchomiono pobieranie dla ${jobs.length} dostawców`, jobs, activeSync });
  });

  // Trigger sync for specific portal
  fastify.post<{ Params: { portalId: string } }>('/sync/:portalId', async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
      const userPortals = await PortalService.getPortalsForUser(request.user.id);
      const hasAccess = userPortals.some((p) => p.id === request.params.portalId);
      if (!hasAccess) {
        throw new NotFoundError('Nie znaleziono portalu dostawcy w Twoich grupach');
      }
    }

    const job = await SyncService.triggerSyncForPortal(request.params.portalId);
    return reply.send({ message: 'Uruchomiono sprawdzanie portalu', job });
  });

  // Get recent sync job history
  fastify.get('/sync/jobs', async (request, reply) => {
    const jobs = await SyncService.getRecentSyncJobsForUser(request.user.id);
    return reply.send({ jobs });
  });

  // Get currently active sync progress for user's portals (supports polling & multiple logins)
  fastify.get('/sync/active', async (request, reply) => {
    const activeSync = await SyncService.getActiveSyncForUser(request.user.id);
    return reply.send({ active: Boolean(activeSync), activeSync });
  });

  // Get currently active sync error for user's portals (permanent banner support)
  fastify.get('/sync/active-error', async (request, reply) => {
    const error = await SyncService.getActiveErrorForUser(request.user.id);
    return reply.send({ error });
  });

  // Get status of the last nightly refresh
  fastify.get('/sync/nightly-status', async (_request, reply) => {
    const status = await NightlyRefreshService.getNightlyRefreshStatus();
    return reply.send(status);
  });
};
