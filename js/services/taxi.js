(function() {
    window.initTaxiService = function() {
        const container = document.getElementById('service_taxi');
        if (!container) return;

        renderTaxiView(container);

        window.addEventListener('serviceMounted', (e) => {
            if (e.detail?.serviceId === 'taxi') {
                renderTaxiView(container);
            }
        });
    };

    async function renderTaxiView(container) {
        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();

        if (!user || !userNick) return;

        const isDriver = user.job === 'taxi';

        container.innerHTML = `
            <div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
                <h2 style="font-family:'Unbounded',sans-serif;font-size:20px;color:var(--accent);">🚕 К-Такси</h2>
                <span class="badge ${isDriver ? 'badge-gold' : 'badge-green'}">${isDriver ? 'Водитель' : 'Пассажир'}</span>
            </div>

            ${isDriver ? renderDriverPanel() : renderPassengerPanel(user)}
        `;

        if (isDriver) {
            setupDriverOrdersListener();
        } else {
            setupPassengerOrdersListener(userNick);
        }
    }

    function renderPassengerPanel(user) {
        return `
            <div class="card" style="margin-bottom:16px;">
                <h3 style="font-size:16px;font-family:'Unbounded',sans-serif;margin-bottom:12px;">Заказать Такси</h3>

                <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Точка отправления</label>
                <input type="text" id="taxiFromInput" value="Центральная площадь">

                <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Пункт назначения</label>
                <input type="text" id="taxiToInput" placeholder="Куда едем?">

                <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Предлагаемая стоимость (₽)</label>
                <input type="number" id="taxiPriceInput" value="300">

                <button class="btn btn-primary" style="width:100%;margin-top:10px;" onclick="createTaxiOrderFlow()">🚖 Вызвать Такси</button>
            </div>

            <div id="passengerActiveOrderContainer"></div>
        `;
    }

    function renderDriverPanel() {
        return `
            <div class="card" style="margin-bottom:16px;">
                <h3 style="font-size:16px;font-family:'Unbounded',sans-serif;margin-bottom:8px;">Панель Водителя Такси</h3>
                <div style="font-size:12px;color:var(--muted);">Принимайте вызовы граждан и зарабатывайте капанёвские рубли.</div>
            </div>

            <div id="driverOrdersContainer">
                <div style="text-align:center;color:var(--muted);padding:20px;">Поиск активных заказов...</div>
            </div>
        `;
    }

    window.createTaxiOrderFlow = async function() {
        const from = document.getElementById('taxiFromInput').value;
        const to = document.getElementById('taxiToInput').value;
        const price = Number(document.getElementById('taxiPriceInput').value);

        if (!from || !to || price <= 0) return alert("Заполните маршрут и цену");

        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();

        if ((user.balance || 0) < price) {
            return alert("Недостаточно средств на балансе для поездки");
        }

        const order = {
            passenger: userNick,
            passengerName: window.KP.displayNick(user),
            from,
            to,
            price,
            status: 'created',
            createdAt: Date.now()
        };

        await window.KP_DB.dbPush('taxi_orders', order);
        alert("🎉 Вызов такси создан! Ожидайте водителя.");
    };

    function setupPassengerOrdersListener(userNick) {
        window.KP_DB.dbOnValue('taxi_orders', (ordersObj) => {
            const container = document.getElementById('passengerActiveOrderContainer');
            if (!container) return;

            if (!ordersObj) {
                container.innerHTML = '';
                return;
            }

            const myOrderKey = Object.keys(ordersObj).find(k => ordersObj[k].passenger === userNick && ordersObj[k].status !== 'completed' && ordersObj[k].status !== 'cancelled');
            if (!myOrderKey) {
                container.innerHTML = '';
                return;
            }

            const order = ordersObj[myOrderKey];

            container.innerHTML = `
                <div class="card" style="border:1px solid var(--accent);">
                    <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                        <span style="font-weight:800;color:var(--accent);">Активный вызов</span>
                        <span class="badge badge-gold">${order.status}</span>
                    </div>
                    <div style="font-size:13px;color:var(--text);">${order.from} ➔ ${order.to}</div>
                    <div style="font-size:12px;color:var(--muted);margin-top:4px;">Стоимость: <b>${order.price} ₽</b></div>
                    ${order.driverName ? `<div style="font-size:12px;color:var(--accent);margin-top:6px;">Водитель: ${order.driverName}</div>` : ''}

                    <div style="display:flex;gap:8px;margin-top:12px;">
                        ${order.status === 'in_progress' ? `
                            <button class="btn btn-green" style="flex:1;" onclick="finishTaxiOrderFlow('${myOrderKey}')">Завершить поездку</button>
                        ` : ''}
                        <button class="btn btn-red" style="flex:1;" onclick="cancelTaxiOrderFlow('${myOrderKey}')">Отменить</button>
                    </div>
                </div>
            `;
        });
    }

    function setupDriverOrdersListener() {
        const driverNick = window.KP.getCurrentNick();

        window.KP_DB.dbOnValue('taxi_orders', (ordersObj) => {
            const container = document.getElementById('driverOrdersContainer');
            if (!container) return;

            if (!ordersObj) {
                container.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;">Доступных заказов нет</div>';
                return;
            }

            const availableList = Object.keys(ordersObj)
                .map(k => ({ ...ordersObj[k], id: k }))
                .filter(o => o.status === 'created' || (o.status === 'in_progress' && o.driver === driverNick));

            if (availableList.length === 0) {
                container.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;">Доступных заказов нет</div>';
                return;
            }

            container.innerHTML = availableList.map(o => `
                <div class="card" style="margin-bottom:12px;">
                    <div style="font-weight:800;font-size:14px;color:var(--text);">${o.from} ➔ ${o.to}</div>
                    <div style="font-size:12px;color:var(--accent);font-weight:700;margin:4px 0;">Оплата: ${o.price} ₽</div>
                    <div style="font-size:11px;color:var(--muted);">Пассажир: ${o.passengerName || o.passenger}</div>

                    <div style="margin-top:10px;">
                        ${o.status === 'created' ? `
                            <button class="btn btn-primary" style="width:100%;" onclick="acceptTaxiOrderFlow('${o.id}')">Принять заказ</button>
                        ` : `
                            <button class="btn btn-green" style="width:100%;" onclick="finishTaxiOrderFlow('${o.id}')">Завершить и получить ${o.price} ₽</button>
                        `}
                    </div>
                </div>
            `).join('');
        });
    }

    window.acceptTaxiOrderFlow = async function(orderId) {
        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();

        await window.KP_DB.dbUpdate(`taxi_orders/${orderId}`, {
            driver: userNick,
            driverName: window.KP.displayNick(user),
            status: 'in_progress'
        });

        const order = await window.KP_DB.dbGet(`taxi_orders/${orderId}`);
        if (order) {
            await window.KP.pushNotification(order.passenger, 'К-Такси', `Водитель ${window.KP.displayNick(user)} принял ваш заказ и выехал!`);
        }
        alert("Вы приняли заказ!");
    };

    window.finishTaxiOrderFlow = async function(orderId) {
        const order = await window.KP_DB.dbGet(`taxi_orders/${orderId}`);
        if (!order || order.status === 'completed') return;

        const passenger = await window.KP_DB.dbGet(`users/${order.passenger}`);
        if (passenger) {
            await window.KP_DB.dbUpdate(`users/${order.passenger}`, { balance: Math.max(0, (passenger.balance || 0) - order.price) });
        }

        if (order.driver) {
            const driver = await window.KP_DB.dbGet(`users/${order.driver}`);
            if (driver) {
                await window.KP_DB.dbUpdate(`users/${order.driver}`, { balance: (driver.balance || 0) + order.price });
            }
        }

        await window.KP_DB.dbUpdate(`taxi_orders/${orderId}`, { status: 'completed' });
        alert("🎉 Поездка завершена! Расчет произведён.");
    };

    window.cancelTaxiOrderFlow = async function(orderId) {
        await window.KP_DB.dbUpdate(`taxi_orders/${orderId}`, { status: 'cancelled' });
        alert("Заказ отменён.");
    };
})();
