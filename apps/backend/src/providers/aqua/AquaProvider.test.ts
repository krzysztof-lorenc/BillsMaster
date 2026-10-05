import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AquaProvider,
  computeAquaIban,
  parseAquaDate,
  parseAquaAmount,
} from './AquaProvider.js';

describe('AquaProvider Unit Tests', () => {
  const provider = new AquaProvider();

  test('should have valid provider metadata', () => {
    assert.equal(provider.id, 'aqua');
    assert.equal(provider.displayName, 'AQUA Bielsko-Biała (eBOK)');
    assert.equal(provider.loginUrl, 'https://ebok.aqua.com.pl/ords/r/ebok/e/logowanie');
  });

  test('computeAquaIban should calculate correct virtual IBAN for client number', () => {
    // Client 100001 -> PL 11 1140 1906 1006 0000 0010 0001
    const iban = computeAquaIban('100001');
    assert.equal(iban, 'PL 11 1140 1906 1006 0000 0010 0001');

    // Handles non-digits
    assert.equal(computeAquaIban('ID: 100001'), 'PL 11 1140 1906 1006 0000 0010 0001');

    // Edge cases
    assert.equal(computeAquaIban(''), undefined);
    assert.equal(computeAquaIban(undefined), undefined);
  });

  test('parseAquaDate should parse ISO and dot date formats correctly', () => {
    const d1 = parseAquaDate('2026-08-07');
    assert.equal(d1.getFullYear(), 2026);
    assert.equal(d1.getMonth(), 7); // August = 7
    assert.equal(d1.getDate(), 7);

    const d2 = parseAquaDate('28.08.2026');
    assert.equal(d2.getFullYear(), 2026);
    assert.equal(d2.getMonth(), 7);
    assert.equal(d2.getDate(), 28);

    const d3 = parseAquaDate('10.02.2026');
    assert.equal(d3.getFullYear(), 2026);
    assert.equal(d3.getMonth(), 1); // February = 1
    assert.equal(d3.getDate(), 10);

    const dEmpty = parseAquaDate('');
    assert.ok(dEmpty instanceof Date);
    assert.ok(!isNaN(dEmpty.getTime()));
  });

  test('parseAquaAmount should correctly parse numbers with commas and currency symbols', () => {
    assert.equal(parseAquaAmount('707,81 zł'), 707.81);
    assert.equal(parseAquaAmount('1,90 zł'), 1.90);
    assert.equal(parseAquaAmount('636.80 PLN'), 636.80);
    assert.equal(parseAquaAmount('0,00 zł'), 0);
    assert.equal(parseAquaAmount(''), 0);
    assert.equal(parseAquaAmount(undefined), 0);
  });

  test('agreement filter regex matches address, client, or invoice', () => {
    const address = '00-001 Warszawa, ul. Prosta 12';
    const clientNumber = '100001';
    const invoiceNumber = 'FV/2026/001';

    const filterProsta = new RegExp('Prosta', 'i');
    assert.ok(filterProsta.test(address));

    const filterClient = new RegExp('100001', 'i');
    assert.ok(filterClient.test(clientNumber));

    const filterInvoice = new RegExp('FV/2026/001', 'i');
    assert.ok(filterInvoice.test(invoiceNumber));

    const filterOther = new RegExp('Gdańska', 'i');
    assert.ok(!filterOther.test(address));
    assert.ok(!filterOther.test(clientNumber));
    assert.ok(!filterOther.test(invoiceNumber));
  });
});
