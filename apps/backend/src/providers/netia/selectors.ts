export const NETIA_CONFIG = {
  loginUrl: 'https://www.netiaonline.pl/',
  dashboardUrl: 'https://ebok.netia.pl/',
  invoicesUrl: 'https://ebok.netia.pl/platnosci.jsp',
  contactUrl: 'https://ebok.netia.pl/dane_kontaktowe.jsp',
  selectors: {
    usernameInput: '#username, input[name="username"], input[name="login"]',
    passwordInput: '#password, input[name="password"]',
    submitButton: '#loginButton, button[type="submit"]',
    cookieConsentButton: '#cookieButton, input[name="cookieButton"], .bt_cookies',
    logoutLink: 'a[href*="logout"], a:has-text("Wyloguj")',
    invoicesTable: 'table.displayToRound, table.table_std',
  },
};
