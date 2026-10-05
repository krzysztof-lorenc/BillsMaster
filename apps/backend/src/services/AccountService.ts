import { PortalService } from './PortalService.js';
import type { UserProviderAccountDto } from '@bills-master/shared-types';

export class AccountService {
  public static async listAccounts(userId: string): Promise<UserProviderAccountDto[]> {
    const portals = await PortalService.getPortalsForUser(userId);
    return portals.map((p) => ({
      id: p.id,
      userId,
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
        name: p.providerName || p.name,
        category: p.providerCategory || ('OTHER' as any),
        loginUrl: '',
        isEnabled: p.isEnabled,
      },
    }));
  }
}
