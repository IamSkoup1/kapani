import { getCurrentUser, getCurrentNick, displayNick } from "../auth.js";
import { dbGet, dbPush, dbUpdate } from "../firebase.js";

export function initRealEstateService() {
    const container = document.getElementById('service_realestate');
    if (!container) return;

    renderRealEstateView(container);

    window.addEventListener('serviceMounted', (e) => {
        if (e.detail?.serviceId === 'realestate') {
            renderRealEstateView(container);
        }
    });
}

async function renderRealEstateView(container) {
    const user = getCurrentUser();
    const userNick = getCurrentNick();
    if (!user || !userNick) return;

    const propsObj = await dbGet('real_estate') || {};
    const props = Object.keys(propsObj)
        .map(k => ({ ...propsObj[k], id: k }))
        .filter(p => p.status === 'approved');

    container.innerHTML = `
        <div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
            <h2 style="font-family:'Unbounded',sans-serif;font-size:20px;">🏠 К-Недвижимость</h2>
            <button class="btn btn-primary" style="padding:8px 14px;font-size:12px;" onclick="openSubmitPropertyModal()">➕ Предложить объект</button>
        </div>

        <div id="realEstateList">
            ${props.length === 0 ? '<div style="text-align:center;color:var(--muted);padding:30px;">Объектов недвижимости пока нет</div>' :
                props.map(p => `
                    <div class="re-card">
                        <img class="re-card-img" src="${p.photo || 'https://cdn-icons-png.flaticon.com/512/609/609803.png'}">
                        <div style="font-family:'Unbounded',sans-serif;font-weight:800;font-size:16px;margin-bottom:4px;">${p.title}</div>
                        <div style="font-size:16px;font-weight:900;color:var(--primary);margin-bottom:8px;">${Number(p.rentPrice).toLocaleString()} ₽ / мес</div>
                        <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">📍 ${p.address} • Тип: ${p.type || 'Здание'}</div>
                        <div style="font-size:12px;line-height:1.5;margin-bottom:12px;">${p.description || ''}</div>
                        <button class="btn btn-primary" style="width:100%;" onclick="rentPropertyFlow('${p.id}', ${p.rentPrice})">Арендовать здание</button>
                    </div>
                `).join('')
            }
        </div>
    `;
}

window.openSubmitPropertyModal = function() {
    let modal = document.getElementById('submitPropertyModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'submitPropertyModal';
        modal.className = 'modal-backdrop';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="modal-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 style="font-family:'Unbounded',sans-serif;font-size:18px;">🏠 Размещение Объекта</h3>
                <span style="font-size:22px;cursor:pointer;color:var(--muted);" onclick="closeSubmitPropertyModal()">✕</span>
            </div>

            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Название здания / объекта</label>
            <input type="text" id="reTitleInput" placeholder="Например: Бизнес-Центр Капани">

            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Адрес</label>
            <input type="text" id="reAddressInput" placeholder="ул. Центральная, д. 5">

            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Стоимость аренды (₽/мес)</label>
            <input type="number" id="rePriceInput" placeholder="Цена аренды">

            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Описание</label>
            <textarea id="reDescInput" placeholder="Характеристики объекта..."></textarea>

            <button class="btn btn-primary" onclick="submitPropertyFlow()" style="width:100%;margin-top:10px;">Отправить на модерацию в Мэрию</button>
        </div>
    `;

    modal.style.display = 'flex';
};

window.closeSubmitPropertyModal = function() {
    const modal = document.getElementById('submitPropertyModal');
    if (modal) modal.style.display = 'none';
};

window.submitPropertyFlow = async function() {
    const user = getCurrentUser();
    const userNick = getCurrentNick();
    const title = document.getElementById('reTitleInput').value;
    const address = document.getElementById('reAddressInput').value;
    const rentPrice = document.getElementById('rePriceInput').value;
    const desc = document.getElementById('reDescInput').value;

    if (!title || !rentPrice) return alert("Заполните название и стоимость аренды");

    await dbPush('real_estate', {
        title,
        address,
        rentPrice: Number(rentPrice),
        description: desc,
        owner: userNick,
        ownerName: displayNick(user),
        status: 'pending_moderation',
        createdAt: Date.now()
    });

    alert("🎉 Объект недвижимости отправлен на модерацию в Мэрию!");
    closeSubmitPropertyModal();
};

window.rentPropertyFlow = async function(propId, price) {
    const user = getCurrentUser();
    const userNick = getCurrentNick();

    if ((user.balance || 0) < price) {
        return alert("Недостаточно средств для оплаты первого месяца аренды");
    }

    if (confirm(`Арендовать данный объект за ${price} ₽/мес?`)) {
        await dbUpdate(`users/${userNick}`, { balance: user.balance - price });
        await dbUpdate(`real_estate/${propId}`, { tenant: userNick, tenantName: displayNick(user) });
        alert("🎉 Поздравляем! Объект успешно арендован.");
        renderRealEstateView(document.getElementById('service_realestate'));
    }
};
