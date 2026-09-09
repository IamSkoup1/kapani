const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onValueCreated } = require('firebase-functions/v2/database');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore } = require('firebase-admin/firestore');
const { getDatabase } = require('firebase-admin/database');
const admin = require('firebase-admin');

admin.initializeApp();
const db = getDatabase();
const firestore = getFirestore();

const ADMIN_UID = 'Денис'; // UID администратора (должен совпадать с ником в базе)
const SUBSCRIPTIONS = require('./subscription-config');
const crypto = require('crypto');

const KAPANI_CANONICAL_URL = 'https://iamskoup1.github.io/kapani/';

function sanitizePushPreferences(incoming) {
    const source = incoming && typeof incoming === 'object' ? incoming : {};
    const allowedCategories = ['messages', 'money', 'taxi_orders', 'delivery_orders', 'market', 'system'];
    const prefs = { enabled: source.enabled !== false };
    for (const category of allowedCategories) {
        if (Object.prototype.hasOwnProperty.call(source, category)) prefs[category] = source[category] !== false;
    }
    return prefs;
}

function normalizeSubscriptionType(value) {
    const type = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(SUBSCRIPTIONS, type) ? type : 'none';
}

function isActiveSubscription(user) {
    const expiry = user?.subscriptionExpiry ? new Date(user.subscriptionExpiry) : null;
    return !!expiry && !Number.isNaN(expiry.getTime()) && expiry.getTime() > Date.now() && normalizeSubscriptionType(user?.subscription) !== 'none';
}

function subscriptionRank(user) {
    if (!isActiveSubscription(user)) return 0;
    return Number(SUBSCRIPTIONS[normalizeSubscriptionType(user.subscription)]?.rank || 0);
}

function hashPassword(password, salt) {
    return crypto.createHash('sha256')
        .update(`kapani::${String(salt || '').trim().toLowerCase()}::${String(password || '')}`, 'utf8')
        .digest('hex');
}

function tokenKey(token) {
    return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex').slice(0, 32);
}

function collectFcmTokens(user) {
    const tokens = [];
    const seen = new Set();
    const add = (token, path, pushPrefs = null) => {
        const value = String(token || '').trim();
        if (!value || seen.has(value)) return;
        seen.add(value);
        tokens.push({ token: value, path, pushPrefs });
    };
    add(user?.fcmToken, 'fcmToken', user?.pushPrefs || null);
    const many = user?.fcmTokens && typeof user.fcmTokens === 'object' ? user.fcmTokens : {};
    for (const [key, entry] of Object.entries(many)) {
        if (typeof entry === 'string') add(entry, `fcmTokens/${key}`, user?.pushPrefs || null);
        else if (entry?.token) add(entry.token, `fcmTokens/${key}`, entry.pushPrefs || user?.pushPrefs || null);
    }
    return tokens;
}

// Проверка, что пользователь является администратором
function isAdmin(context) {
    const uid = context.auth?.uid;
    return uid === ADMIN_UID;
}

// Cloud Function для перевода денег между пользователями
exports.transferMoney = onCall(async (request) => {
    const { toUid, amount, description } = request.data;
    const fromUid = request.auth?.uid;

    if (!fromUid) {
        throw new HttpsError('unauthenticated', 'Пользователь не авторизован');
    }

    if (!toUid || !amount || amount <= 0) {
        throw new HttpsError('invalid-argument', 'Некорректные параметры перевода');
    }

    if (toUid === fromUid) {
        throw new HttpsError('invalid-argument', 'Нельзя переводить самому себе');
    }

    try {
        // Получаем данные отправителя
        const fromSnapshot = await db.ref(`users/${fromUid}`).get();
        if (!fromSnapshot.exists()) {
            throw new HttpsError('not-found', 'Отправитель не найден');
        }
        const fromUser = fromSnapshot.val();

        // Проверяем баланс
        if ((fromUser.balance || 0) < amount) {
            throw new HttpsError('failed-precondition', 'Недостаточно средств');
        }

        // Получаем данные получателя
        const toSnapshot = await db.ref(`users/${toUid}`).get();
        if (!toSnapshot.exists()) {
            throw new HttpsError('not-found', 'Получатель не найден');
        }

        // Атомарная транзакция
        await db.ref('users').transaction((users) => {
            if (!users) return users;

            const fromBalance = users[fromUid]?.balance || 0;
            const toBalance = users[toUid]?.balance || 0;

            if (fromBalance < amount) {
                return; // Отмена транзакции
            }

            users[fromUid].balance = fromBalance - amount;
            users[toUid].balance = toBalance + amount;

            return users;
        });

        // Логируем транзакции
        const { date, time, ts } = getDateTime();
        
        await db.ref(`users/${fromUid}/txlog`).push({
            type: 'out',
            who: toUid,
            amt: amount,
            desc: description || `Перевод пользователю ${toUid}`,
            date,
            time,
            ts
        });

        await db.ref(`users/${toUid}/txlog`).push({
            type: 'in',
            who: fromUid,
            amt: amount,
            desc: description || `Перевод от пользователя ${fromUid}`,
            date,
            time,
            ts
        });

        // Обновляем totalEarned для получателя
        await db.ref(`users/${toUid}`).transaction((user) => {
            if (!user) return user;
            user.totalEarned = (user.totalEarned || 0) + amount;
            return user;
        });

        return { success: true, message: 'Перевод выполнен успешно' };

    } catch (error) {
        console.error('Ошибка перевода:', error);
        throw new HttpsError('internal', 'Ошибка при выполнении перевода');
    }
});

