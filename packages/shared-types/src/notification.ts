export type NotificationEventType = 'NEW_BILL' | 'DUE_SOON' | 'OVERDUE';

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface SubscribePushRequest {
  endpoint: string;
  keys: PushSubscriptionKeys;
  userAgent?: string;
}

export interface UnsubscribePushRequest {
  endpoint: string;
}

export interface VapidPublicKeyResponse {
  publicKey: string;
}

export interface NotificationStatusResponse {
  enabledOnDevice: boolean;
  activeSubscriptionsCount: number;
  vapidConfigured: boolean;
}

export interface SendTestNotificationResponse {
  success: boolean;
  message: string;
  deliveredCount: number;
}
