import { getCurrentUser, displayNick, isMayor } from "../auth.js";
import { navigateTo, getServicesList } from "../launcher.js";

export function initPortalService() {
    const container = document.getElementById('service_portal');
    if (!container) return;

    renderPortal(container);

    window.addEventListener('serviceMounted', (e) => {
        if (e.detail?.serviceId === 'portal') {
            renderPortal(container);
        }
    });
}

function renderPortal(container) {
    const user = getCurrentUser();
    if (!user) return;

    const services = getServicesList().filter(s => !s.mayorOnly || isMayor(user));

    container.innerHTML = `
        <div class="portal-hero">
            <div class="portal-title">Привет, ${displayNick(user)}! 👋</div>
            <div class="portal-subtitle">Добро пожаловать в единую цифровую экосистему Капаней. Выбирайте нужный сервис ниже.</div>

            <div style="display:flex;gap:12px;margin-top:16px;background:rgba(0,0,0,0.25);padding:12px;border-radius:16px;border:1px solid var(--border);">
                <div style="flex:1;">
                    <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:800;">Баланс</div>
                    <div style="font-size:16px;font-weight:900;color:var(--primary);">${(user.balance || 0).toLocaleString()} ₽</div>
                </div>
                <div style="flex:1;border-left:1px solid var(--border);padding-left:12px;">
                    <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:800;">Профессия</div>
                    <div style="font-size:13px;font-weight:800;color:var(--text);">${user.job || 'Гражданин'}</div>
                </div>
                <div style="flex:1;border-left:1px solid var(--border);padding-left:12px;">
                    <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:800;">КВЭ</div>
                    <div style="font-size:13px;font-weight:800;color:var(--gold);">${user.examScore || 0} баллов</div>
                </div>
            </div>
        </div>

        <div class="portal-section-title">
            <span>🚀 Сервисы Экосистемы</span>
        </div>

        <div class="portal-grid">
            ${services.map(s => `
                <div class="portal-card" onclick="window.location.hash='#${s.id}'">
                    ${s.id === 'mayor' ? '<div class="portal-card-badge">Мэрия</div>' : ''}
                    <div class="portal-card-icon">${s.icon}</div>
                    <div class="portal-card-name">${s.name}</div>
                    <div class="portal-card-desc">${s.desc}</div>
                </div>
            `).join('')}
        </div>
    `;
}