// Cloud Function для админских операций с балансом
exports.adminAdjustBalance = onCall(async (request) => {
    const { uid, amount, type, description } = request.data;

    // Проверка администратора
    if (!isAdmin(request)) {
        throw new HttpsError('permission-denied', 'Только администратор может выполнять эту операцию');
    }

    if (!uid || !amount) {
        throw new HttpsError('invalid-argument', 'Некорректные параметры');
    }

    try {
        const snapshot = await db.ref(`users/${uid}`).get();
        if (!snapshot.exists()) {
            throw new HttpsError('not-found', 'Пользователь не найден');
        }

        const user = snapshot.val();
        const currentBalance = user.balance || 0;
        const newBalance = currentBalance + amount;

        await db.ref(`users/${uid}`).update({ balance: newBalance });

        // Логируем операцию
        const { date, time, ts } = getDateTime();
        const txType = amount >= 0 ? 'in' : 'out';
        const absAmount = Math.abs(amount);

        await db.ref(`users/${uid}/txlog`).push({
            type: txType,
            who: 'Мэрия',
            amt: absAmount,
            desc: description || (type === 'fine' ? 'Штраф' : 'Корректировка баланса'),
            date,
            time,
            ts
        });

        return { success: true, newBalance };

    } catch (error) {
        console.error('Ошибка корректировки баланса:', error);
        throw new HttpsError('internal', 'Ошибка при корректировке баланса');
    }
});

// Cloud Function для создания заказа (такси/доставка)
exports.createOrder = onCall(async (request) => {
    const { type, info, price, address, distanceKm, clientLat, clientLng, destLat, destLng, originalPrice, discountApplied } = request.data;
    const clientUid = request.auth?.uid;

    if (!clientUid) {
        throw new HttpsError('unauthenticated', 'Пользователь не авторизован');
    }

    try {
        // Проверяем баланс клиента
        const clientSnapshot = await db.ref(`users/${clientUid}`).get();
        if (!clientSnapshot.exists()) {
            throw new HttpsError('not-found', 'Пользователь не найден');
        }

        const clientUser = clientSnapshot.val();
        if ((clientUser.balance || 0) < price) {
            throw new HttpsError('failed-precondition', 'Недостаточно средств');
        }

        // Создаём заказ
        const orderId = Date.now().toString(36) + Math.random().toString(36).slice(2);
        const orderData = {
            id: orderId,
            type,
            client: clientUid,
            price,
            originalPrice,
            discountApplied,
            status: 'waiting',
            info,
            address,
            worker: null,
            distanceKm,
            driverVehicle: null,
            driverAvatar: null,
            clientLat,
            clientLng,
            destLat,
            destLng,
            driverLat: null,
            driverLng: null,
            createdAt: Date.now()
        };

        await db.ref(`orders/${orderId}`).set(orderData);

        // Списываем средства при создании заказа (будут возвращены при отмене)
        await db.ref(`users/${clientUid}`).update({
            balance: clientUser.balance - price
        });

        return { success: true, orderId };

    } catch (error) {
        console.error('Ошибка создания заказа:', error);
        throw new HttpsError('internal', 'Ошибка при создании заказа');
    }
});

