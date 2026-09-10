# Kapani Cloudflare Push Bridge — ARCHIVE / NOT USED

Этот каталог сохранён только как архив старой интеграции.

**Активный production push path НЕ использует Cloudflare Worker.**
Фронтенд `index.html` регистрирует FCM token через Firebase Cloud Function
`registerFcmToken`, а доставка выполняется серверной цепочкой:

`users/{nick}/notifications/{id} → enqueueNotificationPush → notificationQueue → FCM → firebase-messaging-sw.js`

`pushBridgeUrl`, `/register`, `/push` и `/diagnostics` Worker больше не вызываются активным клиентом.

Не разворачивайте Worker для работы push. Если старый Worker остаётся
развёрнутым по другим причинам, это независимая legacy-интеграция.
