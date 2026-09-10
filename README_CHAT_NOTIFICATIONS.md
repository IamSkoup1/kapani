# Kapani — notifications

## Общий чат

`/chat/{messageId}` обрабатывает `notifyOnChatMessage`. Функция создаёт canonical RTDB notification каждому пользователю, кроме автора.

Дальше работает единый контур:

`chat message → users/{nick}/notifications/chat_{messageId} → enqueueNotificationPush → notificationQueue → FCM → Service Worker`

Если пользователь держит общий чат открытым, push job корректно помечается `skipped` по presence, а RTDB notification остаётся в истории.

## Новости

Раньше fan-out новостей выполнялся из клиентской вкладки и был best-effort. Теперь публикация `news/{newsId}` запускает `notifyOnNewsCreated` на backend, поэтому закрытие страницы автора не мешает fan-out.

## Дуэли

Legacy `/notifications/{nick}/{id}` для `duel_invite`/`duel_declined` сохраняется для совместимости игровой UI. Backend trigger `notifyOnLegacyDuelNotification` зеркалит их в `users/{nick}/notifications/legacy_{id}`, откуда они проходят обычную push queue.

## Push backend

Общий notification record создаётся в RTDB, после чего `enqueueNotificationPush` создаёт durable job в `notificationQueue`. Активный `index.html` не вызывает Cloudflare Worker: регистрация/снятие FCM-токена, настройки и диагностика выполняются через Firebase callable Functions. Поэтому жизненный цикл страницы отправителя не влияет на постановку job.
