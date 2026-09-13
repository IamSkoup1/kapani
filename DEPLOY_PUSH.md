# Kapani Web Push — deployment and verification

Kapani now uses standard Web Push: browser `PushSubscription` → Firebase Realtime Database → existing Firebase Cloud Functions → Web Push protocol → browser Service Worker. Cloudflare Push and FCM are no longer part of the delivery path.

## 1. Set the VAPID private key

The public key is stored in `config.js`. The private key must exist only in Firebase Functions Secret Manager. Never put it in `index.html`, `config.js`, the Service Worker, localStorage, or GitHub Pages.

Generate a P-256 VAPID key pair locally when needed, then store the private key as the Firebase secret:

```bash
firebase functions:secrets:set KAPANI_VAPID_PRIVATE_KEY
```

When prompted, paste the VAPID private key. The deployed Functions use the secret at runtime.

## 2. Deploy existing Functions

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

Then publish the updated static files to the existing GitHub Pages site.

## 3. Browser registration

1. Log into Kapani.
2. Open Profile → Push notifications.
3. Press “Включить”.
4. Grant browser notification permission.
5. Kapani registers one standard Push Subscription for that account/device in `users/<nick>/pushSubscriptions/<subscriptionId>`.

The subscription survives normal page reloads and browser restarts as long as the browser keeps the subscription.

## 4. Delivery path

```text
Kapani event
  ↓
users/<nick>/notifications/<notificationId>
  ↓
Firebase onValueCreated trigger
  ↓
Web Push + VAPID
  ↓
Browser Push Service
  ↓
firebase-messaging-sw.js (standard Web Push SW)
  ↓
showNotification()
```

## 5. Critical closed-tab test

Use two accounts/devices. Give the recipient notification permission, verify a Push Subscription exists, then completely close the recipient Kapani tab. Send a DM or a general-chat message from the other account. The browser must show a system notification while Kapani is closed.

Do not treat `Notification.permission === "granted"` as proof of delivery. Use:

```js
await getKapaniPushDiagnostics()
```

and verify the subscription exists and the Service Worker is active. The actual acceptance test is the real notification while the tab is closed.

## 6. Stale subscription cleanup

HTTP 404/410 responses from the browser Push Service remove the dead subscription automatically from both the user branch and `pushSubscriptionIndex`.
