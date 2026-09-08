# Kapani Push + iOS safe-area patch

## Что заменено
- `index.html` — существующий Kapani HTML с точечными изменениями FCM/iOS/PWA.
- `firebase-messaging-sw.js` — фоновый FCM handler, notification click/focus, обновление SW.
- `functions/index.js` — добавлен только серверный RTDB trigger `pushNotificationCreated` и helper `sendPushToUser()`; существующие функции сохранены.
- `manifest.json` — исходный manifest проекта без изменения PWA-логики.
- `config.js` — исходный конфиг проекта без подстановки выдуманного VAPID-ключа.
- `functions/package.json` — исходный package.json проекта.

## Важно перед deploy
В предоставленном `config.js` поле `fcmVapidKey` пустое. Клиент теперь не блокирует регистрацию FCM из-за этого и вызывает `getToken()` без явного VAPID key, поэтому Firebase может использовать свой default VAPID key. Для максимальной совместимости с браузерами можно позже указать публичный Web Push certificate key из Firebase Console в `fcmVapidKey`; секретные ключи туда помещать нельзя.

## Web-файлы
Положите в тот же web-root, где находятся текущие `index.html`, `image.png` и остальные файлы Kapani, сохранив эти имена:
- `index.html`
- `firebase-messaging-sw.js`
- `config.js`
- `manifest.json`

`manifest.json` должен оставаться рядом с `index.html`, а `firebase-messaging-sw.js` и `config.js` — также доступны из web-root.

## Cloud Functions
В каталоге `functions/` используйте:
- `index.js`
- `package.json`

Установите зависимости обычным способом проекта и разверните минимум новую функцию:

```bash
cd functions
npm install
cd ..
firebase deploy --only functions:pushNotificationCreated
```

Если ваша текущая схема деплоя всегда публикует все Functions сразу, можно использовать обычный deploy текущего каталога Functions; код остальных функций в этом пакете не удалён.

## Что делает новая Push-цепочка
Существующий вызов Kapani `pushNotification(...)` продолжает создавать внутреннее уведомление в `users/{nick}/notifications/...`. Новый RTDB trigger видит создание этой записи и отправляет data-only FCM на сохранённый токен/токены пользователя. Это позволяет доставлять push, даже когда страница закрыта.

Legacy `users/{nick}.fcmToken` сохранён для обратной совместимости. Дополнительно клиент пытается хранить несколько устройств в `users/{nick}/fcmTokens/{tokenId}`; если правила RTDB не разрешают эту дополнительную ветку, legacy token всё равно остаётся рабочим.

## iOS
Push на iPhone рассчитан на установленный PWA (`display-mode: standalone` / `navigator.standalone`). В обычной вкладке Safari показывается инструкция добавить Kapani на экран «Домой».

Safe-area исправления учитывают `env(safe-area-inset-top)` и `env(safe-area-inset-bottom)`, fixed header/bottom-nav, модальные окна и клавиатуру через `visualViewport`.

## Проверено статически
- JS syntax: PASS
- Manifest/package JSON parse: PASS
- 8 inline script blocks in `index.html`: PASS
- Service Worker background-notification smoke test: PASS
- Service Worker notification click/focus smoke test: PASS

Реальный end-to-end push на физическом iPhone/Android и в развернутом Firebase-проекте из этого окружения выполнить нельзя; после deploy нужен фактический device/browser test.
