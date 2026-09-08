/* Firebase Messaging SW — UTF-8. Лежит рядом с index.html */
const SW_VERSION = 'kapani-fcm-2026-09-08-v2';

self.addEventListener('install', (event) => {
  // No application data is cached here; immediate activation is safe for this
  // messaging-only worker and avoids keeping an old FCM handler alive.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

try {
  importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");
} catch (error) {
  console.error('[Kapani SW] Firebase scripts failed:', error);
}

try {
  // Shared project configuration. config.js is intentionally the single source
  // of Firebase configuration for both the page and this classic worker.
  importScripts("./config.js");
  if (!self.KAPANI_CONFIG || !self.KAPANI_CONFIG.firebase) {
    throw new Error("Kapani config.js не загрузил Firebase-конфигурацию");
  }

  firebase.initializeApp(self.KAPANI_CONFIG.firebase);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    try {
      const notification = payload?.notification || {};
      const data = payload?.data || {};

      // Firebase Messaging automatically displays notification payloads in the
      // background. Do not display them a second time from this handler.
      // Our Cloud Function intentionally sends data-only payloads so this branch
      // is the canonical background notification path for Kapani.
      if (Object.keys(notification).length > 0) return;

      const title = String(data.title || 'Капани');
      const body = String(data.body || data.text || '');
      const category = String(data.category || 'system');
      const targetUrl = String(data.url || './index.html');

      if (!body) return;

      const url = new URL(targetUrl, self.location.origin).href;

      return self.registration.showNotification(title, {
        body,
        icon: './image.png',
        badge: './image.png',
        tag: data.notificationId
          ? `kapani-${data.notificationId}`
          : `kapani-${category}-${Date.now()}`,
        renotify: true,
        data: {
          ...data,
          url,
          category,
          swVersion: SW_VERSION
        }
      });
    } catch (error) {
      console.error('[Kapani SW] background push failed:', error);
    }
  });
} catch (error) {
  console.error('[Kapani SW] Firebase Messaging init failed:', error);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification?.data || {};
  const requestedUrl = data.url || './index.html';

  let targetUrl;
  try {
    targetUrl = new URL(requestedUrl, self.location.origin).href;
  } catch (_) {
    targetUrl = new URL('./index.html', self.location.origin).href;
  }

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    // Prefer an already-open Kapani window. This avoids duplicate tabs and keeps
    // the user's current app session alive.
    for (const client of windowClients) {
      if (!client.url || !client.url.startsWith(self.location.origin)) continue;

      try {
        if ('navigate' in client && client.url !== targetUrl) {
          await client.navigate(targetUrl);
        }
      } catch (_) {}

      try {
        await client.focus();
        return client;
      } catch (_) {}
    }

    if (self.clients.openWindow) {
      return self.clients.openWindow(targetUrl);
    }

    return undefined;
  })());
});
