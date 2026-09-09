# Kapani — архитектурное исправление чата, FCM и подарков

## Изменённые файлы

1. `index.html`
   - Убран клиентский fan-out уведомлений общего чата.
   - Общий чат использует один постоянный Firebase RTDB listener; рендер больше не создаёт listener.
   - Убран пользовательский typing-indicator общего чата из realtime-цепочки.
   - Добавлена серверная chat-presence `presence/{nick}/generalChatOpen` с `onDisconnect`, чтобы сервер не отправлял FCM пользователю, который уже открыт в общем чате.
   - RTDB-уведомление теперь является единственным foreground/in-app каналом; `onMessage` FCM не создаёт второй toast/browser notification.
   - FCM token регистрируется через защищённую Cloud Function; остаётся совместимый legacy fallback для старых сессий.
   - `pushNotification()` записывает canonical URL `https://iamskoup1.github.io/kapani/`.
   - Подарок подписки переведён с прямых клиентских изменений баланса/подписки на `giftSubscription` Cloud Function.
   - При обычном входе/создании аккаунта запрашивается внутренний Firebase Auth custom-token сеанс; это не возвращает видимый логин в UI и используется как backend identity.
   - Цена подписок в frontend берётся из общего каталога `KAPANI_SUBSCRIPTIONS`.

2. `functions/index.js`
   - Добавлен общий каталог подписок `require('./subscription-config')`.
   - Добавлена `issueKapaniSessionToken`: проверяет существующую Kapani-пару nick/passwordHash и выдаёт Firebase Custom Token.
   - Добавлена `registerFcmToken`: связывает токен с текущей backend-сессией и удаляет тот же токен у других пользователей.
   - Добавлена `giftSubscription`: серверная проверка ранга, баланса и получателя.
   - Финансовая часть подарка выполняется одной RTDB root transaction: списание, смена подписки, txlog, запись подарка и пополнение казны коммитятся вместе.
   - Запрещён downgrade: `recipientRank >= giftRank` -> операция отменяется без изменений.
   - После успешного коммита сервер создаёт уведомления получателю и отправителю.
   - `notifyOnChatMessage` слушает `/chat/{messageId}`, создаёт детерминированное уведомление `chat_{messageId}` для каждого другого пользователя и напрямую отправляет FCM через Firebase Admin SDK.
   - FCM пропускается для пользователя, у которого `presence/{nick}/generalChatOpen === true`.
   - Невалидные FCM tokens удаляются.

3. `functions/subscription-config.js`
   - Единый источник истины для реальных подписок Kapani: `none`, `plus`, `ultra`, `prime`.
   - Ранги: none=0, plus=1, ultra=2, prime=3.
   - Текущие цены каталога синхронизированы с фактическим frontend gift flow: Plus 299 ₽, Ultra 899 ₽, Prime 1499 ₽.
   - Файл одновременно работает в браузере как UMD/global и в Node.js через `require()`.

4. `config.js`
   - Синхронизированы stale-значения цены Plus/Ultra с текущей реальной ценовой конфигурацией frontend.

5. `firebase-messaging-sw.js`
   - Canonical application path: `/kapani/`.
   - `/index.html` остаётся только как legacy-вход, который нормализуется в `/kapani/`.
   - Background data-only FCM создаёт только одно системное notification.
   - `notificationclick` переиспользует открытую вкладку Kapani либо открывает canonical `/kapani/`.

6. `cloudflare-worker/worker.js`
   - Сохранён для существующих не-chat push flows.
   - Fallback URL и отправляемый URL приведены к `https://iamskoup1.github.io/kapani/`.
   - Общий чат больше не зависит от Worker: для chat push используется Firebase Admin SDK прямо из Cloud Functions.

## Реaltime уведомления

Поток общего чата теперь:

`User A -> RTDB /chat/{messageId} -> onValueCreated Cloud Function -> RTDB notification + FCM`

Foreground:
`RTDB notifications listener -> showNotifPopup`

Background:
`FCM data message -> firebase-messaging-sw.js -> showNotification`

Нет отдельной клиентской рассылки по `users`, нет дублирующего foreground `showNotification()` для chat.

## Realtime общего чата

`attachChatService()` создаёт один listener на query `/chat`, и он живёт в service lifecycle. Он не пересоздаётся при каждом `renderChat()`. При уходе со страницы service-listener удаляется штатным механизмом.

Удаления/редактирования и новые сообщения продолжают отражаться через изменение snapshot; рендер использует актуальный `lastChatMsgs`.

## Typing indicator

Пользовательский вывод `«Кто-то печатает»` / `«Пользователь печатает...»` больше не выполняется в общем чате. Внутренняя typing presence оставлена, потому что она используется также голосовыми/видеосценариями.

## Иерархия подписок

Каталог:
- none = 0
- plus = 1
- ultra = 2
- prime = 3

Правило сервера:
`recipientRank >= giftRank -> reject`

Поэтому:
- ULTRA -> PLUS: reject
- PRO -> PLUS: в текущем проекте уровня `pro` нет; запрос такого уровня не принимается как существующая подписка
- PLUS -> PLUS: reject
- FREE/none -> PLUS: allow
- PLUS -> ULTRA: allow
- ULTRA -> PRIME: allow

Истёкшая подписка имеет rank 0.

## Атомарность подарка

До любого изменения сервер проверяет получателя и баланс.

Одна RTDB transaction одновременно изменяет:
- баланс отправителя;
- подписку получателя;
- txlog отправителя;
- txlog получателя;
- запись `subscriptionGifts`;
- баланс и history казны.

При отклонённой транзакции финансовые/подписочные изменения не применяются.

FCM/in-app уведомления выполняются только после успешного финансового коммита, поэтому ошибка уведомления не может создать частичный финансовый подарок.

## Защищённая серверная проверка

Видимый UI по-прежнему работает с Kapani nick/display name. Для backend-операций добавлен внутренний Firebase Auth custom-token сеанс:
`nick + password -> issueKapaniSessionToken -> Firebase Auth UID = nick`

`giftSubscription` принимает giver только из `request.auth.uid`, а не из произвольного клиентского поля.

## Проверки, выполненные локально

- `node --check`:
  - `functions/index.js` — OK
  - `functions/subscription-config.js` — OK
  - `firebase-messaging-sw.js` — OK
  - `cloudflare-worker/worker.js` — OK
  - `config.js` — OK
- Все inline `<script>` блоки `index.html` — OK.
- Проверено наличие ровно одного general-chat service listener.
- Проверено отсутствие client-side `notifyAllUsersOfChatMessage`.
- Проверено отсутствие вызова foreground `sendPushNotification('Капани', ...)` из realtime notification listener.
- Проверена общая матрица рангов/переходов подписок отдельным Node-тестом — PASS.

## Что нельзя честно заявить по одному архиву

Реальный production round-trip:
`Firebase production -> deployed Cloud Function -> FCM -> физическое устройство`
невозможно подтвердить только исходниками без развёрнутой Cloud Function, рабочих FCM credentials и двух реально авторизованных устройств/браузеров.

В архиве проверены реальные точки интеграции, payload-структуры, listener lifecycle, server-side guards и локальные сценарии рангов. Production FCM delivery после деплоя требует фактического запуска этой версии Functions и регистрации двух FCM клиентов; я не выдаю это за уже выполненный push на физический телефон.

### Последний прогон матрицы подписок
Все 5 проверенных переходов — PASS: ULTRA→PLUS reject, PLUS→PLUS reject, FREE→PLUS allow, PLUS→ULTRA allow, ULTRA→PRIME allow.
