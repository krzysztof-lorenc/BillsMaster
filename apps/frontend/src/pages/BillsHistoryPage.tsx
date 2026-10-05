import React, { useEffect, useState } from 'react';
import { 
  FileText, 
  Search, 
  RefreshCw, 
  X, 
  Building2, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  Zap, 
  Flame, 
  Droplets, 
  Wifi, 
  Copy, 
  Check, 
  Download, 
  CreditCard,
  Calendar,
  QrCode,
  Layers
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import { useTheme } from '../context/ThemeContext.js';
import { 
  formatCurrency, 
  formatDate, 
  formatFullDate, 
  formatBankAccount, 
  getCategoryLabel, 
  getDueStatusInfo 
} from '../lib/utils.js';
import type { BillDto, UserGroupInfo } from '@bills-master/shared-types';
import { PaymentQrModal } from '../components/bills/PaymentQrModal.js';
import { PdfViewerModal } from '../components/bills/PdfViewerModal.js';

const FILTER_OPTIONS = [
  { id: 'PAY_30', label: 'Do zapłaty w 30 dni' },
  { id: 'ALL', label: 'Wszystkie rachunki' },
  { id: 'UNPAID', label: 'Niezapłacone' },
  { id: 'OVERDUE', label: 'Po terminie (pilne!)' },
  { id: 'PAID', label: 'Opłacone' },
];

export const BillsHistoryPage: React.FC = () => {
  const { user } = useAuth();
  const { isLight } = useTheme();
  const [groups, setGroups] = useState<UserGroupInfo[]>(user?.groups || []);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(() => {
    return user?.groups && user.groups.length > 0 ? user.groups[0].id : null;
  });
  const [isInitialized, setIsInitialized] = useState(false);

  const [bills, setBills] = useState<BillDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('PAY_30');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [selectedQrBill, setSelectedQrBill] = useState<BillDto | null>(null);
  const [selectedPdfBill, setSelectedPdfBill] = useState<BillDto | null>(null);
  const [togglingBillId, setTogglingBillId] = useState<string | null>(null);

  const handleBillUpdated = (updatedBill: BillDto) => {
    setBills((prev) => prev.map((b) => (b.id === updatedBill.id ? updatedBill : b)));
    if (selectedQrBill && selectedQrBill.id === updatedBill.id) {
      setSelectedQrBill(updatedBill);
    }
  };

  const handleTogglePaid = async (bill: BillDto) => {
    if (togglingBillId === bill.id) return;
    setTogglingBillId(bill.id);
    try {
      const isCurrentlyPaid = bill.paymentStatus === 'PAID';
      const res = await api.patch<{ bill: BillDto }>(`/api/bills/${bill.id}/payment-status`, {
        isPaid: !isCurrentlyPaid,
      });
      handleBillUpdated(res.bill);
    } catch (err: any) {
      alert(err.message || 'Nie udało się zmienić statusu płatności');
    } finally {
      setTogglingBillId(null);
    }
  };

  // Load user groups on mount
  useEffect(() => {
    let isMounted = true;
    const fetchUserGroups = async () => {
      try {
        const res = await api.get<{ groups: UserGroupInfo[] }>('/api/groups');
        if (!isMounted) return;
        setGroups(res.groups);
        if (res.groups.length > 0) {
          setSelectedGroupId((prev) => {
            // Keep previous selected group if it still exists in fetched groups
            if (prev && res.groups.some((g) => g.id === prev)) {
              return prev;
            }
            // Otherwise select the first group on open
            return res.groups[0].id;
          });
        } else {
          setSelectedGroupId(null);
        }
      } catch (err) {
        console.error('Błąd podczas pobierania grup użytkownika:', err);
      } finally {
        if (isMounted) {
          setIsInitialized(true);
        }
      }
    };

    fetchUserGroups();
    return () => {
      isMounted = false;
    };
  }, []);

  const fetchBills = async (groupId: string | null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') {
        params.append('status', statusFilter);
      }
      if (groupId) {
        params.append('groupId', groupId);
      }
      const qs = params.toString();
      const url = qs ? `/api/bills?${qs}` : '/api/bills';
      const res = await api.get<{ bills: BillDto[] }>(url);
      setBills(res.bills);
    } catch (err) {
      console.error('Błąd podczas pobierania rachunków:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isInitialized) return;

    if (selectedGroupId) {
      fetchBills(selectedGroupId);
    } else {
      setBills([]);
      setLoading(false);
    }
  }, [selectedGroupId, statusFilter, isInitialized]);

  const handleDownloadPdf = async (billId: string, invoiceNumber: string) => {
    setDownloadingId(billId);
    try {
      await api.download(`/api/bills/${billId}/pdf`, `Faktura_${invoiceNumber.replace(/\//g, '_')}.pdf`);
    } catch (err: any) {
      alert(err.message || 'Nie udało się pobrać pliku faktury.');
    } finally {
      setDownloadingId(null);
    }
  };

  const copyToClipboard = async (text: string, fieldKey: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldKey);
      setTimeout(() => {
        setCopiedField((current) => (current === fieldKey ? null : current));
      }, 2500);
    } catch {
      // Fallback
      alert('Nie udało się automatycznie skopiować. Zaznacz tekst myszką i skopiuj ręcznie.');
    }
  };

  // Helper for provider icon
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
      case 'HOUSING':
        return <Building2 className="w-6 h-6 text-emerald-400" />;
      default:
        return <CreditCard className="w-6 h-6 text-blue-400" />;
    }
  };

  // Filter bills based on search query
  const filteredBills = bills.filter((b: BillDto) => {
    if (statusFilter === 'PAY_30') {
      if (b.paymentStatus === 'PAID') {
        return false;
      }
      const due = new Date(b.dueDate).getTime();
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const in30Days = new Date(now);
      in30Days.setDate(in30Days.getDate() + 30);
      in30Days.setHours(23, 59, 59, 999);
      if (due > in30Days.getTime()) {
        return false;
      }
    } else if (statusFilter === 'UNPAID') {
      if (b.paymentStatus === 'PAID') {
        return false;
      }
    } else if (statusFilter === 'OVERDUE') {
      if (b.paymentStatus === 'PAID') {
        return false;
      }
      const dueInfo = getDueStatusInfo(b.dueDate, b.paymentStatus);
      if (!dueInfo.isOverdue) {
        return false;
      }
    }

    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      b.invoiceNumber.toLowerCase().includes(q) ||
      (b.portal?.name && b.portal.name.toLowerCase().includes(q)) ||
      (b.portal?.providerName && b.portal.providerName.toLowerCase().includes(q)) ||
      (b.portal?.category && b.portal.category.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6 pb-12">

      {/* Top Group Switcher Bar (visible ONLY if user is assigned to multiple groups) */}
      {groups.length > 1 && (
        <div className={`${isLight ? 'bg-white border-2 border-slate-200 shadow-md' : 'bg-slate-900/90 border-2 border-slate-800 shadow-xl'} rounded-3xl p-3.5 sm:p-4 backdrop-blur-md`}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className={`flex items-center gap-2.5 px-1 ${isLight ? 'text-slate-500' : 'text-slate-400'} shrink-0`}>
              <Layers className="w-5 h-5 text-blue-500" />
              <span className={`text-xs sm:text-sm font-bold uppercase tracking-wider ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                Grupa / Lokal:
              </span>
            </div>
            <div className="flex items-center gap-2.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none flex-wrap sm:flex-nowrap">
              {groups.map((group) => {
                const isSelected = selectedGroupId === group.id;
                return (
                  <button
                    key={group.id}
                    onClick={() => setSelectedGroupId(group.id)}
                    title={group.description || group.name}
                    className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-sm sm:text-base font-bold whitespace-nowrap transition-all border-2 ${
                      isSelected
                        ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-600/30'
                        : isLight
                        ? 'bg-slate-100 border-slate-200 text-slate-700 hover:border-slate-300 hover:text-slate-900'
                        : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    <span>{group.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Filters and Search */}
      <div className="space-y-4">
        {/* Search Bar - Large & Clear */}
        <div className="relative">
          <Search className={`w-5 h-5 sm:w-6 sm:h-6 ${isLight ? 'text-slate-400' : 'text-slate-400'} absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none`} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Wyszukaj rachunek, dostawcę lub numer..."
            className={`w-full ${
              isLight
                ? 'bg-white border-2 border-slate-200 focus:border-blue-500 text-slate-900 placeholder-slate-400 shadow-sm'
                : 'bg-slate-900 border-2 border-slate-800 focus:border-blue-500 text-white placeholder-slate-400 shadow-inner'
            } rounded-2xl pl-12 sm:pl-14 pr-12 py-3.5 sm:py-4 text-base sm:text-lg focus:outline-none transition-colors`}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className={`absolute right-3.5 top-1/2 -translate-y-1/2 p-2 ${
                isLight ? 'text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200' : 'text-slate-400 hover:text-white bg-slate-800'
              } rounded-xl transition-colors`}
              title="Wyczyść wyszukiwanie"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Filter Pills - Large Comfortable Buttons */}
        <div className="flex items-center gap-2.5 overflow-x-auto pb-2 scrollbar-none">
          {FILTER_OPTIONS.map((f) => {
            const isActive = statusFilter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                className={`px-5 py-3 rounded-2xl text-sm sm:text-base font-bold whitespace-nowrap transition-all border-2 ${
                  isActive
                    ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-600/30'
                    : isLight
                    ? 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:text-slate-900 shadow-sm'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* BILLS LIST AS CARDS */}
      {loading ? (
        <div className="py-20 text-center bg-slate-900/40 border border-slate-800 rounded-3xl">
          <RefreshCw className="w-10 h-10 animate-spin text-blue-500 mx-auto" />
          <p className="text-lg text-slate-300 mt-4 font-semibold">Wczytywanie Twoich rachunków...</p>
        </div>
      ) : filteredBills.length === 0 ? (
        <div className="py-20 text-center bg-slate-900/40 border-2 border-dashed border-slate-800 rounded-3xl p-8">
          <div className="w-16 h-16 rounded-2xl bg-blue-600/15 text-blue-400 flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Brak rachunków w wybranej kategorii</h3>
          <p className="text-base text-slate-400 max-w-md mx-auto">
            {searchQuery
              ? `Nie znaleziono rachunków pasujących do frazy "${searchQuery}". Spróbuj zmienić wyszukiwane słowo.`
              : 'W tej chwili nie ma żadnych rachunków spełniających wybrane kryteria.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredBills.map((bill: BillDto) => {
            const dueInfo = getDueStatusInfo(bill.dueDate, bill.paymentStatus);
            const isPaid = bill.paymentStatus === 'PAID';
            const isOverdue = dueInfo.isOverdue;
            const categoryLabel = getCategoryLabel(bill.portal?.category);
            const formattedAccount = formatBankAccount(bill.bankAccountNumber);
            const isMailScript = Boolean(
              bill.isMailScript ||
              bill.portal?.isMailScript ||
              bill.portal?.providerId === 'mail-script' ||
              (bill.rawMetadata as any)?.source === 'GOOGLE_APPS_SCRIPT'
            );

            // Card border and background color based on status
            let cardBorder = isLight
              ? 'border-slate-200 hover:border-slate-300'
              : 'border-slate-800';
            let cardBg = isLight
              ? 'bg-white shadow-md'
              : 'bg-slate-900/90';

            if (isOverdue) {
              cardBorder = isLight
                ? 'border-rose-300 hover:border-rose-400'
                : 'border-rose-600/80 hover:border-rose-500';
              cardBg = isLight
                ? 'bg-white shadow-md ring-1 ring-rose-200'
                : 'bg-gradient-to-b from-rose-950/30 to-slate-900/90';
            } else if (!isPaid) {
              cardBorder = isLight
                ? 'border-amber-200 hover:border-amber-300'
                : 'border-amber-500/60 hover:border-amber-400';
              cardBg = isLight
                ? 'bg-white shadow-md ring-1 ring-amber-200/60'
                : 'bg-gradient-to-b from-amber-950/20 to-slate-900/90';
            } else {
              cardBorder = isLight
                ? 'border-slate-200 hover:border-emerald-200'
                : 'border-slate-800 hover:border-emerald-800/80';
            }

            return (
              <div
                key={bill.id}
                className={`border-2 ${cardBorder} ${cardBg} rounded-3xl p-6 sm:p-7 transition-all flex flex-col justify-between`}
              >
                {/* Top: Provider & Status Pill */}
                <div>
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3.5">
                      <div className={`w-14 h-14 rounded-2xl ${isLight ? 'bg-slate-50 border border-slate-200 shadow-sm' : 'bg-slate-800 border border-slate-700/80 shadow-md'} flex items-center justify-center shrink-0`}>
                        {getProviderIcon(bill.portal?.category)}
                      </div>
                      <div>
                        <h2 className={`text-xl sm:text-2xl font-bold ${isLight ? 'text-slate-900' : 'text-white'} leading-snug`}>
                          {bill.portal?.name || bill.portal?.providerName || 'Dostawca mediów'}
                        </h2>
                        <span className={`inline-block px-2.5 py-0.5 mt-0.5 rounded-lg text-xs font-semibold uppercase tracking-wider ${isLight ? 'bg-slate-100 text-slate-600 border border-slate-200' : 'bg-slate-800 text-slate-300'}`}>
                          {categoryLabel}
                        </span>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div className="shrink-0">
                      {isPaid ? (
                        <span className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-sm font-bold ${isLight ? 'bg-emerald-50 text-emerald-700 border border-emerald-300' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'}`}>
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Opłacony</span>
                        </span>
                      ) : isOverdue ? (
                        <span className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-sm font-bold ${isLight ? 'bg-rose-50 text-rose-700 border border-rose-300 animate-pulse' : 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'}`}>
                          <AlertTriangle className="w-4 h-4" />
                          <span>Po terminie!</span>
                        </span>
                      ) : (
                        <span className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-sm font-bold ${isLight ? 'bg-amber-50 text-amber-800 border border-amber-300' : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'}`}>
                          <Clock className="w-4 h-4" />
                          <span>Do zapłaty</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Amount Section */}
                  <div className={`my-5 p-4 sm:p-5 ${isLight ? 'bg-slate-50 border border-slate-200' : 'bg-slate-950/70 border border-slate-800'} rounded-2xl`}>
                    <div className={`text-xs sm:text-sm font-semibold uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-slate-400'} mb-1`}>
                      Kwota do zapłaty:
                    </div>
                    <div className={`text-3xl sm:text-4xl lg:text-5xl font-black ${isLight ? 'text-slate-900' : 'text-white'} tracking-tight`}>
                      {formatCurrency(bill.amountDue, bill.currency)}
                    </div>
                  </div>

                  {/* Due Date Alert / Status Banner */}
                  <div
                    className={`p-3.5 rounded-2xl mb-4 border flex items-center gap-3 text-sm sm:text-base font-semibold ${
                      isPaid
                        ? isLight
                          ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                          : 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50'
                        : isOverdue
                        ? isLight
                          ? 'bg-rose-50 text-rose-900 border-rose-200 shadow-sm'
                          : 'bg-rose-950/60 text-rose-200 border-rose-700/80 shadow-md'
                        : dueInfo.isUrgent
                        ? isLight
                          ? 'bg-amber-50 text-amber-900 border-amber-200'
                          : 'bg-amber-950/50 text-amber-200 border-amber-700/70'
                        : isLight
                        ? 'bg-slate-50 text-slate-800 border-slate-200'
                        : 'bg-slate-800/80 text-slate-200 border-slate-700'
                    }`}
                  >
                    <Calendar className="w-5 h-5 shrink-0" />
                    <div>
                      <span className="block">
                        Termin płatności: <strong className="underline decoration-2">{formatFullDate(bill.dueDate)}</strong>
                      </span>
                      <span className={`text-xs sm:text-sm font-medium ${isLight ? 'text-slate-600' : 'opacity-90'}`}>
                        {dueInfo.text}
                      </span>
                    </div>
                  </div>

                  {/* Invoice Details info */}
                  <div className={`grid grid-cols-2 gap-3 text-sm mb-5 ${isLight ? 'bg-slate-50 border border-slate-200 text-slate-700' : 'bg-slate-950/40 border border-slate-800/60 text-slate-300'} p-3.5 rounded-2xl`}>
                    <div>
                      <span className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'} block font-medium`}>Numer faktury:</span>
                      <span className={`font-mono font-bold ${isLight ? 'text-slate-900' : 'text-white'} break-all`}>{bill.invoiceNumber}</span>
                    </div>
                    <div>
                      <span className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'} block font-medium`}>Data wystawienia:</span>
                      <span className={`font-medium ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>{formatDate(bill.issueDate)}</span>
                    </div>
                  </div>

                </div>

                {/* Bottom Card Actions: PDF Preview, QR Code & Copy buttons */}
                <div className={`pt-4 border-t ${isLight ? 'border-slate-200' : 'border-slate-800/80'} space-y-2.5`}>
                  {isMailScript && (
                    <div className="mb-2">
                      {isPaid ? (
                        <button
                          type="button"
                          onClick={() => handleTogglePaid(bill)}
                          disabled={togglingBillId === bill.id}
                          className={`w-full py-2.5 px-4 rounded-2xl text-xs sm:text-sm font-semibold flex items-center justify-between border transition-all group ${
                            isLight
                              ? 'bg-emerald-50 hover:bg-emerald-100/90 text-emerald-800 border-emerald-300 shadow-sm'
                              : 'bg-emerald-950/40 hover:bg-emerald-950/70 text-emerald-300 border-emerald-700/60 shadow-sm'
                          } disabled:opacity-50`}
                          title="Kliknij, aby cofnąć oznaczenie jako zapłacone"
                        >
                          <span className="flex items-center gap-2">
                            {togglingBillId === bill.id ? (
                              <RefreshCw className="w-4 h-4 animate-spin text-emerald-500" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            )}
                            <span>Oznaczono jako zapłacone (poczta e-mail)</span>
                          </span>
                          <span className="text-xs underline decoration-dotted group-hover:decoration-solid opacity-75 group-hover:opacity-100">
                            Cofnij oznaczenie
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleTogglePaid(bill)}
                          disabled={togglingBillId === bill.id}
                          className="w-full py-3.5 px-4 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-2xl text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-600/30 border border-emerald-400/30 transition-all active:scale-[0.99] disabled:opacity-50"
                        >
                          {togglingBillId === bill.id ? (
                            <RefreshCw className="w-5 h-5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-5 h-5" />
                          )}
                          <span>Oznacz jako zapłacone</span>
                        </button>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row items-stretch gap-2.5">
                    {bill.hasPdf ? (
                      <div className="flex items-center gap-2 flex-1">
                        <button
                          onClick={() => setSelectedPdfBill(bill)}
                          className="flex-1 py-3.5 px-4 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-2xl text-sm sm:text-base transition-all flex items-center justify-center gap-2.5 shadow-lg shadow-blue-600/30 border border-blue-400/30 active:scale-[0.99]"
                          title="Otwórz podgląd faktury PDF"
                        >
                          <FileText className="w-5 h-5 text-blue-200" />
                          <span>Podgląd faktury</span>
                        </button>
                        <button
                          onClick={() => handleDownloadPdf(bill.id, bill.invoiceNumber)}
                          disabled={downloadingId === bill.id}
                          className={`py-3.5 px-3.5 ${isLight ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300 shadow-sm' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border-slate-700/80 shadow-sm'} font-bold rounded-2xl text-sm transition-all flex items-center justify-center border disabled:opacity-50`}
                          title="Pobierz plik faktury PDF"
                        >
                          {downloadingId === bill.id ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-1">
                        <button
                          disabled
                          className={`flex-1 py-3.5 px-4 ${isLight ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-slate-800/40 text-slate-500 border-slate-800'} font-bold rounded-2xl text-sm sm:text-base transition-all flex items-center justify-center gap-2.5 border opacity-50 cursor-not-allowed`}
                          title="Brak pliku PDF faktury"
                        >
                          <FileText className="w-5 h-5" />
                          <span>Brak faktury PDF</span>
                        </button>
                      </div>
                    )}

                    <button
                      onClick={() => setSelectedQrBill(bill)}
                      className={`flex-1 py-3.5 px-4 ${
                        isLight
                          ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300 shadow-sm'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border-slate-700/80 shadow-sm'
                      } font-bold rounded-2xl text-sm sm:text-base transition-all flex items-center justify-center gap-2.5 border active:scale-[0.99]`}
                      title="Pokaż kod QR do płatności bankowej"
                    >
                      <QrCode className={`w-5 h-5 ${isLight ? 'text-slate-600' : 'text-slate-400'}`} />
                      <span>Płatność QR</span>
                    </button>
                  </div>

                  <div className="flex flex-row items-stretch gap-1.5 sm:gap-2">
                    {bill.bankAccountNumber && (
                      <button
                        onClick={() => copyToClipboard(bill.bankAccountNumber!, `acc-${bill.id}`)}
                        className={`flex-1 min-w-0 py-2.5 sm:py-3 px-2 sm:px-3 rounded-2xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5 sm:gap-2 border shadow-sm ${
                          copiedField === `acc-${bill.id}`
                            ? 'bg-emerald-600 border-emerald-500 text-white'
                            : isLight
                            ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                            : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 border-slate-700/80 hover:text-white'
                        }`}
                        title={formattedAccount}
                      >
                        {copiedField === `acc-${bill.id}` ? (
                          <>
                            <Check className="w-4 h-4 text-white shrink-0" />
                            <span className="truncate">Skopiowano!</span>
                          </>
                        ) : (
                          <>
                            <Copy className={`w-4 h-4 shrink-0 ${isLight ? 'text-slate-500' : 'text-slate-400'}`} />
                            <span className="truncate hidden xl:inline">Skopiuj nr konta</span>
                            <span className="truncate xl:hidden">Nr konta</span>
                          </>
                        )}
                      </button>
                    )}

                    {(bill.paymentTitle || bill.invoiceNumber) && (
                      <button
                        onClick={() => copyToClipboard(bill.paymentTitle || bill.invoiceNumber, `title-${bill.id}`)}
                        className={`flex-1 min-w-0 py-2.5 sm:py-3 px-2 sm:px-3 rounded-2xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5 sm:gap-2 border shadow-sm ${
                          copiedField === `title-${bill.id}`
                            ? 'bg-emerald-600 border-emerald-500 text-white'
                            : isLight
                            ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                            : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 border-slate-700/80 hover:text-white'
                        }`}
                        title={bill.paymentTitle || bill.invoiceNumber}
                      >
                        {copiedField === `title-${bill.id}` ? (
                          <>
                            <Check className="w-4 h-4 text-white shrink-0" />
                            <span className="truncate">Skopiowano!</span>
                          </>
                        ) : (
                          <>
                            <Copy className={`w-4 h-4 shrink-0 ${isLight ? 'text-slate-500' : 'text-slate-400'}`} />
                            <span className="truncate hidden xl:inline">Skopiuj tytuł</span>
                            <span className="truncate xl:hidden">Tytuł</span>
                          </>
                        )}
                      </button>
                    )}

                    <button
                      onClick={() => copyToClipboard(bill.amountDue.toFixed(2), `amount-${bill.id}`)}
                      className={`flex-1 min-w-0 py-2.5 sm:py-3 px-2 sm:px-3 rounded-2xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5 sm:gap-2 border shadow-sm ${
                        copiedField === `amount-${bill.id}`
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : isLight
                          ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                          : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 border-slate-700/80 hover:text-white'
                      }`}
                      title={`${bill.amountDue.toFixed(2)} PLN`}
                    >
                      {copiedField === `amount-${bill.id}` ? (
                        <>
                          <Check className="w-4 h-4 text-white shrink-0" />
                          <span className="truncate">Skopiowano!</span>
                        </>
                      ) : (
                        <>
                          <Copy className={`w-4 h-4 shrink-0 ${isLight ? 'text-slate-500' : 'text-slate-400'}`} />
                          <span className="truncate hidden xl:inline">Skopiuj kwotę</span>
                          <span className="truncate xl:hidden">Kwota</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Payment QR Modal */}
      <PaymentQrModal
        bill={selectedQrBill}
        onClose={() => setSelectedQrBill(null)}
        onBillUpdated={handleBillUpdated}
      />

      {/* PDF Viewer Modal */}
      <PdfViewerModal bill={selectedPdfBill} onClose={() => setSelectedPdfBill(null)} />
    </div>
  );
};
