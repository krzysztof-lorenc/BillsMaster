export const MYORLEN_CONFIG = {
  loginUrl: 'https://ebok.myorlen.pl/',
  dashboardUrl: 'https://ebok.myorlen.pl/home',
  invoicesUrl: 'https://ebok.myorlen.pl/faktury',

  api: {
    login: 'https://ebok.myorlen.pl/auth/login?api-version=3.0',
    agreements: 'https://ebok.myorlen.pl/crm/get-all-agreements?api-version=3.0',
    agreementsFallback: 'https://ebok.myorlen.pl/crm/get-agreements?api-version=3.0',
    ppgList: 'https://ebok.myorlen.pl/crm/get-ppg-list?api-version=3.0',
    invoices: 'https://ebok.myorlen.pl/crm/get-invoices-v2?api-version=3.0',
    invoicePdf: 'https://ebok.myorlen.pl/crm/get-invoice-pdf',
    balance: 'https://ebok.myorlen.pl/crm/get-balance?api-version=3.0',
  },

  selectors: {
    cookieAcceptBtn: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    showLoginFormBtn: 'button:has-text("Zaloguj loginem eBOK")',
    usernameInput: 'input[name="identificator"]',
    passwordInput: 'input[name="accessPin"]',
    submitBtn: 'button[type="submit"]:has-text("Zaloguj")',
    loggedInIndicator: 'button:has-text("Wyloguj"), a:has-text("Wyloguj"), :text("Zalogowany:")',
    loginError: '.alert-box, .error-message, .form-error, [class*="error"]',
    twoFactorPrompt: 'input[name="smsCode"], input[name="token2FA"], [data-testid="2fa"]',
    captchaContainer: '.g-recaptcha, #recaptcha, iframe[src*="recaptcha"]',
  },
} as const;
