(function() {
    window.initKsbService = function() {
        const container = document.getElementById('service_ksb');
        if (!container) return;

        renderKsbView(container);

        window.addEventListener('serviceMounted', (e) => {
            if (e.detail?.serviceId === 'ksb') {
                renderKsbView(container);
            }
        });
    };

    async function renderKsbView(container) {
        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();

        if (!user || !userNick) return;

        const isOfficer = user.job === 'police' || user.job === 'ksb' || window.KP.isMayor(user);

        container.innerHTML = `
            <div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
                <h2 style="font-family:'Unbounded',sans-serif;font-size:20px;color:var(--red);">🛡 Капанёвская Служба Безопасности</h2>
                <button class="btn btn-red" style="padding:6px 12px;font-size:12px;" onclick="openEmergencyCallModal()">🚨 Вызов Полиии/КСБ</button>
            </div>

            ${isOfficer ? renderOfficerPanel() : `
                <div class="card" style="text-align:center;padding:30px 16px;">
                    <div style="font-size:40px;margin-bottom:12px;">🛡</div>
                    <div style="font-family:'Unbounded',sans-serif;font-size:16px;font-weight:800;margin-bottom:6px;">Служба Правопорядка Капаней</div>
                    <div style="font-size:12px;color:var(--muted);max-width:320px;margin:0 auto 16px;">
                        В случае экстренной ситуации или правонарушения нажмите кнопку «Вызов Полиии/КСБ» для отправки сигнала правоохранителям.
                    </div>
                </div>
            `}
        `;

        if (isOfficer) {
            initOfficerTabLogic();
        }
    }

    function renderOfficerPanel() {
        return `
            <div style="margin-bottom:16px;background:var(--surface2);padding:4px;border-radius:12px;display:flex;gap:4px;">
                <button class="btn btn-primary" style="flex:1;padding:6px;font-size:11px;" onclick="switchKsbTab('search')">🔍 База Граждан</button>
                <button class="btn btn-secondary" style="flex:1;padding:6px;font-size:11px;" onclick="switchKsbTab('calls')">🚨 Поступившие Вызовы</button>
            </div>

            <div id="ksbOfficerContent">
                <div class="card">
                    <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Поиск жителя (Имя/Ник)</label>
                    <input type="text" id="ksbUserSearchInput" placeholder="Введите имя жителя...">
                    <button class="btn btn-primary" onclick="searchCitizenKsb()" style="width:100%;margin-top:6px;">Найти в базе</button>
                </div>
                <div id="ksbSearchResult" style="margin-top:12px;"></div>
            </div>
        `;
    }

    window.switchKsbTab = async function(tab) {
        const content = document.getElementById('ksbOfficerContent');
        if (!content) return;

        if (tab === 'search') {
            content.innerHTML = `
                <div class="card">
                    <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Поиск жителя (Имя/Ник)</label>
                    <input type="text" id="ksbUserSearchInput" placeholder="Введите имя жителя...">
                    <button class="btn btn-primary" onclick="searchCitizenKsb()" style="width:100%;margin-top:6px;">Найти в базе</button>
                </div>
                <div id="ksbSearchResult" style="margin-top:12px;"></div>
            `;
        } else if (tab === 'calls') {
            const rawCalls = await window.KP_DB.dbGet('emergency_calls') || {};
            const calls = Object.keys(rawCalls).map(k => ({ ...rawCalls[k], id: k })).filter(c => c.status === 'active');

            if (calls.length === 0) {
                content.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;">Активных вызовов нет</div>';
                return;
            }

            content.innerHTML = calls.map(c => `
                <div class="card" style="margin-bottom:12px;">
                    <div style="font-weight:800;color:var(--red);">🚨 Вызов от: ${c.callerName || c.caller}</div>
                    <div style="font-size:13px;color:var(--text);margin:6px 0;background:var(--surface2);padding:8px;border-radius:8px;">${c.reason}</div>
                    <button class="btn btn-green" style="width:100%;padding:6px;font-size:12px;" onclick="closeKsbCall('${c.id}')">✅ Закрыть вызов / Выехать</button>
                </div>
            `).join('');
        }
    };

    window.searchCitizenKsb = async function() {
        const query = document.getElementById('ksbUserSearchInput').value.trim().toLowerCase();
        if (!query) return;

        const allUsers = await window.KP_DB.dbGet('users') || {};
        const foundKey = Object.keys(allUsers).find(k => k.toLowerCase().includes(query) || (allUsers[k].name && allUsers[k].name.toLowerCase().includes(query)));

        const resDiv = document.getElementById('ksbSearchResult');
        if (!foundKey) {
            resDiv.innerHTML = '<div style="text-align:center;color:var(--muted);padding:12px;">Гражданин не найден</div>';
            return;
        }

        const citizen = allUsers[foundKey];
        const licenses = citizen.licenses || {};

        resDiv.innerHTML = `
            <div class="card">
                <div style="font-weight:800;font-size:16px;">👤 ${window.KP.displayNick(citizen)} (${foundKey})</div>
                <div style="font-size:12px;color:var(--muted);margin-top:4px;">Баллы экзамена: ${citizen.examPoints || citizen.kve || 0} | Работа: ${citizen.job || 'Нет'}</div>

                <div style="margin:12px 0;background:var(--surface2);padding:10px;border-radius:10px;font-size:12px;">
                    <div><b>Права:</b></div>
                    <div>🛵 Скутер: ${licenses.scooter ? '✅ Есть' : '❌ Отсутствуют'}</div>
                    <div>🚗 Автомобиль: ${licenses.car ? '✅ Есть' : '❌ Отсутствуют'}</div>
                </div>

                <div style="display:flex;gap:8px;margin-bottom:8px;">
                    <button class="btn btn-green" style="flex:1;font-size:11px;padding:6px;" onclick="grantLicenseKsb('${foundKey}', 'scooter')">Выдать права на скутер</button>
                    <button class="btn btn-red" style="flex:1;font-size:11px;padding:6px;" onclick="revokeLicenseKsb('${foundKey}', 'scooter')">Изъять права</button>
                </div>

                <button class="btn btn-red" style="width:100%;font-size:12px;" onclick="issueFineKsb('${foundKey}')">⚠️ Выписать штраф</button>
            </div>
        `;
    };

    window.grantLicenseKsb = async function(nick, type) {
        await window.KP_DB.dbUpdate(`users/${nick}/licenses`, { [type]: true });
        await window.KP.pushNotification(nick, 'КСБ / Полиция', `Вам выданы права на ${type}!`);
        alert("Права успешно выданы!");
        searchCitizenKsb();
    };

    window.revokeLicenseKsb = async function(nick, type) {
        await window.KP_DB.dbUpdate(`users/${nick}/licenses`, { [type]: false });
        await window.KP.pushNotification(nick, 'КСБ / Полиция', `Ваши права на ${type} были изъяты.`);
        alert("Права изъяты.");
        searchCitizenKsb();
    };

    window.issueFineKsb = async function(nick) {
        const sumStr = prompt("Сумма штрафа (₽):");
        if (!sumStr) return;
        const sum = Number(sumStr);
        const reason = prompt("Причина штрафа:") || "Нарушение порядка";

        const citizen = await window.KP_DB.dbGet(`users/${nick}`);
        if (citizen) {
            await window.KP_DB.dbUpdate(`users/${nick}`, { balance: (citizen.balance || 0) - sum });
            await window.KP.pushNotification(nick, 'Штраф от КСБ/Полиции', `Вам выписан штраф ${sum} ₽. Причина: ${reason}`);
            alert(`Штраф ${sum} ₽ выписан пользователю!`);
        }
    };

    window.openEmergencyCallModal = function() {
        const reason = prompt("Опишите причину вызова полиции/КСБ:");
        if (!reason) return;

        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();

        window.KP_DB.dbPush('emergency_calls', {
            caller: userNick,
            callerName: window.KP.displayNick(user),
            reason,
            status: 'active',
            createdAt: Date.now()
        });

        alert("🚨 Сигнал бедствия передан на пульт дежурного КСБ!");
    };

    window.closeKsbCall = async function(id) {
        await window.KP_DB.dbUpdate(`emergency_calls/${id}`, { status: 'closed' });
        alert("Вызов принят и закрыт.");
        switchKsbTab('calls');
    };
})();
