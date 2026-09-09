# Deploy Kapani

## 1. Firebase Functions

В `functions/package.json` установлен Node.js 20 — это текущий рекомендуемый поддерживаемый runtime для Cloud Functions.

```bash
cd functions
npm ci
cd ..
firebase deploy --only functions
```

## 2. Push architecture

Не требуется Cloudflare Push Bridge. Доставка идёт напрямую из Firebase Admin SDK в FCM через `enqueueNotificationPush` и `processNotificationQueue`.

Проверить в Firebase Console:

- `enqueueNotificationPush` создана;
- `processNotificationQueue` создана как scheduled function;
- `registerFcmToken` и `updatePushPreferences` доступны;
- `notifyOnChatMessage` продолжает работать.

## 3. Client

`index.html` регистрирует `firebase-messaging-sw.js`, получает FCM token и передаёт его в `registerFcmToken`. Настройки категорий синхронизируются через `updatePushPreferences`.

## 4. iOS

На iPhone Web Push должен использоваться в установленном PWA. Обычная вкладка Safari не является рабочим вариантом для этой схемы.

## 5. Проверка

После деплоя:

1. включить уведомления в Kapani;
2. убедиться, что появился `users/{nick}/fcmTokens/{tokenId}`;
3. создать тестовое уведомление;
4. проверить `notificationQueue/{jobId}`: `sent`;
5. закрыть вкладку Kapani и отправить ещё одно уведомление;
6. убедиться, что браузер показывает системный push;
7. проверить notification click.
