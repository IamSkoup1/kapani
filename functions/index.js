const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');
const { getDatabase } = require('firebase-admin/database');
const admin = require('firebase-admin');

admin.initializeApp();
const db = getDatabase();
const firestore = getFirestore();

// ─────────────────────────────────────────────────────────────
// Kapani server-side Web Push / FCM
// ─────────────────────────────────────────────────────────────
const crypto = require('crypto');

function hashNotificationToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}
function cleanText(value, maxLen = 1000) {
    return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, maxLen);
}
const ALLOWED_NOTIFICATION_CATS = new Set([
    'system','money','messages','taxi_orders','delivery_orders','market','news'
]);
const DEFAULT_PUSH_URLS = {
    messages:'./index.html?kapaniPush=messages',
    money:'./index.html?kapaniPush=bank',
    taxi_orders:'./index.html?kapaniPush=driverPage',
    delivery_orders:'./index.html?kapaniPush=deliveryOrderPage',
    market:'./index.html?kapaniPush=market',
    news:'./index.html?kapaniPush=news',
    system:'./index.html?kapaniPush=profile'
};
function pushData({title,body,category,url,notificationId}) {
    const cat=ALLOWED_NOTIFICATION_CATS.has(category)?category:'system';
    return {
        title:cleanText(title||'Капани',120),
        body:cleanText(body||'',1000),
        category:cat,
        url:cleanText(url||DEFAULT_PUSH_URLS[cat],500),
        notificationId:cleanText(notificationId||crypto.randomUUID(),120)
    };
}
async function sendPushToUser(nick,payload) {
    const cleanNick=cleanText(nick,120);
    if(!cleanNick) return {sent:0,removed:0};
    const [settingsSnap,tokensSnap]=await Promise.all([
        db.ref(`users/${cleanNick}/pushSettings`).get(),
        db.ref(`users/${cleanNick}/notificationTokens`).get()
    ]);
    const settings=settingsSnap.val()||{};
    if(settings.enabled===false) return {sent:0,removed:0,disabled:true};
    const category=payload.category||'system';
    if(settings[category]===false) return {sent:0,removed:0,disabled:true};

    const tokenMap=tokensSnap.val()||{};
    const tokenRows=Object.entries(tokenMap)
        .filter(([,row])=>row&&row.token)
        .map(([id,row])=>({id,token:String(row.token)}));
    if(!tokenRows.length) return {sent:0,removed:0};

    const data=pushData(payload);
    const messages=tokenRows.map(row=>({
        token:row.token,
        data,
        webpush:{headers:{Urgency:'high'}}
    }));
    const response=await admin.messaging().sendEach(messages);

    const stale=[];
    response.responses.forEach((r,i)=>{
        if(r.success) return;
        const code=r.error?.code||'';
        if(code.includes('registration-token-not-registered') ||
           code.includes('invalid-registration-token') ||
           code.includes('messaging/registration-token-not-registered') ||
           code.includes('messaging/invalid-registration-token')) stale.push(tokenRows[i].id);
    });
    if(stale.length){
        const updates={};
        stale.forEach(id=>updates[`users/${cleanNick}/notificationTokens/${id}`]=null);
        try{await db.ref().update(updates);}catch(e){console.warn('[Kapani Push] stale-token cleanup:',e);}
    }
    return {sent:response.successCount||0,failed:response.failureCount||0,removed:stale.length};
}
async function createNotificationServerSide(nick,text,category='system',extra={}) {
    const cleanNick=cleanText(nick,120);
    if(!cleanNick) throw new Error('Получатель уведомления не указан');
    const cat=ALLOWED_NOTIFICATION_CATS.has(category)?category:'system';
    const id=db.ref(`users/${cleanNick}/notifications`).push().key;
    const item={
        text:cleanText(text,1000),
        time:getTime(),
        cat,
        createdAt:Date.now(),
        read:false
    };
    if(extra.newsId)item.newsId=cleanText(extra.newsId,120);
    if(extra.type)item.type=cleanText(extra.type,80);
    if(extra.duelId)item.duelId=cleanText(extra.duelId,120);
    await db.ref(`users/${cleanNick}/notifications/${id}`).set(item);
    const push=await sendPushToUser(cleanNick,{
        title:extra.title||'Капани',
        body:item.text,
        category:cat,
        url:extra.url,
        notificationId:id
    });
    return {id,push};
}
// Existing custom Kapani auth stores the password hash in the user's profile.
// It is used only as a proof for these notification operations; FCM/Admin
// credentials never reach the frontend.
function verifyActorProof(actorNick,actorProof,userData){
    const nick=cleanText(actorNick,120);
    const proof=cleanText(actorProof,500);
    const stored=String(userData?.passwordHash||'');
    return Boolean(nick&&proof&&stored&&proof===stored);
}
exports.registerNotificationToken=onCall({region:'europe-west1', cors:true},async(request)=>{
    const {actorNick,actorProof,token,platform,userAgent}=request.data||{};
    if(!actorNick||!actorProof||!token) throw new HttpsError('invalid-argument','Не хватает данных для регистрации Push');
    const nick=cleanText(actorNick,120);
    const userSnap=await db.ref(`users/${nick}`).get();
    if(!userSnap.exists()||!verifyActorProof(nick,actorProof,userSnap.val()))
        throw new HttpsError('permission-denied','Не удалось подтвердить пользователя');
    const cleanToken=String(token).trim();
    const tokenId=hashNotificationToken(cleanToken);
    await db.ref(`users/${nick}/notificationTokens/${tokenId}`).set({
        token:cleanToken,
        platform:cleanText(platform||'web',30),
        userAgent:cleanText(userAgent||'',500),
        updatedAt:Date.now()
    });
    return {success:true,tokenId};
});

