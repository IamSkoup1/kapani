```javascript
/* Firebase Messaging SW — UTF-8. Лежит рядом с index.html */
const SW_VERSION = 'kapani-fcm-2026-09-08-v3';

/*
 * Главная страница Капани.
 * Указываем именно /kapani, чтобы push-уведомления не открывали /index.html.
 *
 * Если Капани развёрнут в подпапке, например:
 * https://site.ru/kapani/
 * этот адрес будет работать корректно.
 */
const KAPANI_PATH = '/kapani';

function getKapaniUrl(extraPath = '') {
  const cleanBase = KAPANI_PATH.replace(/\/+$/, '');
  const cleanExtra = String(extraPath || '').replace(/^\/+/, '');

  const path = cleanExtra
    ? `${cleanBase}/${cleanExtra}`
    : `${cleanBase}/`;

  return new URL(path, self.location.origin).href;
}

function normalizeNotificationUrl(rawUrl) {
  /*
   * Любой старый ./index.html / index.html / /index.html
   * принудительно переводим на /kapani.
   */
  const value = String(rawUrl || '').trim();

  if (!value) {
    return getKapaniUrl();
  }

  try {
    const url = new URL(value, self.location.origin);

    // Если payload содержит старый index.html — заменяем его.
    if (
      url.pathname === '/index.html' ||
      url.pathname.endsWith('/index.html') ||
      url.pathname === '/' ||
      url.pathname === ''
    ) {
      return getKapaniUrl(url.search || url.hash ? '' : '');
    }

    // Если URL уже ведёт в /kapani — оставляем query/hash.
    if (
      url.pathname === KAPANI_PATH ||
      url.pathname.startsWith(`${KAPANI_PATH}/`)
    ) {
      return url.href;
    }

    /*
     * Для внешних / чужих URL не меняем поведение.
     * Но системные уведомления Капани обычно передают url,
     * либо вообще не передают его.
     */
    return url.href;
  } catch (error) {
    console.warn('[Kapani SW] Invalid notification URL:', value, error);
    return getKapaniUrl();
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
  /*
   * Используем тот же config.js, что и основная страница.
   * Никакой второй Firebase-проект не создаётся.
   */
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
       * Если Firebase уже получил полноценный notification payload,
       * не показываем второй notification вручную.
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
       * Важный момент:
       * если backend не передал data.url, используем /kapani/,
       * а не ./index.html.
       */
      const targetUrl = normalizeNotificationUrl(
        data.url || data.link || data.click_action || ''
      );

      const notificationId = String(
        data.notificationId || ''
      ).trim();

      return self.registration.showNotification(title, {
        body,

        /*
         * Файлы находятся рядом с index.html.
         * Поэтому относительные пути здесь корректны.
         */
        icon: './image.png',
        badge: './image.png',

        tag: notificationId
          ? `kapani-${notificationId}`
          : `kapani-${category}`,

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

/*
 * Нажатие на системное push-уведомление.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification?.data || {};

  /*
   * Приоритет:
   * 1. сохранённый data.url
   * 2. другие возможные поля
   * 3. гарантированный /kapani/
   */
  const requestedUrl =
    data.url ||
    data.link ||
    data.click_action ||
    '';

  const targetUrl = normalizeNotificationUrl(requestedUrl);

  event.waitUntil(
    (async () => {
      try {
        const windowClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true
        });

        /*
         * Сначала ищем уже открытый Капани.
         * Не открываем новую вкладку без необходимости.
         */
        for (const client of windowClients) {
          if (!client || !client.url) {
            continue;
          }

          let clientUrl;

          try {
            clientUrl = new URL(client.url);
          } catch (_) {
            continue;
          }

          if (clientUrl.origin !== self.location.origin) {
            continue;
          }

          const isKapaniClient =
            clientUrl.pathname === KAPANI_PATH ||
            clientUrl.pathname.startsWith(`${KAPANI_PATH}/`);

          if (!isKapaniClient) {
            continue;
          }

          try {
            if (
              client.url !== targetUrl &&
              typeof client.navigate === 'function'
            ) {
              await client.navigate(targetUrl);
            }
          } catch (error) {
            console.warn(
              '[Kapani SW] Existing client navigation failed:',
              error
            );
          }

          try {
            await client.focus();
            return client;
          } catch (error) {
            console.warn(
              '[Kapani SW] Existing client focus failed:',
              error
            );
          }
        }

        /*
         * Если Капани ещё не открыт — открываем именно /kapani/.
         */
        if (self.clients.openWindow) {
          return await self.clients.openWindow(targetUrl);
        }

        return undefined;
      } catch (error) {
        console.error(
          '[Kapani SW] notification click failed:',
          error
        );

        /*
         * Последний безопасный fallback:
         * даже при ошибке обработки payload открываем Капани.
         */
        try {
          if (self.clients.openWindow) {
            return await self.clients.openWindow(getKapaniUrl());
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
