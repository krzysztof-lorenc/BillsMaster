import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { 
  X, 
  QrCode, 
  Copy, 
  Check, 
  Download, 
  AlertCircle, 
  Smartphone, 
  Building2, 
  ShieldCheck,
  Settings2,
  Share2,
  CheckCircle2,
  Clock,
  RefreshCw
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { 
  generateZbpQrString, 
  validateAndParseNrb 
} from '../../lib/zbpQr.js';
import { formatCurrency, formatFullDate } from '../../lib/utils.js';
import type { BillDto } from '@bills-master/shared-types';

interface PaymentQrModalProps {
  bill: BillDto | null;
  onClose: () => void;
  onBillUpdated?: (updatedBill: BillDto) => void;
}

export const PaymentQrModal: React.FC<PaymentQrModalProps> = ({ bill, onClose, onBillUpdated }) => {
  if (!bill) return null;

  const [currentBill, setCurrentBill] = useState<BillDto>(bill);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<boolean>(false);

  // Editable fields in case user needs to adjust or missing account
  const [accountNumber, setAccountNumber] = useState<string>(bill.bankAccountNumber || '');
  const [recipient, setRecipient] = useState<string>(
    bill.portal?.name || bill.portal?.providerName || 'Dostawca'
  );
  const [title, setTitle] = useState<string>(bill.paymentTitle || bill.invoiceNumber || 'Opłata za rachunek');
  const [amount, setAmount] = useState<number>(bill.amountDue || 0);
  const [removePolish, setRemovePolish] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  // Sync state when bill changes
  useEffect(() => {
    if (bill) {
      setCurrentBill(bill);
      setAccountNumber(bill.bankAccountNumber || '');
      setRecipient(bill.portal?.name || bill.portal?.providerName || 'Dostawca');
      setTitle(bill.paymentTitle || bill.invoiceNumber || 'Opłata za rachunek');
      setAmount(bill.amountDue || 0);
    }
  }, [bill]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const nrbInfo = validateAndParseNrb(accountNumber);
  const isValidNrb = nrbInfo.isValidLength;

  const qrString = generateZbpQrString({
    accountNumber,
    recipient,
    title,
    amount,
    removePolishChars: removePolish,
  });

  const isMailScript = Boolean(
    currentBill.isMailScript ||
    currentBill.portal?.isMailScript ||
    currentBill.portal?.providerId === 'mail-script' ||
    (currentBill.rawMetadata as any)?.source === 'GOOGLE_APPS_SCRIPT'
  );
  const isPaid = currentBill.paymentStatus === 'PAID';

  const handleTogglePaymentStatus = async () => {
    if (isUpdatingStatus) return;
    setIsUpdatingStatus(true);
    try {
      const nextPaid = !isPaid;
      const res = await api.patch<{ bill: BillDto }>(`/api/bills/${currentBill.id}/payment-status`, {
        isPaid: nextPaid,
      });
      setCurrentBill(res.bill);
      onBillUpdated?.(res.bill);
    } catch (err: any) {
      alert(err.message || 'Nie udało się zmienić statusu płatności');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 2500);
    } catch {
      alert('Nie udało się automatycznie skopiować tekstu.');
    }
  };

  const handleCopyAllDetails = async () => {
    const text = [
      `Odbiorca: ${recipient}`,
      `Nr rachunku: ${nrbInfo.formatted || accountNumber}`,
      `Tytuł przelewu: ${title}`,
      `Kwota: ${amount.toFixed(2)} PLN`,
    ].join('\n');
    await handleCopy(text, 'all-details');
  };

  const renderQrToCanvas = (): Promise<HTMLCanvasElement | null> => {
    return new Promise((resolve) => {
      const svg = document.getElementById('payment-qr-svg');
      if (!svg) return resolve(null);

      const svgData = new XMLSerializer().serializeToString(svg);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      img.onload = () => {
        const padding = 24;
        canvas.width = img.width + padding * 2;
        canvas.height = img.height + padding * 2;
        if (ctx) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, padding, padding);
        }
        resolve(canvas);
      };

      img.onerror = () => resolve(null);
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
    });
  };

  const handleDownloadPng = async () => {
    const canvas = await renderQrToCanvas();
    if (!canvas) return;
    const pngUrl = canvas.toDataURL('image/png');
    const downloadLink = document.createElement('a');
    downloadLink.href = pngUrl;
    downloadLink.download = `QR_Przelew_${bill.invoiceNumber.replace(/[\/\\:]/g, '_')}.png`;
    downloadLink.click();
  };

  const handleSharePng = async () => {
    const canvas = await renderQrToCanvas();
    if (!canvas) return;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], `QR_Przelew_${bill.invoiceNumber.replace(/[\/\\:]/g, '_')}.png`, {
        type: 'image/png',
      });
      if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `Kod QR przelewu: ${recipient}`,
            text: `Przelew dla: ${recipient}, kwota: ${amount.toFixed(2)} PLN, rachunek: ${nrbInfo.formatted}`,
          });
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            handleDownloadPng();
          }
        }
      } else {
        handleDownloadPng();
      }
    }, 'image/png');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-y-auto bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-2xl bg-slate-900 border-2 border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 sm:p-6 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center shrink-0">
              <QrCode className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  Płatność kodem QR
                </h2>
                <span className="hidden sm:inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-blue-500/10 text-blue-300 border border-blue-500/20">
                  Standard ZBP
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-300">
                Przelew dla: <strong className="text-white">{bill.portal?.name || bill.portal?.providerName}</strong> (faktura {bill.invoiceNumber})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800/80 hover:bg-slate-700 transition-colors"
            title="Zamknij"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6">
          {/* Main Visual & Info Layout */}
          <div className="flex flex-col md:flex-row items-center gap-6">
            {/* QR Code Container */}
            <div className="shrink-0 flex flex-col items-center">
              <div className="p-3.5 bg-white rounded-3xl shadow-2xl border-4 border-white flex items-center justify-center">
                {isValidNrb ? (
                  <QRCodeSVG
                    id="payment-qr-svg"
                    value={qrString}
                    size={240}
                    level="M"
                    includeMargin={true}
                  />
                ) : (
                  <div className="w-[240px] h-[240px] flex flex-col items-center justify-center text-center p-4 text-slate-700 bg-slate-100 rounded-2xl border-2 border-dashed border-slate-300">
                    <AlertCircle className="w-10 h-10 text-rose-500 mb-2" />
                    <p className="text-xs font-bold text-slate-900">Brak prawidłowego numeru konta</p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Wprowadź 26-cyfrowy rachunek bankowy obok, aby wygenerować kod.
                    </p>
                  </div>
                )}
              </div>

              {isValidNrb && (
                <div className="mt-3 flex flex-wrap justify-center items-center gap-2">
                  <button
                    onClick={handleDownloadPng}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 flex items-center gap-1.5 transition-colors"
                    title="Pobierz kod QR jako plik graficzny PNG"
                  >
                    <Download className="w-3.5 h-3.5 text-blue-400" />
                    <span>Zapisz PNG</span>
                  </button>

                  <button
                    onClick={handleSharePng}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 flex items-center gap-1.5 transition-colors"
                    title="Udostępnij grafikę kodu QR do aplikacji banku lub Obiektywu"
                  >
                    <Share2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Udostępnij</span>
                  </button>

                  <button
                    onClick={() => handleCopy(qrString, 'raw-qr')}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 flex items-center gap-1.5 transition-colors"
                    title="Kopiuj zakodowany ciąg tekstowy ZBP"
                  >
                    {copiedKey === 'raw-qr' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Skopiowano</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-400" />
                        <span>Ciąg ZBP</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Right Side: Key Transfer Details Summary */}
            <div className="flex-1 w-full space-y-3.5">
              {/* Amount Highlight */}
              <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl flex items-center justify-between">
                <div>
                  <span className="text-xs uppercase tracking-wider font-semibold text-slate-400 block">
                    Kwota do zapłaty
                  </span>
                  <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                    {formatCurrency(amount, bill.currency)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-400 block">Termin płatności:</span>
                  <span className="text-sm font-bold text-amber-400">{formatFullDate(bill.dueDate)}</span>
                </div>
              </div>

              {/* Bank Account Details */}
              <div className="p-3.5 bg-slate-950/50 border border-slate-800 rounded-2xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400">Rachunek bankowy (NRB):</span>
                  {nrbInfo.bankName && (
                    <span className="text-xs font-bold text-blue-400 flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5" />
                      <span>{nrbInfo.bankName}</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm sm:text-base font-bold text-white tracking-wider break-all">
                    {nrbInfo.formatted || accountNumber || 'Brak numeru konta'}
                  </span>
                  {accountNumber && (
                    <button
                      onClick={() => handleCopy(nrbInfo.cleanAccount || accountNumber, 'acc-btn')}
                      className="p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-800 transition-colors shrink-0"
                      title="Skopiuj numer konta"
                    >
                      {copiedKey === 'acc-btn' ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>

                {isValidNrb ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium">
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {nrbInfo.isValidChecksum 
                        ? 'Poprawna suma kontrolna IBAN / NRB' 
                        : 'Format 26 cyfr (uwaga na sumę kontrolną)'}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-[11px] text-rose-400 font-medium">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Numer rachunku musi mieć dokładnie 26 cyfr</span>
                  </div>
                )}
              </div>

              {/* Recipient and Title */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="p-3 bg-slate-950/40 border border-slate-800/80 rounded-xl">
                  <span className="text-slate-400 block font-medium">Odbiorca:</span>
                  <span className="font-bold text-white truncate block mt-0.5" title={recipient}>
                    {recipient.slice(0, 20)}
                  </span>
                </div>
                <div className="p-3 bg-slate-950/40 border border-slate-800/80 rounded-xl">
                  <span className="text-slate-400 block font-medium">Tytuł przelewu:</span>
                  <span className="font-bold text-white truncate block mt-0.5" title={title}>
                    {title.slice(0, 32)}
                  </span>
                </div>
              </div>

              {/* Status and mark-as-paid action for mail script / Google Scripts invoices */}
              {isMailScript && (
                <div className="p-3.5 bg-slate-950/70 border border-slate-800/90 rounded-2xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-400">Rachunek z poczty (Google Scripts):</span>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-bold ${
                      isPaid 
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    }`}>
                      {isPaid ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Clock className="w-3.5 h-3.5 text-amber-400" />}
                      <span>{isPaid ? 'Opłacony' : 'Do zapłaty'}</span>
                    </span>
                  </div>

                  {isPaid ? (
                    <button
                      type="button"
                      onClick={handleTogglePaymentStatus}
                      disabled={isUpdatingStatus}
                      className="w-full py-2.5 px-3 bg-emerald-950/50 hover:bg-emerald-900/50 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-between transition-all group disabled:opacity-50"
                      title="Kliknij, aby cofnąć oznaczenie jako zapłacone"
                    >
                      <span className="flex items-center gap-2">
                        {isUpdatingStatus ? (
                          <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        )}
                        <span>Rachunek oznaczony jako zapłacony</span>
                      </span>
                      <span className="text-xs text-slate-400 group-hover:text-emerald-200 underline decoration-dotted">
                        Cofnij oznaczenie
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleTogglePaymentStatus}
                      disabled={isUpdatingStatus}
                      className="w-full py-3 px-3.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs sm:text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 border border-emerald-400/30 active:scale-[0.99] disabled:opacity-50"
                    >
                      {isUpdatingStatus ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                      <span>Oznacz ten rachunek jako zapłacony</span>
                    </button>
                  )}
                </div>
              )}

              <button
                onClick={handleCopyAllDetails}
                className="w-full py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs sm:text-sm font-bold rounded-xl border border-slate-700 transition-colors flex items-center justify-center gap-2"
              >
                {copiedKey === 'all-details' ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>Skopiowano wszystkie dane przelewu do schowka!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-slate-400" />
                    <span>Kopiuj pełne dane do przelewu</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Quick Instructions Banner */}
          <div className="p-4 sm:p-5 bg-blue-950/30 border border-blue-800/50 rounded-2xl space-y-3">
            <div className="flex items-start gap-3">
              <Smartphone className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
              <div className="text-xs sm:text-sm text-slate-300">
                <strong className="text-white block font-bold mb-1">
                  Jak opłacić ten rachunek w banku?
                </strong>
                <p className="text-slate-300">
                  Kod QR jest zgodny z oficjalnym <strong>standardem Związku Banków Polskich (ZBP)</strong>, obsługiwanym przez aplikacje mBank, IKO (PKO BP), Santander, Moje ING, PeoPay (Pekao), Millennium, Alior itp.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-xs">
              <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl space-y-1">
                <span className="font-bold text-white block">🖥️ Z komputera lub tabletu:</span>
                <p className="text-slate-300">
                  Otwórz aplikację banku w telefonie, wybierz <strong>„Płatności kodem QR”</strong> / <strong>„Skanuj i płać”</strong> i skieruj aparat na kod.
                </p>
              </div>

              <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl space-y-1">
                <span className="font-bold text-white block">📱 Na tym samym telefonie (np. Pixel / Android):</span>
                <p className="text-slate-300">
                  Kliknij przycisk <strong>„Zapisz PNG”</strong>. W aplikacji banku włącz skanowanie i kliknij <strong>ikonkę galerii/zdjęcia</strong>, aby wczytać pobrany kod ze zrzutu!
                </p>
              </div>
            </div>
          </div>

          {/* Collapsible Edit / Advanced Settings */}
          <div className="border-t border-slate-800 pt-4">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs sm:text-sm font-semibold text-slate-400 hover:text-white flex items-center gap-2 transition-colors"
            >
              <Settings2 className="w-4 h-4" />
              <span>{showAdvanced ? 'Ukryj edycję danych kodu QR' : 'Dostosuj dane w kodzie QR (opcjonalnie)'}</span>
            </button>

            {showAdvanced && (
              <div className="mt-4 p-4 bg-slate-950/60 border border-slate-800 rounded-2xl space-y-4 animate-in fade-in duration-200">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Bank Account Input */}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Numer konta bankowego (26 cyfr):
                    </label>
                    <input
                      type="text"
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                      placeholder="np. 52 1050 1445 1000 0022 9988 1234"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  {/* Recipient */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs font-semibold text-slate-300">Odbiorca (maks. 20 znaków):</label>
                      <span className="text-[11px] text-slate-500">{recipient.length}/20</span>
                    </div>
                    <input
                      type="text"
                      maxLength={20}
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  {/* Amount */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Kwota (PLN):</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={amount}
                      onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  {/* Title */}
                  <div className="sm:col-span-2">
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs font-semibold text-slate-300">Tytuł przelewu (maks. 32 znaki):</label>
                      <span className="text-[11px] text-slate-500">{title.length}/32</span>
                    </div>
                    <input
                      type="text"
                      maxLength={32}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* Diacritics checkbox */}
                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 pt-1">
                  <input
                    type="checkbox"
                    checked={removePolish}
                    onChange={(e) => setRemovePolish(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 bg-slate-800 border-slate-700 focus:ring-0"
                  />
                  <span>Usuń polskie znaki diakrytyczne (zamień ą, ę, ś... na a, e, s dla starszych czytników)</span>
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div>
            {isMailScript && (
              <button
                type="button"
                onClick={handleTogglePaymentStatus}
                disabled={isUpdatingStatus}
                className={`py-2 px-3.5 sm:px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all border ${
                  isPaid
                    ? 'bg-slate-800/90 hover:bg-slate-700 text-slate-300 border-slate-700'
                    : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white border-emerald-400/30 shadow-md shadow-emerald-600/25'
                } disabled:opacity-50`}
              >
                {isUpdatingStatus ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : isPaid ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>{isPaid ? 'Opłacony (Cofnij)' : 'Oznacz jako zapłacone'}</span>
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-sm transition-colors shadow-lg shadow-blue-600/25"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
};