// Cloud Function для оплаты заказа
exports.payOrder = onCall(async (request) => {
    const { orderId } = request.data;
    const clientUid = request.auth?.uid;

    if (!clientUid) {
        throw new HttpsError('unauthenticated', 'Пользователь не авторизован');
    }

    try {
        const orderSnapshot = await db.ref(`orders/${orderId}`).get();
        if (!orderSnapshot.exists()) {
            throw new HttpsError('not-found', 'Заказ не найден');
        }

        const order = orderSnapshot.val();

        if (order.client !== clientUid) {
            throw new HttpsError('permission-denied', 'Вы не можете оплатить этот заказ');
        }

        if (!order.worker) {
            throw new HttpsError('failed-precondition', 'Нет исполнителя');
        }

        // Получаем данные клиента и работника
        const [clientSnapshot, workerSnapshot] = await Promise.all([
            db.ref(`users/${clientUid}`).get(),
            db.ref(`users/${order.worker}`).get()
        ]);

        if (!clientSnapshot.exists() || !workerSnapshot.exists()) {
            throw new HttpsError('not-found', 'Пользователь не найден');
        }

        const clientUser = clientSnapshot.val();
        const workerUser = workerSnapshot.val();

        // Проверяем баланс клиента (средства уже списаны при создании заказа)
        // Начисляем оплату работнику
        await db.ref(`users/${order.worker}`).update({
            balance: (workerUser.balance || 0) + order.price
        });

        // Логируем транзакции
        const { date, time, ts } = getDateTime();
        const descC = order.type === 'taxi' ? `Оплата такси (${order.info || ''})` : `Оплата доставки: ${order.info || ''}`;
        const descW = order.type === 'taxi' ? `Оплата поездки от ${clientUid}` : `Доставка для ${clientUid}`;

        await db.ref(`users/${clientUid}/txlog`).push({
            type: 'out',
            who: order.worker,
            amt: order.price,
            desc: descC,
            date,
            time,
            ts
        });

        await db.ref(`users/${order.worker}/txlog`).push({
            type: 'in',
            who: clientUid,
            amt: order.price,
            desc: descW,
            date,
            time,
            ts
        });

        // Удаляем заказ
        await db.ref(`orders/${orderId}`).remove();

        return { success: true, message: 'Оплата выполнена успешно' };

    } catch (error) {
        console.error('Ошибка оплаты заказа:', error);
        throw new HttpsError('internal', 'Ошибка при оплате заказа');
    }
});

// Cloud Function для отмены заказа
exports.cancelOrder = onCall(async (request) => {
    const { orderId } = request.data;
    const clientUid = request.auth?.uid;

    if (!clientUid) {
        throw new HttpsError('unauthenticated', 'Пользователь не авторизован');
    }

    try {
        const orderSnapshot = await db.ref(`orders/${orderId}`).get();
        if (!orderSnapshot.exists()) {
            throw new HttpsError('not-found', 'Заказ не найден');
        }

        const order = orderSnapshot.val();

        if (order.client !== clientUid) {
            throw new HttpsError('permission-denied', 'Вы не можете отменить этот заказ');
        }

        const penalty = 50;

        // Возвращаем средства за вычетом штрафа
        const clientSnapshot = await db.ref(`users/${clientUid}`).get();
        if (!clientSnapshot.exists()) {
            throw new HttpsError('not-found', 'Пользователь не найден');
        }

        const clientUser = clientSnapshot.val();
        const refundAmount = order.price - penalty;

        await db.ref(`users/${clientUid}`).update({
            balance: clientUser.balance + refundAmount
        });

        // Логируем штраф
        const { date, time, ts } = getDateTime();
        await db.ref(`users/${clientUid}/txlog`).push({
            type: 'out',
            who: 'Система',
            amt: penalty,
            desc: 'Штраф за отмену заказа',
            date,
            time,
            ts
        });

        // Уведомляем работника если есть
        if (order.worker) {
            await db.ref(`users/${order.worker}/notifications`).push({
                text: `⚠️ ${clientUid} отменил заказ`,
                time: getTime(),
                cat: order.type === 'taxi' ? 'taxi_orders' : 'delivery_orders'
            });
        }

        // Удаляем заказ
        await db.ref(`orders/${orderId}`).remove();

        return { success: true, refundAmount, penalty };

    } catch (error) {
        console.error('Ошибка отмены заказа:', error);
        throw new HttpsError('internal', 'Ошибка при отмене заказа');
    }
});

// Cloud Function для принятия заказа работником
exports.takeOrder = onCall(async (request) => {
    const { orderId } = request.data;
    const workerUid = request.auth?.uid;

    if (!workerUid) {
        throw new HttpsError('unauthenticated', 'Пользователь не авторизован');
    }

    try {
        const orderSnapshot = await db.ref(`orders/${orderId}`).get();
        if (!orderSnapshot.exists()) {
            throw new HttpsError('not-found', 'Заказ не найден');
        }

        const order = orderSnapshot.val();

        if (order.client === workerUid) {
            throw new HttpsError('failed-precondition', 'Нельзя брать свой заказ');
        }

        if (order.worker) {
            throw new HttpsError('failed-precondition', 'Заказ уже взят');
        }

        // Проверяем, не занят ли работник
        const ordersSnapshot = await db.ref('orders').get();
        const orders = ordersSnapshot.val() || {};
        const isBusy = Object.values(orders).some(
            o => o.worker === workerUid && o.status === 'in_progress'
        );

        if (isBusy) {
            throw new HttpsError('failed-precondition', 'Вы уже заняты другим заказом');
        }

        // Получаем данные работника
        const workerSnapshot = await db.ref(`users/${workerUid}`).get();
        if (!workerSnapshot.exists()) {
            throw new HttpsError('not-found', 'Работник не найден');
        }

        const workerUser = workerSnapshot.val();

        // Принимаем заказ
        await db.ref(`orders/${orderId}`).update({
            status: 'in_progress',
            worker: workerUid,
            driverVehicle: workerUser.vehicle || '',
            driverAvatar: workerUser.avatar || ''
        });

        return { success: true };

    } catch (error) {
        console.error('Ошибка принятия заказа:', error);
        throw new HttpsError('internal', 'Ошибка при принятии заказа');
    }
});


