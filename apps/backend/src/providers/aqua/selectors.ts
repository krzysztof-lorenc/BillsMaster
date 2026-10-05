export const AQUA_CONFIG = {
  loginUrl: 'https://ebok.aqua.com.pl/ords/r/ebok/e/logowanie',
  baseUrl: 'https://ebok.aqua.com.pl',
  selectors: {
    usernameInput: '#P102_USERNAME, input[name="P102_USERNAME"]',
    passwordInput: '#P102_PASSWORD, input[name="P102_PASSWORD"]',
    submitButton: '#ZALOGUJ, button#ZALOGUJ, button:has-text("ZALOGUJ SIĘ")',
    loginError: '.t-Alert--danger, .t-Alert--error, .a-Notification--error',
    loggedInIndicator: 'a:has-text("Wyloguj"), #t_TreeNav, a:has-text("Finanse")',
    cards: '.a-CardView-item',
    pointsSelect: '#P80_PUNKTY_FINANSE',
    finanseLink: 'a:has-text("Finanse")',
    dokumentyLink: 'a:has-text("Dokumenty")',
    mojeDaneLink: 'a:has-text("Moje dane")',
  },
};
