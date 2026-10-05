import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, FileText, ArrowUpRight, Zap, RefreshCw, QrCode } from 'lucide-react';
import { api } from '../lib/api.js';
import { formatCurrency, formatDate, formatFullDate, getPaymentStatusLabel } from '../lib/utils.js';
import type { BillsSummaryDto, BillDto } from '@bills-master/shared-types';
import { PaymentQrModal } from '../components/bills/PaymentQrModal.js';
import { PdfViewerModal } from '../components/bills/PdfViewerModal.js';

interface DashboardPageProps {
  onNavigate: (tab: string) => void;
  onManualSyncAll: () => void;
  isSyncing: boolean;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  onNavigate,
  onManualSyncAll,
  isSyncing,
}) => {
  const [summary, setSummary] = useState<BillsSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedQrBill, setSelectedQrBill] = useState<BillDto | null>(null);
  const [selectedPdfBill, setSelectedPdfBill] = useState<BillDto | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchSummary = async () => {
    try {
      const res = await api.get<{ summary: BillsSummaryDto }>('/api/bills/summary');
      setSummary(res.summary);
    } catch (err) {
      console.error('Błąd podczas pobierania podsumowania:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePaid = async (bill: BillDto) => {
    if (togglingId === bill.id) return;
    setTogglingId(bill.id);
    try {
      const isCurrentlyPaid = bill.paymentStatus === 'PAID';
      await api.patch(`/api/bills/${bill.id}/payment-status`, {
        isPaid: !isCurrentlyPaid,
      });
      await fetchSummary();
    } catch (err: any) {
      alert(err.message || 'Nie udało się zmienić statusu płatności');
    } finally {
      setTogglingId(null);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const hasBills = summary && (summary.recentBills.length > 0 || summary.upcomingDueBills.length > 0);

  return (
    <div className="space-y-6">
      {/* Top Banner / Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">Podsumowanie Rachunków</h1>
          <p className="text-base text-slate-300">Przegląd bieżących opłat, nadchodzących terminów i historii.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate('accounts')}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-sm font-semibold transition-colors"
          >
            Dostawcy mediów
          </button>
          <button
            onClick={onManualSyncAll}
            disabled={isSyncing}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 shadow-lg shadow-blue-600/20 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>Pobierz nowe rachunki</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Unpaid */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-300 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Do zapłaty łącznie</span>
            <Clock className="w-5 h-5 text-amber-400" />
          </div>
          <div className="text-3xl font-black text-white tracking-tight">
            {formatCurrency(summary?.totalUnpaidAmount || 0)}
          </div>
          <div className="text-sm text-slate-400 mt-1 font-medium">
            {summary?.unpaidCount || 0} {summary?.unpaidCount === 1 ? 'nieopłacony rachunek' : 'nieopłaconych rachunków'}
          </div>
        </div>

        {/* Overdue */}
        <div className={`border rounded-2xl p-5 backdrop-blur-sm ${
          (summary?.overdueCount || 0) > 0 
            ? 'bg-rose-950/40 border-rose-600/70' 
            : 'bg-slate-900/70 border-slate-800'
        }`}>
          <div className="flex items-center justify-between text-slate-300 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Po terminie</span>
            <AlertTriangle className={`w-5 h-5 ${(summary?.overdueCount || 0) > 0 ? 'text-rose-400' : 'text-slate-500'}`} />
          </div>
          <div className={`text-3xl font-black tracking-tight ${(summary?.overdueCount || 0) > 0 ? 'text-rose-400' : 'text-white'}`}>
            {summary?.overdueCount || 0}
          </div>
          <div className="text-sm text-slate-300 mt-1 font-semibold">
            {(summary?.overdueCount || 0) > 0 ? '⚠️ Wymaga pilnej opłaty!' : 'Wszystkie płatności w terminie'}
          </div>
        </div>

        {/* Paid Total */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-300 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Opłacone</span>
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="text-3xl font-black text-white tracking-tight">
            {formatCurrency(summary?.totalPaidAmount || 0)}
          </div>
          <div className="text-sm text-slate-400 mt-1 font-medium">Suma opłaconych rachunków</div>
        </div>

        {/* Upcoming Deadline */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-300 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Najbliższy termin</span>
            <Zap className="w-5 h-5 text-blue-400" />
          </div>
          <div className="text-xl font-bold text-white tracking-tight">
            {summary?.upcomingDueBills[0] ? formatDate(summary.upcomingDueBills[0].dueDate) : 'Brak oczekujących'}
          </div>
          <div className="text-sm text-slate-400 mt-1 truncate">
            {summary?.upcomingDueBills[0]?.portal?.name || 'Wszystko opłacone'}
          </div>
        </div>
      </div>

      {!hasBills ? (
        /* Empty State */
        <div className="text-center py-16 px-4 border border-dashed border-slate-800 rounded-2xl bg-slate-900/30">
          <div className="w-14 h-14 rounded-2xl bg-blue-600/15 text-blue-400 flex items-center justify-center mx-auto mb-3">
            <Zap className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-bold text-white">Brak pobranych rachunków</h3>
          <p className="text-sm text-slate-400 max-w-sm mx-auto mt-1 mb-4">
            Podłącz swój pierwszy portal dostawcy mediów (np. Tauron eBOK), aby rozpocząć automatyczne pobieranie rachunków.
          </p>
          <button
            onClick={() => onNavigate('accounts')}
            className="px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-blue-600/20"
          >
            Zobacz dostawców
          </button>
        </div>
      ) : (
        /* Main Tables Grid */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Upcoming Bills (2 cols) */}
          <div className="lg:col-span-2 bg-slate-900/70 border border-slate-800 rounded-2xl p-6 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-white">Nadchodzące Płatności</h2>
                <p className="text-xs text-slate-400">Rachunki wymagające zapłaty w najbliższym czasie</p>
              </div>
              <button
                onClick={() => onNavigate('bills')}
                className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1 font-semibold"
              >
                <span>Wszystkie rachunki</span>
                <ArrowUpRight className="w-4 h-4" />
              </button>
            </div>

            {summary?.upcomingDueBills.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400 font-medium">
                🎉 Brak nadchodzących płatności! Wszystkie rachunki są opłacone.
              </div>
            ) : (
              <div className="space-y-3">
                {summary?.upcomingDueBills.map((bill) => (
                  <div
                    key={bill.id}
                    className="flex items-center justify-between p-4 bg-slate-950/70 border border-slate-800 rounded-xl hover:border-slate-700 transition-colors"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-11 h-11 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center shrink-0">
                        <Zap className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-base font-bold text-white flex items-center gap-2">
                          <span>{bill.portal?.name || bill.portal?.providerName || 'Dostawca'}</span>
                          <span className="text-xs text-slate-400 font-mono">({bill.invoiceNumber})</span>
                        </div>
                        <div className="text-sm text-slate-300">
                          Termin: <span className="text-amber-400 font-semibold">{formatFullDate(bill.dueDate)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-base sm:text-lg font-black text-white">{formatCurrency(bill.amountDue, bill.currency)}</div>
                        <span className="inline-block px-2.5 py-0.5 rounded-lg text-xs font-bold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          {getPaymentStatusLabel(bill.paymentStatus)}
                        </span>
                      </div>

                      {Boolean(
                        bill.isMailScript ||
                        bill.portal?.isMailScript ||
                        bill.portal?.providerId === 'mail-script' ||
                        (bill.rawMetadata as any)?.source === 'GOOGLE_APPS_SCRIPT'
                      ) && (
                        <button
                          onClick={() => handleTogglePaid(bill)}
                          disabled={togglingId === bill.id}
                          className="p-2.5 text-emerald-400 hover:text-white bg-emerald-600/20 hover:bg-emerald-600 border border-emerald-500/30 rounded-xl transition-all shadow-sm"
                          title="Oznacz ten rachunek jako zapłacony"
                        >
                          {togglingId === bill.id ? (
                            <RefreshCw className="w-5 h-5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-5 h-5" />
                          )}
                        </button>
                      )}

                      {bill.hasPdf && (
                        <button
                          onClick={() => setSelectedPdfBill(bill)}
                          className="p-2.5 text-blue-400 hover:text-white bg-blue-600/20 hover:bg-blue-600 border border-blue-500/30 rounded-xl transition-all shadow-sm"
                          title="Podgląd faktury PDF"
                        >
                          <FileText className="w-5 h-5" />
                        </button>
                      )}

                      <button
                        onClick={() => setSelectedQrBill(bill)}
                        className="p-2.5 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-700/60 rounded-xl transition-all shadow-sm"
                        title="Pokaż kod QR do płatności bankowej"
                      >
                        <QrCode className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Invoices Activity (1 col) */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-white">Ostatnie Faktury</h2>
                <p className="text-xs text-slate-400">Najnowsze pobrane pozycje</p>
              </div>
              <button
                onClick={() => onNavigate('bills')}
                className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1 font-semibold"
              >
                <span>Historia</span>
                <ArrowUpRight className="w-4 h-4" />
              </button>
            </div>

            <div className="divide-y divide-slate-800/80">
              {summary?.recentBills.map((bill) => (
                <div key={bill.id} className="py-3.5 flex items-center justify-between first:pt-0 last:pb-0">
                  <div>
                    <div className="text-sm font-bold text-white">{bill.portal?.name || bill.portal?.providerName || 'Dostawca'}</div>
                    <div className="text-xs text-slate-400">{formatDate(bill.issueDate)}</div>
                  </div>
                  <div className="text-right flex items-center gap-2">
                    <div>
                      <div className="text-sm font-bold text-slate-200">{formatCurrency(bill.amountDue, bill.currency)}</div>
                      <span className={`text-xs font-semibold block ${
                        bill.paymentStatus === 'PAID' ? 'text-emerald-400' : 'text-amber-400'
                      }`}>
                        {getPaymentStatusLabel(bill.paymentStatus)}
                      </span>
                    </div>
                    {bill.hasPdf && (
                      <button
                        onClick={() => setSelectedPdfBill(bill)}
                        className="p-1.5 text-blue-400 hover:text-white hover:bg-blue-600 rounded-lg transition-colors"
                        title="Podgląd faktury PDF"
                      >
                        <FileText className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedQrBill(bill)}
                      className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                      title="Pokaż kod QR do płatności bankowej"
                    >
                      <QrCode className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Payment QR Modal */}
      <PaymentQrModal
        bill={selectedQrBill}
        onClose={() => setSelectedQrBill(null)}
        onBillUpdated={() => fetchSummary()}
      />

      {/* PDF Viewer Modal */}
      <PdfViewerModal bill={selectedPdfBill} onClose={() => setSelectedPdfBill(null)} />
    </div>
  );
};
