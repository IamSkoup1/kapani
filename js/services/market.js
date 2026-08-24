(function() {
    window.initMarketService = function() {
        const container = document.getElementById('service_market');
        if (!container) return;

        renderMarketView(container);

        window.addEventListener('serviceMounted', (e) => {
            if (e.detail?.serviceId === 'market') {
                renderMarketView(container);
            }
        });
    };

    let activeTab = 'catalog';

    async function renderMarketView(container) {
        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();
        if (!user || !userNick) return;

        const rawProducts = await window.KP_DB.dbGet('market_products') || {};
        const approvedProducts = Object.keys(rawProducts)
            .map(k => ({ ...rawProducts[k], id: k }))
            .filter(p => p.status === 'approved' && p.stock > 0);

        const myOrders = await window.KP_DB.dbGet('market_orders') || {};
        const userOrders = Object.keys(myOrders)
            .map(k => ({ ...myOrders[k], id: k }))
            .filter(o => o.buyer === userNick || o.seller === userNick)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        container.innerHTML = `
            <div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
                <h2 style="font-family:'Unbounded',sans-serif;font-size:20px;">🛍 К-Маркет</h2>
                <div style="display:flex;gap:8px;">
                    <button class="btn btn-secondary" style="padding:6px 12px;font-size:12px;" onclick="switchMarketTab('cart')">🛒 Корзина</button>
                    <button class="btn btn-primary" style="padding:6px 12px;font-size:12px;" onclick="openCreateMarketProductModal()">➕ Продать</button>
                </div>
            </div>

            <div style="display:flex;gap:8px;margin-bottom:16px;">
                <button class="btn ${activeTab === 'catalog' ? 'btn-primary' : 'btn-secondary'}" style="flex:1;padding:8px;font-size:12px;" onclick="switchMarketTab('catalog')">Каталог</button>
                <button class="btn ${activeTab === 'orders' ? 'btn-primary' : 'btn-secondary'}" style="flex:1;padding:8px;font-size:12px;" onclick="switchMarketTab('orders')">Мои Заказы (${userOrders.length})</button>
            </div>

            <div id="marketTabContent">
                ${activeTab === 'catalog' ? renderCatalog(approvedProducts) : renderOrders(userOrders)}
            </div>
        `;
    }

    window.switchMarketTab = function(tab) {
        activeTab = tab;
        renderMarketView(document.getElementById('service_market'));
    };

    function renderCatalog(products) {
        if (products.length === 0) {
            return '<div style="text-align:center;color:var(--muted);padding:30px;">Нет доступных товаров</div>';
        }

        return `
            <div class="market-grid">
                ${products.map(p => `
                    <div class="market-card">
                        <img class="market-card-img" src="${p.photo || 'https://cdn-icons-png.flaticon.com/512/3081/3081559.png'}">
                        <div class="market-card-title">${p.title}</div>
                        <div class="market-card-price">${Number(p.price).toLocaleString()} ₽</div>
                        <div style="font-size:11px;color:var(--muted);margin-bottom:8px;">В наличии: ${p.stock} шт • ${p.sellerName || p.seller}</div>
                        <button class="btn btn-primary" style="width:100%;padding:8px;font-size:12px;" onclick="addToMarketCart('${p.id}')">В корзину</button>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderOrders(orders) {
        if (orders.length === 0) {
            return '<div style="text-align:center;color:var(--muted);padding:30px;">У вас пока нет активных заказов</div>';
        }

        const myNick = window.KP.getCurrentNick();

        return `
            <div style="display:flex;flex-direction:column;gap:12px;">
                ${orders.map(o => {
                    const isBuyer = o.buyer === myNick;
                    return `
                        <div class="card">
                            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                                <span style="font-weight:800;">Заказ #${o.id.substring(0,6)}</span>
                                <span class="badge ${o.status === 'completed' ? 'badge-green' : 'badge-gold'}">${o.status}</span>
                            </div>
                            <div style="font-size:13px;color:var(--text);margin-bottom:4px;">${o.title} (${o.qty} шт.)</div>
                            <div style="font-size:12px;color:var(--muted);">Сумма: <b>${o.totalPrice} ₽</b></div>
                            <div style="font-size:12px;color:var(--muted);">${isBuyer ? `Продавец: ${o.sellerName || o.seller}` : `Покупатель: ${o.buyerName || o.buyer}`}</div>

                            <div style="background:var(--surface2);border-radius:8px;padding:8px;margin-top:8px;font-family:monospace;font-size:13px;text-align:center;color:var(--accent);">
                                Секретный код выдачи: <b>${o.secretCode}</b>
                            </div>

                            ${!isBuyer && o.status === 'paid' ? `
                                <button class="btn btn-primary" style="width:100%;margin-top:8px;padding:6px;" onclick="completeMarketOrder('${o.id}')">Завершить и перевести деньги</button>
                            ` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    window.openCreateMarketProductModal = function() {
        let modal = document.getElementById('createMarketModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'createMarketModal';
            modal.className = 'modal-backdrop';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal-card">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <h3 style="font-family:'Unbounded',sans-serif;font-size:18px;">🛍 Продать на К-Маркет</h3>
                    <span style="font-size:22px;cursor:pointer;color:var(--muted);" onclick="closeCreateMarketModal()">✕</span>
                </div>

                <div style="background:rgba(255,184,0,0.1);border:1px solid var(--accent);border-radius:12px;padding:10px;font-size:11px;color:var(--accent);margin-bottom:12px;">
                    ⚠️ Комиссия за публикацию товара составляет 10% от цены товара. Одобрение происходит через К-Мэрию.
                </div>

                <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Название товара</label>
                <input type="text" id="mProductTitle" placeholder="Введите название">

                <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Цена (₽)</label>
                <input type="number" id="mProductPrice" placeholder="Цена за unit">

                <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Количество на складе</label>
                <input type="number" id="mProductStock" value="1">

                <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Описание</label>
                <textarea id="mProductDesc" placeholder="Характеристики товара..."></textarea>

                <button class="btn btn-primary" onclick="submitMarketProductFlow()" style="width:100%;margin-top:10px;">Оплатить комиссию и отправить в Мэрию</button>
            </div>
        `;

        modal.style.display = 'flex';
    };

    window.closeCreateMarketModal = function() {
        const modal = document.getElementById('createMarketModal');
        if (modal) modal.style.display = 'none';
    };

    window.submitMarketProductFlow = async function() {
        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();
        if (!user || !userNick) return;

        const title = document.getElementById('mProductTitle').value;
        const price = Number(document.getElementById('mProductPrice').value);
        const stock = Number(document.getElementById('mProductStock').value);
        const desc = document.getElementById('mProductDesc').value;

        if (!title || price <= 0 || stock <= 0) return alert("Заполните корректно все поля");

        const fee = Math.ceil(price * 0.10);
        if ((user.balance || 0) < fee) return alert(`Недостаточно средств для уплаты комиссии (${fee} ₽)`);

        await window.KP_DB.dbUpdate(`users/${userNick}`, { balance: user.balance - fee });

        const product = {
            title,
            price,
            stock,
            description: desc,
            seller: userNick,
            sellerName: window.KP.displayNick(user),
            status: 'pending',
            createdAt: Date.now()
        };

        await window.KP_DB.dbPush('market_products', product);
        alert(`🎉 Комиссия ${fee} ₽ списана. Товар отправлен на модерацию в К-Мэрию!`);
        closeCreateMarketModal();
        renderMarketView(document.getElementById('service_market'));
    };

    window.addToMarketCart = async function(productId) {
        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();
        const product = (await window.KP_DB.dbGet(`market_products/${productId}`));
        if (!product || product.stock <= 0) return alert("Товар распродан!");

        if ((user.balance || 0) < product.price) return alert("Недостаточно капанёвских рублей на балансе");

        const secretCode = 'KP-' + Math.floor(100000 + Math.random() * 900000);

        await window.KP_DB.dbUpdate(`users/${userNick}`, { balance: user.balance - product.price });
        await window.KP_DB.dbUpdate(`market_products/${productId}`, { stock: product.stock - 1 });

        const order = {
            productId,
            title: product.title,
            qty: 1,
            totalPrice: product.price,
            buyer: userNick,
            buyerName: window.KP.displayNick(user),
            seller: product.seller,
            sellerName: product.sellerName,
            secretCode,
            status: 'paid',
            createdAt: Date.now()
        };

        await window.KP_DB.dbPush('market_orders', order);

        await window.KP.pushNotification(product.seller, 'Покупка на Маркете', `Пользователь ${window.KP.displayNick(user)} купил ${product.title}. Секретный код: ${secretCode}`);

        alert(`🎉 Оплата прошла успешно! Ваш секретный код получения: ${secretCode}`);
        renderMarketView(document.getElementById('service_market'));
    };

    window.completeMarketOrder = async function(orderId) {
        const order = await window.KP_DB.dbGet(`market_orders/${orderId}`);
        if (!order || order.status !== 'paid') return;

        const seller = await window.KP_DB.dbGet(`users/${order.seller}`);
        if (seller) {
            await window.KP_DB.dbUpdate(`users/${order.seller}`, { balance: (seller.balance || 0) + order.totalPrice });
        }

        await window.KP_DB.dbUpdate(`market_orders/${orderId}`, { status: 'completed' });
        alert("Заказ успешно завершен! Средства переданы продавцу.");
        renderMarketView(document.getElementById('service_market'));
    };
})();
