import React, { useEffect, useState } from 'react';
import { 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  Landmark, 
  Zap, 
  Flame,
  Droplets,
  Wifi,
  Building2,
  Layers,
  Play,
  ArrowLeft,
  Tv,
  Smartphone
} from 'lucide-react';
import { api } from '../lib/api.js';
import { formatDate, getCategoryLabel } from '../lib/utils.js';
import { useTheme } from '../context/ThemeContext.js';
import type { PortalDto } from '@bills-master/shared-types';

interface AccountsPageProps {
  onSyncTriggered?: () => void;
  onNavigateBills?: () => void;
}

export const AccountsPage: React.FC<AccountsPageProps> = ({ onSyncTriggered, onNavigateBills }) => {
  const { isLight } = useTheme();
  const [portals, setPortals] = useState<PortalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingPortalId, setSyncingPortalId] = useState<string | null>(null);

  const fetchPortals = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ portals: PortalDto[] }>('/api/portals');
      setPortals(res.portals);
    } catch (err) {
      console.error('Błąd podczas pobierania dostawców:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPortals();
  }, []);

  const handleSyncPortal = async (portalId: string) => {
    setSyncingPortalId(portalId);
    try {
      await api.post(`/api/portals/${portalId}/sync`);
      if (onSyncTriggered) onSyncTriggered();
      await fetchPortals();
    } catch (err: any) {
      alert(err.message || 'Nie udało się uruchomić sprawdzania portalu.');
    } finally {
      setSyncingPortalId(null);
    }
  };

  const getProviderIcon = (category?: string) => {
    const cat = (category || '').toUpperCase();
    switch (cat) {
      case 'ELECTRICITY':
        return <Zap className="w-6 h-6 text-amber-400" />;
      case 'GAS':
        return <Flame className="w-6 h-6 text-orange-400" />;
      case 'WATER':
        return <Droplets className="w-6 h-6 text-sky-400" />;
      case 'INTERNET':
        return <Wifi className="w-6 h-6 text-indigo-400" />;
      case 'TELECOM':
        return <Tv className="w-6 h-6 text-purple-400" />;
      case 'GSM':
        return <Smartphone className="w-6 h-6 text-fuchsia-400" />;
      case 'HOUSING':
        return <Building2 className="w-6 h-6 text-emerald-400" />;
      default:
        return <Landmark className="w-6 h-6 text-blue-400" />;
    }
  };

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'SUCCESS':
        return {
          label: 'Połączono prawidłowo',
          className: isLight
            ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
            : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
          icon: <CheckCircle2 className="w-4 h-4" />,
        };
      case 'RUNNING':
      case 'QUEUED':
        return {
          label: 'Pobieranie w toku...',
          className: isLight
            ? 'bg-blue-50 text-blue-800 border-blue-300 animate-pulse'
            : 'bg-blue-500/20 text-blue-300 border-blue-500/40 animate-pulse',
          icon: <RefreshCw className="w-4 h-4 animate-spin" />,
        };
      case 'NEEDS_REAUTH': {
        return {
          label: 'Wymaga uwagi',
          className: isLight
            ? 'bg-amber-100 text-amber-900 border-amber-400 font-bold'
            : 'bg-amber-500/25 text-amber-200 border-amber-500/60 font-bold',
          icon: <AlertCircle className="w-4 h-4 text-amber-500" />,
        };
      }
      case 'FAILED':
        return {
          label: 'Błąd połączenia',
          className: isLight
            ? 'bg-rose-50 text-rose-800 border-rose-300'
            : 'bg-rose-500/20 text-rose-300 border-rose-500/40',
          icon: <AlertCircle className="w-4 h-4" />,
        };
      default:
        return {
          label: 'Oczekuje',
          className: isLight
            ? 'bg-slate-100 text-slate-700 border-slate-200'
            : 'bg-slate-800 text-slate-400 border-slate-700',
          icon: null,
        };
    }
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Back button */}
      {onNavigateBills && (
        <div>
          <button
            onClick={onNavigateBills}
            className={`inline-flex items-center gap-2.5 px-5 py-3 rounded-2xl ${
              isLight
                ? 'bg-white border-2 border-slate-200 text-slate-700 hover:text-slate-900 hover:border-slate-300 shadow-sm'
                : 'bg-slate-900 border-2 border-slate-800 text-slate-200 hover:text-white hover:border-slate-700 shadow-sm'
            } text-base font-bold transition-all`}
          >
            <ArrowLeft className="w-5 h-5 text-blue-500" />
            <span>Wróć do listy rachunków</span>
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div className={`${isLight ? 'bg-white border-2 border-slate-200 shadow-sm' : 'bg-slate-900/80 border border-slate-800 shadow-xl'} rounded-3xl p-6 sm:p-8 backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-6`}>
        <div>
          <h1 className={`text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight ${isLight ? 'text-slate-900' : 'text-white'} mb-2`}>
            Podłączeni Dostawcy i Liczniki
          </h1>
          <p className={`text-base sm:text-lg ${isLight ? 'text-slate-600' : 'text-slate-300'} max-w-2xl leading-relaxed`}>
            Tutaj sprawdzisz stan połączenia z dostawcami prądu, gazu, wody i czynszu oraz możesz ręcznie wymusić pobranie najnowszych faktur.
          </p>
        </div>

        <button
          onClick={fetchPortals}
          disabled={loading}
          className="inline-flex items-center justify-center gap-3 px-6 py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-base font-bold transition-all shadow-lg shadow-blue-600/30 shrink-0 disabled:opacity-50"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          <span>Odśwież listę</span>
        </button>
      </div>

      {/* Senior Help / Explanation Card */}
      <div className={`${isLight ? 'bg-blue-50 border-2 border-blue-200 text-blue-900 shadow-sm' : 'bg-blue-950/40 border-2 border-blue-800/60 text-slate-200 shadow-lg'} rounded-3xl p-6 flex items-start gap-4`}>
        <div className={`w-12 h-12 rounded-2xl ${isLight ? 'bg-blue-100 text-blue-600 border-blue-200' : 'bg-blue-600/20 text-blue-400 border-blue-500/30'} flex items-center justify-center shrink-0 border`}>
          <Layers className="w-6 h-6" />
        </div>
        <div className="space-y-1 text-base leading-relaxed">
          <span className={`font-bold ${isLight ? 'text-blue-950' : 'text-white'} text-lg block`}>Harmonogram pobierania faktur:</span>
          <p className={isLight ? 'text-blue-900' : 'text-slate-300'}>
            System automatycznie odświeża faktury według skonfigurowanego harmonogramu (standardowo raz na dobę o <strong>3:00 w nocy</strong> lub częściej: 2x, 3x lub 4x na dobę). W każdej chwili możesz również ręcznie pobrać najnowsze dane, wybierając opcję <strong>„Odśwież rachunki”</strong> z menu (ikona z trzema kropkami w prawym górnym rogu) lub klikając przycisk przy wybranym dostawcy poniżej.
          </p>
        </div>
      </div>

      {/* Portals Grid */}
      {loading ? (
        <div className={`py-20 text-center ${isLight ? 'bg-white border-slate-200 shadow-sm' : 'bg-slate-900/40 border-slate-800'} border rounded-3xl`}>
          <RefreshCw className="w-10 h-10 animate-spin text-blue-500 mx-auto" />
          <p className={`text-lg ${isLight ? 'text-slate-700' : 'text-slate-300'} mt-4 font-semibold`}>Wczytywanie listy dostawców...</p>
        </div>
      ) : portals.length === 0 ? (
        <div className={`py-20 text-center ${isLight ? 'bg-white border-slate-200 shadow-sm' : 'bg-slate-900/40 border-slate-800'} border-2 border-dashed rounded-3xl p-8`}>
          <div className="w-16 h-16 rounded-2xl bg-blue-600/15 text-blue-500 flex items-center justify-center mx-auto mb-4">
            <Landmark className="w-8 h-8" />
          </div>
          <h3 className={`text-xl font-bold ${isLight ? 'text-slate-900' : 'text-white'} mb-2`}>Brak przypisanych dostawców</h3>
          <p className={`text-base ${isLight ? 'text-slate-500' : 'text-slate-400'} max-w-md mx-auto`}>
            Do Twojego konta nie przypisano jeszcze żadnych dostawców mediów. Skontaktuj się z administratorem, aby dodać Twoje mieszkanie lub dom do odpowiedniej grupy.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {portals.map((portal) => {
            const statusInfo = getStatusDisplay(portal.lastSyncStatus);
            const categoryLabel = getCategoryLabel(portal.providerCategory);

            return (
              <div
                key={portal.id}
                className={`${
                  isLight
                    ? 'bg-white border-2 border-slate-200 hover:border-slate-300 shadow-md'
                    : 'bg-slate-900/90 border-2 border-slate-800 hover:border-slate-700 shadow-xl'
                } rounded-3xl p-6 sm:p-7 flex flex-col justify-between transition-all`}
              >
                <div>
                  {/* Top: Icon + Name + Status */}
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3.5">
                      <div className={`w-14 h-14 rounded-2xl ${isLight ? 'bg-slate-50 border border-slate-200 shadow-sm' : 'bg-slate-800 border border-slate-700/80 shadow-md'} flex items-center justify-center shrink-0`}>
                        {getProviderIcon(portal.providerCategory)}
                      </div>
                      <div>
                        <h2 className={`text-xl font-bold ${isLight ? 'text-slate-900' : 'text-white'} leading-tight`}>{portal.name}</h2>
                        <span className={`inline-block px-2.5 py-0.5 mt-1 rounded-lg text-xs font-semibold uppercase tracking-wider ${isLight ? 'bg-slate-100 text-slate-600 border border-slate-200' : 'bg-slate-800 text-slate-300'}`}>
                          {portal.providerName || categoryLabel}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Status Pill */}
                  <div className="mb-5">
                    <span
                      className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-sm font-bold border ${statusInfo.className}`}
                    >
                      {statusInfo.icon}
                      <span>{statusInfo.label}</span>
                    </span>
                  </div>

                  {/* Group tags */}
                  {portal.groupNames && portal.groupNames.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {portal.groupNames.map((gName, idx) => (
                        <span
                          key={idx}
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl ${isLight ? 'bg-indigo-50 border border-indigo-200 text-indigo-700' : 'bg-indigo-950/70 border border-indigo-800/50 text-indigo-300'} text-xs font-bold`}
                        >
                          <Layers className="w-3.5 h-3.5" />
                          <span>{gName}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Details block */}
                  <div className={`space-y-2.5 text-sm ${isLight ? 'bg-slate-50 border border-slate-200 text-slate-700' : 'bg-slate-950/80 border border-slate-800 text-slate-300'} p-4 rounded-2xl mb-6`}>
                    <div className="flex justify-between items-center">
                      <span className={`${isLight ? 'text-slate-500' : 'text-slate-400'} font-medium`}>Identyfikator konta:</span>
                      <span className={`font-mono font-bold ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>{portal.loginMasked}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className={`${isLight ? 'text-slate-500' : 'text-slate-400'} font-medium`}>Odświeżanie:</span>
                      <span className={`font-semibold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                        {portal.syncFrequency === 4 ? '4x / dobę (co 6h)' :
                         portal.syncFrequency === 3 ? '3x / dobę (co 8h)' :
                         portal.syncFrequency === 2 ? '2x / dobę (co 12h)' :
                         '1x / dobę (nocne)'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className={`${isLight ? 'text-slate-500' : 'text-slate-400'} font-medium`}>Ostatnie sprawdzenie:</span>
                      <span className={`font-medium ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>{formatDate(portal.lastSyncedAt || '')}</span>
                    </div>
                    {portal.lastSyncMessage && (
                      <div className={`pt-2 border-t ${isLight ? 'border-slate-200 text-slate-600' : 'border-slate-800 text-slate-300'} text-xs font-medium`}>
                        {portal.lastSyncMessage}
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Card Actions */}
                <div className={`pt-4 border-t ${isLight ? 'border-slate-200' : 'border-slate-800'} flex items-center justify-between gap-3`}>
                  <span className={`text-sm font-bold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    {portal.billCount !== undefined
                      ? `${portal.billCount} ${portal.billCount === 1 ? 'faktura' : 'faktur'}`
                      : ''}
                  </span>

                  <button
                    onClick={() => handleSyncPortal(portal.id)}
                    disabled={syncingPortalId === portal.id || portal.lastSyncStatus === 'RUNNING'}
                    className={`inline-flex items-center gap-2 px-5 py-3 rounded-2xl ${
                      portal.lastSyncStatus === 'NEEDS_REAUTH'
                        ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-600/30 ring-2 ring-amber-400/50'
                        : 'bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/30'
                    } text-sm font-bold transition-all disabled:opacity-50`}
                  >
                    <Play className={`w-4 h-4 ${syncingPortalId === portal.id ? 'animate-spin' : ''}`} />
                    <span>
                      {syncingPortalId === portal.id
                        ? 'Pobieranie...'
                        : portal.lastSyncStatus === 'NEEDS_REAUTH'
                        ? 'Wymaga logowania'
                        : 'Sprawdź teraz'}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
