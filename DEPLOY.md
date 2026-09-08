# KAPANI — Push-уведомления при закрытом сайте

## Что уже сделано
- Все существующие `users/{nick}/notifications/{notificationId}` автоматически отправляются через FCM.
- Используется отдельный `firebase-messaging-sw.js` для background/closed push.
- Добавлена поддержка нескольких устройств пользователя через `fcmTokens`.
- Невалидные/устаревшие FCM-токены автоматически удаляются.
- Клик по системному уведомлению возвращает в Kapani и старается использовать уже открытое окно.
- Для iOS учитывается режим установленной PWA (Add to Home Screen / standalone) и safe-area.
- Существующая структура уведомлений Firebase Realtime Database не меняется.

## Единственный обязательный шаг перед нормальным кросс-браузерным Web Push
В Firebase Console:
1. Project settings → Cloud Messaging.
2. Web configuration → Web Push certificates.
3. Нажать **Generate key pair**.
4. Скопировать **Public key**.
5. В `config.js` заменить значение `fcmVapidKey: ""` на этот public key.

Firebase рекомендует задавать собственный VAPID key; без него SDK использует default key, но некоторые push-сервисы (включая Chrome Push Service) требуют не-default ключ. 

## Деплой Cloud Functions
Из папки проекта:

```bash
cd functions
npm install
firebase deploy --only functions:pushNotificationCreated
```

Или полный деплой Functions:

```bash
npm install
firebase deploy --only functions
```

## Важно
Сайт должен работать по HTTPS. Для iPhone уведомления Web Push работают для установленной PWA, а разрешение нужно дать самой PWA.

## Проверка
1. Открыть Kapani по HTTPS.
2. Включить уведомления.
3. Убедиться, что в базе у пользователя появился `fcmToken` и/или `fcmTokens`.
4. Закрыть сайт/вкладку или отправить PWA в фон.
5. Создать любое обычное Kapani-уведомление через существующий `pushNotification(...)`.
6. Cloud Function `pushNotificationCreated` должна отправить FCM, а Service Worker — показать системное уведомление.

## Ограничение окружения
Из этого чата я не могу выполнить деплой в твой Firebase-проект без доступа к твоему Firebase CLI/аккаунту. Код, Service Worker и Cloud Function подготовлены; после добавления VAPID public key нужен один деплой функции.
