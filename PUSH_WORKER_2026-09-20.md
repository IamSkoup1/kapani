# Push при закрытом сайте через Cloudflare Worker (2026-09-20)
См. `push-worker/SETUP.md` — пошаговая инструкция.

Изменения:
- `push-worker/` — новый Worker (Web Push VAPID + aes128gcm на WebCrypto, KV для подписок, cron, fan-out чата/новостей, запись «🔔 Уведомлений» в RTDB).
- `config.js` — `pushWorkerUrl` (пусто = старый путь через Firebase Functions).
- `index.html` — регистрация/отмена/настройки подписки через Worker; после каждого уведомления, сообщения общего чата и новости пишется задача в
  `pushOutbox` и вызывается Worker (при запрете записи — авторизованный inline-режим); при смене ключа VAPID старая подписка браузера пересоздаётся;
  `getKapaniPushWorkerHealth()` для диагностики.
- `firebase-messaging-sw.js` — без изменений (формат payload тот же).

## 2026-09-21
- worker.js: исправлен дубль push в продолжении большой рассылки (не увеличивался индекс получателя); при «no eligible push device»
  ответ `/event` теперь содержит `detail` (причина по-русски) и `statuses`; новый `POST /debug`; `/health` показывает начало ключа VAPID.
- index.html: `kapaniPushDoctor(ник)` и `kapaniPushSelfTest()` для диагностики из консоли.
- В архив НЕ включены `push-worker/push-worker.zip` (внутри лежал sa.json с ключом сервисного аккаунта) и `sa-new.json`.
