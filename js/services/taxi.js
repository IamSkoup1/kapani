import { getCurrentUser, getCurrentNick, displayNick } from "../auth.js";
import { dbGet, dbSet, dbPush, dbUpdate, dbRemove, dbOnValue } from "../firebase.js";
import { pushNotification } from "../notifications.js";

export function initTaxiService() {
    const container = document.getElementById('service_taxi');
    if (!container) return;

    renderTaxiView(container);

    window.addEventListener('serviceMounted', (e) => {
        if (e.detail?.serviceId === 'taxi') {
            renderTaxiView(container);
        }
    });
}

async function renderTaxiView(container) {
    const user = getCurrentUser();
    const userNick = getCurrentNick();
    if (!user || !userNick) return;

    const isDriverEligible = (user.examScore || 0) >= 60 && user.driversLicense;

    container.innerHTML = `
        <div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
            <h2 style="font-family:'Unbounded',sans-serif;font-size:20px;">🚕 К-Такси</h2>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:16px;">
            <button class="btn btn-primary" style="flex:1;" onclick="switchTaxiMode('passenger')">🙋‍♂️ Пассажир</button>
            <button class="btn ${isDriverEligible ? 'btn-gold' : 'btn-ghost'}" style="flex:1;" onclick="switchTaxiMode('driver')">🛵 Водитель</button>
        </div>

        <div id="taxiModeContainer"></div>
    `;

    switchTaxiMode('passenger');
}

window.switchTaxiMode = async function(mode) {
    const container = document.getElementById('taxiModeContainer');
    if (!container) return;

    const user = getCurrentUser();
    const userNick = getCurrentNick();

    if (mode === 'passenger') {
        const ordersObj = await dbGet('taxi_orders') || {};
        const myActiveOrderKey = Object.keys(ordersObj).find(k => ordersObj[k] && ordersObj[k].client === userNick && ordersObj[k].status !== 'completed' && ordersObj[k].status !== 'cancelled');
        const activeOrder = myActiveOrderKey ? { ...ordersObj[myActiveOrderKey], id: myActiveOrderKey } : null;

        container.innerHTML = `
            ${activeOrder ? `
                <div class="taxi-card" style="border-color:var(--primary);">
                    <div style="font-weight:900;font-size:16px;color:var(--primary);margin-bottom:8px;">🚕 Ваш заказ такси</div>
                    <div>Откуда: <b>${activeOrder.fromAddress}</b></div>
                    <div>Куда: <b>${activeOrder.toAddress}</b></div>
                    <div>Стоимость: <b>${activeOrder.price} ₽</b></div>
                    <div>Статус: <b style="color:var(--gold);">${activeOrder.status === 'waiting' ? 'Поиск водителя…' : 'Водитель в пути 🛵'}</b></div>
                    ${activeOrder.driverName ? `<div style="margin-top:6px;">Водитель: <b>${activeOrder.driverName}</b></div>` : ''}
                    <button class="btn btn-red" style="width:100%;margin-top:12px;" onclick="cancelTaxiOrder('${activeOrder.id}')">Отменить поездку</button>
                </div>
            ` : `
                <div class="taxi-hero">
                    <div style="font-weight:800;font-size:16px;">Заказать Такси по Капаням</div>
                    <div style="font-size:12px;color:var(--muted);margin-top:4px;">Быстрая и удобная поездка в любую точку города.</div>
                </div>

                <div class="taxi-card">
                    <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Точка отправления</label>
                    <input type="text" id="taxiFromInput" placeholder="Например: Центральная площадь">

                    <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Пункт назначения</label>
                    <input type="text" id="taxiToInput" placeholder="Например: Здание Мэрии">

                    <div style="font-size:13px;font-weight:800;margin:10px 0;">Фиксированная стоимость: <span style="color:var(--primary);">250 ₽</span></div>

                    <button class="btn btn-primary" style="width:100%;" onclick="createTaxiOrderFlow()">🚖 Вызвать Такси</button>
                </div>
            `}
        `;
    } else {
        const isEligible = (user.examScore || 0) >= 60 && user.driversLicense;
        if (!isEligible) {
            container.innerHTML = `
                <div class="taxi-card" style="text-align:center;padding:24px;">
                    <div style="font-size:40px;margin-bottom:8px;">❌</div>
                    <div style="font-weight:800;font-size:16px;">Доступ ограничен</div>
                    <div style="font-size:12px;color:var(--muted);margin-top:6px;">Для работы водителем такси требуется КВЭ ≥ 60 баллов и Права на скутер.</div>
                </div>
            `;
            return;
        }

        const ordersObj = await dbGet('taxi_orders') || {};
        const availableOrders = Object.keys(ordersObj)
            .map(k => ({ ...ordersObj[k], id: k }))
            .filter(o => o.status === 'waiting');

        const activeDriverOrder = Object.keys(ordersObj)
            .map(k => ({ ...ordersObj[k], id: k }))
            .find(o => o.driver === userNick && o.status === 'in_progress');

        container.innerHTML = `
            <div class="taxi-hero" style="background:linear-gradient(135deg, rgba(34,211,165,0.15), rgba(59,130,246,0.15));">
                <div style="font-weight:800;font-size:16px;">Панель Водителя Такси 🛵</div>
                <div style="font-size:12px;color:var(--muted);margin-top:4px;">Принимайте заказы и зарабатывайте капанёвские рубли.</div>
            </div>

            ${activeDriverOrder ? `
                <div class="taxi-card" style="border-color:var(--gold);">
                    <div style="font-weight:900;font-size:16px;color:var(--gold);margin-bottom:8px;">🚨 Активный заказ в работе</div>
                    <div>Пассажир: <b>${activeDriverOrder.clientName}</b></div>
                    <div>Маршрут: <b>${activeDriverOrder.fromAddress} → ${activeDriverOrder.toAddress}</b></div>
                    <div>Оплата: <b>${activeDriverOrder.price} ₽</b></div>
                    <button class="btn btn-primary" style="width:100%;margin-top:12px;" onclick="finishTaxiOrder('${activeDriverOrder.id}')">🏁 Завершить поездку</button>
                </div>
            ` : `
                <div style="font-weight:800;font-size:15px;margin-bottom:12px;">Доступные заказы</div>
                <div>
                    ${availableOrders.length === 0 ? '<div style="color:var(--muted);text-align:center;padding:20px;">Заказов пока нет</div>' :
                        availableOrders.map(o => `
                            <div class="taxi-card">
                                <div style="font-weight:800;font-size:14px;">Маршрут: ${o.fromAddress} → ${o.toAddress}</div>
                                <div style="font-size:12px;color:var(--muted);margin:4px 0;">Пассажир: ${o.clientName}</div>
                                <div style="font-weight:900;color:var(--primary);">${o.price} ₽</div>
                                <button class="btn btn-gold" style="width:100%;margin-top:8px;" onclick="acceptTaxiOrder('${o.id}')">Принять заказ</button>
                            </div>
                        `).join('')
                    }
                </div>
            `}
        `;
    }
};

