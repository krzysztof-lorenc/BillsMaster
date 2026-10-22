// Service Worker Web Push notification event listeners for BillsMaster

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch (err) {
    data = {
      title: 'BillsMaster',
      body: event.data.text(),
    };
  }

  const title = data.title || 'BillsMaster';
  const options = {
    body: data.body || '',
    icon: data.icon || '/pwa-192x192.png',
    badge: data.badge || '/favicon.svg',
    tag: data.tag || `billsmaster-push-${Date.now()}`,
    data: {
      url: data.url || '/',
      eventId: data.eventId,
    },
    actions: data.actions || [
      { action: 'open', title: 'Otwórz BillsMaster' },
    ],
    vibrate: [150, 80, 150],
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a window is already open, focus and navigate it
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if ('navigate' in client && targetUrl !== '/') {
            client.navigate(targetUrl);
          }
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
