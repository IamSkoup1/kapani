// Единый источник конфигурации Kapani.
// Используется приложением и Service Worker через importScripts().
const KAPANI_CONFIG = Object.freeze({
    firebase: {
        apiKey: "AIzaSyCDfMUZ-6-GWr8yCWOoU07g6aappDtwxA",
        authDomain: "kapanisite.firebaseapp.com",
        databaseURL: "https://kapanisite-default-rtdb.europe-west1.firebasedatabase.app",
        projectId: "kapanisite",
        storageBucket: "kapanisite.firebasestorage.app",
        messagingSenderId: "250125043268",
        appId: "1:250125043268:web:fd82172b96e326b2001e11"
    },
    fcmVapidKey: "",
    admin: { username: "Денис" },
    jobs: { janitor: "Уборщик", janitorTaskText: "Убрать площадку" },
    finance: { minBalanceAllowed: -2500, pricePerKm: 250, maxSpeedKmh: 30 },
    location: { kapani: { lat: 52.628825753234985, lng: 38.416863347119566 } },
    rewards: { customAvatar: 40, firstWall: 60 },
    subscriptions: {
        plus: { price: 199, name: "Kapani Plus" },
        ultra: { price: 499, name: "Kapani Ultra" },
        prime: { price: 1499, name: "Kapani Prime" }
    },
    limits: { chatMessages: 60, dmMessages: 80, videoCircleMaxDuration: 30, debounceTimeout: 50 },
    ui: { defaultAvatarUrl: "https://cdn-icons-png.flaticon.com/512/149/149071.png" }
});
globalThis.KAPANI_CONFIG = KAPANI_CONFIG;
