import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = 'PLN'): string {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency,
  }).format(amount);
}

export function formatDate(dateString: string): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return date.toLocaleDateString('pl-PL', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatFullDate(dateString: string): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return date.toLocaleDateString('pl-PL', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatDateTime(dateString?: string | null): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return date.toLocaleString('pl-PL', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatBankAccount(account?: string | null): string {
  if (!account) return '';
  const cleaned = account.replace(/\s+/g, '').toUpperCase();
  const prefix = cleaned.startsWith('PL') ? 'PL ' : '';
  const digits = cleaned.replace(/^PL/, '');

  if (digits.length === 26) {
    // Standard Polish IBAN: 2 digits control + 6 blocks of 4 digits
    return `${prefix}${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6, 10)} ${digits.slice(10, 14)} ${digits.slice(14, 18)} ${digits.slice(18, 22)} ${digits.slice(22, 26)}`.trim();
  }

  // Fallback: split every 4 chars
  return `${prefix}${digits.replace(/(.{4})/g, '$1 ').trim()}`;
}

export function getCategoryLabel(category?: string): string {
  if (!category) return 'Opłata';
  const cat = category.toUpperCase();
  switch (cat) {
    case 'ELECTRICITY':
      return 'Prąd elektryczny';
    case 'GAS':
      return 'Gaz ziemny';
    case 'WATER':
      return 'Woda i ścieki';
    case 'INTERNET':
      return 'Internet i telewizja';
    case 'TELECOM':
      return 'Telewizja i multimedia';
    case 'GSM':
      return 'Telefonia komórkowa';
    case 'HOUSING':
      return 'Czynsz i wspólnota';
    default:
      return 'Inne media';
  }
}

export function getPaymentStatusLabel(status: string): string {
  switch (status) {
    case 'PAID':
      return 'Opłacony';
    case 'UNPAID':
      return 'Do zapłaty';
    case 'OVERDUE':
      return 'Po terminie';
    case 'PROCESSING':
      return 'W realizacji';
    default:
      return status;
  }
}

export function getDueStatusInfo(dueDateStr: string, paymentStatus: string) {
  if (paymentStatus === 'PAID') {
    return {
      text: 'Opłacono w terminie',
      isOverdue: false,
      isUrgent: false,
      daysDiff: 0,
      badgeType: 'paid' as const,
    };
  }

  const due = new Date(dueDateStr);
  const now = new Date();
  // Normalize dates to midnight
  due.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);

  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0 || paymentStatus === 'OVERDUE') {
    const overdueDays = Math.abs(diffDays);
    return {
      text: overdueDays === 0 ? 'Termin mija dzisiaj!' : `Termin minął ${overdueDays} ${overdueDays === 1 ? 'dzień' : 'dni'} temu!`,
      isOverdue: true,
      isUrgent: true,
      daysDiff: diffDays,
      badgeType: 'overdue' as const,
    };
  }

  if (diffDays === 0) {
    return {
      text: 'Ostateczny termin zapłaty dzisiaj!',
      isOverdue: false,
      isUrgent: true,
      daysDiff: 0,
      badgeType: 'urgent' as const,
    };
  }

  if (diffDays <= 7) {
    return {
      text: `Do zapłaty: zostało ${diffDays} ${diffDays === 1 ? 'dzień' : 'dni'}`,
      isOverdue: false,
      isUrgent: true,
      daysDiff: diffDays,
      badgeType: 'urgent' as const,
    };
  }

  return {
    text: `Do zapłaty za ${diffDays} dni`,
    isOverdue: false,
    isUrgent: false,
    daysDiff: diffDays,
    badgeType: 'normal' as const,
  };
}

