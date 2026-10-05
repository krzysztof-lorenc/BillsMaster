import React, { useEffect, useState } from 'react';
import { 
  Mail, 
  Copy, 
  Check, 
  Download, 
  ExternalLink, 
  RefreshCw, 
  Key, 
  Clock, 
  AlertCircle, 
  CheckCircle2, 
  FileCode, 
  Layers, 
  HelpCircle,
  RotateCcw,
  Sparkles,
  Link,
  ChevronRight,
  Play,
  Globe
} from 'lucide-react';
import { api } from '../lib/api.js';
import type { 
  MailScriptConfigDto, 
  PortalDto 
} from '@bills-master/shared-types';

interface AdminGoogleScriptPageProps {
  onNavigatePortals?: () => void;
}

export const AdminGoogleScriptPage: React.FC<AdminGoogleScriptPageProps> = ({ onNavigatePortals }) => {
  const [config, setConfig] = useState<MailScriptConfigDto | null>(null);
  const [mailPortals, setMailPortals] = useState<PortalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [triggeringRemote, setTriggeringRemote] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [endpointUrlInput, setEndpointUrlInput] = useState('');
  const [gasWebAppUrlInput, setGasWebAppUrlInput] = useState('');
  const [isCustomizingUrl, setIsCustomizingUrl] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const [configRes, portalsRes] = await Promise.all([
        api.get<{ config: MailScriptConfigDto }>('/api/admin/mail-script/config'),
        api.get<{ portals: PortalDto[] }>('/api/admin/portals'),
      ]);
      let currentCfg = configRes.config;

      // Auto-sync endpointUrl with window.location.origin if it still had custom-domain.local or example.com placeholder
      if (currentCfg.endpointUrl.includes('custom-domain.local') || currentCfg.endpointUrl.includes('example.com')) {
        const autoUrl = `${window.location.origin}/api/mail-script/ingest`;
        const updated = await api.put<{ config: MailScriptConfigDto }>('/api/admin/mail-script/config', {
          endpointUrl: autoUrl,
        });
        currentCfg = updated.config;
      }

      setConfig(currentCfg);
      setEndpointUrlInput(currentCfg.endpointUrl);
      setGasWebAppUrlInput(currentCfg.gasWebAppUrl || '');
      setMailPortals(portalsRes.portals.filter((p) => p.isMailScript || p.providerId === 'mail-script'));
    } catch (err: any) {
      console.error('Błąd pobierania konfiguracji Google Script:', err);
      setStatusMessage({ text: err.message || 'Nie udało się pobrać konfiguracji', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleSaveEndpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!endpointUrlInput.trim()) return;
    setSaving(true);
    setStatusMessage(null);
    try {
      const res = await api.put<{ config: MailScriptConfigDto }>('/api/admin/mail-script/config', {
        endpointUrl: endpointUrlInput.trim(),
      });
      setConfig(res.config);
      setStatusMessage({ text: 'Zapisano nowy adres endpointu URL!', type: 'success' });
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Nie udało się zapisać adresu URL', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveGasUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMessage(null);
    try {
      const res = await api.put<{ config: MailScriptConfigDto }>('/api/admin/mail-script/config', {
        gasWebAppUrl: gasWebAppUrlInput.trim() || null,
      });
      setConfig(res.config);
      setStatusMessage({ text: 'Zapisano adres URL wdrożenia Google Apps Script!', type: 'success' });
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Nie udało się zapisać adresu URL wdrożenia', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleTriggerRemoteSync = async () => {
    setTriggeringRemote(true);
    setStatusMessage(null);
    try {
      const res = await api.post<{ success: boolean; message: string; processedCount?: number }>('/api/admin/mail-script/trigger-remote');
      setStatusMessage({
        text: `Wywołano pomyślnie Google Apps Script! ${res.message || ''}`,
        type: 'success',
      });
      await fetchConfig();
    } catch (err: any) {
      setStatusMessage({
        text: err.message || 'Błąd podczas zdalnego wywoływania Google Apps Script',
        type: 'error',
      });
    } finally {
      setTriggeringRemote(false);
    }
  };

  const handleRegenerateToken = async () => {
    if (!confirm('Czy na pewno chcesz wygenerować nowy token autoryzacyjny? Poprzedni skrypt w Google Apps Script przestanie działać, dopóki nie zaktualizujesz w nim tokenu.')) {
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    try {
      const res = await api.put<{ config: MailScriptConfigDto }>('/api/admin/mail-script/config', {
        regenerateToken: true,
      });
      setConfig(res.config);
      setStatusMessage({ text: 'Wygenerowano nowy token autoryzacyjny!', type: 'success' });
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Nie udało się wygenerować tokenu', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleAcknowledgeUpdate = async () => {
    setSaving(true);
    setStatusMessage(null);
    try {
      const res = await api.put<{ config: MailScriptConfigDto }>('/api/admin/mail-script/config', {
        acknowledgeScriptUpdate: true,
      });
      setConfig(res.config);
      setStatusMessage({ text: 'Oznaczono skrypt jako zaktualizowany!', type: 'success' });
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Błąd zatwierdzania aktualizacji', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleResetLastRun = async () => {
    if (!confirm('Czy na pewno chcesz zresetować datę ostatniego pobrania? Podczas kolejnego uruchomienia skrypt pobierze wszystkie faktury z ostatnich 12 miesięcy.')) {
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    try {
      const res = await api.put<{ config: MailScriptConfigDto }>('/api/admin/mail-script/config', {
        resetLastRunDate: true,
      });
      setConfig(res.config);
      setStatusMessage({ text: 'Zresetowano datę ostatniego pobrania. Kolejne uruchomienie pobierze 12 miesięcy.', type: 'success' });
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Błąd resetowania daty', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = (text: string, setCopiedState: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setCopiedState(true);
    setTimeout(() => setCopiedState(false), 2500);
  };

  const handleDownloadScript = () => {
    if (!config?.scriptCode) return;
    const blob = new Blob([config.scriptCode], { type: 'text/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'BillsMaster_Gmail_Sync.gs';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
        <span className="font-semibold text-sm">Ładowanie konfiguracji Google Script...</span>
      </div>
    );
  }

  const scriptNeedsUpdate = config?.scriptNeedsUpdate ?? false;

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
            <Mail className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-2">
              Poczta przez Google Script
              <span className="text-xs px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold">
                Google Apps Script
              </span>
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Automatyczne pobieranie faktur PDF z Twojej skrzynki Gmail bez konieczności podawania hasła do poczty.
            </p>
          </div>
        </div>

        {onNavigatePortals && (
          <button
            onClick={onNavigatePortals}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-sm font-semibold transition-colors border border-slate-700"
          >
            <Layers className="w-4 h-4 text-indigo-400" />
            <span>Zarządzaj portalami</span>
          </button>
        )}
      </div>

      {/* Global Status Message */}
      {statusMessage && (
        <div
          className={`p-4 rounded-2xl border text-sm font-semibold flex items-center justify-between gap-3 ${
            statusMessage.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-xs opacity-70 hover:opacity-100 uppercase tracking-wider"
          >
            Zamknij
          </button>
        </div>
      )}

      {/* Update Required Warning Banner */}
      {scriptNeedsUpdate && (
        <div className="bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-transparent border-2 border-amber-500/40 rounded-3xl p-5 sm:p-6 shadow-xl shadow-amber-500/5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3.5">
              <div className="p-3 rounded-2xl bg-amber-500/20 text-amber-300 shrink-0">
                <AlertCircle className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-amber-200">
                  Wymagana aktualizacja kodu w Google Apps Script!
                </h3>
                <p className="text-sm text-slate-300 mt-0.5">
                  Wykryto zmiany w konfiguracji portali pocztowych, filtrach regex lub adresie endpointu.
                  Skopiuj poniższy wygenerowany kod i wklej go do swojego projektu w Google Apps Script, aby zsynchronizować nowe reguły.
                </p>
              </div>
            </div>

            <button
              onClick={handleAcknowledgeUpdate}
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-2xl text-sm transition-all shadow-lg shadow-amber-500/20 shrink-0 disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>Oznacz jako zaktualizowany</span>
            </button>
          </div>
        </div>
      )}

      {/* 2-Columns Grid: Settings & Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 cols): Endpoint & Security Settings */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6">
            <div className="flex items-center gap-3 border-b border-slate-800/80 pb-4">
              <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400">
                <Link className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Konfiguracja Endpointu i Autoryzacji</h2>
                <p className="text-xs text-slate-400">Adres URL i unikalny token bezpieczeństwa dla skryptu Google</p>
              </div>
            </div>

            {/* Automated Endpoint Display */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-semibold text-slate-300">
                  Adres Endpointu (BillsMaster Ingest URL)
                </label>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-xs font-semibold">
                    <Check className="w-3.5 h-3.5" />
                    Wykryto automatycznie
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsCustomizingUrl(!isCustomizingUrl)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 underline font-medium"
                  >
                    {isCustomizingUrl ? 'Ukryj edycję' : 'Zmień ręcznie'}
                  </button>
                </div>
              </div>

              {/* Main automated read-only view with copy button */}
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-blue-300 font-mono text-sm select-all truncate flex items-center justify-between">
                  <span>{config?.endpointUrl}</span>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(config?.endpointUrl || '', setCopiedUrl)}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-sm font-semibold border border-slate-700 transition-colors shrink-0"
                  title="Kopiuj URL"
                >
                  {copiedUrl ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span className="text-emerald-400">Skopiowano</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Kopiuj URL</span>
                    </>
                  )}
                </button>
              </div>

              {/* Optional manual override form */}
              {isCustomizingUrl && (
                <form onSubmit={handleSaveEndpoint} className="pt-2 pb-1 space-y-2 border-t border-slate-800/60 mt-3">
                  <span className="text-xs text-slate-400 block">
                    Jeśli korzystasz ze specjalnego tunelu, innej domeny lub reverse proxy, możesz ręcznie nadpisać adres:
                  </span>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="url"
                      value={endpointUrlInput}
                      onChange={(e) => setEndpointUrlInput(e.target.value)}
                      placeholder="https://twoja-domena.pl/api/mail-script/ingest"
                      className="flex-1 px-4 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                      required
                    />
                    <button
                      type="submit"
                      disabled={saving || endpointUrlInput === config?.endpointUrl}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 shrink-0"
                    >
                      Zapisz niestandardowy URL
                    </button>
                  </div>
                </form>
              )}

              <p className="text-xs text-slate-400">
                Adres został automatycznie wykryty na podstawie Twojej bieżącej domeny. Nie musisz nic konfigurować — skrypt poniżej zawiera już ten gotowy endpoint.
              </p>
            </div>

            {/* Secret API Token */}
            <div className="space-y-2 pt-2 border-t border-slate-800/80">
              <label className="block text-sm font-semibold text-slate-300">
                Token Bezpieczeństwa (Secret Token)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-emerald-400 font-mono text-sm select-all truncate">
                  {config?.secretToken}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => copyToClipboard(config?.secretToken || '', setCopiedToken)}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-sm font-semibold border border-slate-700 transition-colors shrink-0"
                  >
                    {copiedToken ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-400" />
                        <span className="text-emerald-400">Skopiowano</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Kopiuj token</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleRegenerateToken}
                    disabled={saving}
                    className="p-2.5 bg-slate-800 hover:bg-slate-700 text-amber-400 hover:text-amber-300 rounded-xl border border-slate-700 transition-colors shrink-0"
                    title="Wygeneruj nowy token"
                  >
                    <Key className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                Token jest automatycznie zaszyty w wygenerowanym kodzie skryptu. Chroni endpoint przed nieautoryzowanym dostępem.
              </p>
            </div>

            {/* GAS Web App URL (Remote Sync Calling) */}
            <div className="space-y-3 pt-4 border-t border-slate-800/80">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-semibold text-white flex items-center gap-2">
                    <Globe className="w-4 h-4 text-indigo-400" />
                    <span>Adres URL Wdrożenia Google Apps Script (Web App URL)</span>
                  </label>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Umożliwia wywoływanie pobierania faktur bezpośrednio z BillsMaster (przycisk synchronizacji portalu lub poniższy przycisk).
                  </p>
                </div>
              </div>

              <form onSubmit={handleSaveGasUrl} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="url"
                  value={gasWebAppUrlInput}
                  onChange={(e) => setGasWebAppUrlInput(e.target.value)}
                  placeholder="https://script.google.com/macros/s/.../exec"
                  className="flex-1 px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors shrink-0 shadow-md shadow-indigo-600/20"
                >
                  Zapisz URL
                </button>
              </form>

              {config?.gasWebAppUrl && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={handleTriggerRemoteSync}
                    disabled={triggeringRemote}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
                  >
                    {triggeringRemote ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin text-white" />
                        <span>Łączenie ze skryptem i pobieranie faktur...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 text-emerald-200 fill-emerald-200" />
                        <span>▶ Wywołaj pobieranie z Gmaila teraz (Zdalne odpytanie)</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              <div className="bg-indigo-950/30 border border-indigo-500/20 rounded-xl p-3 text-xs text-indigo-300 space-y-1">
                <p className="font-semibold text-indigo-200">
                  ⚠️ Ważne ustawienia wdrożenia w Google Apps Script:
                </p>
                <ul className="list-disc list-inside space-y-0.5 text-slate-300">
                  <li>Kliknij <strong>Wdróż</strong> &rarr; <strong>Nowe wdrożenie</strong> &rarr; Zębatka: <strong>Aplikacja internetowa</strong></li>
                  <li><strong>Wykonaj jako:</strong> <code>Ja (Twój adres e-mail)</code></li>
                  <li><strong>Kto ma dostęp:</strong> <strong className="text-amber-300">Każdy (Anyone)</strong> — <em>wymagane, aby BillsMaster mógł wysłać zapytanie bez blokady konta Google</em></li>
                </ul>
              </div>
            </div>
          </div>

          {/* Active Mail Portals List */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Aktywne Portale Pocztowe ({mailPortals.length})</h2>
                  <p className="text-xs text-slate-400">Reguły filtrów dopasowujące faktury z wiadomości e-mail</p>
                </div>
              </div>

              {onNavigatePortals && (
                <button
                  onClick={onNavigatePortals}
                  className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                >
                  <span>Dodaj / edytuj portale</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {mailPortals.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-sm">
                <p>Nie masz jeszcze żadnego portalu typu "Poczta (Google Script)".</p>
                {onNavigatePortals && (
                  <button
                    onClick={onNavigatePortals}
                    className="mt-3 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-xs transition-colors"
                  >
                    Przejdź do dostawców i utwórz portal pocztowy
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {mailPortals.map((p) => (
                  <div key={p.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-white text-sm flex items-center gap-2">
                        <span>{p.name}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                          {p.category || p.providerCategory || 'INNE'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 font-mono mt-1 space-x-2">
                        <span>Nadawca: <strong className="text-slate-300">{p.senderFilter || '.*'}</strong></span>
                        <span>•</span>
                        <span>Temat: <strong className="text-slate-300">{p.titleFilter || '.*'}</strong></span>
                      </div>
                    </div>
                    <div className="text-xs text-slate-400 shrink-0">
                      Rachunków: <strong className="text-white">{p.billCount || 0}</strong>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (1 col): Status & Last Run Info */}
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-5">
            <div className="flex items-center gap-3 border-b border-slate-800/80 pb-4">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Status Ostatniego Pobrania</h2>
                <p className="text-xs text-slate-400">Historia i stan synchronizacji z Gmaila</p>
              </div>
            </div>

            {/* Status Details */}
            <div className="space-y-3.5">
              <div>
                <span className="text-xs font-semibold text-slate-400 block mb-1">Data ostatniego sukcesu:</span>
                {config?.lastRunDate ? (
                  <div className="text-sm font-bold text-white bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-800">
                    {new Date(config.lastRunDate).toLocaleString('pl-PL', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                ) : (
                  <div className="text-xs font-medium text-amber-300 bg-amber-500/10 border border-amber-500/20 px-3 py-2.5 rounded-xl">
                    Jeszcze nie uruchomiono. Pierwszy przebieg pobierze faktury z ostatnich 12 miesięcy.
                  </div>
                )}
              </div>

              <div>
                <span className="text-xs font-semibold text-slate-400 block mb-1">Status ostatniego przebiegu:</span>
                <div className="flex items-center gap-2">
                  {config?.lastRunStatus === 'SUCCESS' ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>SUKCES ({config.lastRunCount} faktur)</span>
                    </span>
                  ) : config?.lastRunStatus === 'FAILED' ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>BŁĄD</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700">
                      <span>BRAK DANYCH</span>
                    </span>
                  )}
                </div>
              </div>

              {config?.lastRunMessage && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 block mb-1">Komunikat:</span>
                  <div className="text-xs text-slate-300 bg-slate-950 px-3 py-2 rounded-xl border border-slate-800 break-words">
                    {config.lastRunMessage}
                  </div>
                </div>
              )}
            </div>

            {/* Reset Last Run Button */}
            <div className="pt-3 border-t border-slate-800/80">
              <button
                onClick={handleResetLastRun}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-amber-300 hover:text-white bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Resetuj datę (pobierz z 12 miesięcy)</span>
              </button>
              <p className="text-[11px] text-slate-400 mt-2 text-center">
                Wymusi ponowne przeszukanie pełnych 12 miesięcy przy następnym uruchomieniu skryptu.
              </p>
            </div>
          </div>

          {/* Quick Help Callout */}
          <div className="bg-gradient-to-br from-indigo-950/40 to-slate-900 border border-indigo-500/20 rounded-3xl p-6 shadow-xl space-y-3">
            <div className="flex items-center gap-2.5 text-indigo-300 font-bold text-sm">
              <Sparkles className="w-4 h-4" />
              <span>Dlaczego Google Apps Script?</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Google Apps Script działa bezpośrednio na serwerach Google w Twoim koncie. 
              Dzięki temu <strong>BillsMaster nigdy nie potrzebuje Twojego hasła</strong> do skrzynki Gmail, 
              a faktury są bezpiecznie przesyłane bezpośrednio z chmury Google do Twojej instalacji.
            </p>
          </div>
        </div>
      </div>

      {/* Step-by-Step Instructions */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
        <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
          <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400">
            <HelpCircle className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Instrukcja Konfiguracji w Google Services (Krok po Kroku)</h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Konfiguracja zajmuje około 2 minut i jest wykonywana tylko raz.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Step 1 */}
          <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 space-y-2.5 flex flex-col justify-between">
            <div>
              <div className="w-7 h-7 rounded-xl bg-indigo-600 text-white font-black text-sm flex items-center justify-center mb-2">
                1
              </div>
              <h4 className="font-bold text-white text-sm">Utwórz projekt w Google</h4>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Przejdź na stronę <a href="https://script.google.com" target="_blank" rel="noreferrer" className="text-blue-400 underline font-semibold inline-flex items-center gap-0.5">script.google.com <ExternalLink className="w-2.5 h-2.5" /></a> i kliknij <strong>"+ Nowy projekt"</strong>.
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 space-y-2.5 flex flex-col justify-between">
            <div>
              <div className="w-7 h-7 rounded-xl bg-indigo-600 text-white font-black text-sm flex items-center justify-center mb-2">
                2
              </div>
              <h4 className="font-bold text-white text-sm">Wklej wygenerowany kod</h4>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Skasuj domyślną zawartość pliku <code className="text-indigo-300">Kod.gs</code>, wklej poniższy wygenerowany skrypt i zapisz (<strong>Ctrl+S</strong>).
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 space-y-2.5 flex flex-col justify-between">
            <div>
              <div className="w-7 h-7 rounded-xl bg-indigo-600 text-white font-black text-sm flex items-center justify-center mb-2">
                3
              </div>
              <h4 className="font-bold text-white text-sm">Jednorazowa zgoda Gmail</h4>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Wybierz funkcję <code className="text-emerald-300 font-mono">runMailSync</code> i kliknij <strong>Uruchom</strong>. Zaakceptuj jednorazowe uprawnienie do przeszukiwania poczty.
              </p>
            </div>
          </div>

          {/* Step 4 */}
          <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 space-y-2.5 flex flex-col justify-between">
            <div>
              <div className="w-7 h-7 rounded-xl bg-emerald-600 text-white font-black text-sm flex items-center justify-center mb-2">
                4
              </div>
              <h4 className="font-bold text-white text-sm">Wdróż jako Web App</h4>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Kliknij <strong>Wdróż</strong> &rarr; <strong>Nowe wdrożenie</strong> &rarr; typ: <strong>Aplikacja internetowa</strong>. Ustaw <em>Kto ma dostęp: Każdy (Anyone)</em>, skopiuj link i wklej w polu powyżej. BillsMaster będzie mógł odpytywać skrypt na żądanie!
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Generated Script Code Viewer */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
              <FileCode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white">Wygenerowany Skrypt Google Apps Script</h2>
              <p className="text-xs sm:text-sm text-slate-400">
                Zawiera zaktualizowany endpoint, token oraz reguły wszystkich portali pocztowych
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => copyToClipboard(config?.scriptCode || '', setCopiedScript)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-colors shadow-md shadow-indigo-600/20"
            >
              {copiedScript ? (
                <>
                  <Check className="w-4 h-4 text-white" />
                  <span>Skopiowano do schowka!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Kopiuj cały kod</span>
                </>
              )}
            </button>

            <button
              onClick={handleDownloadScript}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-sm font-semibold transition-colors border border-slate-700"
              title="Pobierz plik BillsMaster_Gmail_Sync.gs"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Pobierz .gs</span>
            </button>
          </div>
        </div>

        {/* Code Block Container */}
        <div className="relative rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/80 border-b border-slate-800 text-xs font-mono text-slate-400">
            <span>Kod.gs</span>
            <span>Google Apps Script (JavaScript)</span>
          </div>
          <pre className="p-4 sm:p-6 text-xs sm:text-sm text-slate-200 font-mono overflow-x-auto max-h-[32rem] leading-relaxed selection:bg-indigo-600 selection:text-white">
            <code>{config?.scriptCode}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};
