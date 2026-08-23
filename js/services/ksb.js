import { getCurrentUser, getCurrentNick, displayNick } from "../auth.js";
import { dbGet, dbSet, dbPush, dbUpdate } from "../firebase.js";
import { pushNotification } from "../notifications.js";

export function initKsbService() {
    const container = document.getElementById('service_ksb');
    if (!container) return;

    renderKsbView(container);

    window.addEventListener('serviceMounted', (e) => {
        if (e.detail?.serviceId === 'ksb') {
            renderKsbView(container);
        }
    });
}

async function renderKsbView(container) {
    const user = getCurrentUser();
    const userNick = getCurrentNick();
    if (!user || !userNick) return;

    const examScore = user.examScore || 0;
    const isPolice = examScore >= 80 || user.job === 'Полицейский';
    const isKsb = examScore >= 90 || user.job === 'КСБ';
    const hasOfficerAccess = isPolice || isKsb;

    container.innerHTML = `
        <div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
            <h2 style="font-family:'Unbounded',sans-serif;font-size:20px;">🛡 КСБ и Полиция</h2>
        </div>

        <div class="ksb-panel">
            <div style="font-size:11px;color:var(--blue);font-weight:800;text-transform:uppercase;">Капанёвская Служба Безопасности</div>
            <div style="font-size:18px;font-weight:900;margin:4px 0;">Правопорядок Капаней</div>
            <div style="font-size:12px;color:var(--muted);margin-bottom:16px;">Каждый гражданин может оперативно вызвать полицию при происшествии.</div>

            <button class="btn btn-red" style="width:100%;" onclick="openPoliceCallModal()">🚨 Вызвать полицию</button>
        </div>

        ${hasOfficerAccess ? `
            <div style="font-family:'Unbounded',sans-serif;font-size:16px;margin-bottom:12px;color:var(--blue);">🔒 Защищённая Панель Сотрудника (${isKsb ? 'КСБ' : 'Полиция'})</div>

            <div class="ksb-card">
                <div style="font-weight:800;font-size:14px;margin-bottom:8px;">🔍 Поиск Гражданина в Реестре</div>
                <input type="text" id="ksbCitizenSearchInput" placeholder="Введите имя или ник..." oninput="searchKsbCitizen(this.value)">
                <div id="ksbSearchResultArea" style="margin-top:10px;"></div>
            </div>

            <div class="ksb-card">
                <div style="font-weight:800;font-size:14px;margin-bottom:8px;">📢 Активные вызовы полиции</div>
                <div id="ksbPoliceCallsArea">Загрузка вызовов…</div>
            </div>
        ` : ''}
    `;

    if (hasOfficerAccess) {
        loadPoliceCalls();
    }
}

window.openPoliceCallModal = function() {
    const address = prompt("Укажите место происшествия / адрес:");
    const reason = prompt("Опишите причину вызова:");
    if (address && reason) {
        const user = getCurrentUser();
        const userNick = getCurrentNick();

        dbPush('police_calls', {
            caller: userNick,
            callerName: displayNick(user),
            address,
            reason,
            status: 'active',
            createdAt: Date.now()
        }).then(() => alert("🚨 Вызов полиции отправлен! Патруль оповещён."));
    }
};

async function loadPoliceCalls() {
    const callsArea = document.getElementById('ksbPoliceCallsArea');
    if (!callsArea) return;

    const callsObj = await dbGet('police_calls') || {};
    const calls = Object.keys(callsObj)
        .map(k => ({ ...callsObj[k], id: k }))
        .filter(c => c.status === 'active');

    if (calls.length === 0) {
        callsArea.innerHTML = '<div style="font-size:12px;color:var(--muted);">Активных вызовов нет</div>';
        return;
    }

    callsArea.innerHTML = calls.map(c => `
        <div style="background:var(--surface2);padding:10px;border-radius:12px;margin-bottom:8px;">
            <div style="font-weight:800;font-size:13px;color:var(--red);">📍 ${c.address}</div>
            <div style="font-size:12px;margin:2px 0;">Причина: ${c.reason}</div>
            <div style="font-size:10px;color:var(--muted);">Заявитель: ${c.callerName}</div>
            <button class="btn btn-primary" style="padding:4px 10px;font-size:11px;margin-top:6px;" onclick="closePoliceCall('${c.id}')">Завершить вызов</button>
        </div>
    `).join('');
}

window.closePoliceCall = async function(callId) {
    await dbUpdate(`police_calls/${callId}`, { status: 'closed' });
    alert("Вызов закрыт!");
    loadPoliceCalls();
};

window.searchKsbCitizen = async function(query) {
    const resArea = document.getElementById('ksbSearchResultArea');
    if (!resArea || !query.trim()) {
        if (resArea) resArea.innerHTML = '';
        return;
    }

    const allUsers = await dbGet('users') || {};
    const q = query.toLowerCase();

    const matches = Object.keys(allUsers).filter(key => {
        const u = allUsers[key];
        return key.toLowerCase().includes(q) || (u.displayName && u.displayName.toLowerCase().includes(q));
    });

    if (matches.length === 0) {
        resArea.innerHTML = '<div style="font-size:12px;color:var(--muted);">Гражданин не найден</div>';
        return;
    }

    resArea.innerHTML = matches.map(key => {
        const u = allUsers[key];
        return `
            <div style="background:var(--surface2);padding:10px;border-radius:12px;margin-bottom:8px;">
                <div style="font-weight:800;font-size:14px;">${displayNick(u)} (${key})</div>
                <div style="font-size:11px;color:var(--muted);margin:4px 0;">
                    Профессия: <b>${u.job || 'Гражданин'}</b> | Права: <b>${u.driversLicense ? 'Есть ✅' : 'Нет ❌'}</b> | Штрафы: <b>${u.fine || 0} ₽</b>
                </div>
                <div style="display:flex;gap:6px;margin-top:8px;">
                    <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" onclick="toggleKsbDriversLicense('${key}', ${!u.driversLicense})">
                        ${u.driversLicense ? '🚫 Изъять права' : '📜 Выдать права'}
                    </button>
                    <button class="btn btn-red" style="padding:4px 8px;font-size:11px;" onclick="issueKsbFineModal('${key}')">⚠️ Выписать штраф</button>
                </div>
            </div>
        `;
    }).join('');
};

window.toggleKsbDriversLicense = async function(userNick, newState) {
    await dbUpdate(`users/${userNick}`, { driversLicense: newState });
    alert(`Статус прав гражданина обновлён: ${newState ? 'Выданы ✅' : 'Изъяты ❌'}`);
    searchKsbCitizen(document.getElementById('ksbCitizenSearchInput').value);
};

window.issueKsbFineModal = async function(userNick) {
    const amount = prompt("Введите сумму штрафа (₽):");
    const reason = prompt("Укажите причину штрафа:");
    if (amount && reason) {
        const targetUser = await dbGet(`users/${userNick}`);
        if (targetUser) {
            const numAmt = Number(amount);
            const newFine = (targetUser.fine || 0) + numAmt;
            const newBal = (targetUser.balance || 0) - numAmt;

            await dbUpdate(`users/${userNick}`, {
                fine: newFine,
                balance: newBal
            });

            await pushNotification(userNick, `⚠️ Вам выписан штраф ${numAmt} ₽: ${reason}`, 'police', '#bank');
            alert("Штраф выписан и зафиксирован!");
            searchKsbCitizen(document.getElementById('ksbCitizenSearchInput').value);
        }
    }
};
