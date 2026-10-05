export const TAURON_CONFIG = {
  loginUrl: 'https://logowanie.tauron.pl',
  dashboardUrl: 'https://moj.tauron.pl',
  invoicesUrl: 'https://moj.tauron.pl/Home/Pages/faktury',
  archiveInvoicesUrl: 'https://moj.tauron.pl/Home/Pages/archiwum-dokumentow',
  accountsUrl: 'https://moj.tauron.pl/Home/Pages/numery-kont',
  
  selectors: {
    // Cookie consent dialog
    cookieAcceptBtn: 'button#onetrust-accept-btn-handler, #onetrust-accept-btn-handler, button[aria-label="Akceptuj wszystkie"], button.cookie-accept',
    
    // Login form selectors (Keycloak OpenID Connect on logowanie.tauron.pl)
    usernameInput: 'input#username, input[name="username"], input[type="email"], input[name="login"]',
    passwordInput: 'input#password, input[name="password"], input[type="password"]',
    submitBtn: 'button#kc-login, button[type="submit"], input[type="submit"]',
    
    // Challenge / 2FA indicators
    twoFactorPrompt: 'input[name="otp"], input[name="smsCode"], div:has-text("Kod SMS"), div:has-text("Weryfikacja dwuetapowa")',
    captchaContainer: 'div.g-recaptcha, div.h-captcha, iframe[src*="recaptcha"], iframe[src*="turnstile"]',
    loginError: '.ds-alert--error, .ds-alert.ds-alert--error, .field--error, span.kc-feedback-text, div.alert-danger, div.error-message',

    // Dashboard indicators (confirm login on moj.tauron.pl)
    loggedInIndicator: 'a[href*="LogOut"], a[href*="logout" i], a[href*="wyloguj" i], a:has-text("Wyloguj"), a[href*="ustawienia"], .header__logout, .user-profile',

    // Invoices list on moj.tauron.pl
    invoicesTable: 'table',
    invoiceRow: 'tbody tr:has(a[data-base*="GetDocumentImage"]), tr.invoice-row, tbody tr:has(.amount)',
    
    // Fields inside row
    invoiceNumber: 'a[data-base*="GetDocumentImage"], .invoice-number, td:nth-child(1)',
    issueDate: 'td:nth-child(2), .issue-date',
    dueDate: 'td:nth-child(4), td:nth-child(3), .due-date',
    amount: '.amount, input[data-charge-value], td:nth-child(5), td:nth-child(4)',
    status: '.ebok-button-pay-agreement, td:nth-child(5)',
    downloadPdfBtn: 'a[data-base*="GetDocumentImage"], a[href*=".pdf"], button:has-text("Pobierz"), a:has-text("PDF"), button.download-invoice',
  },
};

