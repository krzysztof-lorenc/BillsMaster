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

  // Strip known prefix words like "Faktura nr", "Faktura", "Nr", "e-rachunek", "Nota obciążeniowa"
  first = first.replace(/^(?:e-rachunek|faktura\s+vat|faktura\s+nr|faktura|faktury|rachunek|odsetki|inne|nota\s+obciążeniowa|nota\s+obciazeniowa|nota|nr)[:\s#]*/i, '').trim();

  // Strip known suffix words like "... Faktura", "... Faktury", "... Odsetki"
  first = first.replace(/\s+(?:faktura|faktury|rachunek|odsetki|inne|korekta|nota)$/i, '').trim();

  // Check for nota format with series letter suffix (e.g. "7/2026/ l", "7/2026/ L", "7/2026/l")
  const notaWithSuffix = first.match(/^([0-9]{1,6}\/[0-9]{4})\s*(?:\/|\s)\s*([A-Za-z0-9]+)$/);
  if (notaWithSuffix) {
    return `${notaWithSuffix[1]}/ ${notaWithSuffix[2].toUpperCase()}`;
  }

  // Extract by invoice pattern if slashes or dashes are present (e.g. E/TM3/PC100452/0002/26/3 or 82434931_202608)
  const invoicePattern = /([A-Z0-9]+(?:[\/\-_][A-Z0-9]+)+(?:\s*\/\s*[A-Z0-9]+)?)/i;
  const match = first.match(invoicePattern);
  let candidate = match ? match[1].trim() : first.trim();

  // Check if candidate matches nota format with series suffix
  const candNotaWithSuffix = candidate.match(/^([0-9]{1,6}\/[0-9]{4})\s*(?:\/|\s)\s*([A-Za-z0-9]+)$/);
  if (candNotaWithSuffix) {
    return `${candNotaWithSuffix[1]}/ ${candNotaWithSuffix[2].toUpperCase()}`;
  }

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
 * Normalizes payment title. If rawTitle contains an intentional payment title
 * (such as "NOTA OBCIĄŻENIOWA 7/2026/ L" or recipient-invoice combinations), preserves it.
 * Otherwise falls back to cleaned invoice number or standard label.
 */
export function cleanPaymentTitle(rawTitle?: string | null, fallbackInvoiceNumber?: string): string {
  if (rawTitle && rawTitle.trim()) {
    const trimmedTitle = rawTitle.trim();
    const firstLine = trimmedTitle.split(/\r?\n/)[0].trim();

    // Check for "NOTA OBCIĄŻENIOWA" pattern (e.g. "NOTA OBCIĄŻENIOWA 7/2026/ L", "Nota obciążeniowa 7/2026/l")
    const notaMatch = firstLine.match(/^(?:nota\s+obciążeniowa|nota\s+obciazeniowa)[:\s#]*([0-9]{1,6}\/[0-9]{4}(?:[\/\s]+[A-Za-z0-9]+)?)/i);
    if (notaMatch) {
      let numPart = notaMatch[1].trim();
      const numWithSuffix = numPart.match(/^([0-9]{1,6}\/[0-9]{4})\s*(?:\/|\s)\s*([A-Za-z0-9]+)$/);
      if (numWithSuffix) {
        numPart = `${numWithSuffix[1]}/ ${numWithSuffix[2].toUpperCase()}`;
      }
      return `NOTA OBCIĄŻENIOWA ${numPart}`;
    }

    if (/^NOTA\s+OBCIĄŻENIOWA\b/i.test(firstLine) || /^NOTA\s+OBCIAZENIOWA\b/i.test(firstLine)) {
      return firstLine.replace(/^NOTA\s+OBCIAZENIOWA/i, 'NOTA OBCIĄŻENIOWA').replace(/\s+/g, ' ');
    }

    // Check if the title is a composite like "Recipient - InvoiceNumber" (e.g. e-kartoteka)
    if (/^[^\-\n\r]{2,30}\s*-\s*[A-Za-z0-9\/\-_.\s]+$/i.test(firstLine)) {
      return firstLine;
    }

    // If rawTitle contains an invoice number, clean it
    const cleanedFromTitle = cleanInvoiceNumber(firstLine);
    if (cleanedFromTitle) return cleanedFromTitle;

    // If rawTitle is not portal error noise, return cleaned firstLine
    if (!/przepraszamy|błąd|error|status|loading/i.test(firstLine)) {
      return firstLine;
    }
  }

  // Fallback to invoice number if rawTitle was not provided or unusable
  if (fallbackInvoiceNumber && fallbackInvoiceNumber.trim().length > 0) {
    const fbFirstLine = fallbackInvoiceNumber.trim().split(/\r?\n/)[0].trim();
    const fbNotaMatch = fbFirstLine.match(/^(?:nota\s+obciążeniowa|nota\s+obciazeniowa)[:\s#]*([0-9]{1,6}\/[0-9]{4}(?:[\/\s]+[A-Za-z0-9]+)?)/i);
    if (fbNotaMatch) {
      let numPart = fbNotaMatch[1].trim();
      const numWithSuffix = numPart.match(/^([0-9]{1,6}\/[0-9]{4})\s*(?:\/|\s)\s*([A-Za-z0-9]+)$/);
      if (numWithSuffix) {
        numPart = `${numWithSuffix[1]}/ ${numWithSuffix[2].toUpperCase()}`;
      }
      return `NOTA OBCIĄŻENIOWA ${numPart}`;
    }

    const cleaned = cleanInvoiceNumber(fallbackInvoiceNumber);
    if (cleaned) {
      return cleaned;
    }
  }

  return 'Opłata za rachunek';
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

