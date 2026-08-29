/* Firebase Messaging SW — UTF-8. Лежит рядом с index.html */
try {
    importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
    importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");
} catch (error) {
    console.error('Ошибка загрузки Firebase скриптов:', error);
}

try {
    // Shared client configuration; works in a classic Service Worker.
    importScripts("./config.js");
    if (!self.KAPANI_CONFIG || !self.KAPANI_CONFIG.firebase) {
        throw new Error("Kapani config.js не загрузил Firebase-конфигурацию");
    }
    firebase.initializeApp(self.KAPANI_CONFIG.firebase);

    messaging.onBackgroundMessage((payload) => {
      try {
        const title = (payload.notification && payload.notification.title) || "Капани";
        const body = (payload.notification && payload.notification.body) || "";
        self.registration.showNotification(title, {
          body,
          icon: "https://cdn-icons-png.flaticon.com/512/149/149071.png",
          badge: "https://cdn-icons-png.flaticon.com/512/149/149071.png",
          vibrate: [200, 80, 200]
        });
      } catch (error) {
        console.error('Ошибка обработки push-уведомления:', error);
      }
    });
} catch (error) {
    console.error('Ошибка инициализации Firebase Messaging:', error);
}
