import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  EKartotekaProvider,
  cleanEKartotekaIban,
  parseEKartotekaDate,
  parseEKartotekaAmount,
  formatMonthName,
} from './EKartotekaProvider.js';

describe('EKartotekaProvider Unit Tests', () => {
  const provider = new EKartotekaProvider();

  test('should have valid provider metadata', () => {
    assert.equal(provider.id, 'ekartoteka');
    assert.equal(provider.displayName, 'e-kartoteka (Wspólnota / Spółdzielnia)');
    assert.equal(provider.loginUrl, 'https://www.e-kartoteka.pl/#/login');
  });

  test('cleanEKartotekaIban should format and validate Polish IBAN numbers', () => {
    // 26 digits -> PL + 26 digits
    const raw26 = '13105000990000000000000001';
    assert.equal(cleanEKartotekaIban(raw26), 'PL13105000990000000000000001');

    // Already PL prefixed
    const pl28 = 'PL13105000990000000000000001';
    assert.equal(cleanEKartotekaIban(pl28), 'PL13105000990000000000000001');

    // With spaces
    const spaced = '13 1050 0099 0000 0000 0000 0001';
    assert.equal(cleanEKartotekaIban(spaced), 'PL13105000990000000000000001');

    // Masked bank account
    const masked = '13********************0001';
    assert.equal(cleanEKartotekaIban(masked), '13********************0001');

    // Empty or undefined
    assert.equal(cleanEKartotekaIban(''), undefined);
    assert.equal(cleanEKartotekaIban(undefined), undefined);
  });

  test('parseEKartotekaDate should correctly parse ISO, dot, and fallback dates', () => {
    const d1 = parseEKartotekaDate('2026-09-01');
    assert.equal(d1.getFullYear(), 2026);
    assert.equal(d1.getMonth(), 8); // September = 8
    assert.equal(d1.getDate(), 1);

    const d2 = parseEKartotekaDate('10.05.2026');
    assert.equal(d2.getFullYear(), 2026);
    assert.equal(d2.getMonth(), 4); // May = 4
    assert.equal(d2.getDate(), 10);

    const dEmpty = parseEKartotekaDate('');
    assert.ok(dEmpty instanceof Date);
    assert.ok(!isNaN(dEmpty.getTime()));
  });

  test('parseEKartotekaAmount should handle numeric, string, negative, and currency values', () => {
    assert.equal(parseEKartotekaAmount(247.19), 247.19);
    assert.equal(parseEKartotekaAmount(-1235.95), 1235.95);
    assert.equal(parseEKartotekaAmount('247,19 zł'), 247.19);
    assert.equal(parseEKartotekaAmount('1 235,95 PLN'), 1235.95);
    assert.equal(parseEKartotekaAmount('-24.33 zł'), 24.33);
    assert.equal(parseEKartotekaAmount('0,00 zł'), 0);
    assert.equal(parseEKartotekaAmount(''), 0);
    assert.equal(parseEKartotekaAmount(undefined), 0);
  });

  test('formatMonthName should map month numbers to Polish month names', () => {
    assert.equal(formatMonthName(0), 'Bilans otwarcia');
    assert.equal(formatMonthName(1), 'Styczeń');
    assert.equal(formatMonthName(5), 'Maj');
    assert.equal(formatMonthName(9), 'Wrzesień');
    assert.equal(formatMonthName(12), 'Grudzień');
  });

  test('agreement filter regex matches community, address, code, or invoice', () => {
    const community = 'Wspólnota Mieszkaniowa "Zielone Wzgórze" ul. Akacjowa 1';
    const address = 'ul. Akacjowa 1/12, 00-001 Warszawa';
    const code = '00-015 -029';
    const invoice = 'EK/2026/09/204';
    const client = 'Kowalska Anna, Jan';

    const filterZielone = new RegExp('Zielone', 'i');
    assert.ok(filterZielone.test(community));

    const filterAddress = new RegExp('Akacjowa', 'i');
    assert.ok(filterAddress.test(address));

    const filterCode = new RegExp('00-015', 'i');
    assert.ok(filterCode.test(code));

    const filterInvoice = new RegExp('EK/2026/09', 'i');
    assert.ok(filterInvoice.test(invoice));

    const filterClient = new RegExp('Kowalska', 'i');
    assert.ok(filterClient.test(client));

    const filterMismatch = new RegExp('Krakowska', 'i');
    assert.ok(!filterMismatch.test(community));
    assert.ok(!filterMismatch.test(address));
    assert.ok(!filterMismatch.test(code));
  });

  test('generateStatementPdf creates a valid PDF document with metadata', async () => {
    const pdfBuf = await provider.generateStatementPdf({
      communityName: 'Wspólnota Mieszkaniowa "Zielone Wzgórze"',
      managerName: 'ZARZĄDZANIE NIERUCHOMOŚCIAMI PRO-DOM SP. Z O.O.',
      clientName: 'Kowalska Anna, Jan',
      premisesAddress: 'ul. Akacjowa 1/12',
      premisesCode: '00-015 -029',
      invoiceNumber: 'EK/2026/09/204',
      accountName: 'Rozrachunki z właścicielami',
      monthName: 'Wrzesień',
      year: 2026,
      amountDue: 247.19,
      amountPaid: 0.0,
      balance: -1211.62,
      iban: 'PL13105000990000000000000001',
      issueDate: new Date('2026-09-01T12:00:00Z'),
      dueDate: new Date('2026-09-10T12:00:00Z'),
      paymentStatus: 'UNPAID',
    });

    assert.ok(pdfBuf && pdfBuf.length > 500, 'PDF buffer should be generated and non-empty');
    const header = Buffer.from(pdfBuf.slice(0, 5)).toString('utf-8');
    assert.equal(header, '%PDF-', 'Buffer should start with valid %PDF- header');
  });
});
