import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db/prisma.js';
import { UserService } from '../services/UserService.js';
import { GroupService } from '../services/GroupService.js';
import { PortalService } from '../services/PortalService.js';
import { SyncService } from '../services/SyncService.js';
import { MailScriptService } from '../services/MailScriptService.js';
import { ForbiddenError } from '../core/errors.js';
import type { 
  CreateUserRequest, 
  UpdateUserRequest, 
  CreateGroupRequest, 
  UpdateGroupRequest,
  CreatePortalRequest,
  UpdatePortalRequest,
  DuplicatePortalRequest
} from '@bills-master/shared-types';

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // Enforce ADMIN role on all /api/admin routes
  fastify.addHook('preHandler', async (request) => {
    await fastify.authenticate(request);
    if (request.user.role !== 'ADMIN') {
      throw new ForbiddenError('Wymagane uprawnienia administratora');
    }
  });

  // --- Users Management ---

  // List all users
  fastify.get('/users', async (_request, reply) => {
    const users = await UserService.listUsers();
    return reply.send({ users });
  });

  // Create user
  fastify.post<{ Body: CreateUserRequest }>('/users', async (request, reply) => {
    const user = await UserService.createUser(request.body);
    return reply.status(201).send({ user });
  });

  // Update user (toggle active, update password/name/groups)
  fastify.patch<{ Params: { id: string }; Body: UpdateUserRequest }>('/users/:id', async (request, reply) => {
    const user = await UserService.updateUser(request.params.id, request.body);
    return reply.send({ user });
  });

  // Delete user
  fastify.delete<{ Params: { id: string } }>('/users/:id', async (request, reply) => {
    await UserService.deleteUser(request.params.id);
    return reply.send({ success: true });
  });

  // --- Groups Management ---

  // List all groups
  fastify.get('/groups', async (_request, reply) => {
    const groups = await GroupService.listGroups();
    return reply.send({ groups });
  });

  // Get specific group
  fastify.get<{ Params: { id: string } }>('/groups/:id', async (request, reply) => {
    const group = await GroupService.getGroup(request.params.id);
    return reply.send({ group });
  });

  // Create group
  fastify.post<{ Body: CreateGroupRequest }>('/groups', async (request, reply) => {
    const group = await GroupService.createGroup(request.body);
    return reply.status(201).send({ group });
  });

  // Update group
  fastify.patch<{ Params: { id: string }; Body: UpdateGroupRequest }>('/groups/:id', async (request, reply) => {
    const group = await GroupService.updateGroup(request.params.id, request.body);
    return reply.send({ group });
  });

  // Delete group
  fastify.delete<{ Params: { id: string } }>('/groups/:id', async (request, reply) => {
    await GroupService.deleteGroup(request.params.id);
    return reply.send({ success: true });
  });

  // --- Available Provider Plugins ---
  fastify.get('/providers', async (_request, reply) => {
    const providers = await prisma.provider.findMany({
      where: { 
        isEnabled: true,
        id: { notIn: ['mock-provider', 'test-retention-provider'] },
      },
      orderBy: { name: 'asc' },
    });
    return reply.send({ providers });
  });

  // --- Portals Management for Admin ---

  // List all portals with stats
  fastify.get('/portals', async (_request, reply) => {
    const portals = await PortalService.listPortals();
    const mailScriptConfig = await MailScriptService.getConfig().catch(() => null);
    return reply.send({ 
      portals,
      scriptNeedsUpdate: mailScriptConfig?.scriptNeedsUpdate ?? false
    });
  });

  // Get single portal
  fastify.get<{ Params: { id: string } }>('/portals/:id', async (request, reply) => {
    const portal = await PortalService.getPortal(request.params.id);
    return reply.send({ portal });
  });

  // Create new portal
  fastify.post<{ Body: CreatePortalRequest }>('/portals', async (request, reply) => {
    const portal = await PortalService.createPortal(request.body);
    return reply.status(201).send({ portal });
  });

  // Update portal
  fastify.patch<{ Params: { id: string }; Body: UpdatePortalRequest }>('/portals/:id', async (request, reply) => {
    const portal = await PortalService.updatePortal(request.params.id, request.body);
    return reply.send({ portal });
  });

  // Delete portal
  fastify.delete<{ Params: { id: string } }>('/portals/:id', async (request, reply) => {
    await PortalService.deletePortal(request.params.id);
    return reply.send({ success: true });
  });

  // Duplicate portal
  fastify.post<{ Params: { id: string }; Body: DuplicatePortalRequest }>('/portals/:id/duplicate', async (request, reply) => {
    const portal = await PortalService.duplicatePortal(request.params.id, request.body);
    return reply.status(201).send({ portal });
  });

  // Clear portal session cache
  fastify.post<{ Params: { id: string } }>('/portals/:id/clear-session', async (request, reply) => {
    await PortalService.clearPortalSession(request.params.id);
    return reply.send({ success: true, message: 'Sesja portalu została wyczyszczona' });
  });

  // Import portal session state (cookies)
  fastify.post<{ Params: { id: string }; Body: { sessionData: any } }>('/portals/:id/session', async (request, reply) => {
    await PortalService.importPortalSession(request.params.id, request.body.sessionData);
    return reply.send({ success: true, message: 'Sesja portalu została zaimportowana' });
  });

  // Trigger sync for portal
  fastify.post<{ Params: { id: string } }>('/portals/:id/sync', async (request, reply) => {
    const syncJob = await SyncService.triggerSyncForPortal(request.params.id);
    return reply.send({ syncJob });
  });

  // Trigger sync for all active portals
  fastify.post('/portals/sync-all', async (_request, reply) => {
    const jobs = await SyncService.triggerDailySyncForAllPortals();
    return reply.send({ message: `Uruchomiono synchronizację dla ${jobs.length} portali`, jobs });
  });

  // Trigger scheduled sync for specific frequencies
  fastify.post<{ Body: { frequencies?: number[] } }>('/portals/sync-scheduled', async (request, reply) => {
    const freqs = Array.isArray(request.body?.frequencies) && request.body.frequencies.length > 0
      ? request.body.frequencies
      : [1, 2, 3, 4];
    const jobs = await SyncService.triggerScheduledSyncForFrequencies(freqs);
    return reply.send({ message: `Uruchomiono synchronizację dla ${jobs.length} portali`, jobs });
  });
};
