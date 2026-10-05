import React, { useEffect } from 'react';
import { RefreshCw, CheckCircle2, Zap, AlertCircle } from 'lucide-react';
import type { ActiveSyncState } from '../../hooks/useSyncStream.js';

interface FullScreenSyncModalProps {
  activeSync: ActiveSyncState | null;
  isSyncingManual?: boolean;
  onDismiss?: () => void;
}

export const FullScreenSyncModal: React.FC<FullScreenSyncModalProps> = ({
  activeSync,
  isSyncingManual = false,
  onDismiss,
}) => {
  // Prevent background scrolling and trap interactions
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  const isComplete = activeSync?.isComplete;
  const isFailed = activeSync?.isFailed;
  const progress = isComplete ? 100 : (activeSync?.progressPercent ?? 10);
  
  const currentJobIndex = activeSync?.currentJobIndex ?? 1;
  const totalJobsCount = activeSync?.totalJobsCount ?? 1;
  
  const computedOverall = totalJobsCount > 1
    ? Math.min(100, Math.max(0, Math.round((((currentJobIndex - 1) * 100) + progress) / totalJobsCount)))
    : progress;
  const overallProgress = isComplete ? 100 : (activeSync?.overallProgressPercent ?? computedOverall);

  // Auto dismiss modal when complete or progress reached 100%
  useEffect(() => {
    if ((progress >= 100 || isComplete) && onDismiss) {
      const timer = setTimeout(() => {
        onDismiss();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [progress, isComplete, onDismiss]);

  if (!activeSync && !isSyncingManual) {
    return null;
  }
  const providerName = activeSync?.providerName || activeSync?.portalName || 'Wszyscy dostawcy';
  const stageMessage = activeSync?.message || 'Inicjalizowanie bezpiecznego połączenia z serwisem...';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Aktualizowanie danych rachunków"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-950/90 backdrop-blur-xl select-none animate-in fade-in duration-200"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={`w-full max-w-xl bg-slate-900/95 border-2 rounded-3xl p-6 sm:p-10 shadow-2xl transition-all duration-300 text-center relative backdrop-blur-2xl ${
          isComplete && !isFailed
            ? 'border-emerald-500/60 shadow-emerald-500/20'
            : isFailed
            ? 'border-rose-500/60 shadow-rose-500/20'
            : 'border-blue-500/50 shadow-blue-500/25'
        }`}
      >
        {/* Animated Central Icon Graphic */}
        <div className="relative inline-block mb-6">
          <div
            className={`w-20 h-20 sm:w-24 sm:h-24 rounded-3xl border-2 flex items-center justify-center mx-auto shadow-2xl transition-colors ${
              isComplete && !isFailed
                ? 'bg-emerald-600/20 border-emerald-400 text-emerald-400 shadow-emerald-500/30'
                : isFailed
                ? 'bg-rose-600/20 border-rose-400 text-rose-400 shadow-rose-500/30'
                : 'bg-blue-600/20 border-blue-400 text-blue-400 shadow-blue-500/30 animate-pulse'
            }`}
          >
            {isComplete && !isFailed ? (
              <CheckCircle2 className="w-12 h-12 sm:w-14 sm:h-14 animate-in zoom-in-50 duration-300" />
            ) : isFailed ? (
              <AlertCircle className="w-12 h-12 sm:w-14 sm:h-14 text-rose-400" />
            ) : (
              <RefreshCw className="w-10 h-10 sm:w-12 sm:h-12 animate-spin text-blue-400" />
            )}
          </div>

          {/* Live Ping Indicator for Multi-device Coordination */}
          {!isComplete && (
            <span
              className="absolute -top-1.5 -right-1.5 flex h-4 w-4"
              title="Aktywny strumień WebSocket / Polling"
            >
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-blue-400" />
              <span className="relative inline-flex rounded-full h-4 w-4 border-2 border-slate-900 bg-blue-500" />
            </span>
          )}
        </div>

        {/* Title Heading */}
        <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight mb-2">
          {isComplete && !isFailed
            ? 'Pobieranie zakończone!'
            : isFailed
            ? 'Błąd aktualizacji'
            : 'Aktualizowanie danych rachunków'}
        </h2>

        {/* Provider / Portal Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-950 border border-slate-800 text-blue-300 font-bold text-xs sm:text-sm mb-4 shadow-sm">
          <Zap className="w-4 h-4 text-blue-400 shrink-0" />
          <span className="truncate max-w-xs">{providerName}</span>
        </div>

        {/* Detailed Stage Message */}
        <div className="min-h-[3.25rem] flex items-center justify-center px-4 mb-6">
          <p className="text-base sm:text-lg text-slate-200 font-medium leading-snug">
            {stageMessage}
          </p>
        </div>

        {/* Progress Bars Section */}
        <div className="space-y-4 mb-6">
          {/* 1. Overall Progress Bar */}
          <div className="space-y-1.5 p-3.5 sm:p-4 rounded-2xl bg-slate-950/70 border border-slate-800 text-left">
            <div className="flex items-center justify-between text-xs font-bold text-slate-300 uppercase tracking-wider">
              <div className="flex items-center gap-2">
                <span>Postęp całkowity</span>
                {totalJobsCount > 1 && (
                  <span className="text-[11px] font-semibold text-blue-300 bg-blue-950/80 border border-blue-800/80 px-2 py-0.5 rounded-full normal-case">
                    Dostawca {currentJobIndex} z {totalJobsCount}
                  </span>
                )}
              </div>
              <span className="font-mono text-base font-extrabold text-blue-400">
                {overallProgress}%
              </span>
            </div>

            <div className="w-full h-3.5 sm:h-4 bg-slate-900 rounded-full overflow-hidden border border-slate-700/80 p-0.5 shadow-inner">
              <div
                className={`h-full rounded-full transition-all duration-300 shadow-md ${
                  isComplete && !isFailed
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                    : isFailed
                    ? 'bg-gradient-to-r from-rose-500 to-amber-500'
                    : 'bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-400'
                }`}
                style={{ width: `${overallProgress}%` }}
              />
            </div>
          </div>

          {/* 2. Current Operation Progress Bar */}
          <div className="space-y-1.5 p-3.5 sm:p-4 rounded-2xl bg-slate-950/40 border border-slate-800/60 text-left">
            <div className="flex items-center justify-between text-xs font-bold text-slate-400 uppercase tracking-wider">
              <span className="truncate pr-2">
                Bieżący etap: {providerName}
              </span>
              <span className="font-mono text-sm sm:text-base font-extrabold text-cyan-400">
                {progress}%
              </span>
            </div>

            <div className="w-full h-2.5 sm:h-3 bg-slate-900 rounded-full overflow-hidden border border-slate-800 p-0.5 shadow-inner">
              <div
                className={`h-full rounded-full transition-all duration-300 shadow-md ${
                  isComplete && !isFailed
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                    : isFailed
                    ? 'bg-gradient-to-r from-rose-500 to-amber-500'
                    : 'bg-gradient-to-r from-blue-600 via-indigo-500 to-emerald-400'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        {/* Close button only when completed or failed (cancel is never visible) */}
        {onDismiss && (isComplete || progress >= 100 || isFailed) && (
          <div className="mt-6 pt-4 border-t border-slate-800/80">
            <button
              onClick={onDismiss}
              className={`w-full sm:w-auto px-6 py-2.5 rounded-xl font-bold text-sm transition-all shadow-lg ${
                isFailed
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
              }`}
            >
              Zamknij okno
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
