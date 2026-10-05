import type { Page } from 'playwright';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { IBillProvider, ScrapeContext, AuthResult } from '../IBillProvider.js';
import type { ExtractedBill, ProviderCredentials } from '@bills-master/shared-types';

export class MockProvider implements IBillProvider {
  public readonly id = 'mock-provider';
  public readonly displayName = 'Demo Utility Portal';
  public readonly loginUrl = 'mock://demo-portal';

  private simulateFailureType: 'none' | 'connect' | 'login' | 'invoices' | 'parse' | 'pdf' = 'none';

  public async authenticate(
    _page: Page,
    creds: ProviderCredentials,
    context: ScrapeContext
  ): Promise<AuthResult> {
    context.log.info(`[MockProvider] Authenticating user: ${creds.login}`);
    await context.reportProgress(20, 'Łączenie z portalem demonstracyjnym...');
    
    // Simulate brief network latency
    await new Promise((res) => setTimeout(res, 600));

    const login = creds.login.toLowerCase();
    const pass = (creds.password || '').toLowerCase();

    if (login.includes('error-connect') || pass.includes('error-connect') || pass === 'trigger-connect-error') {
      context.setStage?.('Łączenie ze stroną portalu');
      throw new Error('net::ERR_CONNECTION_REFUSED at https://demo-portal.local/login');
    }

    if (login.includes('error-login') || pass === 'trigger-error' || pass.includes('error-login') || pass === 'trigger-login-error') {
      context.setStage?.('Logowanie do portalu');
      throw new Error('Nieprawidłowy login lub hasło użytkownika w portalu');
    }

    if (login.includes('error-invoices') || pass.includes('error-invoices') || pass === 'trigger-invoices-error') {
      this.simulateFailureType = 'invoices';
    } else if (login.includes('error-parse') || pass.includes('error-parse') || pass === 'trigger-parse-error') {
      this.simulateFailureType = 'parse';
    } else if (login.includes('error-pdf') || pass.includes('error-pdf') || pass === 'trigger-pdf-error') {
      this.simulateFailureType = 'pdf';
    } else {
      this.simulateFailureType = 'none';
    }

    await context.reportProgress(45, 'Logowanie udane. Przechodzenie do sekcji faktur...');
    return {
      sessionState: {
        cookies: [
          {
            name: 'mock_session',
            value: 'authenticated',
            domain: 'localhost',
            path: '/',
            expires: -1,
            httpOnly: false,
            secure: false,
            sameSite: 'Lax',
          },
        ],
        origins: [],
      },
      accountSummary: { clientNumber: 'MOCK-998822', tariff: 'G11' },
    };
  }

  public async fetchBills(
    _page: Page,
    context: ScrapeContext
  ): Promise<ExtractedBill[]> {
    context.log.info('[MockProvider] Extracting billing history and generating invoices...');
    await context.reportProgress(60, 'Pobieranie listy rozliczeń i faktur...');

    if (this.simulateFailureType === 'invoices') {
      context.setStage?.('Pobieranie listy faktur');
      throw new Error('Timeout 30000ms exceeded while waiting for invoice list table');
    }

    if (this.simulateFailureType === 'parse') {
      context.setStage?.('Przetwarzanie (parsowanie) danych faktur');
      throw new Error('Błąd odczytu danych: Nie znaleziono elementów kwoty ani daty płatności w strukturze HTML tabeli');
    }

    if (this.simulateFailureType === 'pdf') {
      context.setStage?.('Pobieranie plików PDF faktur');
      throw new Error('Nie udało się pobrać pliku PDF: Połączenie zostało zerwane przez serwer dostawcy (HTTP 500)');
    }


    const now = new Date();
    
    // Generate 3 realistic bills: 1 upcoming unpaid, 1 overdue, 1 paid
    const mockData = [
      {
        invNum: `FA/DEMO/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/01`,
        amount: 248.50,
        issueDate: new Date(now.getFullYear(), now.getMonth(), 1),
        dueDate: new Date(now.getFullYear(), now.getMonth(), 25),
        status: 'UNPAID' as const,
        title: `Energy settlement ${now.getMonth() + 1}/${now.getFullYear()}`,
      },
      {
        invNum: `FA/DEMO/${now.getFullYear()}/${String(now.getMonth()).padStart(2, '0')}/01`,
        amount: 312.80,
        issueDate: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        dueDate: new Date(now.getFullYear(), now.getMonth() - 1, 20),
        status: 'OVERDUE' as const,
        title: `Energy settlement ${now.getMonth()}/${now.getFullYear()}`,
      },
      {
        invNum: `FA/DEMO/${now.getFullYear()}/${String(now.getMonth() - 1).padStart(2, '0')}/01`,
        amount: 195.40,
        issueDate: new Date(now.getFullYear(), now.getMonth() - 2, 1),
        dueDate: new Date(now.getFullYear(), now.getMonth() - 2, 22),
        status: 'PAID' as const,
        title: `Energy settlement ${now.getMonth() - 1}/${now.getFullYear()}`,
      },
    ];

    const extracted: ExtractedBill[] = [];

    for (let i = 0; i < mockData.length; i++) {
      const item = mockData[i];
      await context.reportProgress(70 + (i * 10), `Przetwarzanie faktury ${item.invNum}...`);

      const pdfBuffer = await this.generateMockInvoicePdf(item.invNum, item.amount, item.dueDate, item.status);

      extracted.push({
        invoiceNumber: item.invNum,
        amountDue: item.amount,
        currency: 'PLN',
        issueDate: item.issueDate,
        dueDate: item.dueDate,
        paymentStatus: item.status,
        bankAccountNumber: 'PL 52 1050 1445 1000 0022 9988 1234',
        paymentTitle: item.invNum,
        pdfBuffer,
        pdfFileName: `Faktura_${item.invNum.replace(/\//g, '_')}.pdf`,
        rawMetadata: {
          meterReading: 1420 + i * 150,
          kwhUsed: 210,
          taxRate: '23%',
        },
      });
    }

    await context.reportProgress(100, 'Wszystkie faktury zostały pomyślnie odczytane.');
    return extracted;
  }

