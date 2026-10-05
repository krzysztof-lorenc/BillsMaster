export const EUROLAN_CONFIG = {
  loginUrl: 'https://bok.euro-lan.pl/',
  baseUrl: 'https://bok.euro-lan.pl',
  selectors: {
    usernameInput: '#inputLogin, input[name="loginform[login]"]',
    passwordInput: '#inputPassword, input[name="loginform[pwd]"]',
    submitButton: 'button[name="loginform[submit]"], #login button[type="submit"]',
    loginError: '.alert, .alert-danger, .toast-body, .form-signin .alert',
    loggedInIndicator: 'a[href*="m=logout"], a:has-text("Wyloguj")',
    infoLink: 'a[href*="m=info"], a:has-text("Informacje")',
    financesLink: 'a[href*="m=finances"], a:has-text("Finanse")',
    balanceSection: '#balance',
    userBalanceBox: '#userbalancebox',
    invoiceRows: '#userbalancebox tr.table-click',
  },
};
