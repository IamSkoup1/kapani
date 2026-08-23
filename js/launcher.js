import { getCurrentUser, displayNick, logoutUser, isMayor } from "./auth.js";
import { getNotifications, markNotificationAsRead, markAllNotificationsAsRead } from "./notifications.js";

const SERVICES = [
    { id: 'portal', name: 'Капани', icon: '🏛', desc: 'Главный портал' },
    { id: 'messenger', name: 'Мессенджер', icon: '💬', desc: 'Чаты и каналы' },
    { id: 'bank', name: 'К-Банк', icon: '💳', desc: 'Переводы и финансы' },
    { id: 'businesses', name: 'Бизнесы', icon: '🏢', desc: 'Предприятия Капаней' },
    { id: 'market', name: 'К-Маркет', icon: '🛒', desc: 'Маркетплейс' },
    { id: 'avito', name: 'К-Авито', icon: '🏷', desc: 'Объявления' },
    { id: 'taxi', name: 'К-Такси', icon: '🚕', desc: 'Такси и поездки' },
    { id: 'ksb', name: 'КСБ и Полиция', icon: '🛡', desc: 'Служба безопасности' },
    { id: 'jobs', name: 'Работа', icon: '💼', desc: 'Вакансии и карьеры' },
    { id: 'news', name: 'К-Новости', icon: '📰', desc: 'Новости и статьи' },
    { id: 'realestate', name: 'Недвижимость', icon: '🏠', desc: 'Аренда и здания' },
    { id: 'mayor', name: 'К-Мэрия', icon: '👑', desc: 'Управление Капанями', mayorOnly: true }
];

let currentService = 'portal';

export function getServicesList() {
    return SERVICES;
}

export function navigateTo(serviceId) {
    if (!SERVICES.some(s => s.id === serviceId)) {
        serviceId = 'portal';
    }

    const user = getCurrentUser();
    if (serviceId === 'mayor' && (!user || !isMayor(user))) {
        alert("Доступ к К-Мэрии разрешён только Мэру (Кайон)");
        window.location.hash = '#portal';
        return;
    }

    currentService = serviceId;
    window.location.hash = `#${serviceId}`;
    renderActiveServiceView();
    updateNavigationUI();
}

export function initLauncher() {
    window.addEventListener('hashchange', () => {
        const hash = window.location.hash.replace('#', '');
        if (hash) {
            navigateTo(hash);
        } else {
            navigateTo('portal');
        }
    });

    const initialHash = window.location.hash.replace('#', '');
    if (initialHash) {
        navigateTo(initialHash);
    } else {
        navigateTo('portal');
    }

    renderGlobalHeader();
    renderBottomLauncher();
}

export function renderActiveServiceView() {
    const user = getCurrentUser();
    const authSec = document.getElementById('authSection');
    const appSec = document.getElementById('mainApp');

    if (!user) {
        if (authSec) authSec.style.display = 'block';
        if (appSec) appSec.style.display = 'none';
        return;
    }

    if (authSec) authSec.style.display = 'none';
    if (appSec) appSec.style.display = 'block';

    SERVICES.forEach(s => {
        const el = document.getElementById(`service_${s.id}`);
        if (el) {
            el.style.display = (s.id === currentService) ? 'block' : 'none';
        }
    });

    const mountEvent = new CustomEvent('serviceMounted', { detail: { serviceId: currentService } });
    window.dispatchEvent(mountEvent);
}

export function renderGlobalHeader() {
    const header = document.getElementById('gHeader');
    if (!header) return;

    const user = getCurrentUser();
    if (!user) {
        header.style.display = 'none';
        return;
    }

    header.style.display = 'flex';
    const displayName = displayNick(user);
    const balance = user.balance || 0;
    const avatar = user.avatar || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    const job = user.job || 'Гражданин';

    header.innerHTML = `
        <div class="h-left" onclick="window.location.hash='#portal'">
            <div class="avatar-wrap">
                <img class="h-avatar" src="${avatar}" alt="Аватар">
                <div class="online-dot"></div>
            </div>
            <div>
                <div class="h-name">${displayName}</div>
                <div class="h-job">${job}</div>
            </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
            <div class="h-bal" onclick="window.location.hash='#bank'">${balance.toLocaleString()} ₽</div>
            <div class="h-notify" onclick="toggleNotificationsModal()">
                🔔
                <span class="h-badge" id="globalNotifyBadge" style="display:none;">0</span>
            </div>
            <button class="btn btn-ghost" onclick="toggleUserMenuModal()" style="padding:6px 10px;font-size:16px;">⚙️</button>
        </div>
    `;
}

export function renderBottomLauncher() {
    const nav = document.getElementById('bottomNav');
    if (!nav) return;

    const user = getCurrentUser();
    if (!user) {
        nav.style.display = 'none';
        return;
    }

    nav.style.display = 'flex';

    nav.innerHTML = `
        <button class="bn-item ${currentService === 'portal' ? 'active' : ''}" onclick="window.location.hash='#portal'">
            <span class="ico">🏛</span>
            <span>Капани</span>
        </button>
        <button class="bn-item ${currentService === 'messenger' ? 'active' : ''}" onclick="window.location.hash='#messenger'">
            <span class="ico">💬</span>
            <span>Чаты</span>
        </button>
        <button class="bn-item ${currentService === 'bank' ? 'active' : ''}" onclick="window.location.hash='#bank'">
            <span class="ico">💳</span>
            <span>Банк</span>
        </button>
        <button class="bn-item ${currentService === 'market' ? 'active' : ''}" onclick="window.location.hash='#market'">
            <span class="ico">🛒</span>
            <span>Маркет</span>
        </button>
        <button class="bn-item" onclick="toggleEcosystemMenu()">
            <span class="ico">🚀</span>
            <span>Сервисы</span>
        </button>
    `;
}

