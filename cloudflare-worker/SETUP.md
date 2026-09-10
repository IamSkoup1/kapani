# Legacy Kapani Push Bridge — ARCHIVE / НЕ ИСПОЛЬЗУЕТСЯ

Текущая версия Kapani **не использует** этот Cloudflare Worker для push-уведомлений. Он оставлен только как архив старой интеграции.

Для актуального проекта разворачивать Worker не требуется: используйте Firebase Cloud Functions `enqueueNotificationPush` + `processNotificationQueue`.

Если старый Worker уже развёрнут, он не должен вызываться клиентом из текущего `index.html`.


**Статус:** не используется активным Kapani. `index.html` не вызывает `/register`, `/unregister`, `/push` или `/diagnostics` Worker. Для push используются только Firebase Cloud Functions.
