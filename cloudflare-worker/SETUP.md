# Legacy Kapani Push Bridge (deprecated)

Текущая версия Kapani **не использует** этот Cloudflare Worker для push-уведомлений. Он оставлен только как архив старой интеграции.

Для актуального проекта разворачивать Worker не требуется: используйте Firebase Cloud Functions `enqueueNotificationPush` + `processNotificationQueue`.

Если старый Worker уже развёрнут, он не должен вызываться клиентом из текущего `index.html`.
