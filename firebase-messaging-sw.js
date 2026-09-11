/* Firebase Messaging SW — UTF-8.
 * Лежит рядом с index.html
 */

const SW_VERSION = 'kapani-fcm-2026-09-11-cloudflare-v7';

/**
 * Главный URL приложения.
 *
 * ВАЖНО:
 * Не используем ./index.html как fallback.
 * Для сайта Капани canonical URL — /kapani
 */
const KAPANI_APP_PATH = '/kapani/';

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

    // Старые уведомления могли содержать /index.html. Нормализуем их
    // на canonical GitHub Pages путь Kapani, сохраняя query/hash.
    if (url.pathname === '/index.html') {
      const canonical = new URL(KAPANI_APP_PATH, self.location.origin);
      canonical.search = url.search;
      canonical.hash = url.hash;
      return canonical.href;
    }

    return url.href;
  } catch (_) {
    return new URL(KAPANI_APP_PATH, self.location.origin).href;
  }
}

/**
 * Определяем, является ли URL страницей Капани.
 */

const shownNotificationIds = new Map();
function wasShownRecently(notificationId){
  const id = String(notificationId || '').trim();
  if(!id) return false;
  const now = Date.now();
  for (const [key, ts] of shownNotificationIds) if (now - ts > 120000) shownNotificationIds.delete(key);
  if(shownNotificationIds.has(id)) return true;
  shownNotificationIds.set(id, now);
  return false;
}
async function showKapaniPush(data = {}){
  const notificationId = String(data.notificationId || '').trim();
  if(notificationId && wasShownRecently(notificationId)) return false;
  const body = String(data.body || data.text || '').trim();
  if(!body) return false;
  const category = String(data.category || 'system');
  const title = String(data.title || 'Капани');
  const targetUrl = resolveNotificationUrl(data.url);
  await self.registration.showNotification(title, {
    body,
    icon: new URL('/kapani/image.png', self.location.origin).href,
    badge: new URL('/kapani/image.png', self.location.origin).href,
    tag: notificationId ? `kapani-${notificationId}` : `kapani-${category}-${Date.now()}`,
    renotify: false,
    data: {...data, url: targetUrl, category, swVersion: SW_VERSION, receivedAt: Date.now()}
  });
  return true;
}

function isKapaniUrl(url) {
  try {
    const parsed = new URL(url, self.location.origin);
    return (
      parsed.origin === self.location.origin &&
      (
        parsed.pathname === KAPANI_APP_PATH ||
        parsed.pathname === KAPANI_APP_PATH.replace(/\/$/, '') ||
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

  self.addEventListener('message', (event) => {
    if(event?.data?.type !== 'KAPANI_FOREGROUND_PUSH') return;
    event.waitUntil(showKapaniPush(event.data.payload || {}).catch(error => {
      console.error('[Kapani SW] foreground push failed:', error);
    }));
  });

  messaging.onBackgroundMessage(async (payload) => {
    try {
      console.log('[Kapani SW] background message received', payload?.data?.notificationId || 'without-id');
      const notification = payload?.notification || {};
      // The canonical sender uses data-only FCM. If a legacy notification payload
      // reaches this worker, the browser already owns its display path.
      if (Object.keys(notification).length > 0) return;
      await showKapaniPush(payload?.data || {});
    } catch (error) {
      console.error('[Kapani SW] background push failed:', error);
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
