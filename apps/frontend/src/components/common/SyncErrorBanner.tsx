import React, { useState } from 'react';
import { 
  AlertTriangle, 
  ChevronDown, 
  ChevronUp, 
  Copy, 
  Check, 
  RefreshCw, 
  X, 
  Terminal, 
  ShieldAlert,
  Layers
} from 'lucide-react';
import type { SyncErrorDetails } from '@bills-master/shared-types';

interface SyncErrorBannerProps {
  error: SyncErrorDetails;
  onDismiss?: () => void;
  onRetry?: () => void;
  isRetrying?: boolean;
}

export const SyncErrorBanner: React.FC<SyncErrorBannerProps> = ({
  error,
  onDismiss,
  onRetry,
  isRetrying = false,
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const handleCopyClipboard = async () => {
    const formattedDate = error.timestamp 
      ? new Date(error.timestamp).toLocaleString('pl-PL')
      : new Date().toLocaleString('pl-PL');

    const diagnosticReport = [
      '=======================================================',
      'RAPORT BŁĘDU SYNCHRONIZACJI — BILLSMASTER',
      '=======================================================',
      `Data wystąpienia: ${formattedDate}`,
      `Portal dostawcy: ${error.portalName} (ID: ${error.portalId})`,
      `Etap procesu: ${error.stage || 'Nieokreślony'}`,
      `Tytuł błędu: ${error.errorTitle}`,
      `Opis ogólny: ${error.generalInfo}`,
      `Komunikat błędu (Error text): ${error.errorMessage}`,
      error.jobId ? `Identyfikator zadania (Job ID): ${error.jobId}` : '',
      '',
      '-------------------------------------------------------',
      'STOS WYWOŁAŃ (CALL STACK):',
      '-------------------------------------------------------',
      error.errorStack || 'Brak zarejestrowanego stosu wywołań (call stack).',
      '=======================================================',
    ].filter(Boolean).join('\n');

    try {
      await navigator.clipboard.writeText(diagnosticReport);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 3000);
    } catch {
      alert('Nie udało się automatycznie skopiować błędu. Zaznacz tekst myszką i skopiuj ręcznie.');
    }
  };

  const formattedTimestamp = error.timestamp 
    ? new Date(error.timestamp).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
    : 'Przed chwilą';

  const is2FA = Boolean(
    error.errorTitle?.toLowerCase().includes('2fa') ||
    error.errorTitle?.toLowerCase().includes('autoryzacj') ||
    error.errorMessage?.toLowerCase().includes('2fa') ||
    error.errorMessage?.toLowerCase().includes('reauth') ||
    error.stage?.toLowerCase().includes('2fa')
  );

  return (
    <div 
      role="alert"
      className={`mb-6 rounded-3xl border-2 p-5 sm:p-7 shadow-2xl backdrop-blur-xl relative overflow-hidden transition-all duration-300 ${
        is2FA
          ? 'border-amber-500/70 bg-gradient-to-r from-amber-950/90 via-slate-900/90 to-amber-950/80 shadow-amber-950/40'
          : 'border-rose-600/70 bg-gradient-to-r from-rose-950/90 via-slate-900/90 to-rose-950/80 shadow-rose-950/40'
      }`}
    >
      {/* Decorative background glow */}
      <div className={`absolute top-0 right-0 -mt-8 -mr-8 w-44 h-44 rounded-full blur-3xl pointer-events-none ${
        is2FA ? 'bg-amber-600/15' : 'bg-rose-600/10'
      }`} />

      {/* Main Banner Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          {/* Pulsing Alert Icon */}
          <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl border-2 flex items-center justify-center shrink-0 shadow-lg ${
            is2FA
              ? 'bg-amber-500/20 border-amber-500/50 shadow-amber-900/40'
              : 'bg-rose-500/20 border-rose-500/50 shadow-rose-900/40'
          }`}>
            {is2FA ? (
              <ShieldAlert className="w-7 h-7 sm:w-8 sm:h-8 text-amber-400 animate-pulse" />
            ) : (
              <AlertTriangle className="w-7 h-7 sm:w-8 sm:h-8 text-rose-400 animate-pulse" />
            )}
          </div>

          <div className="space-y-1.5 flex-1">
            {/* Badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-black uppercase tracking-wider border ${
                is2FA
                  ? 'bg-amber-900/70 border-amber-700/70 text-amber-200'
                  : 'bg-rose-900/60 border-rose-700/60 text-rose-200'
              }`}>
                <ShieldAlert className={`w-3.5 h-3.5 ${is2FA ? 'text-amber-400' : 'text-rose-400'}`} />
                {is2FA ? 'Wymagana autoryzacja' : 'Błąd synchronizacji'}
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700">
                <Layers className="w-3 h-3 text-blue-400" />
                {error.portalName}
              </span>
              <span className="text-xs text-slate-400 font-medium">
                Godzina: {formattedTimestamp}
              </span>
            </div>

            {/* General Info in Title (Polish) */}
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight leading-tight">
              {error.errorTitle || 'Problem z odświeżeniem danych z portalu'}
            </h2>

            {/* General Info Explanation */}
            <p className={`text-sm sm:text-base max-w-3xl leading-relaxed ${
              is2FA ? 'text-amber-100/90' : 'text-rose-100/90'
            }`}>
              {error.generalInfo}
            </p>

            {/* Stage Indicator */}
            <div className={`pt-1 flex items-center gap-2 text-xs sm:text-sm font-semibold ${
              is2FA ? 'text-amber-300' : 'text-rose-300'
            }`}>
              <span className="text-slate-400">Etap wystąpienia:</span>
              <span className={`px-2 py-0.5 border rounded-lg font-mono ${
                is2FA
                  ? 'bg-amber-950 border-amber-800/60 text-amber-200'
                  : 'bg-rose-950 border-rose-800/60 text-rose-200'
              }`}>
                {error.stage || 'Przetwarzanie'}
              </span>
            </div>
          </div>
        </div>

        {/* Top Right Dismiss Button */}
        {onDismiss && (
          <button
            onClick={onDismiss}
            title="Ukryj powiadomienie o błędzie"
            className="self-start p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 border border-transparent hover:border-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Action Buttons Row */}
      <div className={`mt-5 pt-4 border-t flex flex-wrap items-center justify-between gap-3 ${
        is2FA ? 'border-amber-900/40' : 'border-rose-900/40'
      }`}>
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Details Toggle Button */}
          <button
            onClick={() => setShowDetails((prev) => !prev)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-sm font-bold transition-colors shadow-sm"
          >
            <Terminal className={`w-4 h-4 ${is2FA ? 'text-amber-400' : 'text-rose-400'}`} />
            <span>{showDetails ? 'Ukryj szczegóły błędu' : 'Pokaż szczegóły techniczne'}</span>
            {showDetails ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {/* Copy to Clipboard Button */}
          <button
            onClick={handleCopyClipboard}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all shadow-sm ${
              isCopied
                ? 'bg-emerald-950 text-emerald-300 border-emerald-700 shadow-emerald-900/20'
                : is2FA
                ? 'bg-amber-900/40 hover:bg-amber-900/60 text-amber-200 border-amber-700/60'
                : 'bg-rose-900/40 hover:bg-rose-900/60 text-rose-200 border-rose-700/60'
            }`}
          >
            {isCopied ? (
              <>
                <Check className="w-4 h-4 text-emerald-400" />
                <span>Skopiowano szczegóły do schowka!</span>
              </>
            ) : (
              <>
                <Copy className={`w-4 h-4 ${is2FA ? 'text-amber-400' : 'text-rose-400'}`} />
                <span>Kopiuj szczegóły do schowka</span>
              </>
            )}
          </button>
        </div>

        {/* Retry / Dismiss Actions */}
        <div className="flex items-center gap-2">
          {onRetry && (
            <button
              onClick={onRetry}
              disabled={isRetrying}
              className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-md disabled:opacity-50 ${
                is2FA
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 shadow-amber-600/30 font-black'
                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/30'
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} />
              <span>
                {isRetrying
                  ? 'Odświeżanie...'
                  : 'Spróbuj ponownie'}
              </span>
            </button>
          )}

          {onDismiss && (
            <button
              onClick={onDismiss}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900/60 hover:bg-slate-800 text-slate-300 text-sm font-semibold border border-slate-700/80 transition-colors"
            >
              <span>Zamknij</span>
            </button>
          )}
        </div>
      </div>

      {/* Collapsible Details Section (Error text + Call stack) */}
      {showDetails && (
        <div className="mt-4 pt-4 border-t border-rose-900/50 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Error Text Box */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-rose-300 mb-1.5 flex items-center gap-1.5">
              <span>Komunikat błędu (Error text):</span>
            </div>
            <div className="p-3.5 bg-slate-950/90 rounded-2xl border border-rose-900/70 font-mono text-sm text-rose-200 break-words select-text">
              {error.errorMessage}
            </div>
          </div>

          {/* Call Stack Box */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-rose-300 mb-1.5 flex items-center justify-between">
              <span>Stos wywołań (Call Stack / Stack Trace):</span>
              <span className="text-slate-400 font-normal text-[11px]">Format diagnostyczny</span>
            </div>
            <pre className="p-4 bg-slate-950/95 rounded-2xl border border-rose-900/60 font-mono text-xs text-rose-200/90 overflow-x-auto max-h-64 leading-relaxed whitespace-pre select-text shadow-inner">
              {error.errorStack || 'Brak zarejestrowanego stosu wywołań (call stack) dla tego błędu.'}
            </pre>
          </div>

          {/* Metadata Footer */}
          <div className="flex flex-wrap items-center justify-between text-xs text-slate-400 pt-1 font-mono">
            <span>Portal ID: {error.portalId}</span>
            {error.jobId && <span>Job ID: {error.jobId}</span>}
            <span>Czas: {new Date(error.timestamp).toISOString()}</span>
          </div>
        </div>
      )}
    </div>
  );
};
