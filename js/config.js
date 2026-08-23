// Конфигурация экосистемы «Капани»
export const CONFIG = {
    firebase: {
        apiKey: "AIzaSyCDfMUZ-6-GWrw8yCWOoU07g6aappDtwxA",
        authDomain: "kapanisite.firebaseapp.com",
        databaseURL: "https://kapanisite-default-rtdb.europe-west1.firebasedatabase.app",
        projectId: "kapanisite",
        storageBucket: "kapanisite.firebasestorage.app",
        messagingSenderId: "250125043268",
        appId: "1:250125043268:web:fd82172b96e326b2001e11"
    },
    admin: {
        displayName: "Кайон"
    },
    jobs: {
        janitor: "Уборщик",
        janitorSalary: 1500,
        journalist: "Журналист",
        journalistSalary: 2800,
        police: "Полицейский",
        policeSalary: 3400,
        ksb: "КСБ",
        ksbSalary: 4000,
        deputy: "Депутат",
        deputySalary: 5000,
        courier: "Курьер",
        driver: "Водитель"
    },
    fees: {
        businessCreationFee: 500,
        marketCommissionPercent: 10
    },
    limits: {
        maxLoanAmount: 100000,
        chatMessages: 100,
        dmMessages: 100
    },
    ui: {
        defaultAvatarUrl: "https://cdn-icons-png.flaticon.com/512/149/149071.png"
    }
};