exports.unregisterNotificationToken=onCall({region:'europe-west1', cors:true},async(request)=>{
    const {actorNick,actorProof,token}=request.data||{};
    if(!actorNick||!actorProof||!token)
        throw new HttpsError('invalid-argument','Не хватает данных для отключения Push');
    const nick=cleanText(actorNick,120);
    const userSnap=await db.ref(`users/${nick}`).get();
    if(!userSnap.exists()||!verifyActorProof(nick,actorProof,userSnap.val()))
        throw new HttpsError('permission-denied','Не удалось подтвердить пользователя');
    const tokenId=hashNotificationToken(String(token).trim());
    await db.ref(`users/${nick}/notificationTokens/${tokenId}`).remove();
    return {success:true,tokenId};
});
exports.updateNotificationPreferences=onCall({region:'europe-west1', cors:true},async(request)=>{
    const {actorNick,actorProof,settings}=request.data||{};
    if(!actorNick||!actorProof||!settings||typeof settings!=='object')
        throw new HttpsError('invalid-argument','Некорректные настройки уведомлений');
    const nick=cleanText(actorNick,120);
    const userSnap=await db.ref(`users/${nick}`).get();
    if(!userSnap.exists()||!verifyActorProof(nick,actorProof,userSnap.val()))
        throw new HttpsError('permission-denied','Не удалось подтвердить пользователя');
    const next={enabled:settings.enabled!==false};
    for(const cat of ALLOWED_NOTIFICATION_CATS){
        if(cat==='system') continue;
        if(Object.prototype.hasOwnProperty.call(settings,cat)) next[cat]=settings[cat]!==false;
    }
    await db.ref(`users/${nick}/pushSettings`).set(next);
    return {success:true};
});
exports.sendKapaniNotification=onCall({region:'europe-west1', cors:true},async(request)=>{
    const {actorNick,actorProof,recipientNick,text,category,title,url,newsId,type,duelId}=request.data||{};
    if(!actorNick||!actorProof||!recipientNick||!text)
        throw new HttpsError('invalid-argument','Некорректные параметры уведомления');
    const actor=cleanText(actorNick,120);
    const actorSnap=await db.ref(`users/${actor}`).get();
    if(!actorSnap.exists()||!verifyActorProof(actor,actorProof,actorSnap.val()))
        throw new HttpsError('permission-denied','Не удалось подтвердить пользователя');
    return await createNotificationServerSide(recipientNick,text,category||'system',{title,url,newsId,type,duelId});
});