/**
 * Internal Firebase Auth session for the existing Kapani nickname/password UI.
 * The user still uses the public/display name in the interface; Firebase Auth
 * is only a backend identity layer for protected operations.
 */
exports.issueKapaniSessionToken = onCall(async (request) => {
    const nick = String(request.data?.nick || '').trim();
    const password = String(request.data?.password || '');

    if (!nick || password.length < 4) {
        throw new HttpsError('invalid-argument', 'Некорректные данные входа');
    }

    const snapshot = await db.ref(`users/${nick}`).get();
    if (!snapshot.exists()) {
        throw new HttpsError('not-found', 'Пользователь не найден');
    }

    const user = snapshot.val() || {};
    const expected = String(user.passwordHash || '');
    const salt = String(user.passwordHashSalt || user.nick || nick);
    const actual = hashPassword(password, salt);

    if (!expected || actual !== expected) {
        throw new HttpsError('permission-denied', 'Неверный пароль');
    }

    const token = await admin.auth().createCustomToken(nick);
    return { token };
});

/**
 * Registers the current browser FCM token server-side.
 * The same token is removed from other Kapani users, preventing delivery
 * to a previous account when the same browser switches users.
 */
exports.registerFcmToken = onCall(async (request) => {
    const uid = request.auth?.uid;
    const token = String(request.data?.token || '').trim();

    if (!uid) throw new HttpsError('unauthenticated', 'Требуется защищённая сессия');
    if (!token || token.length < 20) {
        throw new HttpsError('invalid-argument', 'Некорректный FCM token');
    }

    const tokenId = tokenKey(token);
    const now = Date.now();
    const pushPrefs = sanitizePushPreferences(request.data?.prefs);
    const indexRef = db.ref(`fcmTokenIndex/${tokenId}`);
    const indexSnap = await indexRef.get();
    const indexedOwner = indexSnap.exists() ? String(indexSnap.val()?.uid || '') : '';
    const updates = {};

    // A token belongs to one current Kapani account. Remove it from a previous
    // account without scanning the entire users collection.
    if (indexedOwner && indexedOwner !== uid) {
        updates[`users/${indexedOwner}/fcmTokens/${tokenId}`] = null;
        if (indexSnap.val()?.token === token) {
            updates[`users/${indexedOwner}/fcmToken`] = null;
        }
    }

    updates[`users/${uid}/fcmTokens/${tokenId}`] = {
        token,
        updatedAt: now,
        userAgent: String(request.data?.userAgent || '').slice(0, 500),
        pushPrefs
    };
    updates[`users/${uid}/fcmToken`] = token;
    updates[`users/${uid}/fcmUpdatedAt`] = now;
    updates[`fcmTokenIndex/${tokenId}`] = { uid, token, updatedAt: now };

    await db.ref().update(updates);
    return { success: true, tokenId };
});

exports.updatePushPreferences = onCall(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Требуется защищённая сессия');

    const prefs = sanitizePushPreferences(request.data?.prefs);
    prefs.updatedAt = Date.now();
    const tokenId = String(request.data?.tokenId || '').trim();
    const updates = { [`users/${uid}/pushPrefs`]: prefs };

    if (tokenId) {
        const tokenSnap = await db.ref(`users/${uid}/fcmTokens/${tokenId}`).get();
        if (tokenSnap.exists()) updates[`users/${uid}/fcmTokens/${tokenId}/pushPrefs`] = prefs;
    }

    await db.ref().update(updates);
    return { success: true, prefs, tokenId: tokenId || null };
});

function notificationCategoryEnabled(user, tokenEntry, category) {
    const prefs = tokenEntry?.pushPrefs && typeof tokenEntry.pushPrefs === 'object'
        ? tokenEntry.pushPrefs
        : (user?.pushPrefs && typeof user.pushPrefs === 'object' ? user.pushPrefs : {});
    if (prefs.enabled === false) return false;
    return prefs[category] !== false;
}

function notificationJobId(nick, notificationId) {
    return crypto.createHash('sha256')
        .update(`${String(nick)}:${String(notificationId)}`, 'utf8')
        .digest('hex');
}

function getNotificationPayload(notification) {
    const category = String(notification?.cat || 'system');
    const body = String(notification?.text || notification?.body || '').trim();
    if (!body) return null;
    return {
        title: String(notification?.title || 'Капани'),
        body,
        category,
        notificationId: String(notification?.id || ''),
        url: String(notification?.url || KAPANI_CANONICAL_URL),
        createdAt: String(notification?.createdAt || Date.now()),
        source: String(notification?.source || ''),
        sourceMessageId: String(notification?.sourceMessageId || '')
    };
}

function isTransientFcmError(code) {
    return /unavailable|internal|deadline|resource-exhausted|quota-exceeded|server-unavailable/i.test(String(code || ''));
}

