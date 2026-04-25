// Конфигурация приложения
export const CONFIG = {
    // Firebase Config
    firebase: {
        apiKey: "AIzaSyCDfMUZ-6-GWrw8yCWOoU07g6aappDtwxA",
        authDomain: "kapanisite.firebaseapp.com",
        databaseURL: "https://kapanisite-default-rtdb.europe-west1.firebasedatabase.app",
        projectId: "kapanisite",
        storageBucket: "kapanisite.firebasestorage.app",
        messagingSenderId: "250125043268",
        appId: "1:250125043268:web:fd82172b96e326b2001e11"
    },
    
    // FCM VAPID Key - Вставьте ключ из Firebase Console → Project settings → Cloud Messaging → Web Push certificates
    fcmVapidKey: "",
    
    // Администратор
    admin: {
        username: "Денис"
    },
    
    // Работа
    jobs: {
        janitor: "Уборщик",
        janitorTaskText: "Убрать площадку"
    },
    
    // Финансовые настройки
    finance: {
        minBalanceAllowed: -2500,
        pricePerKm: 15,
        maxSpeedKmh: 30
    },
    
    // Координаты
    location: {
        kapani: {
            lat: 52.628825753234985,
            lng: 38.416863347119566
        }
    },
    
    // Награды
    rewards: {
        customAvatar: 40,
        firstWall: 60
    },
    
    // Подписки
    subscriptions: {
        plus: {
            price: 199,
            name: "Kapani Plus"
        },
        ultra: {
            price: 499,
            name: "Kapani Ultra"
        }
    },
    
    // Лимиты
    limits: {
        chatMessages: 60,
        dmMessages: 80,
        videoCircleMaxDuration: 30,
        debounceTimeout: 50
    },
    
    // UI настройки
    ui: {
        defaultAvatarUrl: "https://cdn-icons-png.flaticon.com/512/149/149071.png"
    }
};