exports.sendGlobalChatPush=onCall({region:'europe-west1', cors:true},async(request)=>{
    const {actorNick,actorProof,text,messageId}=request.data||{};
    if(!actorNick||!actorProof||!text)
        throw new HttpsError('invalid-argument','Некорректные параметры чат-Push');
    const actor=cleanText(actorNick,120);
    const actorSnap=await db.ref(`users/${actor}`).get();
    if(!actorSnap.exists()||!verifyActorProof(actor,actorProof,actorSnap.val()))
        throw new HttpsError('permission-denied','Не удалось подтвердить пользователя');

    const usersSnap=await db.ref('users').get();
    const users=usersSnap.val()||{};
    const notificationId=`chat-${cleanText(messageId||crypto.randomUUID(),120)}`;
    const body=cleanText(text,1000);
    const recipients=Object.keys(users).filter(nick=>nick&&nick!==actor);
    const results=await Promise.all(recipients.map(nick=>sendPushToUser(nick,{
        title:'Капани 💬',
        body,
        category:'messages',
        url:'./index.html?kapaniPush=messages',
        notificationId
    }).catch(error=>({sent:0,failed:1,error:String(error?.message||error)}))));
    return {
        success:true,
        recipients:recipients.length,
        sent:results.reduce((sum,r)=>sum+(r?.sent||0),0),
        failed:results.reduce((sum,r)=>sum+(r?.failed||0),0)
    };
});

const ADMIN_UID = 'Денис'; // UID администратора (должен совпадать с ником в базе)

// Проверка, что пользователь является администратором
function isAdmin(context) {
    const uid = context.auth?.uid;
    return uid === ADMIN_UID;
}

// Cloud Function для перевода денег между пользователями
exports.transferMoney = onCall({ region:'europe-west1', cors:true }, async (request) => {
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

        await createNotificationServerSide(toUid, `💸 ${fromUid} перевёл вам ${amount}₽`, 'money', {
            title: '💰 Новый перевод',
            url: './index.html?kapaniPush=bank'
        });

        return { success: true, message: 'Перевод выполнен успешно' };

    } catch (error) {
        console.error('Ошибка перевода:', error);
        throw new HttpsError('internal', 'Ошибка при выполнении перевода');
    }
});

// Cloud Function для админских операций с балансом
exports.adminAdjustBalance = onCall({ region:'europe-west1', cors:true }, async (request) => {
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

        await createNotificationServerSide(
            uid,
            amount >= 0 ? `💰 Мэрия зачислила вам ${absAmount}₽` : `💸 Мэрия списала с вас ${absAmount}₽`,
            amount >= 0 ? 'money' : 'system'
        );

        return { success: true, newBalance };

    } catch (error) {
        console.error('Ошибка корректировки баланса:', error);
        throw new HttpsError('internal', 'Ошибка при корректировке баланса');
    }
});

// Cloud Function для создания заказа (такси/доставка)
exports.createOrder = onCall({ region:'europe-west1', cors:true }, async (request) => {
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
exports.payOrder = onCall({ region:'europe-west1', cors:true }, async (request) => {
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
exports.cancelOrder = onCall({ region:'europe-west1', cors:true }, async (request) => {
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
            await createNotificationServerSide(
                order.worker,
                `⚠️ ${clientUid} отменил заказ`,
                order.type === 'taxi' ? 'taxi_orders' : 'delivery_orders'
            );
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
exports.takeOrder = onCall({ region:'europe-west1', cors:true }, async (request) => {
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