window.createTaxiOrderFlow = async function() {
    const user = getCurrentUser();
    const userNick = getCurrentNick();
    const fromAddress = document.getElementById('taxiFromInput').value;
    const toAddress = document.getElementById('taxiToInput').value;

    if (!fromAddress || !toAddress) return alert("Заполните точки отправления и назначения");

    const price = 250;
    if ((user.balance || 0) < price) return alert("Недостаточно средств для заказа такси");

    const orderObj = {
        client: userNick,
        clientName: displayNick(user),
        fromAddress,
        toAddress,
        price,
        status: 'waiting',
        createdAt: Date.now()
    };

    await dbPush('taxi_orders', orderObj);
    alert("🚖 Заказ создан! Ожидаем свободного водителя.");
    switchTaxiMode('passenger');
};

window.cancelTaxiOrder = async function(orderId) {
    await dbUpdate(`taxi_orders/${orderId}`, { status: 'cancelled' });
    alert("Заказ отменён.");
    switchTaxiMode('passenger');
};

window.acceptTaxiOrder = async function(orderId) {
    const user = getCurrentUser();
    const userNick = getCurrentNick();

    await dbUpdate(`taxi_orders/${orderId}`, {
        status: 'in_progress',
        driver: userNick,
        driverName: displayNick(user)
    });

    alert("Заказ принят! Направляйтесь к пассажиру.");
    switchTaxiMode('driver');
};

window.finishTaxiOrder = async function(orderId) {
    const order = await dbGet(`taxi_orders/${orderId}`);
    if (!order) return;

    const user = getCurrentUser();
    const userNick = getCurrentNick();

    await dbUpdate(`taxi_orders/${orderId}`, { status: 'completed' });
    await dbUpdate(`users/${userNick}`, { balance: (user.balance || 0) + order.price });

    const clientUser = await dbGet(`users/${order.client}`);
    if (clientUser) {
        await dbUpdate(`users/${order.client}`, { balance: Math.max(0, (clientUser.balance || 0) - order.price) });
        await pushNotification(order.client, `🚕 Поездка завершена. Списано ${order.price} ₽. Спасибо!`, 'taxi', '#taxi');
    }

    alert(`🎉 Поездка завершена! Вам зачислено ${order.price} ₽.`);
    switchTaxiMode('driver');
};
