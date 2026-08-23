import { dbGet, dbSet, dbUpdate, dbRef, dbOnValue } from "./firebase.js";
import { CONFIG } from "./config.js";

let currentUser = null;
let currentNick = localStorage.getItem('kp_s') || sessionStorage.getItem('kp_s') || null;
let userListeners = [];

export function getCurrentNick() {
    return currentNick;
}

export function getCurrentUser() {
    return currentUser;
}

export function displayNick(user) {
    if (!user) return 'Гражданин';
    if (typeof user === 'string') return user;
    return user.displayName || user.name || 'Гражданин';
}

export function isMayor(user = currentUser) {
    if (!user) return false;
    const name = displayNick(user);
    return name === CONFIG.admin.displayName || name === 'Кайон';
}

export async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    const data = enc.encode(password + 'kp_salt_2025_' + salt);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function loginUser(nameOrLogin, password) {
    const trimmedName = nameOrLogin.trim();
    if (!trimmedName || !password) {
        throw new Error("Заполните все поля");
    }

    const nickKey = trimmedName.replace(/[\.\#\$\[\]]/g, "_");
    let existing = await dbGet(`users/${nickKey}`);

    if (!existing) {
        const allUsers = await dbGet('users') || {};
        for (const key in allUsers) {
            const u = allUsers[key];
            if (u && (u.displayName === trimmedName || u.name === trimmedName || key === nickKey)) {
                existing = u;
                existing._key = key;
                break;
            }
        }
    } else {
        existing._key = nickKey;
    }

    const targetKey = existing ? existing._key : nickKey;

    if (!existing) {
        const passHash = await hashPassword(password, targetKey);
        const newUser = {
            nick: targetKey,
            displayName: trimmedName,
            balance: 1000,
            examScore: 0,
            driversLicense: false,
            job: 'Безработный',
            vehicle: '',
            avatar: CONFIG.ui.defaultAvatarUrl,
            accountVerified: true,
            accountFrozen: false,
            createdAt: Date.now(),
            totalEarned: 0,
            passwordHash: passHash
        };

        await dbSet(`users/${targetKey}`, newUser);
        currentUser = newUser;
        currentNick = targetKey;
    } else {
        if (existing.passwordHash) {
            const enteredHash = await hashPassword(password, targetKey);
            if (existing.passwordHash !== enteredHash) {
                throw new Error("Неверный пароль");
            }
        } else {
            const enteredHash = await hashPassword(password, targetKey);
            await dbUpdate(`users/${targetKey}`, { passwordHash: enteredHash });
        }
        currentUser = existing;
        currentNick = targetKey;
    }

    localStorage.setItem('kp_s', currentNick);
    sessionStorage.setItem('kp_s', currentNick);
    localStorage.setItem('kp_auth', JSON.stringify({
        nick: currentNick,
        displayName: displayNick(currentUser)
    }));

    notifyAuthSubscribers();
    return currentUser;
}

export function logoutUser() {
    localStorage.removeItem('kp_s');
    sessionStorage.removeItem('kp_s');
    localStorage.removeItem('kp_auth');
    currentUser = null;
    currentNick = null;
    notifyAuthSubscribers();
    window.location.reload();
}

export function subscribeAuth(callback) {
    userListeners.push(callback);
    if (currentUser) callback(currentUser);
}

function notifyAuthSubscribers() {
    userListeners.forEach(cb => cb(currentUser));
}

export function initAuth(onUserLoaded) {
    if (!currentNick) {
        onUserLoaded(null);
        return;
    }

    dbOnValue(`users/${currentNick}`, (val) => {
        if (val) {
            val.nick = currentNick;
            currentUser = val;
            notifyAuthSubscribers();
            onUserLoaded(currentUser);
        } else {
            onUserLoaded(null);
        }
    });
}
