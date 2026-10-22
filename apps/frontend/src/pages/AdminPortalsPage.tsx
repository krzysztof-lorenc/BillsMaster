import React, { useEffect, useState } from 'react';
import { 
  Landmark, 
  Plus, 
  RefreshCw, 
  X, 
  Trash2, 
  Edit, 
  CheckCircle2, 
  Ban, 
  Zap, 
  Layers,
  Play,
  Key,
  AlertCircle,
  Copy,
  Clock,
  Mail,
  Bell,
  BellOff
} from 'lucide-react';
import { api } from '../lib/api.js';
import type { 
  PortalDto, 
  ProviderDto,
  ProviderCategory,
  GroupDto,
  CreatePortalRequest, 
  UpdatePortalRequest,
  DuplicatePortalRequest 
} from '@bills-master/shared-types';
import { MAIL_SCRIPT_TEMPLATES } from '../config/mailTemplates.js';

interface AdminPortalsPageProps {
  onOpenMailScript?: () => void;
}

const isDemoProvider = (p: ProviderDto) => {
  const id = p.id.toLowerCase();
  const pName = p.name.toLowerCase();
  return (
    id === 'mock-provider' ||
    id.includes('mock') ||
    id.startsWith('test-') ||
    pName.includes('demo') ||
    pName.includes('mock') ||
    pName.includes('test')
  );
};

const getShortProviderName = (p: ProviderDto) => {
  // Makes provider names readable & concise (e.g. "Tauron eBOK (ELECTRICITY)" -> "Tauron")
  const clean = p.name
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\bOnline\b/i, '')
    .trim();
  return clean || p.name;
};

