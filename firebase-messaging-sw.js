```javascript
/* Firebase Messaging SW — UTF-8.
 * Лежит рядом с index.html
 */

const SW_VERSION = 'kapani-fcm-2026-09-08-v3';

/**
 * Главный URL приложения.
 *
 * ВАЖНО:
 * Не используем ./index.html как fallback.
 * Для сайта Капани canonical URL — /kapani
 */
const KAPANI_APP_PATH = '/kapani';

/**
 * Нормализует URL уведомления.
 *
 * Поддерживает:
 *   /kapani
 *   /kapani/
 *   /kapani?...
 *   полный https://...
 *
 * Если пришёл пустой/битый URL — открываем /kapani.
 */
function resolveNotificationUrl(requestedUrl) {
  try {
    const raw = String(requestedUrl || '').trim();

    // Пустой URL -> основной адрес Капани.
    if (!raw) {
      return new URL(KAPANI_APP_PATH, self.location.origin).href;
    }

    const url = new URL(raw, self.location.origin);

    // Чужой origin не используем для перехода из уведомления.
    if (url.origin !== self.location.origin) {
      return new URL(KAPANI_APP_PATH, self.location.origin).href;
    }

    return url.href;
  } catch (_) {
    return new URL(KAPANI_APP_PATH, self.location.origin).href;
  }
}

/**
 * Определяем, является ли URL страницей Капани.
 */
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

/* ─────────────────────────────────────────────
 * SERVICE WORKER LIFECYCLE
 * ─────────────────────────────────────────────
 */

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/* ─────────────────────────────────────────────
 * FIREBASE MESSAGING
 * ─────────────────────────────────────────────
 */

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
  // Единая конфигурация Firebase для сайта и Service Worker.
  importScripts('./config.js');

  if (!self.KAPANI_CONFIG || !self.KAPANI_CONFIG.firebase) {
    throw new Error(
      'Kapani config.js не загрузил Firebase-конфигурацию'
    );
  }

  firebase.initializeApp(self.KAPANI_CONFIG.firebase);

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    try {
      const notification = payload?.notification || {};
      const data = payload?.data || {};

      /*
       * Если Firebase уже получил notification payload,
       * повторно уведомление не создаём.
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

      /*
       * Самое важное исправление:
       *
       * раньше:
       *   data.url || './index.html'
       *
       * теперь:
       *   data.url || '/kapani'
       */
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

          // Уже нормализованный адрес для notificationclick.
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

/* ─────────────────────────────────────────────
 * NOTIFICATION CLICK
 * ─────────────────────────────────────────────
 */

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification?.data || {};

  /*
   * Больше никогда не используем './index.html'
   * как fallback.
   */
  const targetUrl = resolveNotificationUrl(data.url);

  event.waitUntil(
    (async () => {
      try {
        const windowClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true
        });

        /*
         * 1. Сначала ищем уже открытый Капани.
         *
         * Если он есть — используем существующую вкладку,
         * чтобы не плодить новые окна.
         */
        for (const client of windowClients) {
          if (!client.url) {
            continue;
          }

          if (!isKapaniUrl(client.url)) {
            continue;
          }

          try {
            /*
             * Если уведомление содержит конкретный URL
             * внутри Капани — переходим на него.
             * Иначе остаёмся на /kapani.
             */
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

        /*
         * 2. Иногда открыто окно сайта, но URL сейчас другой
         *    (например, браузер уже находится на index.html).
         *
         * Его тоже стараемся переиспользовать.
         */
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
            // Переходим к openWindow ниже.
          }
        }

        /*
         * 3. Если открытого окна нет — создаём новое.
         */
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }

        return undefined;

      } catch (error) {
        console.error(
          '[Kapani SW] notification click failed:',
          error
        );

        /*
         * Даже при ошибке используем правильный URL,
         * а не старый index.html.
         */
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
```
