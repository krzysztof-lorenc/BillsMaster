import React, { useState } from 'react';
import { 
  Bell, 
  BellRing, 
  Smartphone, 
  Send, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  ShieldCheck, 
  Info 
} from 'lucide-react';
import { usePushNotifications } from '../../hooks/usePushNotifications.js';

interface NotificationSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationSettingsModal: React.FC<NotificationSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    error,
    statusData,
    subscribe,
    unsubscribe,
    sendTestNotification,
  } = usePushNotifications();

  const [testSuccessMessage, setTestSuccessMessage] = useState<string | null>(null);
  const [testSending, setTestSending] = useState(false);

  if (!isOpen) return null;

  const handleToggle = async () => {
    setTestSuccessMessage(null);
    if (isSubscribed) {
      await unsubscribe();
    } else {
      await subscribe();
    }
  };

  const handleTestNotification = async () => {
    try {
      setTestSending(true);
      setTestSuccessMessage(null);
      const res = await sendTestNotification();
      if (res.success) {
        setTestSuccessMessage(res.message);
      }
    } catch {
      // error is handled by hook
    } finally {
      setTestSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="w-full max-w-lg bg-slate-900 border-2 border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-2xl ${isSubscribed ? 'bg-indigo-600/20 text-indigo-400' : 'bg-slate-800 text-slate-400'}`}>
              {isSubscribed ? <BellRing className="w-6 h-6" /> : <Bell className="w-6 h-6" />}
            </div>
            <div>
              <h2 id="modal-title" className="text-lg font-bold text-white leading-tight">
                Powiadomienia na telefon (Android / PWA)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Otrzymuj alerty o rachunkach w systemie operacyjnym
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
            aria-label="Zamknij"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Browser Support Check */}
          {!isSupported ? (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Brak obsługi Web Push</p>
                <p className="text-xs text-amber-200/80 mt-1">
                  Twoja przeglądarka lub środowisko nie wspiera powiadomień Push API. Na Androidzie skorzystaj z przeglądarki Chrome, Samsung Internet lub Firefox.
                </p>
              </div>
            </div>
          ) : permission === 'denied' ? (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Powiadomienia zablokowane w przeglądarce</p>
                <p className="text-xs text-rose-200/80 mt-1">
                  Dostęp do powiadomień został wcześniej zablokowany. Aby je odblokować, kliknij ikonę kłódki/ustawień obok paska adresu i włącz opcję „Powiadomienia”.
                </p>
              </div>
            </div>
          ) : null}

          {/* Error Message */}
          {error && (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Test Success Message */}
          {testSuccessMessage && (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{testSuccessMessage}</span>
            </div>
          )}

          {/* Main Toggle Box */}
          <div className="p-5 rounded-3xl bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-bold text-white">
                  Powiadomienia na tym urządzeniu
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                {isSubscribed
                  ? 'Urządzenie jest aktywne i zarejestrowane do odbierania alertów.'
                  : 'Włącz, aby otrzymywać powiadomienia o rachunkach w tle na Androidzie.'}
              </p>
              {statusData && (
                <p className="text-[11px] text-slate-500 font-mono mt-1">
                  Aktywne subskrypcje konta: {statusData.activeSubscriptionsCount}
                </p>
              )}
            </div>

            <button
              onClick={handleToggle}
              disabled={isLoading || !isSupported || permission === 'denied'}
              className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                isSubscribed ? 'bg-indigo-600' : 'bg-slate-700'
              }`}
              role="switch"
              aria-checked={isSubscribed}
            >
              <span
                className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  isSubscribed ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Action: Send Test Notification */}
          {isSubscribed && (
            <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-700/60 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-slate-200">Sprawdź działanie na telefonie</p>
                <p className="text-[11px] text-slate-400">Wyślij natychmiastowe powiadomienie testowe</p>
              </div>
              <button
                onClick={handleTestNotification}
                disabled={testSending || isLoading}
                className="inline-flex items-center gap-2 px-3.5 py-2 bg-indigo-600/20 text-indigo-300 hover:text-white hover:bg-indigo-600/40 border border-indigo-500/40 rounded-xl text-xs font-semibold transition-all shadow-sm focus:outline-none disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{testSending ? 'Wysyłanie...' : 'Wyślij test'}</span>
              </button>
            </div>
          )}

          {/* Schedule & Rules Information */}
          <div className="space-y-2 text-xs text-slate-400">
            <div className="flex items-center gap-2 font-semibold text-slate-300">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Zasady wysyłki powiadomień:</span>
            </div>
            <ul className="space-y-1.5 pl-6 list-disc text-slate-400">
              <li>
                <strong className="text-slate-300">Maksymalnie 1 powiadomienie na zdarzenie dziennie:</strong> Zbiorcze podsumowanie wysyłane codziennie o <span className="text-indigo-400 font-semibold">08:30 rano</span>.
              </li>
              <li>
                <strong className="text-slate-300">Zdarzenia:</strong> Nowe faktury, płatności w ciągu 3 dni, faktury po terminie.
              </li>
              <li>
                <strong className="text-slate-300">Konfiguracja per dostawca:</strong> Możesz decydować, które zdarzenia są aktywne dla każdego portalu w ustawieniach dostawców.
              </li>
            </ul>
          </div>

          {/* Android PWA Tip */}
          <div className="p-4 rounded-2xl bg-indigo-950/30 border border-indigo-800/40 text-xs text-indigo-300/90 flex items-start gap-3">
            <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-semibold text-indigo-200">Wskazówka dla Androida:</span> Zainstaluj aplikację BillsMaster na ekranie głównym (PWA). Powiadomienia będą wtedy działać w tle ze standardową ikoną, dźwiękiem i wibracją systemu Android.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-sm font-semibold transition-colors border border-slate-700"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
};
