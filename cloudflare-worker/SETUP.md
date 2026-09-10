# Kapani Free Push Worker

В актуальной архитектуре Cloudflare Worker **не является sender-ом FCM**.

Канонический production delivery path:

`RTDB notification -> Firebase Function enqueueNotificationPush -> notificationQueue -> processNotificationQueue -> FCM HTTP v1 -> firebase-messaging-sw.js`

Frontend для token registration/diagnostics использует Firebase Callable Functions:

- `registerFcmToken`
- `unregisterFcmToken`
- `getPushDiagnostics`
- `updatePushPreferences`

Worker сохранён как вспомогательный HTTP API для совместимости/диагностики. Его `/push` и `/send` намеренно отключены (`410 CANONICAL_PIPELINE`), чтобы старый sender не мог конкурировать с queue.

## CORS

Worker разрешает production origin:

`https://iamskoup1.github.io`

и preflight headers:

- `Content-Type`
- `Authorization`

`OPTIONS` должен возвращать `204` для разрешённого origin и `POST`.

## Deploy

Worker можно развернуть отдельно из этой директории:

```bash
npx wrangler deploy
```

Для основной доставки FCM Worker deploy не требуется.
