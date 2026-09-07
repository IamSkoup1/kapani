# Kapani Push — исправленный пакет

## ВАЖНО: причина 404
`updateNotificationPreferences` — HTTP Callable Cloud Function. Если URL
`https://europe-west1-kapanisite.cloudfunctions.net/updateNotificationPreferences`
возвращает 404, Firebase не видит задеплоенную функцию с таким именем/регионом.
Это не ошибка `Access-Control-Allow-Origin`: для существующего callable Firebase
обрабатывает CORS preflight автоматически. См. документацию Firebase.

В этом пакете `index.js` находится именно в `functions/index.js`.

## Структура
- index.html
- config.js
- manifest.json
- firebase-messaging-sw.js
- database.rules.json
- functions/index.js
- functions/package.json

## Перед деплоем
1. В `config.js` замените `REPLACE_WITH_FIREBASE_WEB_PUSH_CERTIFICATE_KEY` на публичный VAPID key.
2. Убедитесь, что Firebase CLI настроен на проект `kapanisite`.
3. Из корня проекта установите зависимости Functions:

```bash
cd functions
npm install
cd ..
```

4. Задеплойте функции:

```bash
firebase deploy --only functions
```

5. После деплоя проверьте наличие функции:

```bash
firebase functions:list
```

В списке должна присутствовать `updateNotificationPreferences` с регионом `europe-west1`.

6. Затем задеплойте Hosting и Rules:

```bash
firebase deploy --only hosting,database
```

## Почему Firefox показывает CORS
Браузер отправляет `OPTIONS` preflight перед callable POST. Firebase Callable API сам обрабатывает такой preflight. Для отсутствующей функции сервер отвечает 404, поэтому браузер дополнительно сообщает про отсутствие CORS-заголовка.

## После успешного деплоя
В DevTools Network запрос:
`https://europe-west1-kapanisite.cloudfunctions.net/updateNotificationPreferences`
должен перестать возвращать 404.

Дальше:
- Profile → Push-уведомления → включить;
- проверить появление `users/<nick>/notificationTokens/<hash>`;
- закрыть вкладку/PWA;
- отправить тестовое уведомление с другого аккаунта.
