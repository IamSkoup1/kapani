/* Firebase Messaging SW — UTF-8.
 * Лежит рядом с index.html
 */

const SW_VERSION = 'kapani-fcm-2026-09-08-v3';

const KAPANI_APP_PATH = '/kapani';

function resolveNotificationUrl(requestedUrl) {
  try {
    const raw = String(requestedUrl || '').trim();

    if (!raw) {
      return new URL(KAPANI_APP_PATH, self.location.origin).href;
    }

    const url = new URL(raw, self.location.origin);

    if (url.origin !== self.location.origin) {
      return new URL(KAPANI_APP_PATH, self.location.origin).href;
    }

    return url.href;
  } catch (_) {
    return new URL(KAPANI_APP_PATH, self.location.origin).href;
  }
}

function isKapaniUrl(url) {
  try {
    const parsed = new URL(url, self.location.origin);

    return (
      parsed.origin === self.location.origin &&
      (
        parsed.pathname === KAPANI_APP_PATH ||
        parsed.pathname === `${KAPANI_APP_PATH}/` ||
        parsed.pathname === '/index.html'
      )
    );
  } catch (_) {
    return false;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

try {
  importScripts(
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js'
  );

  importScripts(
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js'
  );
} catch (error) {
  console.error('[Kapani SW] Firebase scripts failed:', error);
}

try {
  importScripts('./config.js');

  if (!self.KAPANI_CONFIG || !self.KAPANI_CONFIG.firebase) {
    throw new Error(
      'Kapani config.js не загрузил Firebase-конфигурацию'
    );
  }

  firebase.initializeApp(self.KAPANI_CONFIG.firebase);

  const messaging = firebase.messaging();

  // ИСПРАВЛЕНО: callback теперь async,
  // потому что внутри используется await.
  messaging.onBackgroundMessage(async (payload) => {
    try {
      const notification = payload?.notification || {};
      const data = payload?.data || {};

      /*
       * Если Firebase уже получил notification payload,
       * повторно уведомление не показываем.
       */
      if (Object.keys(notification).length > 0) {
        return;
      }

      const title = String(data.title || 'Капани');
      const body = String(data.body || data.text || '');
      const category = String(data.category || 'system');

      if (!body) {
        return;
      }

      const targetUrl = resolveNotificationUrl(data.url);

      await self.registration.showNotification(title, {
        body,

        icon: new URL(
          '/kapani/image.png',
          self.location.origin
        ).href,

        badge: new URL(
          '/kapani/image.png',
          self.location.origin
        ).href,

        tag: data.notificationId
          ? `kapani-${data.notificationId}`
          : `kapani-${category}-${Date.now()}`,

        renotify: true,

        data: {
          ...data,
          url: targetUrl,
          category,
          swVersion: SW_VERSION
        }
      });

    } catch (error) {
      console.error(
        '[Kapani SW] background push failed:',
        error
      );
    }
  });

} catch (error) {
  console.error(
    '[Kapani SW] Firebase Messaging init failed:',
    error
  );
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification?.data || {};
  const targetUrl = resolveNotificationUrl(data.url);

  event.waitUntil(
    (async () => {
      try {
        const windowClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true
        });

        for (const client of windowClients) {
          if (!client.url) {
            continue;
          }

          if (!isKapaniUrl(client.url)) {
            continue;
          }

          try {
            if (client.url !== targetUrl && 'navigate' in client) {
              await client.navigate(targetUrl);
            }
          } catch (navigateError) {
            console.warn(
              '[Kapani SW] client.navigate failed:',
              navigateError
            );
          }

          try {
            await client.focus();
          } catch (focusError) {
            console.warn(
              '[Kapani SW] client.focus failed:',
              focusError
            );
          }

          return client;
        }

        for (const client of windowClients) {
          if (!client.url) {
            continue;
          }

          try {
            if ('navigate' in client) {
              await client.navigate(targetUrl);
            }

            await client.focus();

            return client;
          } catch (_) {
          }
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }

        return undefined;

      } catch (error) {
        console.error(
          '[Kapani SW] notification click failed:',
          error
        );

        try {
          if (self.clients.openWindow) {
            return self.clients.openWindow(
              new URL(
                KAPANI_APP_PATH,
                self.location.origin
              ).href
            );
          }
        } catch (fallbackError) {
          console.error(
            '[Kapani SW] fallback open failed:',
            fallbackError
          );
        }

        return undefined;
      }
    })()
  );
});
