# Push при закрытом сайте через Cloudflare Worker (2026-09-20)
См. `push-worker/SETUP.md` — пошаговая инструкция.

Изменения:
- `push-worker/` — новый Worker (Web Push VAPID + aes128gcm на WebCrypto, KV для подписок, cron, fan-out чата/новостей, запись «🔔 Уведомлений» в RTDB).
- `config.js` — `pushWorkerUrl` (пусто = старый путь через Firebase Functions).
- `index.html` — регистрация/отмена/настройки подписки через Worker; после каждого уведомления, сообщения общего чата и новости пишется задача в
  `pushOutbox` и вызывается Worker (при запрете записи — авторизованный inline-режим); при смене ключа VAPID старая подписка браузера пересоздаётся;
  `getKapaniPushWorkerHealth()` для диагностики.
- `firebase-messaging-sw.js` — без изменений (формат payload тот же).
