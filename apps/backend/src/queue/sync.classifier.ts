import { NeedsReauthError } from '../core/errors.js';

export function classifySyncError(err: any, stage: string): { errorTitle: string; generalInfo: string } {
  const msg = (err?.message || '').toLowerCase();

  // 1. Cannot connect to portal
  if (
    msg.includes('connection') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('err_name_not_resolved') ||
    msg.includes('err_connection_refused') ||
    msg.includes('err_internet_disconnected') ||
    msg.includes('net::') ||
    msg.includes('nie można połączyć') ||
    stage.toLowerCase().includes('łączenie')
  ) {
    return {
      errorTitle: 'Nie można połączyć się ze stroną portalu dostawcy',
      generalInfo: 'Wystąpił problem z nawiązaniem połączenia sieciowego z serwerem portalu dostawcy mediów. Sprawdź połączenie z internetem lub odczekaj chwilę, jeśli portal przeprowadza prace techniczne.',
    };
  }

  // 2. 2FA / Verification required
  if (
    msg.includes('sms') ||
    msg.includes('kod sms') ||
    msg.includes('kod weryfikacyjny') ||
    msg.includes('weryfikacja kodem') ||
    stage.toLowerCase().includes('kod sms') ||
    stage.toLowerCase().includes('2fa')
  ) {
    return {
      errorTitle: 'Wymagana ręczna autoryzacja (2FA / weryfikacja)',
      generalInfo: 'Portal wymaga dodatkowego potwierdzenia tożsamości (weryfikacja 2FA lub kod bezpieczeństwa). Zaloguj się bezpośrednio w serwisie dostawcy.',
    };
  }

  // 3. Cannot login / General Credentials / CAPTCHA
  if (
    err instanceof NeedsReauthError ||
    msg.includes('needs_reauth') ||
    msg.includes('2fa') ||
    msg.includes('captcha') ||
    msg.includes('weryfikacj') ||
    msg.includes('hasło') ||
    msg.includes('login') ||
    msg.includes('credential') ||
    msg.includes('autoryzacj') ||
    stage.toLowerCase().includes('logowanie')
  ) {
    return {
      errorTitle: 'Błąd logowania do portalu dostawcy',
      generalInfo: 'Logowanie do serwisu dostawcy zakończyło się niepowodzeniem. Wprowadzone hasło może być nieprawidłowe, wygasło lub portal wymaga ręcznego potwierdzenia tożsamości (weryfikacja 2FA lub CAPTCHA).',
    };
  }

  // 3. Cannot download invoices list
  if (
    msg.includes('invoices') ||
    msg.includes('faktur') ||
    msg.includes('rozliczeń') ||
    stage.toLowerCase().includes('pobieranie listy faktur')
  ) {
    return {
      errorTitle: 'Nie udało się pobrać listy faktur z portalu',
      generalInfo: 'Po pomyślnym zalogowaniu system nie mógł załadować zakładki rozliczeń i faktur dostawcy. Strona mogła zmienić swój adres lub przekroczyła limit czasu odpowiedzi.',
    };
  }

  // 4. Cannot parse the page
  if (
    msg.includes('parse') ||
    msg.includes('parsow') ||
    msg.includes('odczyt') ||
    msg.includes('selector') ||
    stage.toLowerCase().includes('parsowanie') ||
    stage.toLowerCase().includes('przetwarzanie')
  ) {
    return {
      errorTitle: 'Błąd odczytu i parsowania danych ze strony portalu',
      generalInfo: 'Układ graficzny portalu dostawcy uległ zmianie lub tabela z rachunkami zawiera nieobsługiwany format. Nie udało się odczytać kwot do zapłaty lub numerów dokumentów.',
    };
  }

  // 5. Cannot download PDF
  if (
    msg.includes('pdf') ||
    msg.includes('pobieranie plik') ||
    stage.toLowerCase().includes('pdf')
  ) {
    return {
      errorTitle: 'Błąd pobierania pliku PDF faktury',
      generalInfo: 'Wystąpił problem podczas pobierania dokumentu PDF faktury z serwera dostawcy. Plik może być uszkodzony, tymczasowo niedostępny lub pobieranie zostało przerwane.',
    };
  }

  // Default fallback
  return {
    errorTitle: `Wystąpił problem podczas odświeżania danych (${stage})`,
    generalInfo: 'Wystąpił nieoczekiwany błąd podczas komunikacji z serwisem dostawcy mediów.',
  };
}
