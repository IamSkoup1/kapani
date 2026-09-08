```javascript
/* Firebase Messaging SW — UTF-8.
   Лежит рядом с index.html.
*/

const SW_VERSION = 'kapani-fcm-2026-09-08-v3';

/*
 * Главный URL приложения.
 *
 * ВАЖНО:
 * Уведомления должны вести именно сюда:
 *   /kapani
 *
 * а не:
 *   /index.html
 */
const KAPANI_APP_PATH = '/kapani';

/*
 * Нормализует любой URL уведомления.
 *
 * Старые уведомления / старые серверные payload могут содержать:
 *   ./index.html
 *   /index.html
 *   https://site.ru/index.html
 *
 * Все такие варианты принудительно превращаются в /kapani.
 */
function normalizeKapaniUrl(inputUrl) {
  try {
    const fallback = new URL(KAPANI_APP_PATH, self.location.origin);

    if (!inputUrl) {
      return fallback.href;
    }

    const url = new URL(String(inputUrl), self.location.origin);

    /*
     * Любой URL, который ведёт на index.html,
     * заменяем на основной вход Капани.
     */
    const pathname = (url.pathname || '').replace(/\/+$/, '');

    if (
      pathname === '/index.html' ||
      pathname.endsWith('/index.html') ||
      pathname === ''
    ) {
      return fallback.href;
    }

    /*
     * Если это уже /kapani — оставляем его.
     */
    if (pathname === KAPANI_APP_PATH) {
      return url.href;
    }

    /*
     * Разрешаем дополнительные страницы/маршруты приложения,
     * если они реально переданы уведомлением.
     *
     * При этом query/hash сохраняются.
     */
    return url.href;
  } catch (error) {
    console.warn('[Kapani SW] URL normalization failed:', error);
    return new URL(KAPANI_APP_PATH, self.location.origin).href;
  }
}


/* ─────────────────────────────────────────────────────────────
 * INSTALL / ACTIVATE
 * ──────────────────────────────────────────────────────────── */

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});


/* ─────────────────────────────────────────────────────────────
 * NOTIFICATION CLICK
 *
 * Firebase рекомендует регистрировать этот обработчик ДО импорта
 * Firebase Messaging, чтобы SDK не переопределил пользовательский
 * notificationclick handler.
 * ──────────────────────────────────────────────────────────── */

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification?.data || {};

  /*
   * Приоритет:
   * 1. URL из data
   * 2. /kapani
   */
  const targetUrl = normalizeKapaniUrl(
    data.url || KAPANI_APP_PATH
  );

  event.waitUntil(
    (async () => {
      try {
        const windowClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true
        });

        /*
         * Сначала ищем уже открытый Капани.
         *
         * Это особенно важно на телефоне:
         * вместо открытия нового index.html стараемся вернуть
         * пользователя в существующий экземпляр приложения.
         */
        for (const client of windowClients) {
          if (!client || !client.url) continue;

          let clientUrl;

          try {
            clientUrl = new URL(client.url);
          } catch (_) {
            continue;
          }

          /*
           * Работаем только с нашим origin.
           */
          if (clientUrl.origin !== self.location.origin) {
            continue;
          }

          try {
            /*
             * Если окно уже открыто на Капани — просто фокусируем его.
             */
            if (
              clientUrl.pathname === KAPANI_APP_PATH ||
              clientUrl.pathname === KAPANI_APP_PATH + '/'
            ) {
              await client.focus();
              return client;
            }

            /*
             * Старый вариант index.html автоматически перенаправляем
             * на /kapani.
             */
            const normalizedCurrent = normalizeKapaniUrl(client.url);

            if (normalizedCurrent !== client.url && 'navigate' in client) {
              await client.navigate(normalizedCurrent);
              await client.focus();
              return client;
            }

            /*
             * Для другого окна нашего сайта открываем нужный маршрут.
             */
            if ('navigate' in client && client.url !== targetUrl) {
              await client.navigate(targetUrl);
            }

            await client.focus();
            return client;
          } catch (error) {
            console.warn(
              '[Kapani SW] existing window handling failed:',
              error
            );
          }
        }

        /*
         * Если открытого окна нет — создаём новое,
         * но именно на /kapani.
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
         * Последний fallback — всё равно открыть Капани,
         * а не index.html.
         */
        try {
          return await self.clients.openWindow(
            new URL(KAPANI_APP_PATH, self.location.origin).href
          );
        } catch (_) {
          return undefined;
        }
      }
    })()
  );
});


/* ─────────────────────────────────────────────────────────────
 * FIREBASE MESSAGING
 * ──────────────────────────────────────────────────────────── */

try {
  importScripts(
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js'
  );

  importScripts(
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js'
  );
} catch (error) {
  console.error(
    '[Kapani SW] Firebase scripts failed:',
    error
  );
}


try {
  /*
   * Общий Firebase config.
   * Ничего не меняем в архитектуре проекта.
   */
  importScripts('./config.js');

  if (!self.KAPANI_CONFIG || !self.KAPANI_CONFIG.firebase) {
    throw new Error(
      'Kapani config.js не загрузил Firebase-конфигурацию'
    );
  }

  firebase.initializeApp(
    self.KAPANI_CONFIG.firebase
  );

  const messaging = firebase.messaging();

  /*
   * Background messages.
   *
   * Используем текущую data-only схему Капани:
   * data.title
   * data.body
   * data.category
   * data.url
   */
  messaging.onBackgroundMessage((payload) => {
    try {
      const notification = payload?.notification || {};
      const data = payload?.data || {};

      /*
       * Notification payload Firebase может показать автоматически.
       * Не показываем второе уведомление.
       */
      if (Object.keys(notification).length > 0) {
        return;
      }

      const title = String(
        data.title || 'Капани'
      );

      const body = String(
        data.body ||
        data.text ||
        ''
      );

      const category = String(
        data.category || 'system'
      );

      /*
       * Старое уведомление могло получить index.html.
       * Здесь тоже нормализуем URL заранее.
       */
      const url = normalizeKapaniUrl(
        data.url || KAPANI_APP_PATH
      );

      if (!body) {
        return;
      }

      await self.registration.showNotification(
        title,
        {
          body,

          icon: './image.png',
          badge: './image.png',

          /*
           * Один и тот же notificationId
           * не создаёт бесконтрольные дубли.
           */
          tag: data.notificationId
            ? `kapani-${data.notificationId}`
            : `kapani-${category}-${Date.now()}`,

          renotify: true,

          /*
           * Эти данные попадут в notificationclick.
           */
          data: {
            ...data,

            /*
             * Всегда уже нормализованный URL.
             */
            url,

            category,
            swVersion: SW_VERSION
          }
        }
      );
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
```
