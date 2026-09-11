# Kapani — Push notifications

В этой версии push-уведомления идут по единому серверному контуру Firebase Cloud Functions + FCM + Service Worker.

## Архитектура

`событие → users/{nick}/notifications/{id} + pushQueue/{jobId} → Cloudflare Worker → FCM HTTP v1 → firebase-messaging-sw.js → системное уведомление`

Очередь использует детерминированный job ID, transaction-based lock/lease, повторные попытки с exponential backoff+jitter, состояние доставки по каждому токену, очистку недействительных токенов и повторную обработку просроченных `processing` jobs. Это at-least-once серверная доставка.

Одно событие имеет один `notificationId`; Service Worker использует стабильный `tag`, поэтому retry не должен создавать второй видимый alert для того же notification ID.

## Token lifecycle

FCM token регистрируется только через защищённую Cloud Function после Firebase Auth-сессии. Прямой client-side fallback в `users/{nick}` удалён. Поддерживаются несколько устройств одного пользователя; каждый token хранится в `users/{nick}/fcmTokens/{tokenId}` и индексируется через `fcmTokenIndex/{tokenId}`. Регистрация идёт через Cloudflare bridge; Worker теперь авторизован к RTDB через Google OAuth2.

При `UNREGISTERED`/`registration-token-not-registered`/`invalid-registration-token` token удаляется. Выход пользователя вызывает `unregisterFcmToken` для текущего устройства.

## Фоновая доставка

Сервер отправляет **data-only FCM**. `firebase-messaging-sw.js` принимает сообщение через `onBackgroundMessage()` и сам вызывает `self.registration.showNotification()`. Поэтому открытая вкладка Kapani не нужна. Firebase отдельно документирует foreground `onMessage` и background Service Worker обработку. citeturn733441search3

`firebase-messaging-sw.js` регистрируется в scope приложения `/kapani/`. HTTPS обязателен для FCM Web. citeturn733441search7

## iOS / PWA

Для iPhone Web Push поддерживается в Home Screen web apps начиная с iOS/iPadOS 16.4; разрешение должно запрашиваться в результате прямого действия пользователя. Поэтому Kapani требует установленный PWA-сценарий для iOS. citeturn733441search0turn733441search1

## Notification sources

- общий чат — `notifyOnChatMessage`;
- новости — `notifyOnNewsCreated`;
- подарки подписок — уведомления создаются внутри той же финансовой RTDB-транзакции;
- legacy-дуэли — `notifyOnLegacyDuelNotification` зеркалит duel events в canonical user notifications;
- остальные существующие вызовы `pushNotification()` проходят через callable `createKapaniNotification`, который атомарно создаёт inbox-запись и `pushQueue` job.

## Диагностика

В консоли браузера доступно:

```js
await window.getKapaniPushDiagnostics()
```

Проверяются permission, Service Worker, FCM token, server token registration и last known push state. Сервер также предоставляет `getPushDiagnostics`.

## Deploy

```bash
cd functions
npm ci
cd ..
firebase deploy --only functions
```

После деплоя обязательны реальные тесты на устройстве/браузере: queue state `sent`, закрытая вкладка, закрытые окна, background tab, второй браузер/устройство, invalid token cleanup и notification click.

### Важно про гарантии

Ни FCM, ни браузерный Web Push не дают приложению атомарный ACK уровня «уведомление увидел человек и сервер уже это записал». Поэтому эта система гарантирует сохранение server-side job до принятия сообщения FCM и безопасные retry на уровне очереди. Фактическую доставку на конкретное физическое устройство нужно подтверждать runtime-тестом после deployment.

### Cloudflare Worker

`cloudflare-worker/worker.js` — текущий production delivery engine. Он читает `pushQueue`, получает FCM OAuth token и доставляет data-only push через FCM HTTP v1. Для RTDB Worker использует server-only service account OAuth2; публичные RTDB rules ослаблять не нужно.
