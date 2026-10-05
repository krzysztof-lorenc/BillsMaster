import fs from 'node:fs';
import { prisma } from '../db/prisma.js';
import { NotFoundError, BadRequestError } from '../core/errors.js';
import { getTwelveMonthsAgoCutoff } from '../core/utils.js';
import type { BillDto, BillsSummaryDto, BillFilterQuery, BillStatus, UpdateBillPaymentStatusRequest } from '@bills-master/shared-types';


export class BillService {
  /**
   * Helper to retrieve all portal IDs accessible to a user via their assigned groups (optionally filtered by groupId).
   */
  private static async getAccessiblePortalIds(userId: string, groupId?: string): Promise<string[]> {
    const userGroupsWhere: { userId: string; groupId?: string } = { userId };
    if (groupId) {
      userGroupsWhere.groupId = groupId;
    }
    const userGroups = await prisma.userGroup.findMany({
      where: userGroupsWhere,
      select: { groupId: true },
    });

    if (userGroups.length === 0) return [];

    const groupIds = userGroups.map((ug) => ug.groupId);
    const groupPortals = await prisma.groupPortal.findMany({
      where: { groupId: { in: groupIds } },
      select: { portalId: true },
    });

    return Array.from(new Set(groupPortals.map((gp) => gp.portalId)));
  }

  public static async getBills(userId: string, filters: BillFilterQuery): Promise<BillDto[]> {
    const portalIds = await this.getAccessiblePortalIds(userId, filters.groupId);
    if (portalIds.length === 0) {
      return [];
    }

    const whereClause: any = {
      portalId: { in: portalIds },
    };

    if (filters.status) {
      if ((filters.status as string) === 'PAY_30') {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const in30Days = new Date(now);
        in30Days.setDate(in30Days.getDate() + 30);
        in30Days.setHours(23, 59, 59, 999);

        whereClause.paymentStatus = { not: 'PAID' };
        whereClause.dueDate = {
          lte: in30Days,
        };
      } else if (filters.status === 'UNPAID') {
        whereClause.paymentStatus = { not: 'PAID' };
      } else if (filters.status === 'OVERDUE') {
        const now = new Date();
        whereClause.paymentStatus = { not: 'PAID' };
        whereClause.AND = [
          {
            OR: [
              { paymentStatus: 'OVERDUE' },
              { dueDate: { lt: now } },
            ],
          },
        ];
      } else {
        whereClause.paymentStatus = filters.status;
      }
    }

    if (filters.portalId) {
      if (portalIds.includes(filters.portalId)) {
        whereClause.portalId = filters.portalId;
      } else {
        return []; // user doesn't have access to this portal
      }
    }

    const cutoff = getTwelveMonthsAgoCutoff();
    whereClause.issueDate = whereClause.issueDate || {};
    if (filters.from) {
      const fromDate = new Date(filters.from);
      whereClause.issueDate.gte = fromDate < cutoff ? cutoff : fromDate;
    } else {
      whereClause.issueDate.gte = cutoff;
    }
    if (filters.to) {
      whereClause.issueDate.lte = new Date(filters.to);
    }

    const bills = await prisma.bill.findMany({
      where: whereClause,
      include: {
        portal: {
          include: { provider: true },
        },
      },
      orderBy: (filters.status as string) === 'PAY_30' ? { dueDate: 'asc' } : { dueDate: 'desc' },
    });

    return bills
      .filter((b) => this.matchesPortalFilter(b))
      .map((b) => this.mapToDto(b));
  }

