# KAPANI — бесплатные Push-уведомления при закрытом сайте

Эта сборка не использует Firebase Cloud Functions для Push. Существующая запись `users/{nick}/notifications/{notificationId}` остаётся основной. После её создания Kapani передаёт ID записи в бесплатный Cloudflare Worker. Worker, не раскрывая сервисный ключ в браузере, читает запись и FCM-токены и отправляет FCM HTTP v1.

## На сайт
`index.html`, `config.js`, `firebase-messaging-sw.js`, `manifest.json`.

## functions
Для этого варианта Push ничего из `functions/` деплоить не нужно. Существующие Cloud Functions проекта не трогаются.

## Нужно один раз настроить
1. Создать Cloudflare Worker по `cloudflare-worker/SETUP.md`.
2. В Worker сохранить Firebase Service Account JSON как Secret `FIREBASE_SERVICE_ACCOUNT_JSON`.
3. В `config.js` указать URL Worker в `pushBridgeUrl`.
4. В Firebase Cloud Messaging создать Web Push/VAPID public key и указать его в `fcmVapidKey`.
5. Загрузить обновлённые файлы сайта по HTTPS.

Cloudflare Workers Free на текущий момент предоставляет до 100 000 запросов в сутки; для секретов есть отдельное защищённое хранилище Secrets.