  private async generateMockInvoicePdf(
    invoiceNumber: string,
    amount: number,
    dueDate: Date,
    status: string
  ): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4 size
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const { width, height } = page.getSize();

    // Header Background
    page.drawRectangle({
      x: 0,
      y: height - 100,
      width: width,
      height: 100,
      color: rgb(0.12, 0.23, 0.53),
    });

    // Header Title
    page.drawText('DEMO UTILITY ENERGY S.A.', {
      x: 40,
      y: height - 55,
      size: 20,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    page.drawText('Official Settlement Document & Invoice', {
      x: 40,
      y: height - 75,
      size: 11,
      font,
      color: rgb(0.85, 0.9, 1),
    });

    // Invoice details box
    page.drawText(`INVOICE: ${invoiceNumber}`, {
      x: 40,
      y: height - 140,
      size: 16,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1),
    });

    page.drawText(`Status: ${status}`, {
      x: 40,
      y: height - 165,
      size: 12,
      font: fontBold,
      color: status === 'PAID' ? rgb(0.1, 0.6, 0.2) : status === 'OVERDUE' ? rgb(0.8, 0.1, 0.1) : rgb(0.8, 0.5, 0.0),
    });

    page.drawText(`Due Date: ${dueDate.toISOString().slice(0, 10)}`, {
      x: 40,
      y: height - 185,
      size: 11,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });

    page.drawText(`Bank Account: PL 10 1050 1445 1000 0022 9988 1234`, {
      x: 40,
      y: height - 205,
      size: 11,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });

    // Line items table
    page.drawRectangle({
      x: 40,
      y: height - 270,
      width: width - 80,
      height: 30,
      color: rgb(0.93, 0.94, 0.96),
    });

    page.drawText('Item Description', { x: 50, y: height - 258, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
    page.drawText('Gross Amount', { x: width - 150, y: height - 258, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2) });

    page.drawText('Electricity Consumption (Active Energy tariff G11)', { x: 50, y: height - 300, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(`${amount.toFixed(2)} PLN`, { x: width - 150, y: height - 300, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) });

    // Total box
    page.drawRectangle({
      x: width - 260,
      y: height - 370,
      width: 220,
      height: 50,
      color: rgb(0.96, 0.97, 1.0),
      borderColor: rgb(0.12, 0.23, 0.53),
      borderWidth: 1,
    });

    page.drawText('TOTAL TO PAY:', { x: width - 245, y: height - 345, size: 10, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(`${amount.toFixed(2)} PLN`, { x: width - 245, y: height - 362, size: 14, font: fontBold, color: rgb(0.12, 0.23, 0.53) });

    // Footer
    page.drawText('BillsMaster Auto-Imported Invoice. Generated for demonstration & testing.', {
      x: 40,
      y: 40,
      size: 9,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });

    return await pdfDoc.save();
  }
}
