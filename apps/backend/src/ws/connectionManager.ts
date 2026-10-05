import type { WebSocket } from 'ws';
import type { WsServerEvent, ActiveSyncDto } from '@bills-master/shared-types';
import { logger } from '../core/logger.js';

export class WsConnectionManager {
  private static instance: WsConnectionManager;
  // Map of userId -> Set of connected WebSockets
  private userSockets = new Map<string, Set<WebSocket>>();
  // Map of portalId -> latest ActiveSyncDto
  private activeSyncs = new Map<string, ActiveSyncDto>();

  private constructor() {}

  public static getInstance(): WsConnectionManager {
    if (!WsConnectionManager.instance) {
      WsConnectionManager.instance = new WsConnectionManager();
    }
    return WsConnectionManager.instance;
  }

  public register(userId: string, socket: WebSocket): void {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(socket);
    logger.debug(`[WS] Client registered for user: ${userId}. Active sockets: ${this.userSockets.get(userId)!.size}`);

    socket.on('close', () => {
      this.unregister(userId, socket);
    });

    socket.on('error', (err: Error) => {
      logger.warn(`[WS] Socket error for user ${userId}:`, err);
      this.unregister(userId, socket);
    });
  }

  public unregister(userId: string, socket: WebSocket): void {
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
      }
    }
    logger.debug(`[WS] Socket removed for user: ${userId}`);
  }

  public setActiveSync(portalId: string, active: ActiveSyncDto): void {
    this.activeSyncs.set(portalId, active);
  }

  public clearActiveSync(portalId: string): void {
    this.activeSyncs.delete(portalId);
  }

  public getActiveSyncForPortalIds(portalIds: string[]): ActiveSyncDto | null {
    for (const portalId of portalIds) {
      const active = this.activeSyncs.get(portalId);
      if (active) return active;
    }
    return null;
  }

  public sendToSocket(socket: WebSocket, event: WsServerEvent | { type: string; payload: any }): void {
    if (socket.readyState === 1) { // WebSocket.OPEN
      try {
        socket.send(JSON.stringify(event));
      } catch (e) {
        logger.error('[WS] Error sending event directly to socket:', e);
      }
    }
  }

  public broadcastToAll(event: WsServerEvent): void {
    const data = JSON.stringify(event);
    for (const [userId, sockets] of this.userSockets.entries()) {
      for (const socket of sockets) {
        if (socket.readyState === 1) { // WebSocket.OPEN
          try {
            socket.send(data);
          } catch (e) {
            logger.error(`[WS] Error broadcasting event to user ${userId}:`, e);
          }
        }
      }
    }
  }

  public broadcastToUser(userId: string, event: WsServerEvent): void {
    if (event.type === 'SYNC_PROGRESS') {
      const p = event.payload;
      this.activeSyncs.set(p.portalId, {
        jobId: p.jobId,
        portalId: p.portalId,
        portalName: p.portalName,
        providerId: p.providerId,
        providerName: p.providerName,
        status: p.status,
        progressPercent: p.progressPercent,
        message: p.message,
        startedAt: this.activeSyncs.get(p.portalId)?.startedAt || new Date().toISOString(),
        currentJobIndex: p.currentJobIndex,
        totalJobsCount: p.totalJobsCount,
        overallProgressPercent: p.overallProgressPercent,
      });
    } else if (event.type === 'SYNC_COMPLETED') {
      this.activeSyncs.delete(event.payload.portalId);
    }

    const sockets = this.userSockets.get(userId);
    if (!sockets || sockets.size === 0) return;

    const data = JSON.stringify(event);
    for (const socket of sockets) {
      if (socket.readyState === 1) { // WebSocket.OPEN
        try {
          socket.send(data);
        } catch (e) {
          logger.error(`[WS] Error sending event to user ${userId}:`, e);
        }
      }
    }
  }
}

export const wsConnectionManager = WsConnectionManager.getInstance();
