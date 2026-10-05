import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import pdfjsPkg from 'pdfjs-dist/legacy/build/pdf.js';
import { prisma } from '../db/prisma.js';
import { config } from '../config/index.js';
import { logger } from '../core/logger.js';
import { BadRequestError, UnauthorizedError } from '../core/errors.js';
import { getTwelveMonthsAgoCutoff, cleanInvoiceNumber, cleanPaymentTitle } from '../core/utils.js';
import { wsConnectionManager } from '../ws/connectionManager.js';

async function extractTextFromPdf(pdfBuffer: Buffer): Promise<string> {
  try {
    const loadingTask = pdfjsPkg.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
      disableFontFace: true,
    });
    const doc = await loadingTask.promise;
    let fullText = '';
    for (let i = 1; i <= Math.min(doc.numPages, 5); i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      fullText += tc.items.map((it: any) => it.str).join(' ') + '\n';
    }
    return fullText;
  } catch (err: any) {
    logger.warn(`[MailScriptService] Nie udało się odczytać tekstu z PDF: ${err.message}`);
    return '';
  }
}
import type {
  MailScriptConfigDto,
  UpdateMailScriptConfigRequest,
  MailScriptStatusDto,
  MailScriptIngestRequest,
  MailScriptIngestResult,
  MailScriptPortalRule,
} from '@bills-master/shared-types';

function sanitizePdfText(str?: string | null): string {
  if (!str) return '';
  return str
    .replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .replace(/ą/g, 'a').replace(/Ą/g, 'A')
    .replace(/ć/g, 'c').replace(/Ć/g, 'C')
    .replace(/ę/g, 'e').replace(/Ę/g, 'E')
    .replace(/ń/g, 'n').replace(/Ń/g, 'N')
    .replace(/ó/g, 'o').replace(/Ó/g, 'O')
    .replace(/ś/g, 's').replace(/Ś/g, 'S')
    .replace(/ź/g, 'z').replace(/Ź/g, 'Z')
    .replace(/ż/g, 'z').replace(/Ż/g, 'Z')
    .replace(/[^\x20-\x7E\r\n\t]/g, ' ');
}

