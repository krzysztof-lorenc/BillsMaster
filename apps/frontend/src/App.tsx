import React, { useState, useEffect } from 'react';
import { useAuth } from './context/AuthContext.js';
import { Navbar } from './components/layout/Navbar.js';
import { SetupAdminPage } from './pages/SetupAdminPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { BillsHistoryPage } from './pages/BillsHistoryPage.js';
import { AccountsPage } from './pages/AccountsPage.js';
import { AdminUsersPage } from './pages/AdminUsersPage.js';
import { AdminGroupsPage } from './pages/AdminGroupsPage.js';
import { AdminPortalsPage } from './pages/AdminPortalsPage.js';
import { AdminGoogleScriptPage } from './pages/AdminGoogleScriptPage.js';
import { useSyncStream } from './hooks/useSyncStream.js';
import { SyncErrorBanner } from './components/common/SyncErrorBanner.js';
import { NightlyRefreshBanner } from './components/common/NightlyRefreshBanner.js';
import { FullScreenSyncModal } from './components/common/FullScreenSyncModal.js';
import { api } from './lib/api.js';
import { RefreshCw } from 'lucide-react';
import type { SyncErrorDetails } from '@bills-master/shared-types';

export const App: React.FC = () => {
  const { user, isLoading, isConfigured } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  // Default tab based on role
  const [currentTab, setCurrentTab] = useState<string>('bills');
  const [isSyncing, setIsSyncing] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Synchronize tab with user role whenever user changes
  useEffect(() => {
    if (user) {
      if (user.role === 'ADMIN') {
        if (currentTab !== 'users' && currentTab !== 'groups' && currentTab !== 'portals' && currentTab !== 'mail-script') {
          setCurrentTab('users');
        }
      } else {
        if (currentTab !== 'bills' && currentTab !== 'accounts') {
          setCurrentTab('bills');
        }
      }
    }
  }, [user, currentTab]);

  // Hook into live sync WebSocket updates
  const { 
    activeSync, 
    setActiveSync, 
    syncError, 
    setSyncError, 
    checkActiveSyncStatus 
  } = useSyncStream(() => {
    setRefreshTrigger((prev) => prev + 1);
  });

  // Fetch active sync error on initial mount and when refresh occurs
  useEffect(() => {
    if (user) {
      api.get<{ error: SyncErrorDetails | null }>('/api/sync/active-error')
        .then((res) => {
          setSyncError(res.error || null);
        })
        .catch((err) => {
          console.error('Błąd pobierania błędu synchronizacji:', err);
        });
    }
  }, [user, isAdmin, refreshTrigger, setSyncError]);

  const handleRetrySync = async () => {
    if (syncError?.portalId) {
      setIsSyncing(true);
      try {
        if (isAdmin) {
          await api.post(`/api/admin/portals/${syncError.portalId}/sync`);
        } else {
          await api.post(`/api/sync/${syncError.portalId}`);
        }
        await checkActiveSyncStatus();
      } catch {
        await handleManualSyncAll();
      } finally {
        setIsSyncing(false);
      }
    } else {
      await handleManualSyncAll();
    }
  };

  const handleManualSyncAll = async () => {
    if (isAdmin) {
      setIsSyncing(true);
      try {
        const res = await api.post<{ message: string; jobs: any[] }>('/api/admin/portals/sync-all');
        alert(res.message || 'Uruchomiono synchronizację wszystkich portali.');
        setRefreshTrigger((prev) => prev + 1);
      } catch (err: any) {
        alert(err.message || 'Nie udało się uruchomić synchronizacji.');
      } finally {
        setIsSyncing(false);
      }
      return;
    }
    setIsSyncing(true);
    // Immediately set activeSync state so the wait dialog appears immediately and never closes prematurely
    setActiveSync({
      jobId: 'manual-init',
      providerName: 'Wszyscy dostawcy',
      progressPercent: 5,
      message: 'Inicjalizowanie bezpiecznego połączenia z serwisem...',
      isComplete: false,
    });
    try {
      const res = await api.post<{ message: string; jobs: any[]; activeSync?: any }>('/api/sync/all');
      if (!res.jobs || res.jobs.length === 0) {
        setActiveSync(null);
        setIsSyncing(false);
        alert('Brak aktywnych kont dostawców do zsynchronizowania.');
        return;
      }
      if (res.activeSync) {
        setActiveSync({
          jobId: res.activeSync.jobId,
          portalId: res.activeSync.portalId,
          portalName: res.activeSync.portalName,
          providerName: res.activeSync.providerName || res.activeSync.portalName,
          progressPercent: res.activeSync.progressPercent,
          message: res.activeSync.message,
          isComplete: false,
          currentJobIndex: res.activeSync.currentJobIndex || 1,
          totalJobsCount: res.activeSync.totalJobsCount || res.jobs.length,
          overallProgressPercent: res.activeSync.overallProgressPercent || Math.round(res.activeSync.progressPercent / res.jobs.length),
        });
      }
      setRefreshTrigger((prev) => prev + 1);
      await checkActiveSyncStatus();
    } catch (err: any) {
      setActiveSync(null);
      alert(err.message || 'Nie udało się pobrać najnowszych rachunków.');
    } finally {
      setIsSyncing(false);
    }
  };


  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-blue-400 gap-4">
        <RefreshCw className="w-10 h-10 animate-spin" />
        <span className="text-base font-semibold text-slate-300">Wczytywanie systemu BillsMaster...</span>
      </div>
    );
  }

  // If system has no admin configured yet, present First-Run Setup Wizard
  if (isConfigured === false) {
    return <SetupAdminPage />;
  }

  // If not logged in, show Login page
  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* Full-Screen Blocking Data Updating Notification Modal */}
      {(activeSync || isSyncing) && (
        <FullScreenSyncModal
          activeSync={activeSync}
          isSyncingManual={isSyncing}
          onDismiss={() => {
            setIsSyncing(false);
            setActiveSync(null);
          }}
        />
      )}

      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        activeSync={activeSync}
        onManualSyncAll={handleManualSyncAll}
        isSyncing={isSyncing}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Nightly Refresh Status Banner */}
        <NightlyRefreshBanner
          key={`nightly-${refreshTrigger}`}
          onManualSync={handleManualSyncAll}
          isSyncing={isSyncing}
        />

        {/* Permanent Polish Sync Error Banner */}
        {syncError && (
          <SyncErrorBanner
            error={syncError}
            onDismiss={() => setSyncError(null)}
            onRetry={handleRetrySync}
            isRetrying={isSyncing}
          />
        )}

        {isAdmin ? (
          <>
            {currentTab === 'users' && <AdminUsersPage key={refreshTrigger} />}
            {currentTab === 'groups' && <AdminGroupsPage key={refreshTrigger} />}
            {currentTab === 'portals' && (
              <AdminPortalsPage 
                key={refreshTrigger} 
                onOpenMailScript={() => setCurrentTab('mail-script')} 
              />
            )}
            {currentTab === 'mail-script' && (
              <AdminGoogleScriptPage 
                key={refreshTrigger} 
                onNavigatePortals={() => setCurrentTab('portals')} 
              />
            )}
          </>
        ) : (

          <>
            {currentTab === 'bills' && <BillsHistoryPage key={refreshTrigger} />}
            {currentTab === 'accounts' && (
              <AccountsPage
                key={refreshTrigger}
                onNavigateBills={() => setCurrentTab('bills')}
                onSyncTriggered={() => {
                  setRefreshTrigger((prev) => prev + 1);
                  checkActiveSyncStatus();
                }}
              />
            )}
          </>
        )}
      </main>

      <footer className="border-t border-slate-900 py-6 text-center text-sm text-slate-400 bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="font-medium text-slate-300">
            BillsMaster — Bezpieczne i przejrzyste zarządzanie rachunkami domowymi
          </span>
          <span className="px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-400">
            {isAdmin ? 'Tryb administratora systemu' : 'Konto użytkownika'}
          </span>
        </div>
      </footer>
    </div>
  );
};
