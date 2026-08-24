(function() {
    window.initRealEstateService = function() {
        const container = document.getElementById('service_realestate');
        if (!container) return;

        renderRealEstateView(container);

        window.addEventListener('serviceMounted', (e) => {
            if (e.detail?.serviceId === 'realestate') {
                renderRealEstateView(container);
            }
        });
    };

    async function renderRealEstateView(container) {
        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();

        if (!user || !userNick) return;

        const rawList = await window.KP_DB.dbGet('real_estate') || {};
        const list = Object.keys(rawList)
            .map(k => ({ ...rawList[k], id: k }))
            .filter(r => r.status === 'approved');

        container.innerHTML = `
            <div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
                <h2 style="font-family:'Unbounded',sans-serif;font-size:20px;">🏢 К-Недвижимость</h2>
                <button class="btn btn-primary" style="padding:6px 12px;font-size:12px;" onclick="openCreateRealEstateModal()">➕ Сдать объект</button>
            </div>

            <div style="display:flex;flex-direction:column;gap:12px;">
                ${list.length === 0 ? '<div style="text-align:center;color:var(--muted);padding:30px;">Нет доступной недвижимости</div>' :
                    list.map(re => `
                        <div class="card">
                            <div style="font-weight:800;font-size:16px;color:var(--text);">${re.title}</div>
                            <div style="font-size:14px;color:var(--accent);font-weight:800;margin:4px 0;">💰 ${Number(re.price).toLocaleString()} ₽/нед</div>
                            <div style="font-size:12px;color:var(--muted);">${re.type} • 📍 ${re.address || 'Капани'}</div>
                            <div style="font-size:12px;color:var(--text);margin-top:8px;background:var(--surface2);padding:8px;border-radius:8px;">${re.description || 'Без описания'}</div>
                            <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;">
                                <span style="font-size:11px;color:var(--muted);">Владелец: ${re.ownerName || re.owner}</span>
                                <button class="btn btn-primary" style="padding:6px 12px;font-size:12px;" onclick="rentRealEstate('${re.id}')">Арендовать</button>
                            </div>
                        </div>
                    `).join('')
                }
            </div>
        `;
    }

    window.openCreateRealEstateModal = function() {
        let modal = document.getElementById('createREModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'createREModal';
            modal.className = 'modal-backdrop';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal-card">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <h3 style="font-family:'Unbounded',sans-serif;font-size:18px;">🏢 Добавить Объект Недвижимости</h3>
                    <span style="font-size:22px;cursor:pointer;color:var(--muted);" onclick="closeCreateREModal()">✕</span>
                </div>

                <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Название</label>
                <input type="text" id="reTitleInput" placeholder="Апартаменты / Офис / Помещение...">

                <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Тип</label>
                <select id="reTypeSelect">
                    <option value="Жилая">Жилая</option>
                    <option value="Коммерческая">Коммерческая</option>
                    <option value="Земельный участок">Земельный участок</option>
                </select>

                <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Цена аренды (₽ / неделя)</label>
                <input type="number" id="rePriceInput" placeholder="Цена">

                <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Описание</label>
                <textarea id="reDescInput" placeholder="Характеристики..."></textarea>

                <button class="btn btn-primary" onclick="submitRealEstateFlow()" style="width:100%;margin-top:10px;">Отправить в Мэрию на проверку</button>
            </div>
        `;

        modal.style.display = 'flex';
    };

    window.closeCreateREModal = function() {
        const modal = document.getElementById('createREModal');
        if (modal) modal.style.display = 'none';
    };

    window.submitRealEstateFlow = async function() {
        const title = document.getElementById('reTitleInput').value;
        const type = document.getElementById('reTypeSelect').value;
        const price = Number(document.getElementById('rePriceInput').value);
        const desc = document.getElementById('reDescInput').value;

        if (!title || price <= 0) return alert("Заполните корректно форму");

        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();

        const item = {
            title,
            type,
            price,
            description: desc,
            owner: userNick,
            ownerName: window.KP.displayNick(user),
            status: 'pending',
            createdAt: Date.now()
        };

        await window.KP_DB.dbPush('real_estate', item);
        alert("🎉 Заявка отправлена на модерацию в К-Мэрию!");
        closeCreateREModal();
        renderRealEstateView(document.getElementById('service_realestate'));
    };

    window.rentRealEstate = async function(id) {
        const re = await window.KP_DB.dbGet(`real_estate/${id}`);
        if (!re) return;

        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();

        if ((user.balance || 0) < re.price) {
            return alert("Недостаточно средств для аренды на 1 неделю");
        }

        await window.KP_DB.dbUpdate(`users/${userNick}`, { balance: user.balance - re.price });
        const owner = await window.KP_DB.dbGet(`users/${re.owner}`);
        if (owner) {
            await window.KP_DB.dbUpdate(`users/${re.owner}`, { balance: (owner.balance || 0) + re.price });
        }

        alert(`🎉 Вы арендовали "${re.title}" на 1 неделю! Списано ${re.price} ₽.`);
        renderRealEstateView(document.getElementById('service_realestate'));
    };
})();