export const AdminPortalsPage: React.FC<AdminPortalsPageProps> = ({ onOpenMailScript }) => {
  const [portals, setPortals] = useState<PortalDto[]>([]);
  const [providers, setProviders] = useState<ProviderDto[]>([]);
  const [groups, setGroups] = useState<GroupDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingPortalId, setSyncingPortalId] = useState<string | null>(null);
  const [scriptNeedsUpdate, setScriptNeedsUpdate] = useState(false);

  const availableEbocProviders = providers.filter(
    (p) => p.id !== 'mail-script' && !isDemoProvider(p)
  );

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPortal, setEditingPortal] = useState<PortalDto | null>(null);

  // Duplicate Modal State
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
  const [duplicatingPortal, setDuplicatingPortal] = useState<PortalDto | null>(null);
  const [duplicateName, setDuplicateName] = useState('');
  const [duplicateAgreementFilter, setDuplicateAgreementFilter] = useState('');
  const [duplicateSyncFrequency, setDuplicateSyncFrequency] = useState<number>(1);
  const [duplicateGroupIds, setDuplicateGroupIds] = useState<string[]>([]);
  const [duplicateIsEnabled, setDuplicateIsEnabled] = useState(true);
  const [duplicatePaymentReceiver, setDuplicatePaymentReceiver] = useState('');
  const [duplicateNotifyNewBill, setDuplicateNotifyNewBill] = useState(true);
  const [duplicateNotifyDueSoon, setDuplicateNotifyDueSoon] = useState(true);
  const [duplicateNotifyOverdue, setDuplicateNotifyOverdue] = useState(true);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [duplicateSubmitting, setDuplicateSubmitting] = useState(false);

  // Session Modal State
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [sessionPortal, setSessionPortal] = useState<PortalDto | null>(null);
  const [sessionDataText, setSessionDataText] = useState('');
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionSubmitting, setSessionSubmitting] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [providerId, setProviderId] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [isMailScript, setIsMailScript] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [senderFilter, setSenderFilter] = useState('');
  const [titleFilter, setTitleFilter] = useState('');
  const [paymentReceiver, setPaymentReceiver] = useState('');
  const [category, setCategory] = useState<ProviderCategory>('OTHER');
  const [agreementFilter, setAgreementFilter] = useState('');
  const [syncFrequency, setSyncFrequency] = useState<number>(1);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [isEnabled, setIsEnabled] = useState(true);
  const [notifyNewBill, setNotifyNewBill] = useState(true);
  const [notifyDueSoon, setNotifyDueSoon] = useState(true);
  const [notifyOverdue, setNotifyOverdue] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  const fetchData = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const [portalsRes, providersRes, groupsRes] = await Promise.all([
        api.get<{ portals: PortalDto[]; scriptNeedsUpdate?: boolean }>('/api/admin/portals'),
        api.get<{ providers: ProviderDto[] }>('/api/admin/providers'),
        api.get<{ groups: GroupDto[] }>('/api/admin/groups'),
      ]);
      setPortals(portalsRes.portals);
      setScriptNeedsUpdate(Boolean(portalsRes.scriptNeedsUpdate));
      setProviders(providersRes.providers);
      setGroups(groupsRes.groups);
      const ebok = providersRes.providers.filter(
        (p) => p.id !== 'mail-script' && !isDemoProvider(p)
      );
      if (ebok.length > 0 && !providerId) {
        setProviderId(ebok[0].id);
      }
    } catch (err) {
      console.error('Błąd podczas ładowania portali dostawców:', err);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleApplyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const tmpl = MAIL_SCRIPT_TEMPLATES.find((t) => t.id === templateId);
    if (tmpl) {
      setName(tmpl.name);
      setCategory(tmpl.category);
      setSenderFilter(tmpl.senderFilter);
      setTitleFilter(tmpl.titleFilter);
      if (tmpl.paymentReceiver) {
        setPaymentReceiver(tmpl.paymentReceiver);
      }
    }
  };

  const openCreateModal = (asMailScript = false) => {
    setEditingPortal(null);
    setName(asMailScript ? 'Faktury z poczty' : '');
    setIsMailScript(asMailScript);
    setSelectedTemplateId('');
    const ebok = providers.filter((p) => p.id !== 'mail-script' && !isDemoProvider(p));
    setProviderId(asMailScript ? 'mail-script' : (ebok[0]?.id || 'tauron'));
    setLogin(asMailScript ? 'Poczta (Google Script)' : '');
    setPassword('');
    setSenderFilter('');
    setTitleFilter('');
    setPaymentReceiver('');
    setCategory('OTHER');
    setAgreementFilter('');
    setSyncFrequency(1);
    setSelectedGroupIds([]);
    setIsEnabled(true);
    setNotifyNewBill(true);
    setNotifyDueSoon(true);
    setNotifyOverdue(true);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (portal: PortalDto) => {
    setEditingPortal(portal);
    setName(portal.name);
    const isMail = Boolean(portal.isMailScript || portal.providerId === 'mail-script');
    setIsMailScript(isMail);
    setProviderId(isMail ? 'mail-script' : portal.providerId);
    setLogin(portal.loginMasked);
    setPassword(''); // leave blank to keep existing
    setSenderFilter(portal.senderFilter || '');
    setTitleFilter(portal.titleFilter || '');
    setPaymentReceiver(portal.paymentReceiver || '');
    setCategory((portal.category || portal.providerCategory || 'OTHER') as any);
    setAgreementFilter(portal.agreementFilter || '');
    setSyncFrequency(portal.syncFrequency || 1);
    setSelectedGroupIds(portal.groupIds || []);
    setIsEnabled(portal.isEnabled);
    setNotifyNewBill(portal.notifyNewBill ?? true);
    setNotifyDueSoon(portal.notifyDueSoon ?? true);
    setNotifyOverdue(portal.notifyOverdue ?? true);
    if (isMail) {
      const match = MAIL_SCRIPT_TEMPLATES.find(
        (t) => t.senderFilter === portal.senderFilter && t.titleFilter === portal.titleFilter
      );
      setSelectedTemplateId(match ? match.id : '');
    } else {
      setSelectedTemplateId('');
    }
    setFormError(null);
    setIsModalOpen(true);
  };

  const toggleGroup = (groupId: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const handleSyncPortal = async (portal: PortalDto) => {
    try {
      setSyncingPortalId(portal.id);
      await api.post(`/api/admin/portals/${portal.id}/sync`);
      await fetchData(false);
    } catch (err: any) {
      alert(err.message || 'Nie udało się uruchomić sprawdzania portalu');
    } finally {
      setSyncingPortalId(null);
    }
  };

  const handleToggleStatus = async (portal: PortalDto) => {
    try {
      await api.patch(`/api/admin/portals/${portal.id}`, { isEnabled: !portal.isEnabled });
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Nie udało się zaktualizować statusu portalu');
    }
  };

  const handleDeletePortal = async (portal: PortalDto) => {
    if (!confirm(`Czy na pewno chcesz usunąć portal "${portal.name}"? Usunięte zostaną także powiązane faktury.`)) {
      return;
    }
    try {
      await api.delete(`/api/admin/portals/${portal.id}`);
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Nie udało się usunąć portalu');
    }
  };

  const openDuplicateModal = (portal: PortalDto) => {
    setDuplicatingPortal(portal);
    setDuplicateName(`${portal.name} (kopia)`);
    setDuplicateAgreementFilter(portal.agreementFilter || '');
    setDuplicateSyncFrequency(portal.syncFrequency || 1);
    setDuplicateGroupIds(portal.groupIds || []);
    setDuplicateIsEnabled(portal.isEnabled);
    setDuplicatePaymentReceiver(portal.paymentReceiver || '');
    setDuplicateNotifyNewBill(portal.notifyNewBill ?? true);
    setDuplicateNotifyDueSoon(portal.notifyDueSoon ?? true);
    setDuplicateNotifyOverdue(portal.notifyOverdue ?? true);
    setDuplicateError(null);
    setIsDuplicateModalOpen(true);
  };

  const toggleDuplicateGroup = (groupId: string) => {
    setDuplicateGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const handleDuplicateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!duplicatingPortal) return;
    setDuplicateError(null);
    setDuplicateSubmitting(true);

    try {
      const payload: DuplicatePortalRequest = {
        name: duplicateName.trim(),
        agreementFilter: duplicateAgreementFilter.trim() ? duplicateAgreementFilter.trim() : null,
        syncFrequency: duplicateSyncFrequency,
        groupIds: duplicateGroupIds,
        isEnabled: duplicateIsEnabled,
        paymentReceiver: duplicatePaymentReceiver.trim() ? duplicatePaymentReceiver.trim() : null,
        notifyNewBill: duplicateNotifyNewBill,
        notifyDueSoon: duplicateNotifyDueSoon,
        notifyOverdue: duplicateNotifyOverdue,
      };

      await api.post(`/api/admin/portals/${duplicatingPortal.id}/duplicate`, payload);
      setIsDuplicateModalOpen(false);
      await fetchData();
    } catch (err: any) {
      setDuplicateError(err.message || 'Nie udało się zduplikować portalu');
    } finally {
      setDuplicateSubmitting(false);
    }
  };

  const openSessionModal = (portal: PortalDto) => {
    setSessionPortal(portal);
    setSessionDataText('');
    setSessionError(null);
    setIsSessionModalOpen(true);
  };

  const handleImportSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionPortal) return;
    setSessionError(null);
    setSessionSubmitting(true);

    try {
      let parsedData: any = sessionDataText.trim();
      if (!parsedData) {
        throw new Error('Wprowadź dane sesji (JSON lub tekst nagłówka ciasteczek)');
      }
      if (parsedData.startsWith('{') || parsedData.startsWith('[')) {
        try {
          parsedData = JSON.parse(parsedData);
        } catch {
          throw new Error('Niepoprawny format JSON. Upewnij się, że wklejony tekst to poprawny JSON.');
        }
      }

      await api.post(`/api/admin/portals/${sessionPortal.id}/session`, {
        sessionData: parsedData,
      });

      setIsSessionModalOpen(false);
      await fetchData(false);
      // Automatically trigger sync for this portal
      await handleSyncPortal(sessionPortal);
    } catch (err: any) {
      setSessionError(err.message || 'Nie udało się zaimportować sesji');
    } finally {
      setSessionSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSubmitting(true);

    try {
      if (editingPortal) {
        const payload: UpdatePortalRequest = {
          name,
          providerId: isMailScript ? 'mail-script' : providerId,
          isEnabled,
          agreementFilter: agreementFilter.trim() ? agreementFilter.trim() : null,
          syncFrequency,
          groupIds: selectedGroupIds,
          isMailScript,
          senderFilter: isMailScript ? (senderFilter.trim() || '.*') : null,
          titleFilter: isMailScript ? (titleFilter.trim() || '.*') : null,
          paymentReceiver: paymentReceiver.trim() ? paymentReceiver.trim() : null,
          category: isMailScript ? category : undefined,
          notifyNewBill,
          notifyDueSoon,
          notifyOverdue,
        };
        if (!isMailScript) {
          if (login && login !== editingPortal.loginMasked) {
            payload.login = login;
          }
          if (password.trim().length > 0) {
            payload.password = password;
          }
        }
        await api.patch(`/api/admin/portals/${editingPortal.id}`, payload);
      } else {
        if (!isMailScript && !password.trim()) {
          setFormError('Hasło do portalu jest wymagane podczas tworzenia');
          setFormSubmitting(false);
          return;
        }
        const payload: CreatePortalRequest = {
          name,
          providerId: isMailScript ? 'mail-script' : providerId,
          login: isMailScript ? 'Poczta (Google Script)' : login,
          password: isMailScript ? '' : password.trim(),
          agreementFilter: agreementFilter.trim() ? agreementFilter.trim() : null,
          syncFrequency,
          isEnabled,
          groupIds: selectedGroupIds,
          isMailScript,
          senderFilter: isMailScript ? (senderFilter.trim() || '.*') : null,
          titleFilter: isMailScript ? (titleFilter.trim() || '.*') : null,
          paymentReceiver: paymentReceiver.trim() ? paymentReceiver.trim() : null,
          category: isMailScript ? category : undefined,
          notifyNewBill,
          notifyDueSoon,
          notifyOverdue,
        };
        await api.post<{ portal: PortalDto }>('/api/admin/portals', payload);
      }
      setIsModalOpen(false);
      await fetchData();
    } catch (err: any) {
      setFormError(err.message || 'Nie udało się zapisać portalu');
    } finally {
      setFormSubmitting(false);
    }
  };

  const getSyncBadge = (status: string) => {
    switch (status) {
      case 'SUCCESS':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Połączono</span>
          </span>
        );
      case 'RUNNING':
      case 'QUEUED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/25 animate-pulse">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Pobieranie...</span>
          </span>
        );
      case 'NEEDS_REAUTH':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/25">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Wymaga uwagi</span>
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/25">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Błąd</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <span>Oczekuje</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Dostawcy Mediów i Portale</h1>
          <p className="text-sm text-slate-400">
            Konfiguruj dane logowania do serwisów eBOK dostawców (prąd, gaz, woda, odpady) oraz integracje pocztowe.
          </p>
        </div>
        <div>
          <button
            onClick={() => openCreateModal(false)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-colors shadow-lg shadow-indigo-600/20"
          >
            <Plus className="w-4 h-4" />
            <span>+ Dodaj dostawcę</span>
          </button>
        </div>
      </div>

      {/* Banner if script needs update */}
      {scriptNeedsUpdate && (
        <div className="bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-transparent border-2 border-amber-500/40 rounded-3xl p-5 sm:p-6 shadow-xl shadow-amber-500/5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3.5">
              <div className="p-3 rounded-2xl bg-amber-500/20 text-amber-300 shrink-0">
                <AlertCircle className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-amber-200">
                  Wymagana aktualizacja skryptu Google Apps Script
                </h3>
                <p className="text-sm text-slate-300 mt-0.5">
                  Wykryto zmiany w konfiguracji portali pocztowych lub filtrach regex. Zaktualizuj kod skryptu w Google Apps Script, aby nowe reguły pobierania faktur z poczty były aktywne.
                </p>
              </div>
            </div>
            {onOpenMailScript && (
              <button
                onClick={onOpenMailScript}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-2xl text-sm transition-all shadow-lg shadow-amber-500/20 shrink-0"
              >
                <Mail className="w-4 h-4" />
                <span>Otwórz generator skryptu Google</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Portals Table */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden backdrop-blur-sm">
        {loading ? (
          <div className="py-16 text-center">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mx-auto" />
            <p className="text-sm text-slate-400 mt-2 font-medium">Wczytywanie dostawców...</p>
          </div>
        ) : portals.length === 0 ? (
          <div className="text-center py-16 px-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-600/15 text-indigo-400 flex items-center justify-center mx-auto mb-3">
              <Landmark className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-white">Brak skonfigurowanych dostawców</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1 mb-4">
              Dodaj połączenia do portali eBOK (np. Tauron, PGNiG) wraz z danymi logowania i przypisz je do grup.
            </p>
            <button
              onClick={() => openCreateModal(false)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-colors shadow-lg shadow-indigo-600/20"
            >
              Dodaj pierwszego dostawcę
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-950/90 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold text-xs">
                <tr>
                  <th className="px-5 py-3.5">Nazwa portalu</th>
                  <th className="px-5 py-3.5">Dostawca</th>
                  <th className="px-5 py-3.5">Login</th>
                  <th className="px-5 py-3.5">Przypisane grupy</th>
                  <th className="px-5 py-3.5">Częstotliwość</th>
                  <th className="px-5 py-3.5">Status synchronizacji</th>
                  <th className="px-5 py-3.5">Powiadomienia</th>
                  <th className="px-5 py-3.5">Stan</th>
                  <th className="px-5 py-3.5 text-right">Akcje</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {portals.map((portal) => {
                  const isMail = Boolean(portal.isMailScript || portal.providerId === 'mail-script');
                  return (
                  <tr key={portal.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-4 font-bold text-white">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs ${
                          isMail ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-600/20 text-blue-400'
                        }`}>
                          {isMail ? <Mail className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">{portal.name}</span>
                            {isMail && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                <Mail className="w-3 h-3" />
                                <span>Poczta Google Script</span>
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 font-mono">{portal.id.slice(0, 8)}...</div>
                          {portal.agreementFilter && (
                            <div className="mt-1">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 font-mono text-[11px]" title="Filtr umów Regex">
                                <span className="text-amber-500/70 font-sans font-medium">Filtr:</span>
                                <span>/{portal.agreementFilter}/i</span>
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-slate-300">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700/60 text-slate-300 text-xs font-medium">
                        {isMail ? <Mail className="w-3.5 h-3.5 text-amber-400" /> : <Landmark className="w-3.5 h-3.5 text-indigo-400" />}
                        <span>{isMail ? `Poczta (${portal.category || portal.providerCategory || 'INNE'})` : (portal.providerName || portal.providerId)}</span>
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-300 text-xs">
                      {isMail ? (
                        <div className="space-y-0.5 font-mono">
                          <div>Nadawca: <strong className="text-indigo-300">{portal.senderFilter || '.*'}</strong></div>
                          <div>Temat: <strong className="text-indigo-300">{portal.titleFilter || '.*'}</strong></div>
                          {portal.paymentReceiver && (
                            <div className="text-amber-300 font-sans mt-0.5">
                              Odbiorca: <strong>{portal.paymentReceiver}</strong>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <span className="font-mono sm:text-sm">{portal.loginMasked}</span>
                          {portal.paymentReceiver && (
                            <div className="text-amber-300 font-sans text-xs mt-0.5">
                              Odbiorca: <strong>{portal.paymentReceiver}</strong>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {portal.groupNames && portal.groupNames.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {portal.groupNames.map((gName, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-950/60 border border-indigo-800/40 text-indigo-300 text-xs"
                            >
                              <Layers className="w-3 h-3" />
                              <span>{gName}</span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-500 italic text-xs">Nieprzypisany</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {portal.syncFrequency === 4 ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-300 text-xs font-semibold" title="4 razy na dobę (co 6h: 03:00, 09:00, 15:00, 21:00)">
                          <Clock className="w-3.5 h-3.5 text-purple-400" />
                          <span>4x / dobę</span>
                        </span>
                      ) : portal.syncFrequency === 3 ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-semibold" title="3 razy na dobę (co 8h: 03:00, 11:00, 19:00)">
                          <Clock className="w-3.5 h-3.5 text-indigo-400" />
                          <span>3x / dobę</span>
                        </span>
                      ) : portal.syncFrequency === 2 ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs font-semibold" title="2 razy na dobę (co 12h: 03:00, 15:00)">
                          <Clock className="w-3.5 h-3.5 text-sky-400" />
                          <span>2x / dobę</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700/60 text-slate-300 text-xs font-medium" title="1 raz na dobę (standardowo o 03:00 w nocy)">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>1x / dobę</span>
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="space-y-1">
                        <div>{getSyncBadge(portal.lastSyncStatus)}</div>
                        {portal.lastSyncedAt && (
                          <div className="text-xs text-slate-400 font-mono">
                            {new Date(portal.lastSyncedAt).toLocaleDateString('pl-PL')}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {portal.notifyNewBill || portal.notifyDueSoon || portal.notifyOverdue ? (
                        <div className="flex items-center gap-1.5" title={`Powiadomienia: ${[portal.notifyNewBill && 'Nowy rachunek', portal.notifyDueSoon && 'Do 3 dni', portal.notifyOverdue && 'Po terminie'].filter(Boolean).join(', ')}`}>
                          <Bell className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          <div className="flex flex-wrap gap-1">
                            {portal.notifyNewBill && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                Nowy
                              </span>
                            )}
                            {portal.notifyDueSoon && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                3 dni
                              </span>
                            )}
                            {portal.notifyOverdue && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                                Termin
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-500 text-xs italic">
                          <BellOff className="w-3.5 h-3.5" />
                          <span>Wyłączone</span>
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                          portal.isEnabled
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-red-500/15 text-red-400 border border-red-500/30'
                        }`}
                      >
                        {portal.isEnabled ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                        <span>{portal.isEnabled ? 'Włączony' : 'Wyłączony'}</span>
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleSyncPortal(portal)}
                          disabled={syncingPortalId === portal.id}
                          className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded-lg transition-colors"
                          title="Wymuś synchronizację teraz"
                        >
                          <Play className={`w-4 h-4 ${syncingPortalId === portal.id ? 'animate-spin text-indigo-400' : ''}`} />
                        </button>
                        <button
                          onClick={() => openEditModal(portal)}
                          className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                          title="Edytuj dane dostawcy"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openDuplicateModal(portal)}
                          className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded-lg transition-colors"
                          title="Duplikuj portal"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        {!isMail && (
                          <button
                            onClick={() => openSessionModal(portal)}
                            className="p-2 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg transition-colors"
                            title="Wklej aktywną sesję / pliki cookie (ominięcie WAF / Akamai)"
                          >
                            <Key className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleToggleStatus(portal)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            portal.isEnabled
                              ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                              : 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30'
                          }`}
                        >
                          {portal.isEnabled ? 'Wyłącz' : 'Włącz'}
                        </button>
                        <button
                          onClick={() => handleDeletePortal(portal)}
                          className="p-2 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
                          title="Usuń portal"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Portal Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-lg w-full p-5 sm:p-7 shadow-2xl relative my-auto max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center border ${
                  isMailScript
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                    : 'bg-indigo-600/20 text-indigo-400 border-indigo-500/30'
                }`}>
                  {isMailScript ? <Mail className="w-6 h-6" /> : <Landmark className="w-6 h-6" />}
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-bold text-white">
                    {editingPortal 
                      ? (isMailScript ? 'Edycja Integracji Poczty' : 'Edycja Dostawcy eBOK') 
                      : (isMailScript ? 'Nowa Integracja Poczty (Google Script)' : 'Nowy Dostawca Mediów (eBOK)')}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {isMailScript 
                      ? 'Pobieranie faktur PDF z poczty Gmail' 
                      : 'Logowanie do serwisu internetowego dostawcy'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {editingPortal && (
                  <button
                    type="button"
                    onClick={() => {
                      const portalToDuplicate = editingPortal;
                      setIsModalOpen(false);
                      openDuplicateModal(portalToDuplicate);
                    }}
                    className="px-2.5 py-1.5 text-slate-400 hover:text-indigo-300 rounded-xl bg-slate-800 hover:bg-slate-700/80 transition-colors flex items-center gap-1.5 text-xs font-semibold"
                    title="Duplikuj ten portal"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Duplikuj</span>
                  </button>
                )}
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800 hover:bg-slate-700 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {formError && (
              <div className="my-3 p-3.5 bg-rose-950/60 border border-rose-600/60 rounded-xl text-rose-200 text-sm font-semibold shrink-0">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="overflow-y-auto pt-4 space-y-4 pr-1">
              {/* Portal Type Toggle */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Sposób pozyskiwania faktur
                </label>
                <div className="grid grid-cols-2 gap-2 p-1.5 bg-slate-950 border border-slate-800 rounded-2xl">
                  <button
                    type="button"
                    onClick={() => {
                      setIsMailScript(false);
                      if (providerId === 'mail-script') {
                        setProviderId(availableEbocProviders[0]?.id || 'tauron');
                      }
                    }}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                      !isMailScript
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                        : 'text-slate-400 hover:text-white hover:bg-slate-900'
                    }`}
                  >
                    <Landmark className="w-4 h-4" />
                    <span>Portal eBOK</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMailScript(true);
                      setProviderId('mail-script');
                    }}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                      isMailScript
                        ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30 font-black'
                        : 'text-slate-400 hover:text-white hover:bg-slate-900'
                    }`}
                  >
                    <Mail className="w-4 h-4" />
                    <span>Poczta Google Script</span>
                  </button>
                </div>
              </div>

              {/* Provider dropdown - only for eBOK portals, relying on the selected way of getting bills */}
              {!isMailScript && (
                <div>
                  <label className="block text-sm font-bold text-slate-200 mb-1.5">
                    Wtyczka dostawcy
                  </label>
                  <select
                    value={providerId}
                    onChange={(e) => setProviderId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-base text-white focus:outline-none transition-colors"
                  >
                    {availableEbocProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {getShortProviderName(p)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Template dropdown - for Poczta Google Script */}
              {isMailScript && (
                <div>
                  <label className="block text-sm font-bold text-slate-200 mb-1.5 flex items-center justify-between">
                    <span>Szablon dostawcy pocztowego</span>
                    <span className="text-xs font-normal text-amber-400">Opcjonalnie</span>
                  </label>
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => handleApplyTemplate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl px-4 py-3 text-base text-white focus:outline-none transition-colors"
                  >
                    <option value="">-- Własna konfiguracja (wpisz ręcznie) --</option>
                    {MAIL_SCRIPT_TEMPLATES.map((tmpl) => (
                      <option key={tmpl.id} value={tmpl.id}>
                        {tmpl.displayName}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400 mt-1.5">
                    Wybierz gotowy szablon, aby automatycznie uzupełnić nazwę, kategorię oraz filtry e-mail.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1.5">
                  Nazwa dostawcy / licznika
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={isMailScript ? "np. Tauron z poczty, Play faktury, Vectra" : "np. Tauron Mieszkanie, PGNiG Dom"}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none transition-colors"
                />
              </div>

              {isMailScript ? (
                <>
                  <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-amber-200">
                      <Mail className="w-4 h-4 shrink-0" />
                      <span>Integracja pocztowa bez podawania hasła!</span>
                    </div>
                    <p className="text-slate-300">
                      BillsMaster nie potrzebuje loginu ani hasła do Twojej skrzynki. Faktury są pobierane przez skrypt Google Apps Script na podstawie poniższych filtrów.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-200 mb-1.5">
                      Kategoria mediów / rachunków
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as ProviderCategory)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-base text-white focus:outline-none transition-colors"
                    >
                      <option value="ELECTRICITY">⚡ Prąd / Energia elektryczna</option>
                      <option value="GAS">🔥 Gaz</option>
                      <option value="INTERNET">🌐 Internet / Światłowód</option>
                      <option value="WATER">💧 Woda / Ścieki</option>
                      <option value="HOUSING">🏢 Czynsz / Spółdzielnia / Wspólnota</option>
                      <option value="TELECOM">📡 Telekomunikacja</option>
                      <option value="GSM">📱 Telefon / GSM</option>
                      <option value="OTHER">📁 Inne / Pozostałe opłaty</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-200 mb-1.5">
                      Filtr nadawcy wiadomości (Regex)
                    </label>
                    <input
                      type="text"
                      value={senderFilter}
                      onChange={(e) => setSenderFilter(e.target.value)}
                      placeholder="np. .*@tauron\.pl|.*@enea\.pl"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none transition-colors font-mono"
                    />
                    <p className="text-xs text-slate-400 mt-1.5">
                      Wyrażenie regularne dopasowujące adres e-mail nadawcy (np. <code className="text-amber-300">.*@tauron\.pl</code>). Pozostaw puste, aby dopasować dowolnego nadawcę.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-200 mb-1.5">
                      Filtr tematu wiadomości (Regex)
                    </label>
                    <input
                      type="text"
                      value={titleFilter}
                      onChange={(e) => setTitleFilter(e.target.value)}
                      placeholder="np. .*faktura.*|.*rozliczenie.*"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none transition-colors font-mono"
                    />
                    <p className="text-xs text-slate-400 mt-1.5">
                      Wyrażenie regularne filtrujące temat wiadomości e-mail (np. <code className="text-amber-300">.*faktura.*|.*rachunek.*</code>).
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-200 mb-1.5 flex items-center justify-between">
                      <span>Odbiorca płatności (nazwa do przelewu)</span>
                      <span className="text-xs font-normal text-amber-400">Opcjonalnie</span>
                    </label>
                    <input
                      type="text"
                      value={paymentReceiver}
                      onChange={(e) => setPaymentReceiver(e.target.value)}
                      placeholder="np. Wspólnota Mieszkaniowa ul. Miarki 5"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none transition-colors"
                    />
                    <p className="text-xs text-slate-400 mt-1.5">
                      Domyślna nazwa odbiorcy widoczna przy generowaniu kodów QR przelewu i kopiowaniu danych do płatności.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-bold text-slate-200 mb-1.5">
                      Login / Identyfikator klienta / Numer telefonu
                    </label>
                    <input
                      type="text"
                      required
                      value={login}
                      onChange={(e) => setLogin(e.target.value)}
                      placeholder="np. klient@domena.pl lub numer umowy"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-200 mb-1.5">
                      Hasło do portalu {editingPortal && <span className="text-slate-400 font-normal text-xs">(pozostaw puste, aby nie zmieniać)</span>}
                    </label>
                    <input
                      type="password"
                      required={!editingPortal}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={editingPortal ? '•••••••• (bez zmian)' : 'Hasło do serwisu dostawcy'}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none transition-colors"
                    />
                    <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <span>
                        Hasło jest bezpiecznie szyfrowane algorytmem AES-256-GCM.
                      </span>
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-200 mb-1.5">
                      Filtr umów / adresu (Regex) <span className="text-slate-400 font-normal text-xs">(opcjonalne)</span>
                    </label>
                    <input
                      type="text"
                      value={agreementFilter}
                      onChange={(e) => setAgreementFilter(e.target.value)}
                      placeholder="np. Kwiatowa|Polna, Garaż.* lub Lokal 2"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none transition-colors font-mono"
                    />
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                      Wyrażenie regularne filtrujące umowy lub adresy punktów poboru (np. dla <span className="text-indigo-300 font-mono">myORLEN</span> wg adresu: <span className="text-indigo-300 font-mono">Kwiatowa</span>, <span className="text-indigo-300 font-mono">Polna</span> lub dla <span className="text-indigo-300 font-mono">Tauron</span>: <span className="text-indigo-300 font-mono">Garaż.*</span>). Pozostaw puste, aby pobierać faktury dla wszystkich umów.
                    </p>
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1.5 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-400" />
                  <span>Częstotliwość automatycznego odświeżania na dobę</span>
                </label>
                <select
                  value={syncFrequency}
                  onChange={(e) => setSyncFrequency(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-white focus:outline-none transition-colors"
                >
                  <option value={1}>1 raz na dobę (standard — nocne o 03:00)</option>
                  <option value={2}>2 razy na dobę (co 12h: o 03:00 i 15:00)</option>
                  <option value={3}>3 razy na dobę (co 8h: o 03:00, 11:00, 19:00)</option>
                  <option value={4}>4 razy na dobę (co 6h: o 03:00, 09:00, 15:00, 21:00)</option>
                </select>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  Określa, ile razy w ciągu doby system automatycznie sprawdza i pobiera nowe faktury z tego portalu.
                </p>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1">
                  Przypisz do grup / lokali
                </label>
                {groups.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">Brak grup w systemie.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto bg-slate-950 p-3 rounded-xl border border-slate-800">
                    {groups.map((group) => (
                      <label
                        key={group.id}
                        className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-900 cursor-pointer text-xs font-semibold text-slate-200"
                      >
                        <input
                          type="checkbox"
                          checked={selectedGroupIds.includes(group.id)}
                          onChange={() => toggleGroup(group.id)}
                          className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="truncate">{group.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2.5 pt-2">
                <input
                  type="checkbox"
                  id="isEnabled"
                  checked={isEnabled}
                  onChange={(e) => setIsEnabled(e.target.checked)}
                  className="w-5 h-5 rounded bg-slate-950 border-slate-800 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <label htmlFor="isEnabled" className="text-sm font-semibold text-slate-200 cursor-pointer">
                  Portal jest włączony (aktywne pobieranie faktur)
                </label>
              </div>

              {/* Web Push Notification Triggers Section */}
              <div className="pt-3 border-t border-slate-800 space-y-2.5">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Powiadomienia na telefon (Android / PWA)
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Wybierz, które alerty mają być wysyłane dla tego portalu (zbiorczy poranny raport o 08:30):
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 cursor-pointer text-xs font-medium text-slate-300">
                    <input
                      type="checkbox"
                      checked={notifyNewBill}
                      onChange={(e) => setNotifyNewBill(e.target.checked)}
                      className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span>Nowy rachunek</span>
                  </label>
                  <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 cursor-pointer text-xs font-medium text-slate-300">
                    <input
                      type="checkbox"
                      checked={notifyDueSoon}
                      onChange={(e) => setNotifyDueSoon(e.target.checked)}
                      className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span>Termin do 3 dni</span>
                  </label>
                  <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 cursor-pointer text-xs font-medium text-slate-300">
                    <input
                      type="checkbox"
                      checked={notifyOverdue}
                      onChange={(e) => setNotifyOverdue(e.target.checked)}
                      className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span>Po terminie</span>
                  </label>
                </div>
              </div>

              <button
                type="submit"
                disabled={formSubmitting}
                className="w-full mt-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 px-4 rounded-xl text-base transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-50"
              >
                <Plus className="w-5 h-5" />
                <span>{formSubmitting ? 'Zapisywanie...' : editingPortal ? 'Zapisz zmiany' : 'Dodaj dostawcę'}</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Duplicate Portal Modal */}
      {isDuplicateModalOpen && duplicatingPortal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl relative my-8">
            <button
              onClick={() => setIsDuplicateModalOpen(false)}
              className="absolute right-5 top-5 p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
                <Copy className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Duplikuj Dostawcę</h3>
                <p className="text-xs text-slate-300">
                  Kopiowanie konfiguracji dla <span className="text-indigo-400 font-semibold">{duplicatingPortal.name}</span>
                </p>
              </div>
            </div>

            {/* Info notice about credentials */}
            <div className="mb-5 p-3.5 bg-indigo-950/40 border border-indigo-500/30 rounded-xl flex items-start gap-3 text-xs text-indigo-200">
              <Key className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-white">Dane logowania i hasło zostaną skopiowane automatycznie.</span>
                <p className="text-slate-400 mt-1">
                  Dostawca: <span className="font-medium text-slate-200">{duplicatingPortal.providerName || duplicatingPortal.providerId}</span> ({duplicatingPortal.loginMasked})
                </p>
              </div>
            </div>

            {duplicateError && (
              <div className="mb-4 p-3.5 bg-rose-950/60 border border-rose-600/60 rounded-xl text-rose-200 text-sm font-semibold">
                {duplicateError}
              </div>
            )}

            <form onSubmit={handleDuplicateSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1.5">
                  Nazwa nowego dostawcy
                </label>
                <input
                  type="text"
                  required
                  value={duplicateName}
                  onChange={(e) => setDuplicateName(e.target.value)}
                  placeholder="np. Tauron Garaż, PGNiG Mieszkanie 2"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1.5">
                  Filtr umów / adresu (Regex) <span className="text-slate-400 font-normal text-xs">(opcjonalne)</span>
                </label>
                <input
                  type="text"
                  value={duplicateAgreementFilter}
                  onChange={(e) => setDuplicateAgreementFilter(e.target.value)}
                  placeholder="np. Kwiatowa|Polna, Garaż.* lub Lokal 2"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none transition-colors font-mono"
                />
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  Dostosuj filtr wyrażenia regularnego, aby ten zduplikowany portal pobierał inne punkty poboru lub umowy z tego samego konta eBOK.
                </p>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1.5 flex items-center justify-between">
                  <span>Odbiorca płatności (nazwa do przelewu)</span>
                  <span className="text-xs font-normal text-slate-400">Opcjonalnie</span>
                </label>
                <input
                  type="text"
                  value={duplicatePaymentReceiver}
                  onChange={(e) => setDuplicatePaymentReceiver(e.target.value)}
                  placeholder="np. Wspólnota Mieszkaniowa ul. Miarki 5"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1.5 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-400" />
                  <span>Częstotliwość automatycznego odświeżania na dobę</span>
                </label>
                <select
                  value={duplicateSyncFrequency}
                  onChange={(e) => setDuplicateSyncFrequency(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-white focus:outline-none transition-colors"
                >
                  <option value={1}>1 raz na dobę (standard — nocne o 03:00)</option>
                  <option value={2}>2 razy na dobę (co 12h: o 03:00 i 15:00)</option>
                  <option value={3}>3 razy na dobę (co 8h: o 03:00, 11:00, 19:00)</option>
                  <option value={4}>4 razy na dobę (co 6h: o 03:00, 09:00, 15:00, 21:00)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1">
                  Przypisz do grup / lokali
                </label>
                {groups.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">Brak grup w systemie.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto bg-slate-950 p-3 rounded-xl border border-slate-800">
                    {groups.map((group) => (
                      <label
                        key={group.id}
                        className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-900 cursor-pointer text-xs font-semibold text-slate-200"
                      >
                        <input
                          type="checkbox"
                          checked={duplicateGroupIds.includes(group.id)}
                          onChange={() => toggleDuplicateGroup(group.id)}
                          className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="truncate">{group.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2.5 pt-2">
                <input
                  type="checkbox"
                  id="duplicateIsEnabled"
                  checked={duplicateIsEnabled}
                  onChange={(e) => setDuplicateIsEnabled(e.target.checked)}
                  className="w-5 h-5 rounded bg-slate-950 border-slate-800 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <label htmlFor="duplicateIsEnabled" className="text-sm font-semibold text-slate-200 cursor-pointer">
                  Portal jest włączony (aktywne pobieranie faktur)
                </label>
              </div>

              {/* Duplicate Web Push Notification Triggers */}
              <div className="pt-3 border-t border-slate-800 space-y-2.5">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Powiadomienia na telefon
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 cursor-pointer text-xs font-medium text-slate-300">
                    <input
                      type="checkbox"
                      checked={duplicateNotifyNewBill}
                      onChange={(e) => setDuplicateNotifyNewBill(e.target.checked)}
                      className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span>Nowy rachunek</span>
                  </label>
                  <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 cursor-pointer text-xs font-medium text-slate-300">
                    <input
                      type="checkbox"
                      checked={duplicateNotifyDueSoon}
                      onChange={(e) => setDuplicateNotifyDueSoon(e.target.checked)}
                      className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span>Termin do 3 dni</span>
                  </label>
                  <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 cursor-pointer text-xs font-medium text-slate-300">
                    <input
                      type="checkbox"
                      checked={duplicateNotifyOverdue}
                      onChange={(e) => setDuplicateNotifyOverdue(e.target.checked)}
                      className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span>Po terminie</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsDuplicateModalOpen(false)}
                  className="w-1/3 py-3.5 px-4 rounded-xl text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  disabled={duplicateSubmitting}
                  className="w-2/3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 px-4 rounded-xl text-base transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-50"
                >
                  <Copy className="w-5 h-5" />
                  <span>{duplicateSubmitting ? 'Duplikowanie...' : 'Zduplikuj dostawcę'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Session / Cookies Modal */}
      {isSessionModalOpen && sessionPortal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative my-8">
            <button
              onClick={() => setIsSessionModalOpen(false)}
              className="absolute right-5 top-5 p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
                <Key className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Import sesji / ciasteczek</h3>
                <p className="text-xs text-slate-300">
                  Dla portalu: <span className="text-amber-400 font-semibold">{sessionPortal.name}</span> ({sessionPortal.providerName || sessionPortal.providerId})
                </p>
              </div>
            </div>

            <div className="mb-5 p-3.5 bg-amber-950/40 border border-amber-500/30 rounded-xl space-y-2 text-xs text-amber-200">
              <div className="flex items-center gap-2 font-semibold text-white">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Ominięcie ochrony antybotowej (WAF / Akamai)</span>
              </div>
              <p className="text-slate-300 leading-relaxed">
                Niektóre portale dostawców stosują zaawansowaną ochronę botów (np. Cloudflare, Akamai), która blokuje automatyczne wypełnianie formularzy logowania.
              </p>
              <div className="text-slate-300 pt-1 border-t border-amber-500/20 space-y-1">
                <p className="font-semibold text-amber-300">Jak pobrać sesję ze swojej przeglądarki:</p>
                <ol className="list-decimal list-inside space-y-1 text-slate-300">
                  <li>Zaloguj się w normalnej przeglądarce do serwisu dostawcy.</li>
                  <li>Użyj rozszerzenia <span className="text-white font-mono">Cookie-Editor</span> i kliknij <strong className="text-white">Export &rarr; JSON</strong> (lub skopiuj nagłówek Cookie).</li>
                  <li>Wklej skopiowany kod poniżej i kliknij <strong className="text-white">Zapisz i synchronizuj</strong>.</li>
                </ol>
              </div>
            </div>

            {sessionError && (
              <div className="mb-4 p-3.5 bg-rose-950/60 border border-rose-600/60 rounded-xl text-rose-200 text-sm font-semibold">
                {sessionError}
              </div>
            )}

            <form onSubmit={handleImportSession} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1.5">
                  Dane sesji (JSON ciasteczek z Cookie-Editor lub Playwright storageState)
                </label>
                <textarea
                  required
                  rows={8}
                  value={sessionDataText}
                  onChange={(e) => setSessionDataText(e.target.value)}
                  placeholder={`[
  {
    "name": "session_id",
    "value": "...",
    "domain": ".dostawca.pl",
    "path": "/"
  }
]`}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl p-3 text-xs text-white placeholder-slate-600 focus:outline-none transition-colors font-mono"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsSessionModalOpen(false)}
                  className="w-1/3 py-3.5 px-4 rounded-xl text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  disabled={sessionSubmitting || !sessionDataText.trim()}
                  className="w-2/3 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold py-3.5 px-4 rounded-xl text-base transition-colors flex items-center justify-center gap-2 shadow-lg shadow-amber-600/20 disabled:opacity-50"
                >
                  <Key className="w-5 h-5 text-slate-950" />
                  <span>{sessionSubmitting ? 'Zapisywanie...' : 'Zapisz i synchronizuj'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

