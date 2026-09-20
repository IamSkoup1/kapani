// Единый источник конфигурации Kapani.
// Используется приложением и Service Worker через importScripts().
const KAPANI_CONFIG = Object.freeze({
    firebase: {
        apiKey: "AIzaSyCtMtRrKHsfyI4zb9CDuM6HiE56T7H1Ehw",
        authDomain: "kapanisite.firebaseapp.com",
        databaseURL: "https://kapanisite-default-rtdb.europe-west1.firebasedatabase.app",
        projectId: "kapanisite",
        storageBucket: "kapanisite.firebasestorage.app",
        messagingSenderId: "250125043268",
        appId: "1:250125043268:web:fd82172b96e326b2001e11"
    },
    webPushVapidPublicKey: "BNxUOFgcg5VQqwQ4_wwQLkR-howofNzLG6xzOLT7ZsdIFkc-uFRP5JZvw-tP81_63pudVjdv_k3aUegSQiWpmNU",
    // URL of the Cloudflare push worker (push-worker/SETUP.md), e.g. "https://kapani-push.YOURNAME.workers.dev".
    // Empty = keep using the old Firebase Functions push path.
    pushWorkerUrl: "",
    admin: { username: "Денис" },
    jobs: { janitor: "Уборщик", janitorTaskText: "Убрать площадку" },
    finance: { minBalanceAllowed: -2500, pricePerKm: 250, maxSpeedKmh: 30 },
    location: { kapani: { lat: 52.628825753234985, lng: 38.416863347119566 } },
    rewards: { customAvatar: 40, firstWall: 60 },
    subscriptions: {
        plus: { price: 299, name: "Kapani Plus" },
        ultra: { price: 899, name: "Kapani Ultra" },
        prime: { price: 1499, name: "Kapani Prime" }
    },
    limits: { chatMessages: 60, dmMessages: 80, videoCircleMaxDuration: 30, debounceTimeout: 50 },
    ui: { defaultAvatarUrl: "https://cdn-icons-png.flaticon.com/512/149/149071.png" }
});
globalThis.KAPANI_CONFIG = KAPANI_CONFIG;
