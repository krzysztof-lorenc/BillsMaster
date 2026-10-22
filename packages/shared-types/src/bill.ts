export type BillStatus = 'PAID' | 'UNPAID' | 'OVERDUE' | 'PROCESSING';

export interface BillDto {
  id: string;
  portalId: string;
  invoiceNumber: string;
  amountDue: number;
  currency: string;
  issueDate: string;
  dueDate: string;
  paymentStatus: BillStatus;
  bankAccountNumber?: string | null;
  paymentTitle?: string | null;
  pdfFileName?: string | null;
  hasPdf: boolean;
  rawMetadata?: Record<string, unknown> | null;
  isMailScript?: boolean;
  createdAt: string;
  updatedAt: string;
  portal?: {
    id: string;
    name: string;
    providerId: string;
    providerName: string;
    category: string;
    isMailScript?: boolean;
    paymentReceiver?: string | null;
  };
}

export interface UpdateBillPaymentStatusRequest {
  paymentStatus?: BillStatus;
  isPaid?: boolean;
}

export interface BillsSummaryDto {
  totalUnpaidAmount: number;
  totalPaidAmount: number;
  unpaidCount: number;
  overdueCount: number;
  upcomingDueBills: BillDto[];
  recentBills: BillDto[];
}

export interface BillFilterQuery {
  status?: BillStatus | 'PAY_30';
  portalId?: string;
  groupId?: string;
  from?: string;
  to?: string;
}
