import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifySyncError } from './sync.classifier.js';
import { NeedsReauthError } from '../core/errors.js';

describe('Sync Error Classification & Banner Support', () => {
  test('should correctly classify connection errors with Polish title and guidance', () => {
    const err = new Error('net::ERR_CONNECTION_REFUSED at https://demo-portal.local/login');
    const result = classifySyncError(err, 'Łączenie ze stroną portalu');

    assert.equal(result.errorTitle, 'Nie można połączyć się ze stroną portalu dostawcy');
    assert.ok(result.generalInfo.includes('połączenia sieciowego'));
  });

  test('should correctly classify login / authentication errors with Polish title and guidance', () => {
    const err = new Error('Nieprawidłowy login lub hasło użytkownika w portalu');
    const result = classifySyncError(err, 'Logowanie do portalu');

    assert.equal(result.errorTitle, 'Błąd logowania do portalu dostawcy');
    assert.ok(result.generalInfo.includes('hasło'));
  });

  test('should correctly classify 2FA / Captcha challenges as re-auth requirements', () => {
    const err = new NeedsReauthError('Wymagana weryfikacja 2FA');
    const result = classifySyncError(err, 'Logowanie do portalu');

    assert.ok(
      result.errorTitle === 'Błąd logowania do portalu dostawcy' ||
      result.errorTitle === 'Wymagana ręczna autoryzacja (2FA / weryfikacja)'
    );
    assert.ok(result.generalInfo.includes('2FA') || result.generalInfo.includes('CAPTCHA') || result.generalInfo.includes('potwierdzenia'));
  });


  test('should correctly classify invoices list loading errors', () => {
    const err = new Error('Timeout 30000ms exceeded while waiting for invoice list table');
    const result = classifySyncError(err, 'Pobieranie listy faktur');

    assert.equal(result.errorTitle, 'Nie udało się pobrać listy faktur z portalu');
    assert.ok(result.generalInfo.includes('listą faktur') || result.generalInfo.includes('rozliczeń'));
  });

  test('should correctly classify page parsing errors', () => {
    const err = new Error('Błąd odczytu danych: Nie znaleziono elementów kwoty ani daty');
    const result = classifySyncError(err, 'Przetwarzanie (parsowanie) danych faktur');

    assert.equal(result.errorTitle, 'Błąd odczytu i parsowania danych ze strony portalu');
    assert.ok(result.generalInfo.includes('Układ graficzny'));
  });

  test('should correctly classify PDF download errors', () => {
    const err = new Error('Nie udało się pobrać pliku PDF: Połączenie zostało zerwane przez serwer');
    const result = classifySyncError(err, 'Pobieranie plików PDF faktur');

    assert.equal(result.errorTitle, 'Błąd pobierania pliku PDF faktury');
    assert.ok(result.generalInfo.includes('PDF'));
  });
});