function isInvalidTokenError(code) {
    return /registration-token-not-registered|invalid-registration-token|invalid-argument/i.test(String(code || ''));
}

function nextRetryDelay(attempt) {
    const n = Math.max(1, Number(attempt || 1));
    return Math.min(60 * 60 * 1000, 15 * 1000 * Math.pow(2, Math.min(n - 1, 7)));
}

async function removeInvalidFcmToken(uid, tokenEntry) {
    const updates = {};
    const path = tokenEntry?.path;
    if (path) updates[`users/${uid}/${path}`] = null;
    if (tokenEntry?.token) updates[`fcmTokenIndex/${tokenKey(tokenEntry.token)}`] = null;
    if (Object.keys(updates).length) await db.ref().update(updates);
}

async function acquireNotificationJob(jobId) {
    const ref = db.ref(`notificationQueue/${jobId}`);
    const lockId = crypto.randomBytes(12).toString('hex');
    const now = Date.now();
    const result = await ref.transaction((job) => {
        if (!job) return job;
        if (job.status === 'sent' || job.status === 'skipped' || job.status === 'dead') return;
        if (Number(job.leaseUntil || 0) > now && job.lockId && job.lockId !== lockId) return;
        return {
            ...job,
            status: 'sending',
            lockId,
            leaseUntil: now + 90 * 1000,
            workerStartedAt: now,
            updatedAt: now
        };
    });
    return result.committed ? { ref, job: result.snapshot.val(), lockId } : null;
}

async function processNotificationJob(jobId) {
    const acquired = await acquireNotificationJob(jobId);
    if (!acquired) return;

    const { ref: jobRef, job, lockId } = acquired;
    const now = Date.now();
    const nick = String(job.nick || '');
    if (!nick || !job.notification) {
        await jobRef.update({ status: 'dead', lastError: 'invalid_job', updatedAt: now });
        return;
    }

    try {
        const userSnap = await db.ref(`users/${nick}`).get();
        const user = userSnap.exists() ? (userSnap.val() || {}) : null;
        if (!user) {
            await jobRef.update({ status: 'dead', lastError: 'user_not_found', updatedAt: now, leaseUntil: null });
            return;
        }

        const notification = job.notification;
        const category = String(notification.category || 'system');

        if (!notificationCategoryEnabled(user, category)) {
            await jobRef.update({ status: 'skipped', skipReason: 'user_preferences', completedAt: now, updatedAt: now, leaseUntil: null, lockId: null });
            return;
        }

        if (notification.source === 'general_chat') {
            const presenceSnap = await db.ref(`presence/${nick}/generalChatOpen`).get();
            if (presenceSnap.val() === true) {
                await jobRef.update({ status: 'skipped', skipReason: 'general_chat_open', completedAt: now, updatedAt: now, leaseUntil: null, lockId: null });
                return;
            }
        }

        const tokenEntries = collectFcmTokens(user);
        if (!tokenEntries.length) {
            const attempts = Number(job.attempts || 0) + 1;
            if (attempts >= 96) {
                await jobRef.update({ status: 'dead', lastError: 'no_tokens', attempts, completedAt: now, updatedAt: now, leaseUntil: null, lockId: null });
            } else {
                await jobRef.update({
                    status: 'waiting_token', attempts,
                    nextAttemptAt: now + 15 * 60 * 1000,
                    lastError: 'no_tokens', updatedAt: now, leaseUntil: null, lockId: null
                });
            }
            return;
        }

        const tokenStatus = (job.tokenStatus && typeof job.tokenStatus === 'object') ? { ...job.tokenStatus } : {};
        const responsesToSend = [];
        let enabledTokenCount = 0;
        for (const entry of tokenEntries) {
            const id = tokenKey(entry.token);
            const state = tokenStatus[id]?.state;
            if (state === 'sent' || state === 'invalid' || state === 'disabled') continue;
            if (!notificationCategoryEnabled(user, entry, category)) {
                tokenStatus[id] = { state: 'disabled', attempts: Number(tokenStatus[id]?.attempts || 0), updatedAt: now };
                continue;
            }
            enabledTokenCount += 1;
            responsesToSend.push({ ...entry, id });
        }

        if (!responsesToSend.length) {
            await jobRef.update({ status: enabledTokenCount ? 'sent' : 'skipped', skipReason: enabledTokenCount ? null : 'user_preferences', tokenStatus, sentAt: now, completedAt: now, updatedAt: now, nextAttemptAt: null, leaseUntil: null, lockId: null });
            return;
        }

        const payload = {
            data: {
                title: String(notification.title || 'Капани'),
                body: String(notification.body || ''),
                text: String(notification.body || ''),
                category,
                notificationId: String(job.notificationId || notification.notificationId || jobId),
                url: String(notification.url || KAPANI_CANONICAL_URL),
                createdAt: String(notification.createdAt || now),
                ...(notification.source ? { source: String(notification.source) } : {}),
                ...(notification.sourceMessageId ? { sourceMessageId: String(notification.sourceMessageId) } : {})
            },
            webpush: { headers: { Urgency: 'high' } },
            token: ''
        };

        const tokenStatuses = { ...tokenStatus };
        let successCount = 0;
        const attemptedAt = Date.now();

        for (let offset = 0; offset < responsesToSend.length; offset += 500) {
            const batch = responsesToSend.slice(offset, offset + 500);
            const response = await admin.messaging().sendEach(batch.map((entry) => ({
                ...payload,
                token: entry.token
            })));

            response.responses.forEach((result, index) => {
                const entry = batch[index];
                const previousAttempts = Number(tokenStatuses[entry.id]?.attempts || 0);
                const errorCode = result.success ? '' : String(result.error?.code || 'unknown');
                if (result.success) {
                    successCount += 1;
                    tokenStatuses[entry.id] = { state: 'sent', attempts: previousAttempts + 1, updatedAt: attemptedAt };
                    return;
                }
                if (isInvalidTokenError(errorCode)) {
                    tokenStatuses[entry.id] = { state: 'invalid', attempts: previousAttempts + 1, updatedAt: attemptedAt, error: errorCode };
                    removeInvalidFcmToken(nick, entry).catch((cleanupError) => console.warn('[Kapani FCM cleanup]', cleanupError));
                    return;
                }
                tokenStatuses[entry.id] = {
                    state: 'pending', attempts: previousAttempts + 1,
                    updatedAt: attemptedAt, error: errorCode
                };
            });
        }

        const unresolved = responsesToSend.filter((entry) => tokenStatuses[entry.id]?.state === 'pending');
        if (unresolved.length) {
            const attempts = Number(job.attempts || 0) + 1;
            if (attempts >= 10) {
                await jobRef.update({
                    status: successCount > 0 ? 'partial' : 'dead', attempts,
                    tokenStatus: tokenStatuses,
                    lastError: 'max_attempts', completedAt: now,
                    updatedAt: now, nextAttemptAt: null, leaseUntil: null, lockId: null
                });
            } else {
                await jobRef.update({
                    status: 'retry', attempts,
                    tokenStatus: tokenStatuses,
                    nextAttemptAt: now + nextRetryDelay(attempts),
                    lastError: 'fcm_delivery_failed', updatedAt: now, leaseUntil: null, lockId: null
                });
            }
            return;
        }

        await jobRef.update({
            status: 'sent', tokenStatus: tokenStatuses, sentCount: successCount,
            completedAt: now, updatedAt: now, nextAttemptAt: null, leaseUntil: null, lockId: null
        });
    } catch (error) {
        const attempts = Number(job.attempts || 0) + 1;
        console.error('[Kapani notification queue]', jobId, error);
        if (attempts >= 10) {
            await jobRef.update({ status: 'dead', attempts, lastError: String(error?.message || error), updatedAt: Date.now(), nextAttemptAt: null, leaseUntil: null, lockId: null });
        } else {
            await jobRef.update({ status: 'retry', attempts, lastError: String(error?.message || error), updatedAt: Date.now(), nextAttemptAt: Date.now() + nextRetryDelay(attempts), leaseUntil: null, lockId: null });
        }
    }
}


