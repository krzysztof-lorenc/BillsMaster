import { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../lib/api.js';
import type { 
  WsServerEvent, 
  WsSyncProgressEvent, 
  WsSyncCompletedEvent,
  SyncErrorDetails,
  ActiveSyncResponse 
} from '@bills-master/shared-types';

export interface ActiveSyncState {
  jobId: string;
  portalId?: string;
  portalName?: string;
  providerName: string;
  progressPercent: number;
  message: string;
  isComplete?: boolean;
  isFailed?: boolean;
  currentJobIndex?: number;
  totalJobsCount?: number;
  overallProgressPercent?: number;
}

export function useSyncStream(onSyncCompleted?: (payload?: WsSyncCompletedEvent['payload']) => void) {
  const [activeSync, setActiveSync] = useState<ActiveSyncState | null>(null);
  const [lastNotification, setLastNotification] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<SyncErrorDetails | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const dismissTimeoutRef = useRef<any>(null);
  const activeSyncRef = useRef<ActiveSyncState | null>(null);
  activeSyncRef.current = activeSync;

  const onSyncCompletedRef = useRef(onSyncCompleted);
  onSyncCompletedRef.current = onSyncCompleted;

  const clearDismissTimeout = useCallback(() => {
    if (dismissTimeoutRef.current) {
      clearTimeout(dismissTimeoutRef.current);
      dismissTimeoutRef.current = null;
    }
  }, []);

  // Query server for active sync state (used on mount, visibility change, and periodic poll)
  const checkActiveSyncStatus = useCallback(async () => {
    try {
      const res = await api.get<ActiveSyncResponse>('/api/sync/active');

      if (res.active && res.activeSync) {
        clearDismissTimeout();
        const p = res.activeSync;
        setActiveSync({
          jobId: p.jobId,
          portalId: p.portalId,
          portalName: p.portalName,
          providerName: p.providerName || p.portalName,
          progressPercent: p.progressPercent,
          message: p.message,
          isComplete: false,
          currentJobIndex: p.currentJobIndex,
          totalJobsCount: p.totalJobsCount,
          overallProgressPercent: p.overallProgressPercent,
        });
      } else if (activeSyncRef.current && !activeSyncRef.current.isComplete) {
        // Was active locally, but server reports no active sync anymore -> it completed in background
        clearDismissTimeout();
        setActiveSync((prev) =>
          prev
            ? {
                ...prev,
                progressPercent: 100,
                overallProgressPercent: 100,
                message: 'Pobieranie zakończone pomyślnie',
                isComplete: true,
              }
            : null
        );
        api.get<{ error: SyncErrorDetails | null }>('/api/sync/active-error')
          .then((res) => {
            setSyncError(res.error || null);
          })
          .catch(() => {});
        if (onSyncCompletedRef.current) {
          onSyncCompletedRef.current();
        }
        dismissTimeoutRef.current = setTimeout(() => {
          setActiveSync(null);
          dismissTimeoutRef.current = null;
        }, 1500);
      }
    } catch {
      // Ignore network errors during background polling
    }
  }, [clearDismissTimeout]);

  const connect = useCallback(() => {
    // Construct WebSocket URL based on current origin
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/sync-stream`;

    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      // Upon socket opening, verify active sync status immediately
      checkActiveSyncStatus();
    };

    socket.onmessage = (event) => {
      try {
        const data: WsServerEvent | { type: string; payload: any } = JSON.parse(event.data);

        if (data.type === 'SYNC_PROGRESS') {
          clearDismissTimeout();
          const p = (data as WsSyncProgressEvent).payload;
          const isFinished = p.progressPercent >= 100;
          setActiveSync((prev) => ({
            jobId: p.jobId,
            portalId: p.portalId,
            portalName: p.portalName,
            providerName: p.providerName || p.portalName,
            progressPercent: p.progressPercent,
            message: p.message,
            isComplete: isFinished,
            currentJobIndex: p.currentJobIndex ?? prev?.currentJobIndex,
            totalJobsCount: p.totalJobsCount ?? prev?.totalJobsCount,
            overallProgressPercent: p.overallProgressPercent ?? prev?.overallProgressPercent,
          }));

          if (isFinished) {
            if (onSyncCompletedRef.current) {
              onSyncCompletedRef.current();
            }
            dismissTimeoutRef.current = setTimeout(() => {
              setActiveSync(null);
              dismissTimeoutRef.current = null;
            }, 2000);
          }
        } else if (data.type === 'SYNC_COMPLETED') {
          clearDismissTimeout();
          const p = (data as WsSyncCompletedEvent).payload;
          const isFailure = p.status === 'FAILED' || p.status === 'NEEDS_REAUTH';

          if (isFailure) {
            if (p.errorDetails) {
              setSyncError(p.errorDetails);
            }
          } else if (p.status === 'SUCCESS') {
            // Clear banner if this successful sync resolved the portal that failed
            setSyncError((currentErr) => {
              if (currentErr && (currentErr.portalId === p.portalId || !p.portalId)) {
                return null;
              }
              return currentErr;
            });
          }

          setLastNotification(p.message);

          // Check if more jobs are still queued or running for this user
          if (p.hasMoreJobs) {
            // Do NOT close the modal - update state to show progress transition
            setActiveSync((prev) => ({
              jobId: p.jobId,
              portalId: p.portalId,
              portalName: p.portalName,
              providerName: p.portalName || prev?.providerName || 'Dostawcy',
              progressPercent: 100,
              message: isFailure
                ? `Błąd dla ${p.portalName || 'portalu'}. Sprawdzanie kolejnych kont...`
                : `Zsynchronizowano: ${p.portalName || 'konto'}. Sprawdzanie kolejnych kont...`,
              isComplete: false,
              isFailed: false,
              currentJobIndex: p.currentJobIndex ?? prev?.currentJobIndex,
              totalJobsCount: p.totalJobsCount ?? prev?.totalJobsCount,
              overallProgressPercent: p.overallProgressPercent ?? prev?.overallProgressPercent,
            }));

            // Immediately poll server for next active job info
            checkActiveSyncStatus();

            if (onSyncCompletedRef.current) {
              onSyncCompletedRef.current(p);
            }
          } else {
            // All sync jobs for user have completed
            setActiveSync((prev) =>
              prev
                ? {
                    ...prev,
                    progressPercent: 100,
                    overallProgressPercent: 100,
                    message: p.message,
                    isComplete: true,
                    isFailed: isFailure,
                  }
                : null
            );

            if (onSyncCompletedRef.current) {
              onSyncCompletedRef.current(p);
            }

            // Clear modal after brief transition
            dismissTimeoutRef.current = setTimeout(() => {
              setActiveSync(null);
              dismissTimeoutRef.current = null;
            }, 1500);
          }
        }
      } catch (e) {
        console.error('Error parsing WS message:', e);
      }
    };

    socket.onclose = (e) => {
      if (e.code !== 1000 && e.code !== 4001) {
        // Reconnect after 3 seconds if unexpected disconnect
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      }
    };

    socket.onerror = () => {
      socket.close();
    };
  }, [checkActiveSyncStatus, clearDismissTimeout]);

  // Connect on mount
  useEffect(() => {
    connect();
    checkActiveSyncStatus();

    // Check active status when tab becomes visible or user unlocks phone
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkActiveSyncStatus();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearDismissTimeout();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) wsRef.current.close(1000);
    };
  }, [connect, checkActiveSyncStatus, clearDismissTimeout]);

  // Polling fallback: while activeSync is in progress, poll every 2.5s to prevent desync on mobile
  useEffect(() => {
    if (!activeSync || activeSync.isComplete) return;

    const interval = setInterval(() => {
      checkActiveSyncStatus();
    }, 2500);

    return () => clearInterval(interval);
  }, [activeSync, checkActiveSyncStatus]);

  return { 
    activeSync, 
    setActiveSync, 
    lastNotification, 
    syncError, 
    setSyncError, 
    checkActiveSyncStatus 
  };
}
