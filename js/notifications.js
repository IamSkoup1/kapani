import { dbPush, dbOnValue, dbUpdate, dbGet } from "./firebase.js";
import { getCurrentNick } from "./auth.js";

let notificationsList = [];
let unreadCount = 0;
let listeners = [];

export async function pushNotification(targetNick, text, category = 'system', actionUrl = '') {
    if (!targetNick) return;
    const dateStr = new Date().toLocaleDateString('ru');
    const timeStr = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });

    await dbPush(`notifications/${targetNick}`, {
        text,
        category,
        actionUrl,
        date: dateStr,
        time: timeStr,
        ts: Date.now(),
        read: false
    });
}

export function initNotifications(onUpdateCallback) {
    const userNick = getCurrentNick();
    if (!userNick) return;

    dbOnValue(`notifications/${userNick}`, (data) => {
        notificationsList = [];
        unreadCount = 0;

        if (data) {
            Object.keys(data).forEach(key => {
                const item = data[key];
                item.id = key;
                notificationsList.unshift(item);
                if (!item.read) unreadCount++;
            });
        }

        notificationsList.sort((a, b) => (b.ts || 0) - (a.ts || 0));

        updateBadgeUI();
        if (onUpdateCallback) onUpdateCallback(notificationsList, unreadCount);
        listeners.forEach(cb => cb(notificationsList, unreadCount));
    });
}

export function subscribeNotifications(callback) {
    listeners.push(callback);
    callback(notificationsList, unreadCount);
}

export async function markNotificationAsRead(notifId) {
    const userNick = getCurrentNick();
    if (!userNick || !notifId) return;

    await dbUpdate(`notifications/${userNick}/${notifId}`, { read: true });
}

export async function markAllNotificationsAsRead() {
    const userNick = getCurrentNick();
    if (!userNick) return;

    const data = await dbGet(`notifications/${userNick}`) || {};
    const updates = {};
    Object.keys(data).forEach(key => {
        updates[`${key}/read`] = true;
    });

    if (Object.keys(updates).length > 0) {
        await dbUpdate(`notifications/${userNick}`, updates);
    }
}

function updateBadgeUI() {
    const badge = document.getElementById('globalNotifyBadge');
    if (badge) {
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
}

export function getNotifications() {
    return notificationsList;
}
