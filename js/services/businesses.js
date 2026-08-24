(function() {
    window.initBusinessesService = function() {
        const container = document.getElementById('service_businesses');
        if (!container) return;

        renderBusinessesView(container);

        window.addEventListener('serviceMounted', (e) => {
            if (e.detail?.serviceId === 'businesses') {
                renderBusinessesView(container);
            }
        });
    };

    async function renderBusinessesView(container) {
        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();
        if (!user || !userNick) return;

        const businessesObj = await window.KP_DB.dbGet('businesses') || {};
        const list = Object.keys(businessesObj).map(k => ({ ...businessesObj[k], id: k }));

        container.innerHTML = `
            <div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
                <h2 style="font-family:'Unbounded',sans-serif;font-size:20px;">🏢 К-Бизнесы</h2>
                <button class="btn btn-primary" style="padding:8px 14px;font-size:12px;" onclick="openCreateBusinessModal()">➕ Открыть бизнес (${window.KP_CONFIG.fees.businessCreationFee} ₽)</button>
            </div>

            <div class="biz-hero">
                <div style="font-size:16px;font-weight:800;color:var(--text);">Каталог предприятий Капаней</div>
                <div style="font-size:12px;color:var(--muted);margin-top:4px;">Магазины, студии, кафе, сервисы и компании нашего города.</div>
            </div>

            <div id="bizListArea">
                ${list.length === 0 ? '<div style="text-align:center;color:var(--muted);padding:20px;">Предприятий пока нет. Будьте первым бизнесменом!</div>' :
                    list.map(b => `
                        <div class="biz-card" onclick="openBusinessMiniSite('${b.id}')">
                            <div style="display:flex;gap:12px;align-items:center;">
                                <img class="biz-logo" src="${b.logo || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'}">
                                <div>
                                    <div style="font-weight:800;font-size:15px;color:var(--text);">${b.name}</div>
                                    <div style="font-size:11px;color:var(--purple);font-weight:700;">${b.category || 'Предприятие'} • 📍 ${b.address || 'Капани'}</div>
                                    <div style="font-size:11px;color:var(--muted);margin-top:2px;">Владелец: ${b.ownerName || b.owner}</div>
                                </div>
                            </div>
                        </div>
                    `).join('')
                }
            </div>
        `;
    }

    window.openCreateBusinessModal = function() {
        let modal = document.getElementById('createBizModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'createBizModal';
            modal.className = 'modal-backdrop';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal-card">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <h3 style="font-family:'Unbounded',sans-serif;font-size:18px;">🏢 Открытие Бизнеса</h3>
                    <span style="font-size:22px;cursor:pointer;color:var(--muted);" onclick="closeCreateBizModal()">✕</span>
                </div>
                <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">Госпошлина за регистрацию бизнеса составляет <b>${window.KP_CONFIG.fees.businessCreationFee} ₽</b>.</div>

                <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Название бизнеса</label>
                <input type="text" id="bizNameInput" placeholder="Например: Капани Кофе">

                <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Категория</label>
                <select id="bizCategorySelect">
                    <option value="Магазин">Магазин</option>
                    <option value="Кафе / Ресторан">Кафе / Ресторан</option>
                    <option value="Мастерская">Мастерская</option>
                    <option value="Сервис / Услуги">Сервис / Услуги</option>
                    <option value="Студия">Студия</option>
                    <option value="Компания">Компания</option>
                </select>

                <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Адрес</label>
                <input type="text" id="bizAddressInput" placeholder="ул. Капаневская, д. 1">

                <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Описание</label>
                <textarea id="bizDescInput" placeholder="Чем занимается ваш бизнес?"></textarea>

                <button class="btn btn-primary" onclick="submitCreateBusinessFlow()" style="width:100%;margin-top:10px;">Зарегистрировать бизнес</button>
            </div>
        `;

        modal.style.display = 'flex';
    };

    window.closeCreateBizModal = function() {
        const modal = document.getElementById('createBizModal');
        if (modal) modal.style.display = 'none';
    };

    window.submitCreateBusinessFlow = async function() {
        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();
        if (!user || !userNick) return;

        const name = document.getElementById('bizNameInput').value;
        const category = document.getElementById('bizCategorySelect').value;
        const address = document.getElementById('bizAddressInput').value;
        const desc = document.getElementById('bizDescInput').value;

        if (!name) return alert("Заполните название бизнеса");

        if ((user.balance || 0) < window.KP_CONFIG.fees.businessCreationFee) {
            return alert(`Недостаточно средств для уплаты госпошлины (${window.KP_CONFIG.fees.businessCreationFee} ₽)`);
        }

        await window.KP_DB.dbUpdate(`users/${userNick}`, { balance: user.balance - window.KP_CONFIG.fees.businessCreationFee });

        const bizKey = 'biz_' + Date.now();
        const bizObj = {
            id: bizKey,
            name,
            category,
            address,
            description: desc,
            owner: userNick,
            ownerName: window.KP.displayNick(user),
            logo: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png',
            createdAt: Date.now(),
            products: []
        };

        await window.KP_DB.dbSet(`businesses/${bizKey}`, bizObj);
        alert("🎉 Бизнес успешно открыт и внесен в реестр Капаней!");
        closeCreateBizModal();
        renderBusinessesView(document.getElementById('service_businesses'));
    };

    window.openBusinessMiniSite = async function(bizId) {
        const biz = await window.KP_DB.dbGet(`businesses/${bizId}`);
        if (!biz) return;

        let modal = document.getElementById('bizMiniSiteModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'bizMiniSiteModal';
            modal.className = 'modal-backdrop';
            document.body.appendChild(modal);
        }

        const myNick = window.KP.getCurrentNick();
        const isOwner = biz.owner === myNick;

        modal.innerHTML = `
            <div class="modal-card" style="max-width:480px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <img src="${biz.logo}" style="width:36px;height:36px;border-radius:10px;">
                        <div>
                            <div style="font-weight:900;font-size:16px;">${biz.name}</div>
                            <div style="font-size:10px;color:var(--purple);font-weight:700;">${biz.category}</div>
                        </div>
                    </div>
                    <span style="font-size:22px;cursor:pointer;color:var(--muted);" onclick="closeBizMiniSite()">✕</span>
                </div>

                <div class="biz-mini-site">
                    <div style="font-size:13px;line-height:1.5;margin-bottom:12px;">${biz.description || 'Описание отсутствует.'}</div>
                    <div style="font-size:11px;color:var(--muted);">📍 Адрес: <b>${biz.address || 'Капани'}</b></div>
                    <div style="font-size:11px;color:var(--muted);margin-top:2px;">👑 Владелец: <b>${biz.ownerName || biz.owner}</b></div>

                    ${isOwner ? `
                        <button class="btn btn-gold" style="width:100%;margin-top:16px;font-size:12px;" onclick="addBizProductPrompt('${bizId}')">➕ Добавить товар / услугу</button>
                    ` : ''}
                </div>
            </div>
        `;

        modal.style.display = 'flex';
    };

    window.closeBizMiniSite = function() {
        const modal = document.getElementById('bizMiniSiteModal');
        if (modal) modal.style.display = 'none';
    };

    window.addBizProductPrompt = async function(bizId) {
        const name = prompt("Название товара/услуги:");
        const price = prompt("Цена (₽):");
        if (name && price) {
            await window.KP_DB.dbPush(`businesses/${bizId}/products`, {
                name,
                price: Number(price),
                createdAt: Date.now()
            });
            alert("Товар добавлен!");
            openBusinessMiniSite(bizId);
        }
    };
})();
