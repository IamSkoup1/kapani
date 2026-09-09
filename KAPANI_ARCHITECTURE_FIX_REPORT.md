# Kapani — исправление push-архитектуры

## Что изменено

- Убран клиентский Cloudflare Push Bridge из основного пути доставки.
- Добавлена универсальная очередь `notificationQueue`.
- Любая запись `users/{nick}/notifications/{notificationId}` с `push !== false` автоматически создаёт очередь.
- Добавлена дедупликация job по hash(`nick:notificationId`).
- Добавлена transaction-based блокировка job и lease.
- Добавлены повторные попытки с экспоненциальной задержкой.
- Состояние доставки хранится отдельно для каждого FCM-токена.
- Невалидные/отозванные токены автоматически очищаются.
- Добавлен scheduled worker `processNotificationQueue`, который подбирает просроченные retry/waiting jobs.
- Общий чат теперь только создаёт RTDB-уведомления; push идёт тем же универсальным каналом.
- Настройки push синхронизируются на сервер, включая per-token preferences.
- Регистрация токена больше не сканирует всю `users` базу: используется `fcmTokenIndex`.
- Manifest использует canonical `./` start URL.
- Firebase Functions переведены на Node.js 20.

## Background delivery

FCM отправляется как data-only сообщение. `firebase-messaging-sw.js` получает его в `onBackgroundMessage()` и показывает системное уведомление через `showNotification()`. Поэтому открытая вкладка Kapani не нужна.

## Ограничение надёжности

Архитектура рассчитана на at-least-once доставку: внешняя push-платформа не даёт нам атомарную транзакцию «сервер получил ack от устройства и база обновилась». Поэтому очередь делает повторные попытки и сохраняет состояние по токену. Возможный повтор одного и того же job сглаживается стабильным `notificationId`/`tag` в Service Worker.

## Production validation

Исходники проверены локально, `functions/index.js` проходит `node --check`. Фактическую доставку на физическое устройство нельзя подтвердить без деплоя этой версии Cloud Functions и реального тестового устройства с выданным FCM token.
