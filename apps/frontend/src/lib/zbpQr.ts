/**
 * Polish Bank Association (Związek Banków Polskich - ZBP) 2D QR Code Generator
 * Specification: Rekomendacja ZBP dotycząca standardu dwuwymiarowego kodu graficznego (2D)
 *
 * Format:
 * {nip}|{country}|{accountNumber}|{amount}|{recipient}|{title}|{directDebitId}|{invoobillId}|{reserved}
 *
 * Fields:
 * 1. NIP (optional, max 10 chars)
 * 2. Country code ('PL', 2 chars)
 * 3. Bank Account Number (26 digits NRB)
 * 4. Amount in grosze (formatted as at least 6 digits with leading zeros, e.g. 120.50 PLN -> '012050')
 * 5. Recipient name (max 20 chars)
 * 6. Payment title (max 32 chars)
 * 7. Customer ID for Direct Debit (optional, max 20 chars)
 * 8. Invoobill ID (optional, max 12 chars)
 * 9. Reserved (optional, max 24 - amount.length + 6 chars)
 */

export interface ZbpQrParams {
  accountNumber: string;
  recipient: string;
  title: string;
  amount: number;
  nip?: string | null;
  removePolishChars?: boolean;
}

export interface NrbValidationResult {
  cleanAccount: string;
  formatted: string;
  isValidLength: boolean;
  isValidChecksum: boolean;
  bankName: string | null;
}

const POLISH_BANK_CODES: Record<string, string> = {
  '1010': 'Narodowy Bank Polski',
  '1020': 'PKO BP',
  '1030': 'Citi Handlowy',
  '1050': 'ING Bank Śląski',
  '1060': 'Bank BPH',
  '1090': 'Santander Bank Polska',
  '1130': 'Bank Gospodarstwa Krajowego',
  '1140': 'mBank',
  '1160': 'Bank Millennium',
  '1240': 'Bank Pekao SA',
  '1320': 'Bank Pocztowy',
  '1540': 'BOŚ Bank',
  '1600': 'BNP Paribas Bank Polska',
  '1610': 'SGB-Bank',
  '1680': 'Plus Bank',
  '1870': 'Nest Bank',
  '1930': 'Bank Polskiej Spółdzielczości (BPS)',
  '1940': 'Credit Agricole',
  '2030': 'BNP Paribas',
  '2120': 'Santander Consumer Bank',
  '2160': 'Toyota Bank',
  '2480': 'VeloBank',
  '2490': 'Alior Bank',
};

const POLISH_CHAR_MAP: Record<string, string> = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
  Ą: 'A', Ć: 'C', Ę: 'E', Ł: 'L', Ń: 'N', Ó: 'O', Ś: 'S', Ź: 'Z', Ż: 'Z',
};

export function removeDiacritics(text: string): string {
  return text.replace(/[ąćęłńóśźżĄĆĘŁŃŚŻ]/g, (char) => POLISH_CHAR_MAP[char] || char);
}

/**
 * Validates and formats a Polish NRB bank account number
 */
export function validateAndParseNrb(rawAccount?: string | null): NrbValidationResult {
  if (!rawAccount) {
    return {
      cleanAccount: '',
      formatted: '',
      isValidLength: false,
      isValidChecksum: false,
      bankName: null,
    };
  }

  // Remove spaces, dashes, dots, and optional PL prefix
  const clean = rawAccount.trim().replace(/^PL/i, '').replace(/[\s\-_.]/g, '');
  const isValidLength = /^\d{26}$/.test(clean);

  if (!isValidLength) {
    return {
      cleanAccount: clean,
      formatted: clean,
      isValidLength: false,
      isValidChecksum: false,
      bankName: null,
    };
  }

  // Format as 2 4 4 4 4 4 4
  const formatted = `${clean.slice(0, 2)} ${clean.slice(2, 6)} ${clean.slice(6, 10)} ${clean.slice(10, 14)} ${clean.slice(14, 18)} ${clean.slice(18, 22)} ${clean.slice(22, 26)}`;

  // Identify Bank by 4 digits (from index 2 to 6)
  const bankCode = clean.slice(2, 6);
  const bankName = POLISH_BANK_CODES[bankCode] || null;

  // Validate Modulo 97 (IBAN standard checksum)
  // For Poland (PL = 25 21): move first 2 digits to the end, followed by '2521'
  const rearranged = clean.slice(2) + '2521' + clean.slice(0, 2);
  let remainder = 0;
  for (let i = 0; i < rearranged.length; i++) {
    remainder = (remainder * 10 + parseInt(rearranged[i], 10)) % 97;
  }
  const isValidChecksum = remainder === 1;

  return {
    cleanAccount: clean,
    formatted,
    isValidLength: true,
    isValidChecksum,
    bankName,
  };
}

