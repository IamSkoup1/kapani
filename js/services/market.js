import { getCurrentUser, getCurrentNick, displayNick } from "../auth.js";
import { dbGet, dbSet, dbPush, dbUpdate, dbRemove } from "../firebase.js";
import { pushNotification } from "../notifications.js";
import { CONFIG } from "../config.js";

let cart = [];

export function initMarketService() {
    const container = document.getElementById('service_market');
    if (!container) return;

    renderMarketView(container);

    window.addEventListener('serviceMounted', (e) => {
        if (e.detail?.serviceId === 'market') {
            renderMarketView(container);
        }
    });
}

async function renderMarketView(container) {
    const user = getCurrentUser();
    const userNick = getCurrentNick();
    if (!user || !userNick) return;

    const marketObj = await dbGet('market') || {};
    const list = Object.keys(marketObj)
        .map(k => ({ ...marketObj[k], id: k }))
        .filter(item => item.status === 'approved' && (item.quantity || 0) > 0);

    const userOrdersObj = await dbGet(`market_orders`) || {};
    const myOrders = Object.keys(userOrdersObj)
        .map(k => ({ ...userOrdersObj[k], id: k }))
        .filter(o => o.buyer === userNick || o.seller === userNick);

    container.innerHTML = `
        <div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
            <h2 style="font-family:'Unbounded',sans-serif;font-size:20px;">🛒 К-Маркет</h2>
            <button class="btn btn-primary" style="padding:8px 14px;font-size:12px;" onclick="openCreateMarketListingModal()">➕ Выставить товар</button>
        </div>

        <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">
            Комиссия за размещение: <b>10%</b> от стоимости. Все новые товары проходят модерацию в Мэрии.
        </div>

        <div class="market-grid">
            ${list.length === 0 ? '<div style="grid-column:span 2;text-align:center;color:var(--muted);padding:30px;">В Маркете пока нет одобренных товаров</div>' :
                list.map(item => `
                    <div class="market-card">
                        <div class="market-badge">${item.quantity} шт</div>
                        <img class="market-card-img" src="${item.photo || 'https://cdn-icons-png.flaticon.com/512/3081/3081559.png'}">
                        <div style="font-weight:800;font-size:14px;color:var(--text);">${item.title}</div>
                        <div style="font-family:'Unbounded',sans-serif;font-size:15px;font-weight:900;color:var(--primary);">${Number(item.price).toLocaleString()} ₽</div>
                        <div style="font-size:10px;color:var(--muted);">Продавец: ${item.sellerName || item.seller}</div>
                        <button class="btn btn-ghost" style="padding:6px;font-size:12px;margin-top:4px;" onclick="addToMarketCart('${item.id}')">🛒 В корзину</button>
                    </div>
                `).join('')
            }
        </div>

        ${myOrders.length > 0 ? `
            <div style="margin-top:24px;">
                <h3 style="font-weight:800;font-size:16px;margin-bottom:12px;">📦 Мои Заказы</h3>
                ${myOrders.map(o => `
                    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:12px;margin-bottom:8px;">
                        <div style="display:flex;justify-content:space-between;">
                            <div style="font-weight:800;font-size:13px;">Заказ #${o.id.slice(-6)}</div>
                            <div style="font-weight:800;color:var(--primary);">${o.totalPrice} ₽</div>
                        </div>
                        <div style="font-size:11px;color:var(--muted);margin-top:4px;">Покупатель: ${o.buyerName} | Продавец: ${o.sellerName}</div>
                        <div style="background:#0f172a;border:1px dashed var(--gold);padding:8px;border-radius:8px;margin-top:8px;text-align:center;">
                            🔑 Секретный код получения: <b style="color:var(--gold);font-size:16px;letter-spacing:2px;">${o.secretCode}</b>
                        </div>
                    </div>
                `).join('')}
            </div>
        ` : ''}

        ${cart.length > 0 ? `
            <div class="cart-bar" onclick="openCartModal()">
                <span>🛒 В корзине: ${cart.reduce((a,b)=>a+b.qty, 0)} шт</span>
                <span>Оформить →</span>
            </div>
        ` : ''}
    `;
}

