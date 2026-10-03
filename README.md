> Обновление 2026-10-03: сначала прочитайте [отчёт](KAPANI_FIX_REPORT_2026-10-03.md) и [установку](INSTALL_2026-10-03.md). Старые финансовые сценарии ещё требуют серверной миграции; полный production-аудит не подтверждён.

# Kapani — Push notifications

В production push-уведомления идут через **Cloudflare Worker + стандартный Web Push (VAPID)**. Firebase используется как **Realtime Database/Auth-контур**, а Firebase Cloud Functions не участвуют в доставке push. Эта схема не требует перевода Firebase-проекта на Blaze только ради push.

## Архитектура

```text
Kapani
  ↓
users/<nick>/notifications/<notificationId>
  +
pushOutbox/<jobId>
  ↓
Cloudflare Worker (push-worker/)
  ↓
VAPID + Web Push (aes128gcm)
  ↓
браузерный Push Service
  ↓
firebase-messaging-sw.js
  ↓
системное уведомление
```

Worker хранит подписки в Cloudflare KV, а для защищённого доступа к RTDB использует **server-only service-account secret**. Это не Firebase Cloud Functions и само по себе не переводит Firebase-проект на Blaze. Firebase указывает, что Cloud Messaging (FCM) относится к no-cost продуктам, а Cloud Functions требуют Blaze; Realtime Database на Spark имеет собственную бесплатную квоту.

## Закрытый сайт

Ключевой путь для закрытой вкладки — обычное событие `push` в Service Worker. Открытая страница Kapani для показа системного уведомления не нужна; браузерный Push Service доставляет payload Service Worker, а он вызывает `showNotification()`.

## VAPID

`config.js:webPushVapidPublicKey` и `push-worker/wrangler.toml:VAPID_PUBLIC_KEY` должны быть **одинаковыми**, а секрет `VAPID_PRIVATE_KEY` в Cloudflare должен быть приватной частью **той же самой P-256 пары**.

## Диагностика

В консоли Kapani:

```js
await kapaniPushDoctor()
await kapaniPushSelfTest()
await getKapaniPushWorkerHealth()
```

`/health` Worker должен показывать:

```json
"vapid": {"publicOk": true, "privateOk": true, "pairOk": true}
```

А реальный self-test при одном действующем устройстве должен дать `sent: 1`.

## Deploy

```bash
cd push-worker
wrangler login
wrangler kv namespace create PUSH_KV   # только если namespace ещё не создан
wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
wrangler secret put VAPID_PRIVATE_KEY
wrangler deploy
```

После деплоя опубликйте на GitHub Pages обновлённые `index.html`, `config.js` и `firebase-messaging-sw.js`. При смене VAPID public key существующая browser subscription пересоздаётся автоматически при следующем открытии сайта.

## Firebase Spark

Firebase официально указывает, что Spark — no-cost тариф, а Cloud Functions доступны только на Blaze. Realtime Database при Spark продолжает работать в пределах бесплатной квоты. В этой push-схеме Worker сам выполняет Web Push и использует RTDB через REST API с OAuth2 service account, поэтому Firebase Functions для push не нужны.

## Важно

Не публикуйте `VAPID_PRIVATE_KEY` или JSON service account в GitHub. В архиве проекта эти секреты не хранятся.
