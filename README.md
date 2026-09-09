# Kapani — Push notifications

В этой версии push-уведомления работают через единый серверный контур Firebase Cloud Functions + FCM + Service Worker. Cloudflare Worker больше не участвует в доставке push.

## Архитектура

`событие → users/{nick}/notifications/{id} → enqueueNotificationPush → notificationQueue/{jobId} → FCM → firebase-messaging-sw.js → системное уведомление`

Очередь использует детерминированный job ID, блокировку, повторные попытки с backoff, состояние каждого FCM-токена и удаление невалидных токенов. Это даёт at-least-once серверную доставку без прямых клиентских запросов к push bridge. Повторная доставка одного job использует одинаковый `notificationId`, а Service Worker применяет стабильный notification tag.

## Токены

FCM-токен регистрируется через защищённую Cloud Function. Для каждого токена создаётся индекс `fcmTokenIndex/{tokenId}`, поэтому регистрация не сканирует всех пользователей. Настройки push синхронизируются на сервер и могут применяться отдельно к каждому токену/устройству.

## Фоновая доставка

`firebase-messaging-sw.js` принимает data-only FCM в `onBackgroundMessage()` и вызывает `self.registration.showNotification()`. Поэтому открытая вкладка Kapani для получения системного push не нужна. Нажатие на уведомление открывает canonical `/kapani/`.

## Развёртывание

Требуется Firebase CLI и поддерживаемый Node.js runtime. В проекте выставлен Node.js 20.

```bash
cd functions
npm ci
cd ..
firebase deploy --only functions
```

После деплоя проверь наличие функций `enqueueNotificationPush`, `processNotificationQueue`, `notifyOnChatMessage`, `registerFcmToken` и `updatePushPreferences`.

Папка `cloudflare-worker/` сохранена как архив старой интеграции, но текущий клиент и Firebase Functions её больше не вызывают.
