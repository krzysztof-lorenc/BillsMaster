import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MyOrlenProvider } from './MyOrlenProvider.js';

describe('MyOrlenProvider Unit Tests', () => {
  const provider = new MyOrlenProvider();

  test('should have valid provider metadata', () => {
    assert.equal(provider.id, 'myorlen');
    assert.equal(provider.displayName, 'myORLEN (eBOK Gaz)');
    assert.equal(provider.loginUrl, 'https://ebok.myorlen.pl/');
  });

  test('formatAgreementAddress should format Polish address matching portal combobox', () => {
    const agKwiatowa = {
      AgreementNumber: 'AGR/1000/01',
      Address: {
        Ulica: 'Kwiatowa',
        UlicaTyp: 'ul.',
        NrBudynku: '2',
        NrLokalu: '126',
        KodPocztowy: '00-001',
        Miejscowosc: 'Warszawa',
      },
    };
    assert.equal(provider.formatAgreementAddress(agKwiatowa), 'Warszawa, ul. Kwiatowa 2/126');

    const agSloneczna = {
      AgreementNumber: 'AGR/2000/02',
      Address: {
        Ulica: 'Słoneczna',
        UlicaTyp: 'ul.',
        NrBudynku: '15a',
        NrLokalu: ' ',
        KodPocztowy: '00-002',
        Miejscowosc: 'Warszawa',
      },
    };
    assert.equal(provider.formatAgreementAddress(agSloneczna), 'Warszawa, ul. Słoneczna 15a');
  });

  test('formatAgreementAddress should handle missing sub-fields gracefully', () => {
    const agEmpty = {
      AgreementNumber: 'AG-12345',
      AgreementName: 'Moja Umowa Gaz',
    };
    assert.equal(provider.formatAgreementAddress(agEmpty), 'Moja Umowa Gaz');
  });

  test('regex filter correctly matches or discriminates agreements by address', () => {
    const agKwiatowa = {
      AgreementNumber: 'AGR/1000/01',
      ClientNumber: '11223344',
      Address: {
        Ulica: 'Kwiatowa',
        UlicaTyp: 'ul.',
        NrBudynku: '2',
        NrLokalu: '126',
        KodPocztowy: '00-001',
        Miejscowosc: 'Warszawa',
      },
    };

    const agSloneczna = {
      AgreementNumber: 'AGR/2000/02',
      ClientNumber: '99887766',
      Address: {
        Ulica: 'Słoneczna',
        UlicaTyp: 'ul.',
        NrBudynku: '15a',
        NrLokalu: ' ',
        KodPocztowy: '00-002',
        Miejscowosc: 'Warszawa',
      },
    };

    const formattedKwiatowa = provider.formatAgreementAddress(agKwiatowa);
    const formattedSloneczna = provider.formatAgreementAddress(agSloneczna);

    // Filter by "Kwiatowa"
    const regexKwiatowa = new RegExp('Kwiatowa', 'i');
    assert.ok(regexKwiatowa.test(formattedKwiatowa));
    assert.ok(!regexKwiatowa.test(formattedSloneczna));

    // Filter by "Słoneczna"
    const regexSloneczna = new RegExp('Słoneczna', 'i');
    assert.ok(!regexSloneczna.test(formattedKwiatowa));
    assert.ok(regexSloneczna.test(formattedSloneczna));

    // Filter by building "15a"
    const regex15a = new RegExp('15a', 'i');
    assert.ok(regex15a.test(formattedSloneczna));
    assert.ok(!regex15a.test(formattedKwiatowa));

    // Filter by Client number
    const regexClient = new RegExp('11223344', 'i');
    assert.ok(regexClient.test(agKwiatowa.ClientNumber));
    assert.ok(!regexClient.test(agSloneczna.ClientNumber));
  });
});