async function generateInvoicePdfFromEmail(data: {
  portalName: string;
  invoiceNumber: string;
  amountDue: number;
  dueDate: string | null;
  bankAccountNumber: string | null;
  paymentTitle: string | null;
  subject: string;
  bodySnippet: string;
  date: string;
}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  page.drawText(sanitizePdfText('BILLSMASTER — E-RACHUNEK POCZTOWY'), {
    x: 50,
    y: 790,
    size: 16,
    font: fontBold,
    color: rgb(0.15, 0.35, 0.75),
  });
  page.drawText(sanitizePdfText('Dostawca: ' + data.portalName), { x: 50, y: 760, size: 12, font: fontBold });
  page.drawText(sanitizePdfText('Numer dokumentu: ' + data.invoiceNumber), { x: 50, y: 740, size: 11, font });
  page.drawText(sanitizePdfText('Data otrzymania: ' + data.date), { x: 50, y: 720, size: 11, font });
  page.drawText(sanitizePdfText('Kwota do zaplaty: ' + data.amountDue.toFixed(2) + ' PLN'), {
    x: 50,
    y: 690,
    size: 14,
    font: fontBold,
    color: rgb(0.8, 0.2, 0.2),
  });
  if (data.dueDate) page.drawText(sanitizePdfText('Termin platnosci: ' + data.dueDate), { x: 50, y: 670, size: 12, font: fontBold });
  if (data.bankAccountNumber) page.drawText(sanitizePdfText('Konto do wplaty: ' + data.bankAccountNumber), { x: 50, y: 650, size: 11, font });
  page.drawText(sanitizePdfText('Temat wiadomosci: ' + data.subject.slice(0, 65)), { x: 50, y: 620, size: 10, font });

  page.drawText(sanitizePdfText('Tresc powiadomienia e-mail:'), { x: 50, y: 590, size: 10, font: fontBold });
  const lines = (data.bodySnippet || '').slice(0, 2000).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let y = 570;
  for (const line of lines.slice(0, 28)) {
    if (y < 60) break;
    page.drawText(sanitizePdfText(line.slice(0, 85)), { x: 50, y, size: 9, font });
    y -= 15;
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

export class MailScriptService {
  private static async getOrCreateConfig(detectedOrigin?: string) {
    let cfg = await prisma.mailScriptConfig.findUnique({ where: { id: 'default' } });
    const defaultEndpoint = `${detectedOrigin || process.env.PUBLIC_URL || 'http://localhost:3000'}/api/mail-script/ingest`;

    if (!cfg) {
      const token = 'bm_sec_' + crypto.randomUUID().replace(/-/g, '');
      cfg = await prisma.mailScriptConfig.create({
        data: {
          id: 'default',
          endpointUrl: defaultEndpoint,
          secretToken: token,
        },
      });
    } else if (cfg.endpointUrl.includes('custom-domain.local') || cfg.endpointUrl === 'https://my-bills.example.com/api/mail-script/ingest' || !cfg.endpointUrl) {
      // Auto-migrate placeholder/dummy endpoint to live detected URL
      cfg = await prisma.mailScriptConfig.update({
        where: { id: 'default' },
        data: { endpointUrl: defaultEndpoint },
      });
    }
    return cfg;
  }

  public static computeRulesHash(
    rules: MailScriptPortalRule[],
    endpointUrl: string,
    secretToken: string
  ): string {
    const serialized = JSON.stringify({
      endpointUrl: endpointUrl.trim(),
      secretToken: secretToken.trim(),
      rules: rules.map((r) => ({
        id: r.id,
        name: r.name,
        senderFilter: r.senderFilter,
        titleFilter: r.titleFilter,
        category: r.category,
      })).sort((a, b) => a.id.localeCompare(b.id)),
    });

    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  public static async getActivePortalRules(): Promise<MailScriptPortalRule[]> {
    const portals = await prisma.portal.findMany({
      where: {
        OR: [
          { isMailScript: true },
          { providerId: 'mail-script' },
        ],
        isEnabled: true,
      },
      include: {
        provider: true,
        _count: {
          select: { bills: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return portals.map((p) => ({
      id: p.id,
      name: p.name,
      senderFilter: p.senderFilter || '.*',
      titleFilter: p.titleFilter || '.*',
      category: (p.customCategory || p.provider?.category || 'OTHER') as any,
      lastSyncedAt: p._count.bills > 0 && p.lastSyncedAt ? p.lastSyncedAt.toISOString() : null,
    }));
  }

  public static generateScriptCode(
    endpointUrl: string,
    secretToken: string,
    portals: MailScriptPortalRule[]
  ): string {
    const portalsJson = JSON.stringify(portals);
    const statusUrl = endpointUrl.replace(/\/ingest\/?$/, '/status');

    return `const BM_CONFIG = {
  ENDPOINT_URL: ${JSON.stringify(endpointUrl)},
  STATUS_URL: ${JSON.stringify(statusUrl)},
  SECRET_TOKEN: ${JSON.stringify(secretToken)},
  PORTALS: ${portalsJson}
};

function normalizeDashes(str) {
  if (!str) return "";
  return str.replace(/[\\u2010-\\u2015\\u2212\\uFE58\\uFE63\\uFF0D]/g, "-").replace(/\\s+/g, " ").trim();
}

function runMailSync() {
  var portals = BM_CONFIG.PORTALS || [];
  var defaultSince = null;

  try {
    var resp = UrlFetchApp.fetch(BM_CONFIG.STATUS_URL + "?token=" + encodeURIComponent(BM_CONFIG.SECRET_TOKEN), { muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      var data = JSON.parse(resp.getContentText());
      if (data.activePortals && data.activePortals.length > 0) {
        portals = data.activePortals;
      }
      if (data.cutoffDate) defaultSince = new Date(data.cutoffDate);
      else if (data.lastRunDate) defaultSince = new Date(data.lastRunDate);
    }
  } catch (e) {}

  if (!defaultSince) {
    defaultSince = new Date();
    defaultSince.setDate(defaultSince.getDate() - 730);
  }

  if (!portals || !portals.length) return { success: true, count: 0, message: "Brak aktywnych portali" };

  var items = [];
  var seenIds = {};

  for (var p = 0; p < portals.length; p++) {
    var portal = portals[p];
    var portalSince = portal.lastSyncedAt ? new Date(portal.lastSyncedAt) : defaultSince;
    // 2 days buffer so recently sent invoices around midnight aren't missed
    var searchSince = new Date(portalSince.getTime() - (2 * 86400000));
    var formattedDate = Utilities.formatDate(searchSince, "GMT", "yyyy/MM/dd");

    var q = "after:" + formattedDate;
    if (portal.senderFilter) {
      var cleanFrom = portal.senderFilter.split("\\\\").join("").split(".*").join("").replace(/[\\\\^$]/g, "").trim();
      if (cleanFrom) q += " from:(" + cleanFrom + ")";
    }

    Logger.log("Szukanie dla portalu [" + portal.name + "]: " + q);
    var threads = GmailApp.search(q, 0, 50);
    Logger.log("Liczba watkow znalezionych w Gmail: " + threads.length);

    for (var i = 0; i < threads.length; i++) {
      var messages = threads[i].getMessages();
      for (var m = 0; m < messages.length; m++) {
        var msg = messages[m];
        var msgId = msg.getId();
        if (seenIds[msgId]) continue;
        var msgDate = msg.getDate();
        if (msgDate < searchSince) continue;
        var from = msg.getFrom();
        var subject = msg.getSubject();

        var normSubject = normalizeDashes(subject);
        var normTitleFilter = normalizeDashes(portal.titleFilter || ".*");

        if (!new RegExp(portal.senderFilter || ".*", "i").test(from)) continue;
        if (!new RegExp(normTitleFilter || ".*", "i").test(normSubject) && !new RegExp(portal.titleFilter || ".*", "i").test(subject)) continue;

        seenIds[msgId] = true;
        Logger.log("Dopasowano wiadomosc: [" + subject + "] od [" + from + "], data: " + msgDate.toISOString());

        var atts = msg.getAttachments();
        var foundPdf = false;
        for (var a = 0; a < atts.length; a++) {
          var att = atts[a];
          var name = att.getName();
          var type = att.getContentType() || "";
          if (type.indexOf("pdf") !== -1 || name.toLowerCase().indexOf(".pdf") !== -1) {
            items.push({
              portalId: portal.id,
              sender: from,
              subject: subject,
              date: msgDate.toISOString(),
              fileName: name,
              pdfBase64: Utilities.base64Encode(att.getBytes()),
              bodySnippet: msg.getPlainBody().substring(0, 3000)
            });
            foundPdf = true;
          }
        }

        if (!foundPdf) {
          items.push({
            portalId: portal.id,
            sender: from,
            subject: subject,
            date: msgDate.toISOString(),
            fileName: "e-rachunek_" + msgDate.toISOString().slice(0, 10) + ".pdf",
            bodySnippet: msg.getPlainBody().substring(0, 4000)
          });
        }
      }
    }
  }

  if (items.length === 0) {
    Logger.log("Brak nowych faktur do przesłania.");
    var resZero = UrlFetchApp.fetch(BM_CONFIG.ENDPOINT_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ secretToken: BM_CONFIG.SECRET_TOKEN, items: [] }),
      muteHttpExceptions: true
    });
    return JSON.parse(resZero.getContentText());
  }

  Logger.log("Przesylanie " + items.length + " faktur do BillsMaster w paczkach...");
  var totalImported = 0;
  var batchSize = 5;
  var lastResponse = null;

  for (var b = 0; b < items.length; b += batchSize) {
    var chunk = items.slice(b, b + batchSize);
    Logger.log("Wysylanie paczki " + (Math.floor(b / batchSize) + 1) + " (" + chunk.length + " faktur)...");
    var res = UrlFetchApp.fetch(BM_CONFIG.ENDPOINT_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ secretToken: BM_CONFIG.SECRET_TOKEN, items: chunk }),
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    if (code >= 200 && code < 300) {
      lastResponse = JSON.parse(res.getContentText());
      totalImported += (lastResponse.importedCount || 0);
    } else {
      throw new Error("BillsMaster HTTP " + code + ": " + res.getContentText());
    }
  }

  return {
    success: true,
    importedCount: totalImported,
    message: "Pomyślnie zaimportowano " + totalImported + " faktur z poczty Gmail.",
    lastRunDate: lastResponse ? lastResponse.lastRunDate : null
  };
}

function doGet(e) {
  try {
    return ContentService.createTextOutput(JSON.stringify(runMailSync())).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  return doGet(e);
}
`;
  }

  public static async getConfig(detectedOrigin?: string): Promise<MailScriptConfigDto> {
    const cfg = await this.getOrCreateConfig(detectedOrigin);
    const rules = await this.getActivePortalRules();

    const currentHash = this.computeRulesHash(rules, cfg.endpointUrl, cfg.secretToken);
    const scriptNeedsUpdate = rules.length > 0 && cfg.scriptAcknowledgedHash !== currentHash;

    const scriptCode = this.generateScriptCode(cfg.endpointUrl, cfg.secretToken, rules);

    return {
      endpointUrl: cfg.endpointUrl,
      gasWebAppUrl: cfg.gasWebAppUrl,
      secretToken: cfg.secretToken,
      lastRunDate: cfg.lastRunDate ? cfg.lastRunDate.toISOString() : null,
      lastRunStatus: cfg.lastRunStatus,
      lastRunMessage: cfg.lastRunMessage,
      lastRunCount: cfg.lastRunCount,
      scriptNeedsUpdate,
      scriptCode,
      portalCount: rules.length,
    };
  }

  public static async updateConfig(dto: UpdateMailScriptConfigRequest): Promise<MailScriptConfigDto> {
    const cfg = await this.getOrCreateConfig();
    const rules = await this.getActivePortalRules();

    const dataToUpdate: any = {};

    if (dto.endpointUrl !== undefined) {
      const url = dto.endpointUrl.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new BadRequestError('Adres endpointu musi zaczynać się od http:// lub https://');
      }
      dataToUpdate.endpointUrl = url;
    }

    if (dto.gasWebAppUrl !== undefined) {
      const gUrl = dto.gasWebAppUrl ? dto.gasWebAppUrl.trim() : null;
      if (gUrl && !gUrl.startsWith('http://') && !gUrl.startsWith('https://')) {
        throw new BadRequestError('Adres wdrożenia Google Apps Script musi zaczynać się od https://');
      }
      dataToUpdate.gasWebAppUrl = gUrl;
    }

    if (dto.regenerateToken) {
      dataToUpdate.secretToken = 'bm_sec_' + crypto.randomUUID().replace(/-/g, '');
    }

    if (dto.resetLastRunDate) {
      dataToUpdate.lastRunDate = null;
      dataToUpdate.lastRunStatus = null;
      dataToUpdate.lastRunMessage = 'Zresetowano datę pobierania (następne pobranie pobierze faktury z 12 miesięcy)';
      dataToUpdate.lastRunCount = 0;

      await prisma.portal.updateMany({
        where: {
          OR: [{ isMailScript: true }, { providerId: 'mail-script' }],
        },
        data: {
          lastSyncedAt: null,
          lastSyncMessage: 'Zresetowano datę pobierania (następne pobranie pobierze faktury z 12 miesięcy)',
        },
      });
    }

    const updatedCfg = await prisma.mailScriptConfig.update({
      where: { id: 'default' },
      data: dataToUpdate,
    });

    const activeRules = await this.getActivePortalRules();
    const currentHash = this.computeRulesHash(activeRules, updatedCfg.endpointUrl, updatedCfg.secretToken);

    if (dto.acknowledgeScriptUpdate) {
      await prisma.mailScriptConfig.update({
        where: { id: 'default' },
        data: { scriptAcknowledgedHash: currentHash },
      });
    }

    return this.getConfig();
  }

  public static async triggerRemoteSync(): Promise<{ success: boolean; message: string; importedCount: number }> {
    const cfg = await this.getOrCreateConfig();
    if (!cfg.gasWebAppUrl) {
      throw new BadRequestError('Adres URL wdrożenia Google Apps Script (Web App URL) nie został skonfigurowany w BillsMaster');
    }

    logger.info(`[MailScriptService] 🌐 Odpytywanie endpointu Google Apps Script Web App: ${cfg.gasWebAppUrl}`);

    try {
      const response = await fetch(cfg.gasWebAppUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'BillsMaster/1.0',
        },
      });

      const text = await response.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        if (text.includes('accounts.google.com') || text.includes('Sign in')) {
          throw new Error('Google wymaga logowania. Skonfiguruj wdrożenie jako: "Kto ma dostęp: Każdy" (Who has access: Anyone).');
        }
      }

      if (!response.ok && !data.success) {
        throw new Error(`Google Apps Script zwrócił kod HTTP ${response.status}`);
      }

      const importedCount = data.importedCount ?? data.count ?? 0;
      logger.info(`[MailScriptService] ✅ Odpowiedź z Google Apps Script: pobrano/zaimportowano ${importedCount} faktur`);

      return {
        success: true,
        message: data.message || `Pomyślnie wywołano Google Apps Script. Zaimportowano ${importedCount} faktur.`,
        importedCount,
      };
    } catch (err: any) {
      logger.error(`[MailScriptService] ❌ Błąd wywołania Google Apps Script: ${err.message}`);
      throw new Error(`Nie udało się wywołać Google Apps Script: ${err.message}`);
    }
  }

  public static async getStatus(token: string): Promise<MailScriptStatusDto> {
    const cfg = await this.getOrCreateConfig();
    if (!token || token.trim() !== cfg.secretToken) {
      throw new UnauthorizedError('Nieprawidłowy token autoryzacyjny');
    }

    const rules = await this.getActivePortalRules();
    const cutoff = getTwelveMonthsAgoCutoff();

    // If ANY active portal has never synced, return null for lastRunDate so all past bills are discovered
    const hasUnsyncedPortal = rules.some((r) => !r.lastSyncedAt);
    const effectiveLastRunDate = hasUnsyncedPortal ? null : (cfg.lastRunDate ? cfg.lastRunDate.toISOString() : null);

    return {
      lastRunDate: effectiveLastRunDate,
      cutoffDate: cutoff.toISOString(),
      activePortals: rules,
    };
  }

  public static async ingest(
    payload: MailScriptIngestRequest,
    clientIp?: string
  ): Promise<MailScriptIngestResult> {
    const cfg = await this.getOrCreateConfig();

    if (!payload.secretToken || payload.secretToken.trim() !== cfg.secretToken) {
      logger.warn(`[MailScriptService] Nieautoryzowana próba przesłania faktur z IP ${clientIp || 'unknown'}`);
      throw new UnauthorizedError('Nieprawidłowy lub brakujący token autoryzacyjny');
    }

    const items = payload.items;
    if (!Array.isArray(items)) {
      throw new BadRequestError('Pole items musi być tablicą');
    }

    const now = new Date();

    // If items is empty, this is a zero-results run.
    // Do NOT advance lastRunDate so subsequent runs can still search past history!
    if (items.length === 0) {
      await prisma.mailScriptConfig.update({
        where: { id: 'default' },
        data: {
          lastRunStatus: 'SUCCESS',
          lastRunMessage: 'Synchronizacja zakończona: brak nowych faktur w zadanym okresie',
          lastRunCount: 0,
        },
      });

      return {
        success: true,
        importedCount: 0,
        message: 'Brak nowych faktur do zaimportowania',
        lastRunDate: cfg.lastRunDate ? cfg.lastRunDate.toISOString() : null,
      };
    }

    const activePortals = await prisma.portal.findMany({
      where: {
        OR: [
          { isMailScript: true },
          { providerId: 'mail-script' },
        ],
        isEnabled: true,
      },
      include: {
        groups: {
          include: {
            group: {
              include: {
                users: true,
              },
            },
          },
        },
      },
    });

    if (activePortals.length === 0) {
      throw new BadRequestError('Brak aktywnych portali pocztowych skonfigurowanych w systemie');
    }

    let importedCount = 0;
    const errors: string[] = [];
    const affectedPortalIds = new Set<string>();
    const affectedUserIds = new Set<string>();

    for (let index = 0; index < items.length; index++) {
      const item = items[index];

      // 1. Match portal
      let matchedPortal = activePortals.find((p) => p.id === item.portalId);

      if (!matchedPortal) {
        // Fallback: match by sender and subject regex
        for (const portal of activePortals) {
          try {
            const senderRe = new RegExp(portal.senderFilter || '.*', 'i');
            const titleRe = new RegExp(portal.titleFilter || '.*', 'i');
            if (senderRe.test(item.sender) && titleRe.test(item.subject)) {
              matchedPortal = portal;
              break;
            }
          } catch {}
        }
      }

      if (!matchedPortal) {
        logger.warn(`[MailScriptService] Wiadomość [${item.subject}] od [${item.sender}] nie pasuje do żadnego aktywnego portalu. Pomijanie.`);
        errors.push(`Wiadomość "${item.subject}" od "${item.sender}" nie pasuje do żadnego portalu.`);
        continue;
      }

      affectedPortalIds.add(matchedPortal.id);
      for (const gp of matchedPortal.groups) {
        for (const u of gp.group.users) {
          affectedUserIds.add(u.userId);
        }
      }

      // Clean file name
      let pdfFileName = item.fileName?.trim() || `Faktura_Poczta_${Date.now()}.pdf`;
      let sanitizedFileName = pdfFileName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');

      // 1. Decode PDF attachment if present
      let pdfBuffer: Buffer | null = null;
      let pdfFileSize = 0;

      if (item.pdfBase64 && item.pdfBase64.trim().length > 0) {
        try {
          pdfBuffer = Buffer.from(item.pdfBase64.trim(), 'base64');
          pdfFileSize = pdfBuffer.length;
        } catch (err: any) {
          logger.warn(`[MailScriptService] Błąd dekodowania Base64 dla załącznika ${pdfFileName}:`, err);
        }
      }

      // 2. Extract text from PDF attachment if available
      let pdfExtractedText = '';
      if (pdfBuffer && pdfBuffer.length > 0) {
        pdfExtractedText = await extractTextFromPdf(pdfBuffer);
      }

      // 3. Extract metadata from combined text (subject, snippet, PDF text, filename)
      const combinedText = `${item.subject} ${item.bodySnippet || ''} ${pdfExtractedText} ${sanitizedFileName}`;

      // Extract invoice number
      let rawInvoiceNumber = item.invoiceNumber?.trim();
      let cleanInv = rawInvoiceNumber ? cleanInvoiceNumber(rawInvoiceNumber) : '';

      if (!cleanInv) {
        // Look for invoice number patterns
        // Pattern 0: Play-style invoice patterns (e.g. F/10552203/09/26 or F_10470278_10_24)
        const playSlashMatch = combinedText.match(/\b(F\/[0-9]{7,10}\/[0-9]{2}\/[0-9]{2})\b/i);
        const playFileMatch = sanitizedFileName ? sanitizedFileName.match(/\bF[_-]([0-9]{7,10})[_-]([0-9]{2})[_-]([0-9]{2})\b/i) : null;

        if (playSlashMatch) {
          cleanInv = playSlashMatch[1].toUpperCase();
        } else if (playFileMatch) {
          cleanInv = `F/${playFileMatch[1]}/${playFileMatch[2]}/${playFileMatch[3]}`;
        }

        const explicitInvMatch = !cleanInv ? combinedText.match(/(?:nr\s+faktury|numer\s+faktury|nr\s+rachunku(?!\s+(?:odbiorcy|bankow|klient|kont|platnik|wplat))|numer\s+rachunku(?!\s+(?:odbiorcy|bankow|klient|kont|platnik|wplat))|faktura\s+vat\s+nr|faktura\s+nr|rachunek\s+nr|nr\s+dokumentu|numer\s+dokumentu)[:\s#]+([A-Za-z0-9\/\-_]{3,35})/i) : null;
        const rachunekMatch = !cleanInv ? combinedText.match(/(?:bieżący|biezacy)\s+rachunek\s+([0-9]{2}[\/\-_][0-9]{4})/i) : null;

        if (!cleanInv && explicitInvMatch && explicitInvMatch[1]) {
          const cand = explicitInvMatch[1].trim();
          const isPureAmount = /^[0-9]+([,\.][0-9]{2})?$/.test(cand);
          if (!isPureAmount && cleanInvoiceNumber(cand)) {
            cleanInv = cleanInvoiceNumber(cand);
          }
        }

        if (!cleanInv && sanitizedFileName && !sanitizedFileName.startsWith('e-rachunek_') && sanitizedFileName.endsWith('.pdf')) {
          cleanInv = cleanInvoiceNumber(sanitizedFileName.replace(/\.pdf$/i, ''));
        }

        if (!cleanInv && rachunekMatch) {
          cleanInv = `RACHUNEK-${rachunekMatch[1].replace('/', '-')}`;
        }

        if (!cleanInv) {
          const datePrefix = new Date(item.date).toISOString().slice(0, 10).replace(/-/g, '');
          const portalPrefix = matchedPortal.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'MAIL';
          const hashShort = crypto.createHash('md5').update(`${item.sender}-${item.subject}-${sanitizedFileName}-${item.date}`).digest('hex').slice(0, 6).toUpperCase();
          cleanInv = `${portalPrefix}-${datePrefix}-${hashShort}`;
        }
      }

      // Extract amount due
      let amountDue = item.amountDue;
      if (amountDue === undefined || isNaN(amountDue) || amountDue <= 0) {
        // Pattern 1: Amount immediately followed by RAZEM
        const razemMatch = combinedText.match(/\b([0-9]{1,5}(?:[,\.][0-9]{2}))\s*RAZEM\b/i);

        // Pattern 2: Contextual keywords before amount (do zapłaty, kwota, rachunek, należność etc.)
        const contextualMatch = combinedText.match(/(?:do zapłaty|kwota do zapłaty|razem do zapłaty|należność|rachunek|kwota|wartość|suma|ogółem|razem)[:\s\r\n|–-]*([0-9]{1,5}(?:[,\.][0-9]{2}))\s*(?:zł|pln)?/i);

        // Pattern 3: Amount immediately followed by currency and optional payment words (e.g. "204,34 zł płatne do")
        const currencyMatch = combinedText.match(/([0-9]{1,5}(?:[,\.][0-9]{2}))\s*(?:zł|pln)(?:\s*(?:płatne|do zapłaty|termin))?/i);

        // Pattern 4: Fallback any isolated currency amount in text
        const fallbackMatch = combinedText.match(/\b([0-9]{1,5}[,\.][0-9]{2})\s*(?:zł|pln)\b/i);

        const chosenAmountMatch = razemMatch || contextualMatch || currencyMatch || fallbackMatch;
        if (chosenAmountMatch && chosenAmountMatch[1]) {
          const parsedStr = chosenAmountMatch[1].replace(/\s/g, '').replace(',', '.');
          const parsed = parseFloat(parsedStr);
          if (!isNaN(parsed) && parsed > 0) {
            amountDue = parsed;
          }
        }
      }
      if (amountDue === undefined || isNaN(amountDue)) {
        amountDue = 0.00;
      }

      // Dates
      let issueDate = item.date ? new Date(item.date) : new Date();
      const issueMatch = combinedText.match(/(?:data wystawienia|wystawiono dnia|data dokumentu)[:\s]*([0-9]{2}[\/\-\.][0-9]{2}[\/\-\.][0-9]{4}|[0-9]{4}[-\.\/][0-9]{2}[-\.\/][0-9]{2})/i);
      if (issueMatch && issueMatch[1]) {
        const rawIssue = issueMatch[1].replace(/[\.\/]/g, '-');
        const parts = rawIssue.split('-');
        if (parts[0].length === 4) {
          const parsed = new Date(rawIssue);
          if (!isNaN(parsed.getTime())) issueDate = parsed;
        } else if (parts[2].length === 4) {
          const parsed = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
          if (!isNaN(parsed.getTime())) issueDate = parsed;
        }
      }

      let dueDate = item.dueDate ? new Date(item.dueDate) : null;
      if (!dueDate || isNaN(dueDate.getTime())) {
        const polishMonths: Record<string, number> = {
          sty: 0, stycznia: 0,
          lut: 1, lutego: 1,
          mar: 2, marca: 2,
          kwi: 3, kwietnia: 3,
          maj: 4, maja: 4,
          cze: 5, czerwca: 5,
          lip: 6, lipca: 6,
          sie: 7, sierpnia: 7,
          wrz: 8, września: 8, wrzesnia: 8,
          paz: 9, paź: 9, października: 9, pazdziernika: 9,
          lis: 10, listopada: 10,
          gru: 11, grudnia: 11,
        };

        // Textual month format: "płatne do 17 wrz", "termin: 17 wrz 2026", "do 17 września"
        const textMonthMatch = combinedText.match(/(?:termin(?: płatności)?|płatne do|zapłać do|do dnia|do)[:\s\r\n|–-]*([0-9]{1,2})\s+(sty(?:cznia)?|lut(?:ego)?|mar(?:ca)?|kwi(?:etnia)?|maj(?:a)?|cze(?:rwca)?|lip(?:ca)?|sie(?:rpnia)?|wrz(?:eśnia|esnia)?|paź(?:dziernika)?|paz(?:dziernika)?|lis(?:topada)?|gru(?:dnia)?)(?:\s+([0-9]{4}))?/i);

        if (textMonthMatch) {
          const day = parseInt(textMonthMatch[1], 10);
          const mStr = textMonthMatch[2].toLowerCase();
          const year = textMonthMatch[3] ? parseInt(textMonthMatch[3], 10) : issueDate.getFullYear();
          const monthIdx = polishMonths[mStr];
          if (monthIdx !== undefined && !isNaN(day) && day >= 1 && day <= 31) {
            dueDate = new Date(Date.UTC(year, monthIdx, day, 12, 0, 0));
          }
        }
      }

      if (!dueDate || isNaN(dueDate.getTime())) {
        const rachunekDateMatch = combinedText.match(/rachunek\s+[0-9]{2}[\/\-_][0-9]{4}(?:\s+niezwłocznie)?\s+([0-9]{2}[\/\-\.][0-9]{2}[\/\-\.][0-9]{4})/i);
        const dueMatch = combinedText.match(/(?:termin(?: płatności)?|płatne do|zapłać do)[:\s\r\n|–-]*([0-9]{4}[-\.\/][0-9]{2}[-\.\/][0-9]{2}|[0-9]{2}[-\.\/][0-9]{2}[-\.\/][0-9]{4})/i);

        const chosenDueMatch = rachunekDateMatch || dueMatch;
        if (chosenDueMatch && chosenDueMatch[1]) {
          const rawDue = chosenDueMatch[1].replace(/[\.\/]/g, '-');
          const parts = rawDue.split('-');
          if (parts[0].length === 4) {
            dueDate = new Date(rawDue);
          } else if (parts[2].length === 4) {
            dueDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
          }
        }
      }
      if (!dueDate || isNaN(dueDate.getTime())) {
        dueDate = new Date(issueDate.getTime() + 14 * 24 * 60 * 60 * 1000);
      }

      // Bank account
      let bankAccountNumber = item.bankAccountNumber?.trim() || null;
      if (!bankAccountNumber) {
        const ibanMatch = combinedText.match(/(?:PL\s*)?([0-9]{2}(?:\s*[0-9]{4}){6})/i);
        if (ibanMatch && ibanMatch[1]) {
          bankAccountNumber = ibanMatch[1].replace(/\s+/g, '');
        }
      }

      // Payment title
      const paymentTitle = cleanPaymentTitle(item.paymentTitle || item.subject, cleanInv);

      // Fallback PDF generation if no physical PDF attachment was provided
      if (!pdfBuffer || pdfBuffer.length === 0) {
        pdfBuffer = await generateInvoicePdfFromEmail({
          portalName: matchedPortal.name,
          invoiceNumber: cleanInv,
          amountDue,
          dueDate: dueDate ? dueDate.toISOString().slice(0, 10) : null,
          bankAccountNumber,
          paymentTitle,
          subject: item.subject,
          bodySnippet: item.bodySnippet || '',
          date: issueDate.toISOString().slice(0, 10),
        });
        pdfFileSize = pdfBuffer.length;
        sanitizedFileName = `e-rachunek_${cleanInv}.pdf`;
      }

      // Ensure invoices directory exists for this portal
      const portalInvoicesDir = path.join(config.INVOICES_DIR, matchedPortal.id);
      await fs.mkdir(portalInvoicesDir, { recursive: true });
      const pdfFilePath = path.join(portalInvoicesDir, sanitizedFileName);
      await fs.writeFile(pdfFilePath, pdfBuffer);

      // Upsert bill in database
      await prisma.bill.upsert({
        where: {
          portalId_invoiceNumber: {
            portalId: matchedPortal.id,
            invoiceNumber: cleanInv,
          },
        },
        update: {
          amountDue,
          currency: 'PLN',
          issueDate,
          dueDate,
          bankAccountNumber,
          paymentTitle,
          pdfFilePath,
          pdfFileName: sanitizedFileName,
          pdfFileSize,
          rawMetadata: {
            source: 'GOOGLE_APPS_SCRIPT',
            sender: item.sender,
            subject: item.subject,
            receivedDate: item.date,
            fileName: sanitizedFileName,
          },
        },
        create: {
          portalId: matchedPortal.id,
          invoiceNumber: cleanInv,
          amountDue,
          currency: 'PLN',
          issueDate,
          dueDate,
          paymentStatus: 'UNPAID',
          bankAccountNumber,
          paymentTitle,
          pdfFilePath,
          pdfFileName: sanitizedFileName,
          pdfFileSize,
          rawMetadata: {
            source: 'GOOGLE_APPS_SCRIPT',
            sender: item.sender,
            subject: item.subject,
            receivedDate: item.date,
            fileName: sanitizedFileName,
          },
        },
      });

      importedCount++;
    }

    // ONLY update lastRunDate if processing did not crash and at least some items were handled
    await prisma.mailScriptConfig.update({
      where: { id: 'default' },
      data: {
        lastRunDate: now,
        lastRunStatus: 'SUCCESS',
        lastRunMessage: `Pomyślnie zaimportowano ${importedCount} faktur z poczty`,
        lastRunCount: importedCount,
      },
    });

    const mailPortals = await prisma.portal.findMany({
      where: { OR: [{ isMailScript: true }, { providerId: 'mail-script' }] },
      select: { id: true },
    });
    const allTargetPortalIds = Array.from(
      new Set([...Array.from(affectedPortalIds), ...mailPortals.map((p) => p.id)])
    );

    if (allTargetPortalIds.length > 0) {
      await prisma.portal.updateMany({
        where: { id: { in: allTargetPortalIds } },
        data: {
          lastSyncStatus: 'SUCCESS',
          lastSyncMessage: importedCount > 0 
            ? `Pobrano ${importedCount} faktur z poczty`
            : 'Poczta sprawdzona: brak nowych faktur',
          lastSyncedAt: now,
        },
      });
    }

    // Broadcast WebSocket updates to affected users + admins
    const adminUsers = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true },
    });
    const notifyUserIds = Array.from(
      new Set([...Array.from(affectedUserIds), ...adminUsers.map((a) => a.id)])
    );

    for (const uid of notifyUserIds) {
      wsConnectionManager.broadcastToUser(uid, {
        type: 'SYNC_COMPLETED',
        payload: {
          jobId: 'mail-script-' + Date.now(),
          portalId: allTargetPortalIds[0] || '',
          portalName: 'Poczta Gmail',
          status: 'SUCCESS',
          billsFound: items.length,
          billsImported: importedCount,
          message: importedCount > 0
            ? `Pobrano ${importedCount} nowych faktur z poczty`
            : 'Poczta sprawdzona: brak nowych faktur',
        },
      });
    }

    logger.info(`[MailScriptService] ✅ Pomyślnie zakończono ingest z Google Apps Script: ${importedCount} faktur.`);

    return {
      success: true,
      importedCount,
      message: `Pomyślnie zaimportowano ${importedCount} faktur z poczty Gmail.`,
      errors: errors.length > 0 ? errors : undefined,
      lastRunDate: now.toISOString(),
    };
  }
}
