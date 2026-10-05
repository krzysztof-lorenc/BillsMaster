import React, { useEffect, useState } from 'react';
import { AlertTriangle, Moon, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/utils.js';
import { useTheme } from '../../context/ThemeContext.js';
import type { NightlyRefreshStatusDto } from '@bills-master/shared-types';

interface NightlyRefreshBannerProps {
  onManualSync?: () => void;
  isSyncing?: boolean;
}

export const NightlyRefreshBanner: React.FC<NightlyRefreshBannerProps> = ({
  onManualSync,
  isSyncing = false,
}) => {
  const { isLight } = useTheme();
  const [status, setStatus] = useState<NightlyRefreshStatusDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);

  const fetchStatus = async (showSpinner = false) => {
    if (showSpinner) setIsRefreshingStatus(true);
    try {
      const res = await api.get<NightlyRefreshStatusDto>('/api/sync/nightly-status');
      setStatus(res);
    } catch (err) {
      console.error('Nie udało się pobrać statusu nocnej synchronizacji:', err);
    } finally {
      setLoading(false);
      if (showSpinner) setIsRefreshingStatus(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      fetchStatus();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (loading || !status) {
    return null;
  }

  const { lastNightlyRefreshAt, isOverdue } = status;

  // 1. ALERT STYLE: When last nightly refresh is older than 25 hours (or never occurred)
  if (isOverdue) {
    return (
      <aside
        role="alert"
        aria-live="polite"
        className={`mb-4 px-4 py-2.5 sm:px-5 sm:py-3 rounded-xl border-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm sm:text-base font-medium shadow-md transition-all ${
          isLight
            ? 'bg-amber-100 border-amber-500 text-amber-950'
            : 'bg-amber-950/80 border-amber-500 text-amber-100 shadow-amber-950/30'
        }`}
      >
        <div className="flex items-center gap-3">
          <AlertTriangle className={`w-5 h-5 sm:w-6 sm:h-6 shrink-0 ${isLight ? 'text-amber-800' : 'text-amber-400'} animate-pulse`} />
          <div className="leading-snug">
            <span className="font-bold">Uwaga: </span>
            {lastNightlyRefreshAt ? (
              <span>
                Nocne odświeżenie opóźnione (&gt; 25h). Ostatnie:{' '}
                <strong className={`font-bold ${isLight ? 'text-amber-950 underline' : 'text-white underline'}`}>
                  {formatDateTime(lastNightlyRefreshAt)}
                </strong>
              </span>
            ) : (
              <span className="font-bold">Brak zarejestrowanego nocnego odświeżenia rachunków.</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          {onManualSync && (
            <button
              onClick={onManualSync}
              disabled={isSyncing}
              className={`px-3 py-1.5 sm:px-4 sm:py-1.5 rounded-lg font-bold text-xs sm:text-sm flex items-center gap-2 shadow-sm transition-all disabled:opacity-50 ${
                isLight
                  ? 'bg-amber-700 hover:bg-amber-800 text-white'
                  : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>Odśwież teraz</span>
            </button>
          )}

          <button
            onClick={() => fetchStatus(true)}
            disabled={isRefreshingStatus}
            aria-label="Sprawdź status ponownie"
            title="Sprawdź status ponownie"
            className={`p-1.5 sm:p-2 rounded-lg border transition-colors ${
              isLight
                ? 'bg-white hover:bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-slate-900/60 hover:bg-slate-800 border-amber-600/50 text-amber-200'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isRefreshingStatus ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </aside>
    );
  }

  // 2. NORMAL STYLE: Slim, calm, high-contrast, elderly-friendly status bar
  return (
    <div
      role="status"
      aria-live="polite"
      className={`mb-4 px-4 py-2.5 sm:px-5 sm:py-3 rounded-xl border flex items-center justify-between gap-3 text-sm sm:text-base font-medium shadow-sm transition-all ${
        isLight
          ? 'bg-slate-100 border-slate-300 text-slate-800'
          : 'bg-slate-900/80 border-slate-800 text-slate-200'
      }`}
    >
      <div className="flex items-center gap-3">
        <Moon className={`w-5 h-5 shrink-0 ${isLight ? 'text-blue-700' : 'text-blue-400'}`} />
        <div className="leading-snug">
          <span>Ostatnie nocne odświeżenie: </span>
          <strong className={`font-bold ${isLight ? 'text-slate-950' : 'text-white'}`}>
            {formatDateTime(lastNightlyRefreshAt)}
          </strong>
        </div>
      </div>

      <button
        onClick={() => fetchStatus(true)}
        disabled={isRefreshingStatus}
        aria-label="Odśwież status"
        title="Sprawdź status"
        className={`p-1.5 rounded-lg border transition-colors shrink-0 ${
          isLight
            ? 'bg-white hover:bg-slate-200 border-slate-300 text-slate-700'
            : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
        }`}
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingStatus ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
};
