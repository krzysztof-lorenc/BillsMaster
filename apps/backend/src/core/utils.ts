/**
 * Utility functions for BillsMaster backend
 */

/**
 * Cleans and extracts a canonical invoice number from raw scraped text or dirty database strings.
 * Removes extra lines, DOM artifacts, Polish document labels (Faktura, Odsetki, etc.),
 * and portal tooltips/error messages (e.g. "Przepraszamy, w tej chwili nie możemy pobrać dokumentu...").
 */
export function cleanInvoiceNumber(raw: string): string {
  if (!raw) return '';
  // 1. Take first non-empty line
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let first = lines[0] || '';

  // Strip known prefix words like "Faktura nr", "Faktura", "Nr", "e-rachunek"
  first = first.replace(/^(?:e-rachunek|faktura\s+vat|faktura\s+nr|faktura|faktury|rachunek|odsetki|inne|nota|nr)[:\s#]*/i, '').trim();

  // Strip known suffix words like "... Faktura", "... Faktury", "... Odsetki"
  first = first.replace(/\s+(?:faktura|faktury|rachunek|odsetki|inne|korekta|nota)$/i, '').trim();

  // Extract by invoice pattern if slashes or dashes are present (e.g. E/TM3/PC100452/0002/26/3 or 82434931_202608)
  const invoicePattern = /([A-Z0-9]+(?:[\/\-_][A-Z0-9]+)+)/i;
  const match = first.match(invoicePattern);
  let candidate = match ? match[1].trim() : first.trim();

  // Reject strings with spaces or invalid characters
  if (/\s/.test(candidate) || !/^[A-Za-z0-9\/\-_.]+$/.test(candidate)) {
    return '';
  }

  // Normalize Polish diacritics for stopword filtering
  const norm = candidate
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]/g, '');

  const stopwords = [
    'dostepny', 'dostepna', 'dostepne', 'dost', 'elektroniczny', 'nowy', 'twoj', 'strefa', 'online',
    'faktura', 'rachunek', 'erachunek', 'rachunku', 'faktury',
    'odbiorcy', 'bankowego', 'klienta', 'konta', 'rozliczeniowego', 'platnika', 'wplaty', 'nadawcy'
  ];
  if (stopwords.includes(norm) || norm.length < 3) {
    return '';
  }

  return candidate;
}

/**
 * Normalizes payment title to ensure it contains only the invoice number.
 */
export function cleanPaymentTitle(rawTitle?: string | null, fallbackInvoiceNumber?: string): string {
  if (fallbackInvoiceNumber && fallbackInvoiceNumber.trim().length > 0) {
    const cleaned = cleanInvoiceNumber(fallbackInvoiceNumber);
    if (cleaned) return cleaned;
  }
  if (!rawTitle) {
    return 'Opłata za rachunek';
  }
  const firstLine = rawTitle.split(/\r?\n/)[0].trim();
  const cleanedFromTitle = cleanInvoiceNumber(firstLine);
  if (cleanedFromTitle) return cleanedFromTitle;
  return firstLine || 'Opłata za rachunek';
}

/**
 * Calculates the 12-month cutoff date from now (or a given reference date).
 * Invoices issued before this timestamp are older than 12 months.
 */
export function getTwelveMonthsAgoCutoff(referenceDate: Date = new Date(), months: number = 24): Date {
  const cutoff = new Date(referenceDate);
  cutoff.setMonth(cutoff.getMonth() - months);
  cutoff.setHours(0, 0, 0, 0);
  return cutoff;
}

/**
 * Checks if a given date is older than 12 months relative to referenceDate.
 */
export function isOlderThan12Months(date?: Date | string | number | null, referenceDate: Date = new Date()): boolean {
  if (!date) return false;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return false;
  return d.getTime() < getTwelveMonthsAgoCutoff(referenceDate, 12).getTime();
}

