import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../db/prisma.js';
import { config } from '../config/index.js';
import { BadRequestError, NotFoundError } from '../core/errors.js';
import { CryptoService } from '../security/crypto.service.js';
import { providerRegistry } from '../providers/registry.js';
import type { 
  PortalDto, 
  CreatePortalRequest, 
  UpdatePortalRequest, 
  DuplicatePortalRequest 
} from '@bills-master/shared-types';

export class PortalService {
  public static mapPortalToDto(p: any): PortalDto {
    const isMail = Boolean(p.isMailScript || p.providerId === 'mail-script');
    const category = (p.customCategory || p.provider?.category || 'OTHER') as any;

    return {
      id: p.id,
      name: p.name,
      providerId: p.providerId,
      providerName: p.provider?.name,
      providerCategory: category,
      category,
      loginMasked: isMail ? 'Poczta (Google Script)' : CryptoService.maskLogin(p.login),
      isEnabled: p.isEnabled,
      agreementFilter: p.agreementFilter,
      syncFrequency: p.syncFrequency ?? 1,
      groupIds: p.groups ? p.groups.map((g: any) => g.group?.id || g.groupId).filter(Boolean) : [],
      groupNames: p.groups ? p.groups.map((g: any) => g.group?.name).filter(Boolean) : [],
      lastSyncStatus: p.lastSyncStatus,
      lastSyncMessage: p.lastSyncMessage,
      lastSyncedAt: p.lastSyncedAt?.toISOString() || null,
      billCount: p._count?.bills ?? 0,
      isMailScript: isMail,
      senderFilter: p.senderFilter || null,
      titleFilter: p.titleFilter || null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  public static async listPortals(): Promise<PortalDto[]> {
    const portals = await prisma.portal.findMany({
      include: {
        provider: true,
        groups: {
          include: {
            group: {
              select: { id: true, name: true },
            },
          },
        },
        _count: {
          select: { bills: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return portals.map((p) => this.mapPortalToDto(p));
  }

  public static async getPortal(id: string): Promise<PortalDto> {
    const portal = await prisma.portal.findUnique({
      where: { id },
      include: {
        provider: true,
        groups: {
          include: {
            group: {
              select: { id: true, name: true },
            },
          },
        },
        _count: {
          select: { bills: true },
        },
      },
    });

    if (!portal) {
      throw new NotFoundError('Nie znaleziono portalu dostawcy');
    }

    return this.mapPortalToDto(portal);
  }

  public static async createPortal(data: CreatePortalRequest): Promise<PortalDto> {
    const name = data.name?.trim();
    if (!name || name.length < 2) {
      throw new BadRequestError('Nazwa dostawcy musi mieć co najmniej 2 znaki');
    }

    const providerId = data.providerId?.trim();
    if (!providerId) {
      throw new BadRequestError('Wtyczka dostawcy jest wymagana');
    }

    const provider = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) {
      throw new BadRequestError(`Wtyczka dostawcy "${providerId}" nie istnieje`);
    }

    const isMailScript = Boolean(data.isMailScript || providerId === 'mail-script');

    let login = data.login?.trim() || '';
    let encryptedPass = '';

    if (isMailScript) {
      login = login || 'Poczta (Google Script)';
      encryptedPass = '';
    } else {
      if (!login) {
        throw new BadRequestError('Login / identyfikator portalu jest wymagany');
      }
      const password = data.password?.trim() || '';
      if (!password) {
        throw new BadRequestError('Hasło do portalu jest wymagane');
      }
      encryptedPass = CryptoService.encrypt(password);
    }

    if (data.senderFilter) {
      try {
        new RegExp(data.senderFilter);
      } catch (err: any) {
        throw new BadRequestError(`Nieprawidłowe wyrażenie regularne dla filtra nadawcy: ${err.message}`);
      }
    }

    if (data.titleFilter) {
      try {
        new RegExp(data.titleFilter);
      } catch (err: any) {
        throw new BadRequestError(`Nieprawidłowe wyrażenie regularne dla filtra tematu: ${err.message}`);
      }
    }

    const groupIds = Array.isArray(data.groupIds) ? Array.from(new Set(data.groupIds)) : [];
    const syncFrequency = [1, 2, 3, 4].includes(Number(data.syncFrequency)) ? Number(data.syncFrequency) : 1;

    const portal = await prisma.portal.create({
      data: {
        name,
        providerId,
        login,
        encryptedPass,
        isEnabled: data.isEnabled ?? true,
        isMailScript,
        senderFilter: data.senderFilter ? data.senderFilter.trim() : null,
        titleFilter: data.titleFilter ? data.titleFilter.trim() : null,
        customCategory: data.category || null,
        agreementFilter: data.agreementFilter ? data.agreementFilter.trim() : null,
        syncFrequency,
        groups: {
          create: groupIds.map((groupId) => ({
            group: { connect: { id: groupId } },
          })),
        },
      },
      include: {
        provider: true,
        groups: {
          include: {
            group: {
              select: { id: true, name: true },
            },
          },
        },
        _count: {
          select: { bills: true },
        },
      },
    });

    return this.mapPortalToDto(portal);
  }

  public static async updatePortal(id: string, data: UpdatePortalRequest): Promise<PortalDto> {
    const existing = await prisma.portal.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Nie znaleziono portalu dostawcy');
    }

    const updateData: Record<string, unknown> = {};

    if (data.name !== undefined) {
      const name = data.name.trim();
      if (!name || name.length < 2) {
        throw new BadRequestError('Nazwa dostawcy musi mieć co najmniej 2 znaki');
      }
      updateData.name = name;
    }

    let invalidateSession = false;

    if (data.providerId !== undefined) {
      const provider = await prisma.provider.findUnique({ where: { id: data.providerId } });
      if (!provider) {
        throw new BadRequestError(`Wtyczka dostawcy "${data.providerId}" nie istnieje`);
      }
      if (data.providerId !== existing.providerId) {
        updateData.providerId = data.providerId;
        invalidateSession = true;
      }
    }

    if (data.login !== undefined) {
      const login = data.login.trim();
      if (!login) {
        throw new BadRequestError('Login nie może być pusty');
      }
      if (login !== existing.login) {
        updateData.login = login;
        invalidateSession = true;
      }
    }

    if (data.password !== undefined && data.password.trim().length > 0) {
      updateData.encryptedPass = CryptoService.encrypt(data.password.trim());
      invalidateSession = true;
    }

    if (invalidateSession) {
      updateData.sessionStatePath = null;
      const portalSessionsDir = path.join(config.SESSIONS_DIR, id);
      await fs.promises.rm(portalSessionsDir, { recursive: true, force: true }).catch(() => {});
    }

    if (data.isEnabled !== undefined) {
      updateData.isEnabled = data.isEnabled;
    }

    if (data.agreementFilter !== undefined) {
      updateData.agreementFilter = data.agreementFilter ? data.agreementFilter.trim() : null;
    }

    if (data.syncFrequency !== undefined) {
      const freq = Number(data.syncFrequency);
      if (![1, 2, 3, 4].includes(freq)) {
        throw new BadRequestError('Częstotliwość odświeżania musi wynosić 1, 2, 3 lub 4 razy na dobę');
      }
      updateData.syncFrequency = freq;
    }

    if (data.isMailScript !== undefined) {
      updateData.isMailScript = data.isMailScript;
    }

    if (data.senderFilter !== undefined) {
      if (data.senderFilter && data.senderFilter.trim()) {
        try {
          new RegExp(data.senderFilter.trim());
        } catch (err: any) {
          throw new BadRequestError(`Nieprawidłowe wyrażenie regularne dla filtra nadawcy: ${err.message}`);
        }
        updateData.senderFilter = data.senderFilter.trim();
      } else {
        updateData.senderFilter = null;
      }
    }

    if (data.titleFilter !== undefined) {
      if (data.titleFilter && data.titleFilter.trim()) {
        try {
          new RegExp(data.titleFilter.trim());
        } catch (err: any) {
          throw new BadRequestError(`Nieprawidłowe wyrażenie regularne dla filtra tematu: ${err.message}`);
        }
        updateData.titleFilter = data.titleFilter.trim();
      } else {
        updateData.titleFilter = null;
      }
    }

    if (data.category !== undefined) {
      updateData.customCategory = data.category || null;
    }

    await prisma.$transaction(async (tx) => {
      if (Object.keys(updateData).length > 0) {
        await tx.portal.update({
          where: { id },
          data: updateData,
        });
      }

      if (data.providerId !== undefined && data.providerId !== existing.providerId) {
        const oldBills = await tx.bill.findMany({
          where: { portalId: id },
          select: { id: true, pdfFilePath: true },
        });
        for (const b of oldBills) {
          if (b.pdfFilePath) {
            await fs.promises.unlink(b.pdfFilePath).catch(() => {});
          }
        }
        await tx.bill.deleteMany({ where: { portalId: id } });
      }

      if (data.agreementFilter !== undefined && updateData.agreementFilter) {
        try {
          const filterRegex = new RegExp(updateData.agreementFilter as string, 'i');
          const existingBills = await tx.bill.findMany({
            where: { portalId: id },
            select: { id: true, invoiceNumber: true, rawMetadata: true, pdfFilePath: true },
          });
          const toDelete = existingBills.filter((b) => {
            const meta = b.rawMetadata as any;
            if (meta?.agreementName) {
              return !filterRegex.test(meta.agreementName);
            }
            return !filterRegex.test(b.invoiceNumber);
          });
          if (toDelete.length > 0) {
            for (const b of toDelete) {
              if (b.pdfFilePath) {
                await fs.promises.unlink(b.pdfFilePath).catch(() => {});
              }
            }
            await tx.bill.deleteMany({
              where: { id: { in: toDelete.map((b) => b.id) } },
            });
          }
        } catch {
          // Ignore invalid regex
        }
      }

      if (data.groupIds !== undefined) {
        const uniqueGroupIds = Array.from(new Set(data.groupIds));
        await tx.groupPortal.deleteMany({ where: { portalId: id } });
        if (uniqueGroupIds.length > 0) {
          await tx.groupPortal.createMany({
            data: uniqueGroupIds.map((groupId) => ({
              portalId: id,
              groupId,
            })),
          });
        }
      }
    });

    return this.getPortal(id);
  }

  public static async clearPortalSession(id: string): Promise<void> {
    const existing = await prisma.portal.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Nie znaleziono portalu dostawcy');
    }

    await prisma.portal.update({
      where: { id },
      data: { sessionStatePath: null },
    });

    const portalSessionsDir = path.join(config.SESSIONS_DIR, id);
    await fs.promises.rm(portalSessionsDir, { recursive: true, force: true }).catch(() => {});
  }

  public static async importPortalSession(id: string, sessionData: any): Promise<void> {
    const existing = await prisma.portal.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Nie znaleziono portalu dostawcy');
    }

    const portalSessionsDir = path.join(config.SESSIONS_DIR, id);
    await fs.promises.mkdir(portalSessionsDir, { recursive: true });
    const sessionFilePath = path.join(portalSessionsDir, `${id}.json`);

    let defaultDomain = '';
    try {
      const providerDef = providerRegistry.get(existing.providerId);
      if (providerDef?.loginUrl && !providerDef.loginUrl.startsWith('mock://')) {
        defaultDomain = '.' + new URL(providerDef.loginUrl).hostname.replace(/^www\./, '');
      }
    } catch {}

    let finalState: any = sessionData;
    if (typeof sessionData === 'string') {
      try {
        finalState = JSON.parse(sessionData.trim());
      } catch {
        // Fallback: parse raw Cookie header string "name1=val1; name2=val2"
        const pairs = sessionData.split(';').map(p => p.trim()).filter(Boolean);
        const cookies = pairs.map(p => {
          const idx = p.indexOf('=');
          if (idx === -1) return null;
          return {
            name: p.substring(0, idx).trim(),
            value: p.substring(idx + 1).trim(),
            domain: defaultDomain || '',
            path: '/',
            expires: -1,
            httpOnly: false,
            secure: true,
            sameSite: 'Lax',
          };
        }).filter(Boolean);
        finalState = { cookies, origins: [] };
      }
    }

    // Convert array of cookies (from Cookie-Editor export) to Playwright storageState format
    if (Array.isArray(finalState)) {
      finalState = {
        cookies: finalState.map((c: any) => ({
          name: c.name,
          value: c.value,
          domain: c.domain || defaultDomain || '',
          path: c.path || '/',
          expires: typeof c.expirationDate === 'number' ? c.expirationDate : (c.expires || -1),
          httpOnly: Boolean(c.httpOnly),
          secure: c.secure !== undefined ? Boolean(c.secure) : true,
          sameSite: c.sameSite === 'no_restriction' ? 'None' : (c.sameSite === 'strict' ? 'Strict' : 'Lax'),
        })),
        origins: [],
      };
    }

    if (!finalState?.cookies || !Array.isArray(finalState.cookies)) {
      throw new Error('Nieprawidłowy format danych sesji (wymagana tablica ciasteczek lub obiekt storageState).');
    }

    await fs.promises.writeFile(sessionFilePath, JSON.stringify(finalState, null, 2), 'utf-8');

    await prisma.portal.update({
      where: { id },
      data: {
        sessionStatePath: sessionFilePath,
        lastSyncStatus: 'IDLE',
        lastSyncMessage: 'Zaimportowano aktywną sesję ręcznie.',
      },
    });
  }

  public static async deletePortal(id: string): Promise<void> {
    const existing = await prisma.portal.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Nie znaleziono portalu dostawcy');
    }

    await prisma.portal.delete({ where: { id } });

    // Clean up stored invoices and session data for this portal from disk
    const portalInvoicesDir = path.join(config.INVOICES_DIR, id);
    const portalSessionsDir = path.join(config.SESSIONS_DIR, id);
    await fs.promises.rm(portalInvoicesDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(portalSessionsDir, { recursive: true, force: true }).catch(() => {});
  }

  public static async duplicatePortal(id: string, data?: DuplicatePortalRequest): Promise<PortalDto> {
    const existing = await prisma.portal.findUnique({
      where: { id },
      include: {
        groups: true,
      },
    });

    if (!existing) {
      throw new NotFoundError('Nie znaleziono portalu dostawcy');
    }

    const name = data?.name?.trim() ? data.name.trim() : `${existing.name} (kopia)`;
    if (!name || name.length < 2) {
      throw new BadRequestError('Nazwa dostawcy musi mieć co najmniej 2 znaki');
    }

    const isEnabled = data?.isEnabled !== undefined ? data.isEnabled : existing.isEnabled;
    const agreementFilter = data?.agreementFilter !== undefined
      ? (data.agreementFilter ? data.agreementFilter.trim() : null)
      : existing.agreementFilter;

    const groupIds = data?.groupIds !== undefined
      ? Array.from(new Set(data.groupIds))
      : existing.groups.map((g) => g.groupId);

    const syncFrequency = data?.syncFrequency !== undefined
      ? Number(data.syncFrequency)
      : (existing.syncFrequency ?? 1);

    // Decrypt and re-encrypt with a fresh IV so that each portal has unique encryption
    let encryptedPass = existing.encryptedPass;
    try {
      const plainPass = CryptoService.decrypt(existing.encryptedPass);
      encryptedPass = CryptoService.encrypt(plainPass);
    } catch {
      // Keep existing encrypted pass if decrypt fails
    }

    const portal = await prisma.portal.create({
      data: {
        name,
        providerId: existing.providerId,
        login: existing.login,
        encryptedPass,
        isEnabled,
        isMailScript: existing.isMailScript,
        senderFilter: data?.senderFilter !== undefined ? data.senderFilter : existing.senderFilter,
        titleFilter: data?.titleFilter !== undefined ? data.titleFilter : existing.titleFilter,
        customCategory: (data as any)?.category !== undefined ? (data as any).category : existing.customCategory,
        agreementFilter,
        syncFrequency,
        lastSyncStatus: 'IDLE',
        groups: {
          create: groupIds.map((groupId) => ({
            group: { connect: { id: groupId } },
          })),
        },
      },
      include: {
        provider: true,
        groups: {
          include: {
            group: {
              select: { id: true, name: true },
            },
          },
        },
        _count: {
          select: { bills: true },
        },
      },
    });

    return this.mapPortalToDto(portal);
  }

  /**
   * Returns all portals belonging to any group the user is assigned to.
   */
  public static async getPortalsForUser(userId: string): Promise<PortalDto[]> {
    const userGroups = await prisma.userGroup.findMany({
      where: { userId },
      select: { groupId: true },
    });

    if (userGroups.length === 0) {
      return [];
    }

    const groupIds = userGroups.map((ug) => ug.groupId);

    const portals = await prisma.portal.findMany({
      where: {
        groups: {
          some: {
            groupId: { in: groupIds },
          },
        },
        isEnabled: true,
      },
      include: {
        provider: true,
        groups: {
          where: {
            groupId: { in: groupIds },
          },
          include: {
            group: {
              select: { id: true, name: true },
            },
          },
        },
        _count: {
          select: { bills: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return portals.map((p) => this.mapPortalToDto(p));
  }
}
