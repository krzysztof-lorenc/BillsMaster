import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import type { BillDto } from '@bills-master/shared-types';
import { generateZbpQrString, validateAndParseNrb } from './zbpQr.js';

/**
 * Resolves the genuine recipient / seller / community name from the bill.
 * Avoids using private portal nicknames (e.g. "Bystrzańska", "Dom") unless no other name is available.
 */
export function resolveBillRecipient(bill?: BillDto | null): string {
  if (!bill) return 'Dostawca';

  const meta = (bill.rawMetadata || {}) as Record<string, any>;

  // 0. Configured portal payment receiver (configured in portal settings)
  if (bill.portal?.paymentReceiver && bill.portal.paymentReceiver.trim()) {
    return bill.portal.paymentReceiver.trim();
  }

  // 1. Explicit recipient from metadata
  if (meta.recipient && typeof meta.recipient === 'string' && meta.recipient.trim()) {
    return meta.recipient.trim();
  }

  // 2. Seller name / issuer from metadata
  if (meta.sellerName && typeof meta.sellerName === 'string' && meta.sellerName.trim()) {
    return meta.sellerName.trim();
  }
  if (meta.seller && typeof meta.seller === 'string' && meta.seller.trim()) {
    return meta.seller.trim();
  }

  // 3. Housing community name (e.g. e-kartoteka: 'Wspólnota Mieszkaniowa "Lipowa Dolina" ul. Bystrzańska 15 b, 15 c')
  if (meta.communityName && typeof meta.communityName === 'string' && meta.communityName.trim()) {
    let clean = meta.communityName.trim();
    clean = clean.replace(/[,;]?\s+(?:ul\.|al\.|pl\.|os\.)\s+.*$/i, '');
    clean = clean.replace(/["”„«»]/g, '');
    if (clean.trim()) return clean.trim();
  }

  // 4. Sender from email ingestion (e.g. "Canal+", "Vectra")
  if (meta.sender && typeof meta.sender === 'string' && meta.sender.trim()) {
    const senderClean = meta.sender.replace(/<.*?>/, '').replace(/["']/g, '').trim();
    if (senderClean) return senderClean;
  }

  // 5. Provider display name (e.g. "Tauron", "Netia", "AQUA Bielsko-Biała", "Euro-lan")
  if (bill.portal?.providerName && bill.portal.providerName.trim() && bill.portal.providerName !== 'Dostawca') {
    return bill.portal.providerName.trim();
  }

  // 6. User's custom portal name (only as fallback)
  if (bill.portal?.name && bill.portal.name.trim()) {
    return bill.portal.name.trim();
  }

  return 'Dostawca';
}

/**
 * Renders a QR code to an HTML Canvas in memory using SVG rendering
 */
export function generateQrCanvas(qrString: string, size = 300): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    let svgString = renderToStaticMarkup(
      React.createElement(QRCodeSVG, {
        value: qrString,
        size,
        level: 'M',
        includeMargin: true,
        xmlns: 'http://www.w3.org/2000/svg',
      })
    );

    if (!svgString.includes('xmlns=')) {
      svgString = svgString.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    }

    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      const padding = 24;
      const canvas = document.createElement('canvas');
      canvas.width = img.width + padding * 2;
      canvas.height = img.height + padding * 2;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, padding, padding);
      }
      resolve(canvas);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Nie udało się wygenerować obrazu kodu QR'));
    };

    img.src = url;
  });
}

/**
 * Downloads a generated QR code as a PNG file directly
 */
export async function downloadQrPng(qrString: string, fileName: string, size = 300): Promise<void> {
  const canvas = await generateQrCanvas(qrString, size);
  const dataUrl = canvas.toDataURL('image/png');
  const downloadLink = document.createElement('a');
  downloadLink.href = dataUrl;
  downloadLink.download = fileName.endsWith('.png') ? fileName : `${fileName}.png`;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}

/**
 * Generates and downloads payment QR code for a bill without needing to open the QR modal
 */
export async function downloadBillQrCode(bill: BillDto): Promise<void> {
  const nrb = validateAndParseNrb(bill.bankAccountNumber);
  if (!nrb.isValidLength) {
    throw new Error('Rachunek nie posiada poprawnego 26-cyfrowego numeru konta bankowego.');
  }

  const recipient = resolveBillRecipient(bill);
  const title = bill.paymentTitle || bill.invoiceNumber || 'Opłata za rachunek';
  const amount = bill.amountDue || 0;

  const qrString = generateZbpQrString({
    accountNumber: bill.bankAccountNumber || '',
    recipient,
    title,
    amount,
    removePolishChars: false,
  });

  const invoiceLabel = (bill.invoiceNumber || bill.id || 'faktura').replace(/[\/\\:]/g, '_');
  await downloadQrPng(qrString, `QR_Przelew_${invoiceLabel}.png`, 300);
}
