# Kapani — общий чат: уведомления и realtime

## Что исправлено
- Сообщения общего чата обновляются в реальном времени без перезагрузки.
- Текст «кто-то печатает» в общем чате полностью убран.
- Каждое новое сообщение общего чата создаёт RTDB-уведомление всем пользователям, кроме автора.
- `pushNotificationCreated` отправляет серверное уведомление через FCM на зарегистрированные устройства.
- `firebase-messaging-sw.js` получает background push и открывает `https://iamskoup1.github.io/kapani/`.
- Browser-originated notifications (`pushNotification`) помечаются `pushDelivery: bridge`, чтобы не получать дубль через Firebase Function.

## Обязательный деплой
```bash
cd functions
npm install
firebase deploy --only functions:notifyOnChatMessage,functions:pushNotificationCreated
```

Для web push VAPID Public Key уже находится в `config.js`.
