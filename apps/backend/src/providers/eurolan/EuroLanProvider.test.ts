import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  EuroLanProvider,
  cleanEuroLanIban,
  parseEuroLanDate,
  parseEuroLanAmount,
  parseSignedEuroLanAmount,
} from './EuroLanProvider.js';

describe('EuroLanProvider Unit Tests', () => {
  const provider = new EuroLanProvider();

  test('should have valid provider metadata', () => {
    assert.equal(provider.id, 'eurolan');
    assert.equal(provider.displayName, 'Euro-lan Bielsko');
    assert.equal(provider.loginUrl, 'https://bok.euro-lan.pl/');
  });

  test('cleanEuroLanIban should clean and format Polish IBAN with PL prefix', () => {
    // 52 1050 0099 0000 0000 0000 1234 -> PL52105000990000000000001234
    const iban = cleanEuroLanIban('52 1050 0099 0000 0000 0000 1234');
    assert.equal(iban, 'PL52105000990000000000001234');

    // Already prefixed
    assert.equal(cleanEuroLanIban('PL52105000990000000000001234'), 'PL52105000990000000000001234');

    // Edge cases
    assert.equal(cleanEuroLanIban(''), undefined);
    assert.equal(cleanEuroLanIban(undefined), undefined);
  });

  test('parseEuroLanDate should parse ISO and dot date formats', () => {
    const d1 = parseEuroLanDate('2026-09-01');
    assert.equal(d1.getFullYear(), 2026);
    assert.equal(d1.getMonth(), 8); // September = 8
    assert.equal(d1.getDate(), 1);

    const d2 = parseEuroLanDate('08.09.2026');
    assert.equal(d2.getFullYear(), 2026);
    assert.equal(d2.getMonth(), 8);
    assert.equal(d2.getDate(), 8);

    const dEmpty = parseEuroLanDate('');
    assert.ok(dEmpty instanceof Date);
    assert.ok(!isNaN(dEmpty.getTime()));
  });

  test('parseEuroLanAmount should parse debit and credit amount values', () => {
    assert.equal(parseEuroLanAmount('-60,00 PLN'), 60.0);
    assert.equal(parseEuroLanAmount('+60,00 PLN'), 60.0);
    assert.equal(parseEuroLanAmount('60,00 zł'), 60.0);
    assert.equal(parseEuroLanAmount('0,00 PLN'), 0);
    assert.equal(parseEuroLanAmount(''), 0);
    assert.equal(parseEuroLanAmount(undefined), 0);
  });

  test('parseSignedEuroLanAmount should preserve negative/positive signs', () => {
    assert.equal(parseSignedEuroLanAmount('-60,00 PLN'), -60.0);
    assert.equal(parseSignedEuroLanAmount('+60,00 PLN'), 60.0);
    assert.equal(parseSignedEuroLanAmount('0,00 PLN'), 0);
  });

  test('agreement filter regex matches invoice, client, address, or agreement', () => {
    const invoiceNumber = 'FV/2026/10001';
    const address = 'ul. Słoneczna 10 , 00-001 Warszawa';
    const clientNumber = '1234';
    const agreementNumber = 'UM/2026/001';

    const filterSloneczna = new RegExp('Słoneczna', 'i');
    assert.ok(filterSloneczna.test(address));

    const filterClient = new RegExp('1234', 'i');
    assert.ok(filterClient.test(clientNumber));

    const filterInvoice = new RegExp('FV/2026/10001', 'i');
    assert.ok(filterInvoice.test(invoiceNumber));

    const filterAgreement = new RegExp('UM/2026/001', 'i');
    assert.ok(filterAgreement.test(agreementNumber));

    const filterOther = new RegExp('Warszawska', 'i');
    assert.ok(!filterOther.test(address));
    assert.ok(!filterOther.test(clientNumber));
    assert.ok(!filterOther.test(invoiceNumber));
  });
});
