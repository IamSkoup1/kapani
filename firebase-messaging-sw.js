/* Firebase Messaging SW — UTF-8. Лежит рядом с index.html */
try {
    importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
    importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");
} catch (error) {
    console.error('Ошибка загрузки Firebase скриптов:', error);
}

try {
    firebase.initializeApp({
      apiKey: "AIzaSyCDfMUZ-6-GWrw8yCWOoU07g6aappDtwxA",
      authDomain: "kapanisite.firebaseapp.com",
      databaseURL: "https://kapanisite-default-rtdb.europe-west1.firebasedatabase.app",
      projectId: "kapanisite",
      storageBucket: "kapanisite.firebasestorage.app",
      messagingSenderId: "250125043268",
      appId: "1:250125043268:web:fd82172b96e326b2001e11"
    });

    const messaging = firebase.messaging();
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