export function updateNavigationUI() {
    renderGlobalHeader();
    renderBottomLauncher();
}

window.toggleEcosystemMenu = function() {
    let modal = document.getElementById('ecosystemMenuModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'ecosystemMenuModal';
        modal.className = 'modal-backdrop';
        document.body.appendChild(modal);
    }

    const user = getCurrentUser();
    const list = SERVICES.filter(s => !s.mayorOnly || (user && isMayor(user)));

    modal.innerHTML = `
        <div class="modal-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 style="font-family:'Unbounded',sans-serif;font-size:18px;">🌐 Экосистема Капаней</h3>
                <span style="font-size:22px;cursor:pointer;color:var(--muted);" onclick="closeEcosystemMenu()">✕</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:10px;max-height:65vh;overflow-y:auto;padding-right:4px;">
                ${list.map(s => `
                    <div class="eco-service-card" onclick="navigateTo('${s.id}');closeEcosystemMenu();">
                        <div style="font-size:26px;margin-bottom:4px;">${s.icon}</div>
                        <div style="font-weight:800;font-size:13px;color:var(--text);">${s.name}</div>
                        <div style="font-size:10px;color:var(--muted);">${s.desc}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    modal.style.display = 'flex';
};

window.closeEcosystemMenu = function() {
    const modal = document.getElementById('ecosystemMenuModal');
    if (modal) modal.style.display = 'none';
};

window.toggleNotificationsModal = function() {
    let modal = document.getElementById('globalNotificationsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'globalNotificationsModal';
        modal.className = 'modal-backdrop';
        document.body.appendChild(modal);
    }

    const list = getNotifications();

    modal.innerHTML = `
        <div class="modal-card" style="max-width:440px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 style="font-family:'Unbounded',sans-serif;font-size:18px;">🔔 Уведомления</h3>
                <span style="font-size:22px;cursor:pointer;color:var(--muted);" onclick="closeNotificationsModal()">✕</span>
            </div>
            <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
                <button class="btn btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="window._markAllRead()">Прочитать всё</button>
            </div>
            <div style="max-height:55vh;overflow-y:auto;" id="notifModalList">
                ${list.length === 0 ? '<div style="text-align:center;color:var(--muted);padding:20px;">Нет уведомлений</div>' :
                    list.map(n => `
                        <div class="notif-item ${n.read ? '' : 'unread'}" onclick="window._clickNotif('${n.id}', '${n.actionUrl}')">
                            <div style="font-size:13px;color:var(--text);font-weight:600;">${n.text}</div>
                            <div style="font-size:10px;color:var(--muted);margin-top:4px;">${n.date} в ${n.time}</div>
                        </div>
                    `).join('')}
            </div>
        </div>
    `;

    modal.style.display = 'flex';
};

window._markAllRead = async function() {
    await markAllNotificationsAsRead();
    window.toggleNotificationsModal();
};

window._clickNotif = async function(id, url) {
    await markNotificationAsRead(id);
    closeNotificationsModal();
    if (url) {
        window.location.hash = url;
    }
};

window.closeNotificationsModal = function() {
    const modal = document.getElementById('globalNotificationsModal');
    if (modal) modal.style.display = 'none';
};

window.toggleUserMenuModal = function() {
    let modal = document.getElementById('userProfileMenuModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'userProfileMenuModal';
        modal.className = 'modal-backdrop';
        document.body.appendChild(modal);
    }

    const user = getCurrentUser();
    if (!user) return;

    modal.innerHTML = `
        <div class="modal-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 style="font-family:'Unbounded',sans-serif;font-size:18px;">👤 Профиль гражданина</h3>
                <span style="font-size:22px;cursor:pointer;color:var(--muted);" onclick="closeUserMenuModal()">✕</span>
            </div>
            <div style="text-align:center;margin-bottom:16px;">
                <img src="${user.avatar || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'}" style="width:70px;height:70px;border-radius:20px;border:2px solid var(--primary);object-fit:cover;">
                <div style="font-size:18px;font-weight:800;margin-top:8px;">${displayNick(user)}</div>
                <div style="font-size:12px;color:var(--primary);font-weight:700;">${user.job || 'Гражданин'}</div>
            </div>
            <div style="background:var(--surface2);padding:12px;border-radius:14px;margin-bottom:16px;font-size:13px;line-height:1.6;">
                <div>💰 Баланс: <b>${(user.balance || 0).toLocaleString()} ₽</b></div>
                <div>📊 КВЭ / Экзамены: <b>${user.examScore || 0} баллов</b></div>
                <div>🛵 Права на скутер: <b>${user.driversLicense ? 'Есть ✅' : 'Отсутствуют ❌'}</b></div>
            </div>
            <button class="btn btn-red" onclick="window._logoutApp()" style="width:100%;">🚪 Выйти из аккаунта</button>
        </div>
    `;

    modal.style.display = 'flex';
};

window.closeUserMenuModal = function() {
    const modal = document.getElementById('userProfileMenuModal');
    if (modal) modal.style.display = 'none';
};

window._logoutApp = function() {
    logoutUser();
};
