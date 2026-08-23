(function() {
    window.KP = window.KP || {};

    let notificationsList = [];
    let unreadCount = 0;
    let listeners = [];

    async function pushNotification(targetNick, text, category = 'system', actionUrl = '') {
        if (!targetNick) return;
        const dateStr = new Date().toLocaleDateString('ru');
        const timeStr = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });

        await window.KP_DB.dbPush(`notifications/${targetNick}`, {
            text,
            category,
            actionUrl,
            date: dateStr,
            time: timeStr,
            ts: Date.now(),
            read: false
        });
    }

    function initNotifications(onUpdateCallback) {
        const userNick = window.KP.getCurrentNick();
        if (!userNick) return;

        window.KP_DB.dbOnValue(`notifications/${userNick}`, (data) => {
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

    function subscribeNotifications(callback) {
        listeners.push(callback);
        callback(notificationsList, unreadCount);
    }

    async function markNotificationAsRead(notifId) {
        const userNick = window.KP.getCurrentNick();
        if (!userNick || !notifId) return;

        await window.KP_DB.dbUpdate(`notifications/${userNick}/${notifId}`, { read: true });
    }

    async function markAllNotificationsAsRead() {
        const userNick = window.KP.getCurrentNick();
        if (!userNick) return;

        const data = await window.KP_DB.dbGet(`notifications/${userNick}`) || {};
        const updates = {};
        Object.keys(data).forEach(key => {
            updates[`${key}/read`] = true;
        });

        if (Object.keys(updates).length > 0) {
            await window.KP_DB.dbUpdate(`notifications/${userNick}`, updates);
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

    function getNotifications() {
        return notificationsList;
    }

    window.KP.pushNotification = pushNotification;
    window.KP.initNotifications = initNotifications;
    window.KP.subscribeNotifications = subscribeNotifications;
    window.KP.markNotificationAsRead = markNotificationAsRead;
    window.KP.markAllNotificationsAsRead = markAllNotificationsAsRead;
    window.KP.getNotifications = getNotifications;
})();
