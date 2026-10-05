export const EKARTOTEKA_CONFIG = {
  loginUrl: 'https://www.e-kartoteka.pl/#/login',
  baseUrl: 'https://www.e-kartoteka.pl',
  selectors: {
    usernameInput: 'input[name="login"]',
    passwordInput: 'input[name="password"]',
    submitButton: 'button.ek-app-main-page-panel-btn, button:has-text("Zaloguj się")',
    loggedInIndicator: 'text=WYLOGUJ, a[href*="wyloguj"], button:has-text("WYLOGUJ")',
    guideCloseButton: 'button:has-text("WYŁĄCZ WSKAZÓWKI"), button:has-text("Wyłącz wskazówki"), .modal button.close',
    rozrachunkiMenu: 'text=ROZRACHUNKI, a[href*="rozrachunki"]',
    rozrachunkiRow: 'tr:has-text("Rozrachunki z właścicielami")',
    showDocsButton: 'button:has-text("POKAŻ DOKUMENTY"), button:has-text("Pokaż dokumenty")',
    downloadAnnualReportButton: 'button:has-text("POBIERZ RAPORT"), button:has-text("Pobierz raport")',
    errorAlert: '.alert-danger, .modal-danger, .has-error',
  },
};
