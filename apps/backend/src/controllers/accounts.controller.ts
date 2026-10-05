import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db/prisma.js';
import { PortalService } from '../services/PortalService.js';
import { SyncService } from '../services/SyncService.js';
import { ForbiddenError, NotFoundError } from '../core/errors.js';

export const accountsRoutes: FastifyPluginAsync = async (fastify) => {
  // Enforce authentication & disallow ADMIN from viewing personal portals/bills
  fastify.addHook('preHandler', async (request) => {
    await fastify.authenticate(request);
    if (request.user.role === 'ADMIN') {
      throw new ForbiddenError('Konta administratora nie mają dostępu do portali użytkowników');
    }
  });

  // Get groups assigned to the current user
  fastify.get('/groups', async (request, reply) => {
    const userGroups = await prisma.userGroup.findMany({
      where: { userId: request.user.id },
      include: {
        group: {
          select: { id: true, name: true, description: true },
        },
      },
      orderBy: {
        group: { name: 'asc' },
      },
    });

    const groups = userGroups.map((ug) => ({
      id: ug.group.id,
      name: ug.group.name,
      description: ug.group.description,
    }));

    return reply.send({ groups });
  });

  // Alias for /groups
  fastify.get('/user/groups', async (request, reply) => {
    const userGroups = await prisma.userGroup.findMany({
      where: { userId: request.user.id },
      include: {
        group: {
          select: { id: true, name: true, description: true },
        },
      },
      orderBy: {
        group: { name: 'asc' },
      },
    });

    const groups = userGroups.map((ug) => ({
      id: ug.group.id,
      name: ug.group.name,
      description: ug.group.description,
    }));

    return reply.send({ groups });
  });

  // Get portals available to the current user via their assigned groups
  fastify.get('/portals', async (request, reply) => {
    const portals = await PortalService.getPortalsForUser(request.user.id);
    return reply.send({ portals });
  });

  // Compatibility route for /accounts
  fastify.get('/accounts', async (request, reply) => {
    const portals = await PortalService.getPortalsForUser(request.user.id);
    const accounts = portals.map((p) => ({
      id: p.id,
      userId: request.user.id,
      providerId: p.providerId,
      accountLabel: p.name,
      loginMasked: p.loginMasked,
      lastSyncStatus: p.lastSyncStatus,
      lastSyncMessage: p.lastSyncMessage,
      lastSyncedAt: p.lastSyncedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      provider: {
        id: p.providerId,
        name: p.providerName,
        category: p.providerCategory,
        isEnabled: p.isEnabled,
      },
    }));
    return reply.send({ accounts, portals });
  });

  // Trigger sync for a portal belonging to user's groups
  fastify.post<{ Params: { id: string } }>('/portals/:id/sync', async (request, reply) => {
    const userPortals = await PortalService.getPortalsForUser(request.user.id);
    const hasAccess = userPortals.some((p) => p.id === request.params.id);
    if (!hasAccess) {
      throw new NotFoundError('Nie znaleziono portalu dostawcy w Twoich grupach');
    }

    const syncJob = await SyncService.triggerSyncForPortal(request.params.id);
    return reply.send({ success: true, syncJob });
  });
};