exports.enqueueNotificationPush = onValueCreated(
  { ref: '/users/{nick}/notifications/{notificationId}', region: 'europe-west1' },
  async (event) => {
    const nick = String(event.params?.nick || '');
    const notificationId = String(event.params?.notificationId || '');
    const raw = event.data?.val();
    if (!nick || !notificationId || !raw || raw.push === false) return null;

    const payload = getNotificationPayload({ ...raw, id: notificationId });
    if (!payload) return null;

    const now = Date.now();
    const jobId = notificationJobId(nick, notificationId);
    const queueRef = db.ref(`notificationQueue/${jobId}`);
    const existing = await queueRef.get();
    if (!existing.exists()) {
        await queueRef.set({
            id: jobId,
            nick,
            notificationId,
            notification: payload,
            status: 'queued',
            attempts: 0,
            tokenStatus: {},
            createdAt: now,
            nextAttemptAt: now,
            updatedAt: now
        });
    }

    await processNotificationJob(jobId);
    return null;
  }
);

exports.processNotificationQueue = onSchedule(
  { schedule: 'every 2 minutes', timeZone: 'UTC', region: 'europe-west1' },
  async () => {
    const snap = await db.ref('notificationQueue').get();
    if (!snap.exists()) return null;
    const now = Date.now();
    const jobs = Object.values(snap.val() || {})
      .filter((job) => job && ['queued', 'retry', 'waiting_token'].includes(job.status) && Number(job.nextAttemptAt || 0) <= now)
      .sort((a, b) => Number(a.nextAttemptAt || 0) - Number(b.nextAttemptAt || 0))
      .slice(0, 100);

    await Promise.allSettled(jobs.map((job) => processNotificationJob(String(job.id))));
    return null;
  }
);

