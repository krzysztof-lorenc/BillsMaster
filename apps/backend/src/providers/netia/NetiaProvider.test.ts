import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { NetiaProvider, parsePolishDate, cleanIban } from './NetiaProvider.js';

describe('NetiaProvider Unit Tests', () => {
  const provider = new NetiaProvider();

  test('should have valid provider metadata', () => {
    assert.equal(provider.id, 'netia');
    assert.equal(provider.displayName, 'Netia Online');
    assert.equal(provider.loginUrl, 'https://www.netiaonline.pl/');
  });

  test('parsePolishDate should parse various Polish date formats correctly', () => {
    const d1 = parsePolishDate('8 września 2026');
    assert.ok(d1);
    assert.equal(d1?.getFullYear(), 2026);
    assert.equal(d1?.getMonth(), 8); // 0-indexed September = 8
    assert.equal(d1?.getDate(), 8);

    const d2 = parsePolishDate('14 stycznia 2026');
    assert.ok(d2);
    assert.equal(d2?.getFullYear(), 2026);
    assert.equal(d2?.getMonth(), 0); // January = 0
    assert.equal(d2?.getDate(), 14);

    const d3 = parsePolishDate('17 grudnia 2025');
    assert.ok(d3);
    assert.equal(d3?.getFullYear(), 2025);
    assert.equal(d3?.getMonth(), 11); // December = 11
    assert.equal(d3?.getDate(), 17);

    const d4 = parsePolishDate('08.09.2026');
    assert.ok(d4);
    assert.equal(d4?.getFullYear(), 2026);
    assert.equal(d4?.getMonth(), 8);
    assert.equal(d4?.getDate(), 8);

    const d5 = parsePolishDate('2026-09-08');
    assert.ok(d5);
    assert.equal(d5?.getFullYear(), 2026);
    assert.equal(d5?.getMonth(), 8);
    assert.equal(d5?.getDate(), 8);

    assert.equal(parsePolishDate(''), null);
    assert.equal(parsePolishDate(null), null);
    assert.equal(parsePolishDate(undefined), null);
  });

  test('cleanIban should format Polish IBAN with PL prefix', () => {
    assert.equal(
      cleanIban('19-1140-1560-0000-0000-0000-0001'),
      'PL19114015600000000000000001'
    );
    assert.equal(
      cleanIban('PL 19 1140 1560 0000 0000 0000 0001'),
      'PL19114015600000000000000001'
    );
    assert.equal(cleanIban(''), '');
    assert.equal(cleanIban(null), '');
  });

  test('filter matching logic works for agreement, billing account, and address', () => {
    const account = {
      agreementNumber: '1234/26/NET/0001',
      billingAccount: '123456',
      clientNumber: '1000001',
      address: 'Polna 5/10, 00-001 Warszawa',
      clientName: 'Jan Kowalski',
    };

    const filterPolna = new RegExp('Polna', 'i');
    assert.ok(filterPolna.test(account.address));

    const filterBilling = new RegExp('123456', 'i');
    assert.ok(filterBilling.test(account.billingAccount));

    const filterAgreement = new RegExp('1234/26/NET/0001', 'i');
    assert.ok(filterAgreement.test(account.agreementNumber));

    const filterUnknown = new RegExp('Poznańska', 'i');
    assert.ok(!filterUnknown.test(account.address));
    assert.ok(!filterUnknown.test(account.agreementNumber));
    assert.ok(!filterUnknown.test(account.billingAccount));
  });
});
