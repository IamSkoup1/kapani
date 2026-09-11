# Kapani Cloudflare Push Bridge — ACTIVE PRODUCTION PUSH BRIDGE

Этот каталог сохранён только как архив старой интеграции.

**Активный production push path использует Cloudflare Worker.**
Frontend получает короткоживущий `cfp.*` push session token от `/session`; push bridge `/register`, `/unregister`, `/diagnostics`, `/preferences` и `/enqueue` работают через этот Cloudflare-issued token. Firebase Auth больше не является обязательной частью push delivery path.

`users/{nick}/notifications/{id} → enqueueNotificationPush → notificationQueue → FCM → firebase-messaging-sw.js`

`pushBridgeUrl`, `/register`, `/push` и `/diagnostics` являются активным Cloudflare push bridge API.

Не разворачивайте Worker для работы push. Если старый Worker остаётся
развёрнутым по другим причинам, это независимая legacy-интеграция.
