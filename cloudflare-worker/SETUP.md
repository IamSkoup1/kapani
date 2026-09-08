# Kapani — бесплатный Push Bridge через Cloudflare Workers

Этот вариант не использует Firebase Cloud Functions и не требует перехода проекта на Blaze.

## 1. Что нужно

- Бесплатный аккаунт Cloudflare.
- Firebase-проект `kapanisite`.
- Доступ владельца/администратора проекта к Firebase Console.
- Google Service Account key JSON для проекта Kapani.

Service Account JSON — секрет. Не загружай его в сайт, GitHub или этот чат.

## 2. Получить Service Account key

Firebase Console → Project settings → Service accounts → Firebase Admin SDK → Generate new private key.

Сохрани JSON-файл локально.

Также проверь, что в Firebase/Google Cloud включён Firebase Cloud Messaging API (V1).

## 3. Установить Wrangler

В CMD/PowerShell:

    npm install -g wrangler

Проверка:

    wrangler --version

## 4. Войти в Cloudflare

В папке `cloudflare-worker`:

    wrangler login

Откроется браузер.

## 5. Добавить секрет Service Account

В той же папке выполни:

    wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON

После этого вставь ВСЁ содержимое скачанного JSON-файла целиком и нажми Enter.

Секрет хранится в Cloudflare Secrets и не попадает в `worker.js`.

## 6. Развернуть Worker

    wrangler deploy

В конце Cloudflare покажет URL примерно такого вида:

    https://kapani-free-push.<твой-аккаунт>.workers.dev

## 7. Указать URL в Kapani

Открой `config.js` и укажи:

    pushBridgeUrl: "https://kapani-free-push.<твой-аккаунт>.workers.dev"

После этого заново загрузить на хостинг `config.js` и `index.html` из этой сборки.

## 8. VAPID key

Для Web Push желательно указать Web Push certificate / VAPID public key в `config.js`:

    fcmVapidKey: "ТВОЙ_PUBLIC_VAPID_KEY"

Firebase Console → Project settings → Cloud Messaging → Web Push certificates → Generate key pair.

В сайт вставляется только Public key.

## 9. Проверка

1. Открой Kapani по HTTPS.
2. Разреши уведомления.
3. Открой профиль и убедись, что Push включён.
4. Закрой вкладку/браузер или оставь сайт в фоне.
5. С другого аккаунта вызови действие Kapani, которое создаёт уведомление.
6. Уведомление должно прийти через FCM и обработаться `firebase-messaging-sw.js`.

Проверка Worker:

Открытие URL Worker через браузер должно вернуть JSON со значением `service: kapani-free-push-bridge`.
