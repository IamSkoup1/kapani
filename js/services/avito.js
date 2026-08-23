import { getCurrentUser, getCurrentNick, displayNick } from "../auth.js";
import { dbGet, dbSet, dbPush, dbRemove } from "../firebase.js";

export function initAvitoService() {
    const container = document.getElementById('service_avito');
    if (!container) return;

    renderAvitoView(container);

    window.addEventListener('serviceMounted', (e) => {
        if (e.detail?.serviceId === 'avito') {
            renderAvitoView(container);
        }
    });
}

async function renderAvitoView(container) {
    const user = getCurrentUser();
    const userNick = getCurrentNick();
    if (!user || !userNick) return;

    const adsObj = await dbGet('avito_ads') || {};
    const list = Object.keys(adsObj).map(k => ({ ...adsObj[k], id: k })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    container.innerHTML = `
        <div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
            <h2 style="font-family:'Unbounded',sans-serif;font-size:20px;">🏷 К-Авито</h2>
            <button class="btn btn-primary" style="padding:8px 14px;font-size:12px;" onclick="openCreateAvitoAdModal()">➕ Подать объявление</button>
        </div>

        <div style="margin-bottom:16px;">
            <input type="text" placeholder="🔍 Поиск по объявлениям..." oninput="filterAvitoAds(this.value)">
        </div>

        <div id="avitoAdsContainer">
            ${list.length === 0 ? '<div style="text-align:center;color:var(--muted);padding:20px;">Объявлений пока нет</div>' :
                list.map(ad => `
                    <div class="avito-card" onclick="openAvitoAdModal('${ad.id}')">
                        <img class="avito-card-img" src="${ad.photo || 'https://cdn-icons-png.flaticon.com/512/1170/1170576.png'}">
                        <div style="flex:1;">
                            <div style="font-weight:800;font-size:15px;color:var(--text);">${ad.title}</div>
                            <div class="avito-price">${Number(ad.price).toLocaleString()} ₽</div>
                            <div style="font-size:11px;color:var(--muted);">${ad.category} • 📍 ${ad.location || 'Капани'}</div>
                            <div style="font-size:10px;color:var(--muted);margin-top:4px;">Продавец: ${ad.sellerName || ad.seller}</div>
                        </div>
                    </div>
                `).join('')
            }
        </div>
    `;
}

window.openCreateAvitoAdModal = function() {
    let modal = document.getElementById('createAvitoModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'createAvitoModal';
        modal.className = 'modal-backdrop';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="modal-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 style="font-family:'Unbounded',sans-serif;font-size:18px;">🏷 Новое Объявление</h3>
                <span style="font-size:22px;cursor:pointer;color:var(--muted);" onclick="closeCreateAvitoModal()">✕</span>
            </div>

            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Название</label>
            <input type="text" id="avitoTitleInput" placeholder="Что продаёте или предлагаете?">

            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Категория</label>
            <select id="avitoCatSelect">
                <option value="Товары">Товары</option>
                <option value="Услуги">Услуги</option>
                <option value="Вакансии">Вакансии</option>
                <option value="Аренда">Аренда</option>
            </select>

            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Цена (₽)</label>
            <input type="number" id="avitoPriceInput" placeholder="Цена">

            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Описание</label>
            <textarea id="avitoDescInput" placeholder="Подробности..."></textarea>

            <button class="btn btn-primary" onclick="submitAvitoAdFlow()" style="width:100%;margin-top:10px;">Опубликовать объявление</button>
        </div>
    `;

    modal.style.display = 'flex';
};

window.closeCreateAvitoModal = function() {
    const modal = document.getElementById('createAvitoModal');
    if (modal) modal.style.display = 'none';
};

window.submitAvitoAdFlow = async function() {
    const user = getCurrentUser();
    const userNick = getCurrentNick();
    if (!user || !userNick) return;

    const title = document.getElementById('avitoTitleInput').value;
    const category = document.getElementById('avitoCatSelect').value;
    const price = document.getElementById('avitoPriceInput').value;
    const desc = document.getElementById('avitoDescInput').value;

    if (!title || !price) return alert("Заполните название и цену");

    const adObj = {
        title,
        category,
        price: Number(price),
        description: desc,
        seller: userNick,
        sellerName: displayNick(user),
        location: 'Капани',
        createdAt: Date.now()
    };

    await dbPush('avito_ads', adObj);
    alert("🎉 Объявление опубликовано на К-Авито!");
    closeCreateAvitoModal();
    renderAvitoView(document.getElementById('service_avito'));
};

window.openAvitoAdModal = async function(adId) {
    const ads = await dbGet('avito_ads') || {};
    const ad = ads[adId];
    if (!ad) return;

    let modal = document.getElementById('avitoDetailModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'avitoDetailModal';
        modal.className = 'modal-backdrop';
        document.body.appendChild(modal);
    }

    const myNick = getCurrentNick();
    const isOwner = ad.seller === myNick;

    modal.innerHTML = `
        <div class="modal-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 style="font-family:'Unbounded',sans-serif;font-size:16px;">${ad.title}</h3>
                <span style="font-size:22px;cursor:pointer;color:var(--muted);" onclick="closeAvitoDetailModal()">✕</span>
            </div>

            <div class="avito-price" style="font-size:22px;">${Number(ad.price).toLocaleString()} ₽</div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:12px;">Продавец: <b>${ad.sellerName || ad.seller}</b> • 📍 ${ad.location || 'Капани'}</div>

            <div style="background:var(--surface2);padding:12px;border-radius:12px;font-size:13px;line-height:1.5;margin-bottom:16px;">
                ${ad.description || 'Описание отсутствует.'}
            </div>

            ${!isOwner ? `
                <button class="btn btn-primary" style="width:100%;" onclick="contactAvitoSeller('${ad.seller}')">💬 Написать продавцу</button>
            ` : `
                <button class="btn btn-red" style="width:100%;" onclick="deleteAvitoAd('${adId}')">🗑 Удалить объявление</button>
            `}
        </div>
    `;

    modal.style.display = 'flex';
};

window.closeAvitoDetailModal = function() {
    const modal = document.getElementById('avitoDetailModal');
    if (modal) modal.style.display = 'none';
};

window.contactAvitoSeller = function(sellerNick) {
    closeAvitoDetailModal();
    window.location.hash = '#messenger';
};

window.deleteAvitoAd = async function(adId) {
    if (confirm("Вы уверены, что хотите удалить объявление?")) {
        await dbRemove(`avito_ads/${adId}`);
        closeAvitoDetailModal();
        renderAvitoView(document.getElementById('service_avito'));
    }
};