/**
 * Server-authoritative subscription gifting.
 *
 * IMPORTANT:
 * The complete financial/subscription mutation happens in one RTDB root
 * transaction. If the gift is rejected or the transaction does not commit,
 * no balance/subscription/transaction/gift record is changed.
 */
exports.giftSubscription = onCall(async (request) => {
    const giverNick = String(request.auth?.uid || '').trim();
    const recipientNick = String(request.data?.recipientNick || '').trim();
    const type = normalizeSubscriptionType(request.data?.subscriptionType);

    if (!giverNick) throw new HttpsError('unauthenticated', 'Требуется защищённая сессия');
    if (!recipientNick || recipientNick === giverNick) {
        throw new HttpsError('invalid-argument', 'Некорректный получатель');
    }
    if (type === 'none') {
        throw new HttpsError('invalid-argument', 'Некорректная подписка');
    }

    const plan = SUBSCRIPTIONS[type];
    const price = Number(plan?.price || 0);
    const giftRank = Number(plan?.rank || 0);
    if (!Number.isSafeInteger(price) || price <= 0 || giftRank <= 0) {
        throw new HttpsError('failed-precondition', 'Некорректная конфигурация подписки');
    }

    const rootRef = db.ref();
    const giftId = rootRef.child(`subscriptionGifts/${recipientNick}`).push().key;
    const giverTxId = rootRef.child(`users/${giverNick}/txlog`).push().key;
    const recipientTxId = rootRef.child(`users/${recipientNick}/txlog`).push().key;
    if (!giftId || !giverTxId || !recipientTxId) {
        throw new HttpsError('internal', 'Не удалось подготовить идентификаторы операции');
    }

    const committedAt = Date.now();
    const txResult = await rootRef.transaction((root) => {
        if (!root) return;

        const users = root.users || {};
        const giver = users[giverNick];
        const recipient = users[recipientNick];

        if (!giver || !recipient) return;
        if (String(giverNick) !== String(request.auth.uid)) return;

        const balance = Number(giver.balance || 0);
        if (!Number.isFinite(balance) || balance < price) return;

        const recipientRank = subscriptionRank(recipient);
        if (recipientRank >= giftRank) return;

        const now = new Date(committedAt);
        const currentExpiry = recipient.subscriptionExpiry ? new Date(recipient.subscriptionExpiry) : null;
        const activeSameType = normalizeSubscriptionType(recipient.subscription) === type
            && currentExpiry
            && !Number.isNaN(currentExpiry.getTime())
            && currentExpiry.getTime() > committedAt;

        const expiry = activeSameType
            ? new Date(currentExpiry.getTime() + 7 * 24 * 60 * 60 * 1000)
            : new Date(committedAt + 7 * 24 * 60 * 60 * 1000);

        const startDate = activeSameType
            ? String(recipient.subscriptionStart || now.toISOString())
            : now.toISOString();

        const updatedRoot = { ...root };
        updatedRoot.users = { ...users };
        updatedRoot.users[giverNick] = {
            ...giver,
            balance: balance - price
        };
        updatedRoot.users[recipientNick] = {
            ...recipient,
            subscription: type,
            subscriptionStatus: 'active',
            subscriptionExpiry: expiry.toISOString(),
            subscriptionStart: startDate,
            subscriptionGiftedBy: giverNick,
            subscriptionGiftedAt: now.toISOString(),
            totalEarned: Number(recipient.totalEarned || 0)
        };

        const date = now.toLocaleDateString('ru');
        const time = now.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
        const ts = now.toISOString();

        updatedRoot.users[giverNick].txlog = {
            ...(giver.txlog || {}),
            [giverTxId]: {
                type: 'out',
                who: 'Подарок подписки',
                amt: price,
                desc: `Подарок ${plan.name} для ${recipientNick}`,
                date, time, ts
            }
        };

        updatedRoot.users[recipientNick].txlog = {
            ...(recipient.txlog || {}),
            [recipientTxId]: {
                type: 'in',
                who: 'Подарок подписки',
                amt: 0,
                desc: `Получена ${plan.name} от ${giverNick}`,
                date, time, ts
            }
        };

        updatedRoot.subscriptionGifts = {
            ...(root.subscriptionGifts || {}),
            [giftId]: {
                id: giftId,
                from: giverNick,
                to: recipientNick,
                subscription: type,
                price,
                createdAt: committedAt,
                status: 'completed'
            }
        };

        const treasury = root.municipalTreasury && typeof root.municipalTreasury === 'object'
            ? root.municipalTreasury
            : { balance: 0 };
        updatedRoot.municipalTreasury = {
            ...treasury,
            balance: Number(treasury.balance || 0) + price,
            updatedAt: committedAt
        };

        const history = root.municipalTreasury?.history && typeof root.municipalTreasury.history === 'object'
            ? root.municipalTreasury.history
            : {};
        const treasuryHistoryId = rootRef.child('municipalTreasury/history').push().key;
        updatedRoot.municipalTreasury.history = {
            ...history,
            [treasuryHistoryId]: {
                type: 'in',
                amount: price,
                reason: `Подаренная подписка ${plan.name} от ${giverNick}`,
                sourceNick: giverNick,
                sourceType: 'subscription_gift',
                date, time, ts
            }
        };

        return updatedRoot;
    });

    if (!txResult.committed) {
        const latest = await db.ref(`users/${recipientNick}`).get();
        const latestUser = latest.exists() ? latest.val() : null;
        const latestRank = subscriptionRank(latestUser);
        if (latestRank >= giftRank) {
            throw new HttpsError('failed-precondition', 'Нельзя подарить эту подписку. У пользователя уже есть подписка более высокого уровня.');
        }

        const giverSnap = await db.ref(`users/${giverNick}`).get();
        const giverBalance = Number(giverSnap.val()?.balance || 0);
        if (giverBalance < price) {
            throw new HttpsError('failed-precondition', `Недостаточно средств. Нужно ${price}₽`);
        }

        throw new HttpsError('aborted', 'Операция не была подтверждена Firebase. Повторите попытку.');
    }

    // Notification delivery is intentionally outside the financial transaction:
    // notification failure can never roll back or partially apply the gift.
    const notificationBase = {
        createdAt: committedAt,
        url: KAPANI_CANONICAL_URL,
        cat: 'system',
        push: true
    };
    await Promise.all([
        db.ref(`users/${giverNick}/notifications/gift_${giftId}`).set({
            ...notificationBase,
            text: `🎁 Вы подарили ${plan.name} пользователю ${recipientNick}!`,
            time: new Date(committedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        }),
        db.ref(`users/${recipientNick}/notifications/gift_${giftId}`).set({
            ...notificationBase,
            text: `🎁 ${giverNick} подарил вам ${plan.name}!`,
            time: new Date(committedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        })
    ]).catch((error) => console.warn('[giftSubscription notifications]', error));

    return {
        success: true,
        giftId,
        subscription: type,
        price
    };
});

/**
 * General-chat notification fan-out.
 * One /chat write -> one deterministic notification per recipient -> FCM.
 * The sender is excluded, and FCM is skipped for users who currently have
 * the general chat open. RTDB notification remains available to them.
 */
exports.notifyOnChatMessage = onValueCreated(
  {
    ref: '/chat/{messageId}',
    region: 'europe-west1'
  },
  async (event) => {
    const message = event.data?.val();
    const messageId = String(event.params?.messageId || '');
    if (!message?.nick || !messageId) return null;

    const senderNick = String(message.nick);
    let preview = String(message.text || message.caption || '').trim();
    if (!preview) {
      if (message.msgType === 'image') preview = '📷 Фото';
      else if (message.msgType === 'voice') preview = '🎤 Голосовое сообщение';
      else if (message.msgType === 'video') preview = '🎬 Видео';
      else if (message.msgType === 'video_circle') preview = '⭕ Видеосообщение';
      else if (message.mediaData) preview = '📎 Вложение';
      else preview = 'Новое сообщение';
    }
    if (preview.length > 80) preview = `${preview.slice(0, 77)}...`;

    const usersSnap = await db.ref('users').get();
    const users = usersSnap.val() || {};
    const sender = users[senderNick] || {};
    const senderName = String(sender.displayName || sender.name || sender.publicName || sender.nick || senderNick);
    const notificationText = `💬 ${senderName} написал в общий чат: ${preview}`;
    const now = Date.now();

    const updates = {};

    for (const [nick, user] of Object.entries(users)) {
      if (!user || nick === senderNick) continue;

      const notificationId = `chat_${messageId}`;
      updates[`users/${nick}/notifications/${notificationId}`] = {
        text: notificationText,
        time: new Date(now).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        cat: 'messages',
        createdAt: now,
        url: KAPANI_CANONICAL_URL,
        push: true,
        source: 'general_chat',
        sourceMessageId: messageId
      };

    }

    if (Object.keys(updates).length) {
      await db.ref().update(updates);
    }

    // Push delivery is handled by the universal notification queue trigger.
    // This keeps chat, gifts and all other notification sources on the same
    // retry/dedupe/invalid-token path.

    return null;
  }
);

// Вспомогательная функция для получения даты/времени
function getDateTime() {
    const d = new Date();
    return {
        date: d.toLocaleDateString('ru'),
        time: d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }),
        ts: d.toISOString()
    };
}

function getTime() {
    return new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Уведомления общего чата.
 *
 * Архитектурно fan-out выполняется на сервере, а не из браузера пользователя:
 * 1) клиент пишет одно сообщение в /chat;
 * 2) Cloud Function получает событие;
 * 3) сервер записывает уведомление каждому другому пользователю;
 * 4) существующие RTDB-listener'ы и FCM bridge доставляют его без перезагрузки.
 */
