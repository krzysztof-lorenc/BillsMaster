import { prisma } from '../db/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../core/errors.js';
import { CryptoService } from '../security/crypto.service.js';
import type { GroupDto, CreateGroupRequest, UpdateGroupRequest } from '@bills-master/shared-types';

export class GroupService {
  public static async listGroups(): Promise<GroupDto[]> {
    const groups = await prisma.group.findMany({
      include: {
        portals: {
          include: {
            portal: {
              include: { provider: true },
            },
          },
        },
        users: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                role: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt.toISOString(),
      portals: g.portals.map((gp) => ({
        id: gp.portal.id,
        name: gp.portal.name,
        providerId: gp.portal.providerId,
        providerName: gp.portal.provider.name,
        providerCategory: gp.portal.provider.category as any,
        loginMasked: CryptoService.maskLogin(gp.portal.login),
        isEnabled: gp.portal.isEnabled,
        agreementFilter: gp.portal.agreementFilter,
        syncFrequency: gp.portal.syncFrequency ?? 1,
        groupIds: [g.id],
        lastSyncStatus: gp.portal.lastSyncStatus,
        lastSyncMessage: gp.portal.lastSyncMessage,
        lastSyncedAt: gp.portal.lastSyncedAt?.toISOString() || null,
        notifyNewBill: gp.portal.notifyNewBill ?? true,
        notifyDueSoon: gp.portal.notifyDueSoon ?? true,
        notifyOverdue: gp.portal.notifyOverdue ?? true,
        createdAt: gp.portal.createdAt.toISOString(),
        updatedAt: gp.portal.updatedAt.toISOString(),
      })),
      users: g.users.map((gu) => ({
        id: gu.user.id,
        email: gu.user.email,
        name: gu.user.name,
        role: gu.user.role,
        isActive: gu.user.isActive,
        createdAt: gu.user.createdAt.toISOString(),
        updatedAt: gu.user.updatedAt.toISOString(),
      })),
      portalCount: g.portals.length,
      userCount: g.users.length,
    }));
  }

  public static async getGroup(id: string): Promise<GroupDto> {
    const group = await prisma.group.findUnique({
      where: { id },
      include: {
        portals: {
          include: {
            portal: {
              include: { provider: true },
            },
          },
        },
        users: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                role: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });

    if (!group) {
      throw new NotFoundError('Nie znaleziono grupy');
    }

    return {
      id: group.id,
      name: group.name,
      description: group.description,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
      portals: group.portals.map((gp) => ({
        id: gp.portal.id,
        name: gp.portal.name,
        providerId: gp.portal.providerId,
        providerName: gp.portal.provider.name,
        providerCategory: gp.portal.provider.category as any,
        loginMasked: CryptoService.maskLogin(gp.portal.login),
        isEnabled: gp.portal.isEnabled,
        agreementFilter: gp.portal.agreementFilter,
        syncFrequency: gp.portal.syncFrequency ?? 1,
        groupIds: [group.id],
        lastSyncStatus: gp.portal.lastSyncStatus,
        lastSyncMessage: gp.portal.lastSyncMessage,
        lastSyncedAt: gp.portal.lastSyncedAt?.toISOString() || null,
        notifyNewBill: gp.portal.notifyNewBill ?? true,
        notifyDueSoon: gp.portal.notifyDueSoon ?? true,
        notifyOverdue: gp.portal.notifyOverdue ?? true,
        createdAt: gp.portal.createdAt.toISOString(),
        updatedAt: gp.portal.updatedAt.toISOString(),
      })),
      users: group.users.map((gu) => ({
        id: gu.user.id,
        email: gu.user.email,
        name: gu.user.name,
        role: gu.user.role,
        isActive: gu.user.isActive,
        createdAt: gu.user.createdAt.toISOString(),
        updatedAt: gu.user.updatedAt.toISOString(),
      })),
      portalCount: group.portals.length,
      userCount: group.users.length,
    };
  }

  public static async createGroup(data: CreateGroupRequest): Promise<GroupDto> {
    const trimmedName = data.name?.trim();
    if (!trimmedName) {
      throw new BadRequestError('Nazwa grupy jest wymagana');
    }

    const existing = await prisma.group.findUnique({
      where: { name: trimmedName },
    });
    if (existing) {
      throw new ConflictError('Grupa o tej nazwie już istnieje');
    }

    const portalIds = Array.isArray(data.portalIds) ? Array.from(new Set(data.portalIds)) : [];
    const userIds = Array.isArray(data.userIds) ? Array.from(new Set(data.userIds)) : [];

    const group = await prisma.group.create({
      data: {
        name: trimmedName,
        description: data.description?.trim() || null,
        portals: {
          create: portalIds.map((portalId) => ({
            portal: { connect: { id: portalId } },
          })),
        },
        users: {
          create: userIds.map((userId) => ({
            user: { connect: { id: userId } },
          })),
        },
      },
      include: {
        portals: {
          include: {
            portal: {
              include: { provider: true },
            },
          },
        },
        users: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                role: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });

    return this.getGroup(group.id);
  }

  public static async updateGroup(id: string, data: UpdateGroupRequest): Promise<GroupDto> {
    const existing = await prisma.group.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Nie znaleziono grupy');
    }

    if (data.name !== undefined) {
      const trimmedName = data.name.trim();
      if (!trimmedName) {
        throw new BadRequestError('Nazwa grupy nie może być pusta');
      }
      if (trimmedName !== existing.name) {
        const duplicate = await prisma.group.findUnique({ where: { name: trimmedName } });
        if (duplicate) {
          throw new ConflictError('Grupa o tej nazwie już istnieje');
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      const updateData: Record<string, unknown> = {};
      if (data.name !== undefined) updateData.name = data.name.trim();
      if (data.description !== undefined) updateData.description = data.description?.trim() || null;

      if (Object.keys(updateData).length > 0) {
        await tx.group.update({
          where: { id },
          data: updateData,
        });
      }

      if (data.portalIds !== undefined) {
        const uniquePortalIds = Array.from(new Set(data.portalIds));
        await tx.groupPortal.deleteMany({ where: { groupId: id } });
        if (uniquePortalIds.length > 0) {
          await tx.groupPortal.createMany({
            data: uniquePortalIds.map((portalId) => ({
              groupId: id,
              portalId,
            })),
          });
        }
      }

      if (data.userIds !== undefined) {
        const uniqueUserIds = Array.from(new Set(data.userIds));
        await tx.userGroup.deleteMany({ where: { groupId: id } });
        if (uniqueUserIds.length > 0) {
          await tx.userGroup.createMany({
            data: uniqueUserIds.map((userId) => ({
              groupId: id,
              userId,
            })),
          });
        }
      }
    });

    return this.getGroup(id);
  }

  public static async deleteGroup(id: string): Promise<void> {
    const existing = await prisma.group.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Nie znaleziono grupy');
    }

    await prisma.group.delete({ where: { id } });
  }
}
