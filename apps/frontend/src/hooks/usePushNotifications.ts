import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';
import type { 
  VapidPublicKeyResponse, 
  NotificationStatusResponse,
  SendTestNotificationResponse 
} from '@bills-master/shared-types';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications() {
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [statusData, setStatusData] = useState<NotificationStatusResponse | null>(null);

  useEffect(() => {
    const supported = typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
    setIsSupported(supported);

    if (supported) {
      setPermission(Notification.permission);
    }
  }, []);

  const checkStatus = useCallback(async () => {
    if (!isSupported) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      const query = subscription ? `?endpoint=${encodeURIComponent(subscription.endpoint)}` : '';
      const res = await api.get<NotificationStatusResponse>(`/api/notifications/status${query}`);
      setStatusData(res);
      setIsSubscribed(Boolean(subscription && res.enabledOnDevice));
      setPermission(Notification.permission);
    } catch (err: any) {
      console.warn('[Push] Error checking push notification status:', err);
    }
  }, [isSupported]);

  useEffect(() => {
    if (isSupported) {
      checkStatus();
    }
  }, [isSupported, checkStatus]);

  const subscribe = async (): Promise<boolean> => {
    if (!isSupported) {
      setError('Twoja przeglądarka nie obsługuje powiadomień Web Push.');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 1. Request permission
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm !== 'granted') {
        setError('Zgoda na powiadomienia została odrzucona w przeglądarce.');
        setIsLoading(false);
        return false;
      }

      // 2. Fetch server VAPID key
      const { publicKey } = await api.get<VapidPublicKeyResponse>('/api/notifications/vapid-key');
      if (!publicKey) {
        throw new Error('Serwer nie zwrócił publicznego klucza VAPID.');
      }

      // 3. Register push subscription with browser
      const registration = await navigator.serviceWorker.ready;
      const applicationServerKey = urlBase64ToUint8Array(publicKey);

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey as unknown as BufferSource,
        });
      }

      // 4. Send subscription to BillsMaster backend
      const subJson = subscription.toJSON();
      if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
        throw new Error('Przeglądarka wygenerowała niekompletną subskrypcję Push.');
      }

      await api.post('/api/notifications/subscribe', {
        endpoint: subJson.endpoint,
        keys: {
          p256dh: subJson.keys.p256dh,
          auth: subJson.keys.auth,
        },
        userAgent: navigator.userAgent,
      });

      setIsSubscribed(true);
      await checkStatus();
      return true;
    } catch (err: any) {
      console.error('[Push] Subscribe error:', err);
      setError(err?.message || 'Błąd podczas włączania powiadomień.');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const unsubscribe = async (): Promise<boolean> => {
    if (!isSupported) return false;

    setIsLoading(true);
    setError(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await api.post('/api/notifications/unsubscribe', {
          endpoint: subscription.endpoint,
        });
        await subscription.unsubscribe();
      }

      setIsSubscribed(false);
      await checkStatus();
      return true;
    } catch (err: any) {
      console.error('[Push] Unsubscribe error:', err);
      setError(err?.message || 'Błąd podczas wyłączania powiadomień.');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const sendTestNotification = async (): Promise<SendTestNotificationResponse> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.post<SendTestNotificationResponse>('/api/notifications/test');
      return result;
    } catch (err: any) {
      setError(err?.message || 'Nie udało się wysłać testowego powiadomienia.');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    error,
    statusData,
    subscribe,
    unsubscribe,
    sendTestNotification,
    refreshStatus: checkStatus,
  };
}