  public static async getSummary(userId: string, groupId?: string): Promise<BillsSummaryDto> {
    const portalIds = await this.getAccessiblePortalIds(userId, groupId);
    if (portalIds.length === 0) {
      return {
        totalUnpaidAmount: 0,
        totalPaidAmount: 0,
        unpaidCount: 0,
        overdueCount: 0,
        upcomingDueBills: [],
        recentBills: [],
      };
    }

    const cutoff = getTwelveMonthsAgoCutoff();
    const allBillsRaw = await prisma.bill.findMany({
      where: {
        portalId: { in: portalIds },
        issueDate: { gte: cutoff },
      },
      include: {
        portal: {
          include: { provider: true },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    const allBills = allBillsRaw.filter((b) => this.matchesPortalFilter(b));

    let totalUnpaidAmount = 0;
    let totalPaidAmount = 0;
    let unpaidCount = 0;
    let overdueCount = 0;

    const upcomingDueBills: BillDto[] = [];
    const now = new Date();

    for (const b of allBills) {
      const amount = Number(b.amountDue);
      if (b.paymentStatus === 'UNPAID') {
        totalUnpaidAmount += amount;
        unpaidCount++;
        if (b.dueDate >= now) {
          upcomingDueBills.push(this.mapToDto(b));
        } else {
          overdueCount++;
        }
      } else if (b.paymentStatus === 'OVERDUE') {
        totalUnpaidAmount += amount;
        overdueCount++;
      } else if (b.paymentStatus === 'PAID') {
        totalPaidAmount += amount;
      }
    }

    const recentBills = allBills
      .sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime())
      .slice(0, 5)
      .map((b) => this.mapToDto(b));

    return {
      totalUnpaidAmount: Math.round(totalUnpaidAmount * 100) / 100,
      totalPaidAmount: Math.round(totalPaidAmount * 100) / 100,
      unpaidCount,
      overdueCount,
      upcomingDueBills: upcomingDueBills.slice(0, 5),
      recentBills,
    };
  }

  public static async getBillPdf(userId: string, billId: string): Promise<{ filePath: string; fileName: string }> {
    const portalIds = await this.getAccessiblePortalIds(userId);
    if (portalIds.length === 0) {
      throw new NotFoundError('Nie znaleziono pliku PDF faktury');
    }

    const bill = await prisma.bill.findFirst({
      where: {
        id: billId,
        portalId: { in: portalIds },
      },
    });

    if (!bill || !bill.pdfFilePath) {
      throw new NotFoundError('Rachunek nie posiada przypisanego pliku PDF');
    }

    let filePath = bill.pdfFilePath;

    // Self-healing: if file does not exist at stored path, check cleaned path or if file with newline exists
    if (!fs.existsSync(filePath)) {
      const cleanPath = filePath.replace(/\s*[\r\n]+.*/g, '.pdf').replace(/[\r\n\t]+/g, '').trim();
      if (fs.existsSync(cleanPath)) {
        filePath = cleanPath;
      } else {
        throw new NotFoundError('Plik PDF faktury nie został odnaleziony na dysku serwera');
      }
    }

    const rawFileName = bill.pdfFileName || `Invoice_${bill.invoiceNumber}.pdf`;
    const cleanFileName = rawFileName.replace(/\s*[\r\n]+.*/g, '.pdf').replace(/[\r\n\t]+/g, ' ').trim();

    return {
      filePath,
      fileName: cleanFileName,
    };
  }

  public static async updateBillPaymentStatus(
    userId: string,
    billId: string,
    update: UpdateBillPaymentStatusRequest
  ): Promise<BillDto> {
    const portalIds = await this.getAccessiblePortalIds(userId);
    if (portalIds.length === 0) {
      throw new NotFoundError('Nie znaleziono rachunku');
    }

    const bill = await prisma.bill.findFirst({
      where: {
        id: billId,
        portalId: { in: portalIds },
      },
      include: {
        portal: {
          include: { provider: true },
        },
      },
    });

    if (!bill) {
      throw new NotFoundError('Nie znaleziono rachunku');
    }

    const isMailScript = Boolean(
      bill.portal?.isMailScript ||
      bill.portal?.providerId === 'mail-script' ||
      (bill.rawMetadata as any)?.source === 'GOOGLE_APPS_SCRIPT'
    );

    if (!isMailScript) {
      throw new BadRequestError('Ręczna zmiana statusu płatności jest dostępna tylko dla rachunków pobieranych z poczty e-mail / Google Scripts.');
    }

    let targetStatus: BillStatus;
    if (typeof update.isPaid === 'boolean') {
      if (update.isPaid) {
        targetStatus = 'PAID';
      } else {
        const now = new Date();
        targetStatus = bill.dueDate < now ? 'OVERDUE' : 'UNPAID';
      }
    } else if (update.paymentStatus) {
      targetStatus = update.paymentStatus;
    } else {
      throw new BadRequestError('Należy podać parametr paymentStatus lub isPaid');
    }

    const updated = await prisma.bill.update({
      where: { id: billId },
      data: { paymentStatus: targetStatus },
      include: {
        portal: {
          include: { provider: true },
        },
      },
    });

    return this.mapToDto(updated);
  }

  private static mapToDto(b: any): BillDto {
    const isMailScript = Boolean(
      b.portal?.isMailScript ||
      b.portal?.providerId === 'mail-script' ||
      (b.rawMetadata as any)?.source === 'GOOGLE_APPS_SCRIPT'
    );

    return {
      id: b.id,
      portalId: b.portalId,
      invoiceNumber: b.invoiceNumber,
      amountDue: Number(b.amountDue),
      currency: b.currency,
      issueDate: b.issueDate.toISOString(),
      dueDate: b.dueDate.toISOString(),
      paymentStatus: b.paymentStatus,
      bankAccountNumber: b.bankAccountNumber,
      paymentTitle: b.paymentTitle,
      pdfFileName: b.pdfFileName,
      hasPdf: Boolean(b.pdfFilePath),
      rawMetadata: b.rawMetadata,
      isMailScript,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
      portal: b.portal
        ? {
            id: b.portal.id,
            name: b.portal.name,
            providerId: b.portal.provider.id,
            providerName: b.portal.provider.name,
            category: b.portal.customCategory || b.portal.provider.category,
            isMailScript: Boolean(b.portal.isMailScript || b.portal.providerId === 'mail-script'),
          }
        : undefined,
    };
  }

  private static matchesPortalFilter(b: any): boolean {
    const filter = b.portal?.agreementFilter;
    if (!filter || !filter.trim()) return true;
    try {
      const regex = new RegExp(filter.trim(), 'i');
      const meta = b.rawMetadata as any;
      if (meta?.agreementName && regex.test(meta.agreementName)) {
        return true;
      }
      if (meta?.address) {
        if (typeof meta.address === 'string' && regex.test(meta.address)) {
          return true;
        }
        if (typeof meta.address === 'object') {
          const addrStr = `${meta.address.Miejscowosc || ''} ${meta.address.Ulica || ''} ${meta.address.NrBudynku || ''}`;
          if (regex.test(addrStr)) return true;
        }
      }
      if (meta?.agreementNumber && regex.test(meta.agreementNumber)) {
        return true;
      }
      if (meta?.clientNumber && regex.test(meta.clientNumber)) {
        return true;
      }
      return regex.test(b.invoiceNumber);
    } catch {
      return true;
    }
  }

  /**
   * Automatically deletes all bills and their corresponding PDF files that are older than 12 months.
   * Can be scoped to a single portal or run globally across all portals.
   */
  public static async deleteBillsOlderThan12Months(portalId?: string): Promise<number> {
    const cutoff = getTwelveMonthsAgoCutoff();
    const whereClause: any = {
      issueDate: { lt: cutoff },
    };
    if (portalId) {
      whereClause.portalId = portalId;
    }

    const oldBills = await prisma.bill.findMany({
      where: whereClause,
      select: { id: true, pdfFilePath: true },
    });

    if (oldBills.length === 0) {
      return 0;
    }

    // Delete associated PDF files on disk
    for (const b of oldBills) {
      if (b.pdfFilePath) {
        try {
          await fs.promises.unlink(b.pdfFilePath);
        } catch {
          // File may already have been removed
        }
      }
    }

    // Delete records from database
    const deleteResult = await prisma.bill.deleteMany({
      where: {
        id: { in: oldBills.map((b) => b.id) },
      },
    });

    return deleteResult.count;
  }
}

