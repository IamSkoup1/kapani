(function() {
    window.initMayorService = function() {
        const container = document.getElementById('service_mayor');
        if (!container) return;

        renderMayorView(container);

        window.addEventListener('serviceMounted', (e) => {
            if (e.detail?.serviceId === 'mayor') {
                renderMayorView(container);
            }
        });
    };

    let activeMayorTab = 'market';

    async function renderMayorView(container) {
        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();

        if (!user || !userNick) return;

        if (!window.KP.isMayor(user)) {
            container.innerHTML = `
                <div style="text-align:center;padding:50px 20px;">
                    <div style="font-size:60px;margin-bottom:12px;">🚫</div>
                    <h2 style="font-family:'Unbounded',sans-serif;font-size:20px;color:var(--red);">Доступ Запрещён</h2>
                    <p style="font-size:13px;color:var(--muted);margin-top:6px;">Раздел Мэрии доступен только Главным Лицам Города (Кайон).</p>
                    <button class="btn btn-secondary" onclick="window.location.hash='#portal'" style="margin-top:16px;">Вернуться в Портал</button>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
                <h2 style="font-family:'Unbounded',sans-serif;font-size:20px;color:var(--accent);">🏛 К-Мэрия (Кайон)</h2>
                <span class="badge badge-gold">Админ Панель</span>
            </div>

            <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:16px;">
                <button class="btn ${activeMayorTab === 'market' ? 'btn-primary' : 'btn-secondary'}" style="font-size:11px;padding:6px 12px;white-space:nowrap;" onclick="switchMayorTab('market')">Модерация Маркета</button>
                <button class="btn ${activeMayorTab === 'realestate' ? 'btn-primary' : 'btn-secondary'}" style="font-size:11px;padding:6px 12px;white-space:nowrap;" onclick="switchMayorTab('realestate')">Недвижимость</button>
                <button class="btn ${activeMayorTab === 'deputy' ? 'btn-primary' : 'btn-secondary'}" style="font-size:11px;padding:6px 12px;white-space:nowrap;" onclick="switchMayorTab('deputy')">Инициативы</button>
                <button class="btn ${activeMayorTab === 'janitors' ? 'btn-primary' : 'btn-secondary'}" style="font-size:11px;padding:6px 12px;white-space:nowrap;" onclick="switchMayorTab('janitors')">Отчёты Уборщиков</button>
            </div>

            <div id="mayorTabContent">
                Загрузка данных...
            </div>
        `;

        renderMayorTabContent();
    }

    window.switchMayorTab = function(tab) {
        activeMayorTab = tab;
        renderMayorTabContent();
    };

    async function renderMayorTabContent() {
        const contentDiv = document.getElementById('mayorTabContent');
        if (!contentDiv) return;

        if (activeMayorTab === 'market') {
            const rawProducts = await window.KP_DB.dbGet('market_products') || {};
            const pendingList = Object.keys(rawProducts)
                .map(k => ({ ...rawProducts[k], id: k }))
                .filter(p => p.status === 'pending');

            if (pendingList.length === 0) {
                contentDiv.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;">Заявок на модерацию товаров нет</div>';
                return;
            }

            contentDiv.innerHTML = pendingList.map(p => `
                <div class="card" style="margin-bottom:12px;">
                    <div style="font-weight:800;font-size:15px;margin-bottom:4px;">${p.title}</div>
                    <div style="font-size:12px;color:var(--muted);">Продавец: ${p.sellerName || p.seller} | Цена: ${p.price} ₽ | Кол-во: ${p.stock} шт</div>
                    <div style="font-size:12px;color:var(--text);margin-top:6px;background:var(--surface2);padding:8px;border-radius:8px;">${p.description || 'Без описания'}</div>
                    <div style="display:flex;gap:8px;margin-top:10px;">
                        <button class="btn btn-green" style="flex:1;padding:6px;font-size:12px;" onclick="approveMarketProduct('${p.id}')">✅ Одобрить</button>
                        <button class="btn btn-red" style="flex:1;padding:6px;font-size:12px;" onclick="rejectMarketProduct('${p.id}')">❌ Отклонить</button>
                    </div>
                </div>
            `).join('');
        } else if (activeMayorTab === 'realestate') {
            const rawRE = await window.KP_DB.dbGet('real_estate') || {};
            const pendingRE = Object.keys(rawRE)
                .map(k => ({ ...rawRE[k], id: k }))
                .filter(r => r.status === 'pending');

            if (pendingRE.length === 0) {
                contentDiv.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;">Заявок на модерацию недвижимости нет</div>';
                return;
            }

            contentDiv.innerHTML = pendingRE.map(r => `
                <div class="card" style="margin-bottom:12px;">
                    <div style="font-weight:800;font-size:15px;margin-bottom:4px;">${r.title}</div>
                    <div style="font-size:12px;color:var(--muted);">Заявитель: ${r.ownerName || r.owner} | Аренда: ${r.price} ₽ | Тип: ${r.type}</div>
                    <div style="font-size:12px;color:var(--text);margin-top:6px;background:var(--surface2);padding:8px;border-radius:8px;">${r.description || 'Без описания'}</div>
                    <div style="display:flex;gap:8px;margin-top:10px;">
                        <button class="btn btn-green" style="flex:1;padding:6px;font-size:12px;" onclick="approveRealEstate('${r.id}')">✅ Одобрить</button>
                        <button class="btn btn-red" style="flex:1;padding:6px;font-size:12px;" onclick="rejectRealEstate('${r.id}')">❌ Отклонить</button>
                    </div>
                </div>
            `).join('');
        } else if (activeMayorTab === 'deputy') {
            const rawProposals = await window.KP_DB.dbGet('deputy_proposals') || {};
            const list = Object.keys(rawProposals).map(k => ({ ...rawProposals[k], id: k }));

            if (list.length === 0) {
                contentDiv.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;">Инициатив от депутатов пока нет</div>';
                return;
            }

            contentDiv.innerHTML = list.map(p => `
                <div class="card" style="margin-bottom:12px;">
                    <div style="font-weight:800;font-size:14px;margin-bottom:4px;">Депутат: ${p.authorName || p.author}</div>
                    <div style="font-size:13px;color:var(--text);background:var(--surface2);padding:8px;border-radius:8px;">${p.text}</div>
                    <div style="margin-top:6px;font-size:11px;color:var(--muted);">Статус: ${p.status || 'На рассмотрении'}</div>
                </div>
            `).join('');
        } else if (activeMayorTab === 'janitors') {
            const rawReports = await window.KP_DB.dbGet('janitor_reports') || {};
            const list = Object.keys(rawReports).map(k => ({ ...rawReports[k], id: k }));

            if (list.length === 0) {
                contentDiv.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;">Отчётов уборщиков нет</div>';
                return;
            }

            contentDiv.innerHTML = list.map(rep => `
                <div class="card" style="margin-bottom:12px;">
                    <div style="font-weight:800;font-size:14px;">Уборщик: ${rep.workerName || rep.worker}</div>
                    <div style="font-size:12px;color:var(--text);margin-top:4px;">${rep.reportText}</div>
                    <div style="font-size:10px;color:var(--muted);margin-top:4px;">${new Date(rep.createdAt || Date.now()).toLocaleString()}</div>
                </div>
            `).join('');
        }
    }

    window.approveMarketProduct = async function(id) {
        const prod = await window.KP_DB.dbGet(`market_products/${id}`);
        await window.KP_DB.dbUpdate(`market_products/${id}`, { status: 'approved' });
        if (prod) {
            await window.KP.pushNotification(prod.seller, 'К-Маркет', `Ваш товар "${prod.title}" успешно прошёл модерацию и опубликован!`);
        }
        alert("Товар одобрен!");
        renderMayorTabContent();
    };

    window.rejectMarketProduct = async function(id) {
        const prod = await window.KP_DB.dbGet(`market_products/${id}`);
        await window.KP_DB.dbUpdate(`market_products/${id}`, { status: 'rejected' });
        if (prod) {
            await window.KP.pushNotification(prod.seller, 'К-Маркет', `Ваш товар "${prod.title}" был отклонён Мэрией.`);
        }
        alert("Товар отклонён.");
        renderMayorTabContent();
    };

    window.approveRealEstate = async function(id) {
        const re = await window.KP_DB.dbGet(`real_estate/${id}`);
        await window.KP_DB.dbUpdate(`real_estate/${id}`, { status: 'approved' });
        if (re) {
            await window.KP.pushNotification(re.owner, 'К-Недвижимость', `Ваш объект "${re.title}" успешно опубликован!`);
        }
        alert("Объект недвижимости одобрен!");
        renderMayorTabContent();
    };

    window.rejectRealEstate = async function(id) {
        const re = await window.KP_DB.dbGet(`real_estate/${id}`);
        await window.KP_DB.dbUpdate(`real_estate/${id}`, { status: 'rejected' });
        if (re) {
            await window.KP.pushNotification(re.owner, 'К-Недвижимость', `Ваш объект "${re.title}" был отклонён Мэрией.`);
        }
        alert("Объект недвижимости отклонён.");
        renderMayorTabContent();
    };
})();