/**
 * Sanitizes input string to meet ZBP standard rules:
 * - Disallow pipe '|' character
 * - Disallow unprintable characters
 * - Trim and slice to maxLength
 */
export function sanitizeZbpField(val: string | null | undefined, maxLength: number, removeDiacr = false): string {
  if (!val) return '';
  let str = val.trim().replace(/\|/g, ' ');
  if (removeDiacr) {
    str = removeDiacritics(str);
  }
  // Keep only alphanumeric, spaces, and safe punctuation
  str = str.replace(/[^\w\s,\.\/\-@#&*\/'ąćęłńóśźżĄĆĘŁŃŚŻ]/gu, '');
  return str.slice(0, maxLength);
}

/**
 * Formats recipient name to strictly fit within the 20-character ZBP standard limit
 * while keeping distinctive identifying names (e.g. "Wspólnota Mieszkaniowa Lipowa Dolina" -> "WM Lipowa Dolina").
 */
export function formatZbpRecipient(name?: string | null): string {
  if (!name) return '';
  let clean = name.trim().replace(/["”„«»]/g, '');

  if (clean.length <= 20) return clean;

  // Use common Polish organizational abbreviations first
  let abbreviated = clean
    .replace(/^Wspólnota\s+Mieszkaniowa(?:\s+|$)/i, 'WM ')
    .replace(/^Wspolnota\s+Mieszkaniowa(?:\s+|$)/i, 'WM ')
    .replace(/^Spółdzielnia\s+Mieszkaniowa(?:\s+|$)/i, 'SM ')
    .replace(/^Spoldzielnia\s+Mieszkaniowa(?:\s+|$)/i, 'SM ')
    .replace(/^Przedsiębiorstwo\s+/i, 'Przedsiebiorstwo ')
    .trim();

  if (abbreviated.length <= 20) return abbreviated;

  // If still too long, strip trailing street prefix/address
  abbreviated = abbreviated.replace(/[,;]?\s+(?:ul\.|al\.|pl\.|os\.)\s+.*$/i, '').trim();

  if (abbreviated.length <= 20) return abbreviated;
  return abbreviated.slice(0, 20).trim();
}

/**
 * Builds the standard ZBP QR code string for Polish banking apps
 */
export function generateZbpQrString(params: ZbpQrParams): string {
  const { cleanAccount } = validateAndParseNrb(params.accountNumber);

  // Amount in grosze, minimum 6 digits (padded with leading zeros)
  const grosze = Math.max(0, Math.round((params.amount || 0) * 100));
  const amountStr = String(grosze).padStart(6, '0');

  const nip = params.nip ? params.nip.replace(/\D/g, '').slice(0, 10) : '';
  const formattedRecipient = formatZbpRecipient(params.recipient);
  const recipient = sanitizeZbpField(formattedRecipient, 20, params.removePolishChars);
  const title = sanitizeZbpField(params.title, 32, params.removePolishChars);

  // 9 fields separated by '|':
  // 1: NIP
  // 2: Country code ('PL')
  // 3: Account number (26 digits)
  // 4: Amount in grosze (min 6 digits)
  // 5: Recipient (max 20 chars)
  // 6: Title (max 32 chars)
  // 7: Direct Debit ID (empty)
  // 8: Invoobill ID (empty)
  // 9: Reserved (empty)
  const parts = [
    nip,
    'PL',
    cleanAccount,
    amountStr,
    recipient,
    title,
    '',
    '',
    '',
  ];

  return parts.join('|');
}