window.openCreateMarketListingModal = function() {
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
                <h3 style="font-family:'Unbounded',sans-serif;font-size:18px;">🛒 Продажа в К-Маркет</h3>
                <span style="font-size:22px;cursor:pointer;color:var(--muted);" onclick="closeCreateMarketModal()">✕</span>
            </div>

            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Название товара</label>
            <input type="text" id="marketTitleInput" placeholder="Название">

            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Цена за шт. (₽)</label>
            <input type="number" id="marketPriceInput" placeholder="Цена">

            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Количество на складе</label>
            <input type="number" id="marketQtyInput" placeholder="Количество" value="1">

            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Описание и характеристики</label>
            <textarea id="marketDescInput" placeholder="Описание товара..."></textarea>

            <button class="btn btn-primary" onclick="submitMarketListingFlow()" style="width:100%;margin-top:10px;">Отправить на модерацию в Мэрию</button>
        </div>
    `;

    modal.style.display = 'flex';
};

window.closeCreateMarketModal = function() {
    const modal = document.getElementById('createMarketModal');
    if (modal) modal.style.display = 'none';
};

window.submitMarketListingFlow = async function() {
    const user = getCurrentUser();
    const userNick = getCurrentNick();
    if (!user || !userNick) return;

    const title = document.getElementById('marketTitleInput').value;
    const price = Number(document.getElementById('marketPriceInput').value);
    const quantity = Number(document.getElementById('marketQtyInput').value);
    const desc = document.getElementById('marketDescInput').value;

    if (!title || isNaN(price) || price <= 0 || isNaN(quantity) || quantity <= 0) {
        return alert("Укажите корректное название, цену и количество");
    }

    const commission = Math.round(price * 0.10);
    if ((user.balance || 0) < commission) {
        return alert(`Недостаточно средств на балансе для оплаты комиссии размещения (10% = ${commission} ₽)`);
    }

    await dbUpdate(`users/${userNick}`, { balance: user.balance - commission });

    const itemObj = {
        title,
        price,
        quantity,
        description: desc,
        seller: userNick,
        sellerName: displayNick(user),
        commissionPaid: commission,
        status: 'pending_moderation',
        createdAt: Date.now()
    };

    await dbPush('market', itemObj);
    alert(`🎉 Товар отправлен на модерацию в Мэрию! Комиссия ${commission} ₽ списана.`);
    closeCreateMarketModal();
    renderMarketView(document.getElementById('service_market'));
};

window.addToMarketCart = async function(listingId) {
    const marketObj = await dbGet(`market/${listingId}`);
    if (!marketObj) return;

    const existing = cart.find(c => c.listingId === listingId);
    if (existing) {
        if (existing.qty < marketObj.quantity) {
            existing.qty++;
        } else {
            alert("Больше нет на складе!");
        }
    } else {
        cart.push({ listingId, item: marketObj, qty: 1 });
    }

    renderMarketView(document.getElementById('service_market'));
};

window.openCartModal = function() {
    let modal = document.getElementById('cartModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'cartModal';
        modal.className = 'modal-backdrop';
        document.body.appendChild(modal);
    }

    const total = cart.reduce((acc, c) => acc + (c.item.price * c.qty), 0);

    modal.innerHTML = `
        <div class="modal-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 style="font-family:'Unbounded',sans-serif;font-size:18px;">🛒 Корзина</h3>
                <span style="font-size:22px;cursor:pointer;color:var(--muted);" onclick="closeCartModal()">✕</span>
            </div>

            <div style="max-height:40vh;overflow-y:auto;margin-bottom:16px;">
                ${cart.map(c => `
                    <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface2);padding:10px;border-radius:12px;margin-bottom:8px;">
                        <div>
                            <div style="font-weight:800;font-size:13px;">${c.item.title}</div>
                            <div style="font-size:11px;color:var(--muted);">${c.item.price} ₽ x ${c.qty}</div>
                        </div>
                        <div style="font-weight:900;color:var(--primary);">${c.item.price * c.qty} ₽</div>
                    </div>
                `).join('')}
            </div>

            <div style="display:flex;justify-content:space-between;font-weight:900;font-size:16px;margin-bottom:16px;">
                <span>Итого:</span>
                <span style="color:var(--primary);">${total.toLocaleString()} ₽</span>
            </div>

            <button class="btn btn-primary" style="width:100%;" onclick="checkoutMarketCartFlow()">💳 Оплатить и получить секретный код</button>
        </div>
    `;

    modal.style.display = 'flex';
};

window.closeCartModal = function() {
    const modal = document.getElementById('cartModal');
    if (modal) modal.style.display = 'none';
};

window.checkoutMarketCartFlow = async function() {
    const user = getCurrentUser();
    const userNick = getCurrentNick();
    if (!user || !userNick) return;

    const total = cart.reduce((acc, c) => acc + (c.item.price * c.qty), 0);
    if ((user.balance || 0) < total) {
        return alert("Недостаточно средств на балансе для оплаты заказа");
    }

    for (const c of cart) {
        const itemTotal = c.item.price * c.qty;
        const secretCode = Math.floor(100000 + Math.random() * 900000).toString();

        const orderObj = {
            listingId: c.listingId,
            title: c.item.title,
            qty: c.qty,
            totalPrice: itemTotal,
            buyer: userNick,
            buyerName: displayNick(user),
            seller: c.item.seller,
            sellerName: c.item.sellerName || c.item.seller,
            secretCode,
            status: 'paid',
            createdAt: Date.now()
        };

        await dbPush('market_orders', orderObj);

        const newQty = Math.max(0, (c.item.quantity || 1) - c.qty);
        await dbUpdate(`market/${c.listingId}`, { quantity: newQty });

        const sellerUser = await dbGet(`users/${c.item.seller}`);
        if (sellerUser) {
            await dbUpdate(`users/${c.item.seller}`, { balance: (sellerUser.balance || 0) + itemTotal });
            await pushNotification(c.item.seller, `🎉 Продан товар «${c.item.title}»! Поступило ${itemTotal} ₽. Секретный код: ${secretCode}`, 'market', '#market');
        }
    }

    await dbUpdate(`users/${userNick}`, { balance: user.balance - total });

    cart = [];
    alert("🎉 Оплата прошла успешно! Секретный код заказа создан.");
    closeCartModal();
    renderMarketView(document.getElementById('service_market'));
};
