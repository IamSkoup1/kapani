# Kapani Push — production deploy / verification

## 1. Firebase Functions

В `functions/index.js` активный Push sender отсутствует: Firebase Functions только создают каноническое уведомление и `pushQueue`. После обновления обязательно задеплойте Functions:

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

Если в уже задеплоенном Firebase проекте всё ещё существует старый sender/queue-процессор, который отправляет через `admin.messaging()`, его нужно удалить вручную после проверки списка функций. В текущем исходнике прямого `admin.messaging()` sender нет.

## 2. Cloudflare Worker

```bash
cd cloudflare-worker
wrangler login
wrangler whoami
wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
wrangler deploy
```

Секрет должен быть полным JSON service account для проекта `kapanisite`. Private key не должен попадать в `config.js`, `index.html`, `wrangler.toml` или Git.

`wrangler.toml` уже содержит:

- `FIREBASE_PROJECT_ID=kapanisite`
- `FIREBASE_DATABASE_URL=https://kapanisite-default-rtdb.europe-west1.firebasedatabase.app`
- `FIREBASE_WEB_API_KEY=<public Firebase web API key>`
- Cron: `* * * * *`

## 3. Health

После deploy:

```bash
curl https://kapani-free-push.kapani.workers.dev/health
```

Ожидается HTTP 200 и JSON с:

```json
{
  "ok": true,
  "service": "kapani-free-push-bridge",
  "mode": "cloudflare-queue-fcm-v1",
  "configured": {
    "serviceAccount": true,
    "projectId": true,
    "databaseUrl": true,
    "cron": true
  }
}
```

Если `ok:false` / HTTP 503 — Worker задеплоен, но production-конфигурация не готова.

## 4. Frontend

Опубликуйте обновлённые:

- `index.html`
- `config.js`
- `firebase-messaging-sw.js`
- `manifest.json`
- остальные используемые ассеты.

Сайт должен работать по HTTPS.

## 5. Диагностика в браузере

После входа:

```js
await window.getKapaniPushDiagnostics()
```

Критичные поля:

```text
permission               granted
serviceWorkerRegistered  true
activeServiceWorker      true
fcmTokenExists           true
serverRegistered         true
serverTokenCount        >= 1
cloudflareHealth.ok      true
```

Также проверяйте:

```text
serviceWorkerScope
serviceWorkerScript
lastRegisterResponse
queueDiagnostic
```

## 6. Реальный end-to-end тест

В браузере с разрешёнными уведомлениями:

```js
await window.testKapaniPush()
```

Это НЕ локальный `showNotification()`. Функция создаёт настоящее Kapani-уведомление через Firebase Function, которое попадает в `pushQueue` и дальше должно быть обработано Cloudflare → FCM.

Для проверки closed-site:

1. Запустите `await window.testKapaniPush()` и убедитесь, что диагностика показывает `cloudflareHealth.ok: true`.
2. Закройте вкладку Kapani.
3. Дождитесь системного Push.
4. Нажмите Push — Service Worker должен открыть `https://iamskoup1.github.io/kapani/`.

## 7. Локальный тест Cron

```bash
cd cloudflare-worker
wrangler dev --test-scheduled
```

В другом терминале:

```bash
curl "http://localhost:8787/cdn-cgi/local/scheduled?format=json"
```

## 8. iOS / iPadOS

Web Push для iOS/iPadOS поддерживается для web apps, добавленных на Home Screen, начиная с iOS/iPadOS 16.4. Разрешение запрашивается через прямое действие пользователя. Обычная вкладка Safari не должна рассматриваться как полноценный эквивалент установленной PWA.
