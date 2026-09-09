# Kapani — уведомления общего чата

Новое сообщение в `/chat/{messageId}` обрабатывается `notifyOnChatMessage`. Функция создаёт обычную запись уведомления каждому пользователю, кроме автора.

Дальше отправка push **не выполняется непосредственно из chat trigger**. Запись `users/{nick}/notifications/{notificationId}` автоматически попадает в универсальную очередь `notificationQueue` через `enqueueNotificationPush`.

Очередь:

1. создаёт детерминированный job;
2. захватывает job через RTDB transaction;
3. читает актуальные FCM-токены и серверные push preferences;
4. отправляет data-only FCM;
5. помечает каждый токен как `sent`, `invalid`, `disabled` или `pending`;
6. повторяет временно неудачные отправки через scheduler;
7. удаляет невалидные токены.

Такой же контур используется для подарков подписки и остальных функций сайта, которые создают `users/{nick}/notifications/*` с `push !== false`.

## Deploy

```bash
firebase deploy --only functions
```

`firebase-messaging-sw.js` должен быть размещён рядом с `index.html`. Для iOS Web Push пользователь должен запускать Kapani как установленный PWA.
