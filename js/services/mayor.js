import { getCurrentUser, displayNick, isMayor } from "../auth.js";
import { dbGet, dbUpdate, dbRemove } from "../firebase.js";
import { pushNotification } from "../notifications.js";

export function initMayorService() {
    const container = document.getElementById('service_mayor');
    if (!container) return;

    renderMayorView(container);

    window.addEventListener('serviceMounted', (e) => {
        if (e.detail?.serviceId === 'mayor') {
            renderMayorView(container);
        }
    });
}

async function renderMayorView(container) {
    const user = getCurrentUser();
    if (!user || !isMayor(user)) {
        container.innerHTML = `
            <div style="text-align:center;padding:40px;color:var(--red);">
                <h2>⛔ Доступ запрещён</h2>
                <p>К-Мэрия доступна исключительно Мэру Города (Кайон).</p>
            </div>
        `;
        return;
    }

    const marketObj = await dbGet('market') || {};
    const pendingMarket = Object.keys(marketObj).map(k => ({ ...marketObj[k], id: k })).filter(m => m.status === 'pending_moderation');

    const newsObj = await dbGet('news_articles') || {};
    const pendingNews = Object.keys(newsObj).map(k => ({ ...newsObj[k], id: k })).filter(n => n.status === 'pending_moderation');

    const reObj = await dbGet('real_estate') || {};
    const pendingRe = Object.keys(reObj).map(k => ({ ...reObj[k], id: k })).filter(r => r.status === 'pending_moderation');

    const proposalsObj = await dbGet('deputy_proposals') || {};
    const proposals = Object.keys(proposalsObj).map(k => ({ ...proposalsObj[k], id: k })).filter(p => p.status === 'pending');

    container.innerHTML = `
        <div class="mayor-panel">
            <div style="font-size:11px;color:var(--gold);font-weight:900;text-transform:uppercase;letter-spacing:1px;">Государственный Кабинет Мэра</div>
            <div style="font-family:'Unbounded',sans-serif;font-size:22px;font-weight:900;margin:6px 0;">👑 К-Мэрия Капаней</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.8);">Приветствуем, Мэр ${displayNick(user)}! Здесь сосредоточено управление всеми сервисами и государственными вопросами города.</div>
        </div>

        <div class="mayor-section">
            <div style="font-weight:800;font-size:16px;margin-bottom:10px;">🛒 Модерация К-Маркета (${pendingMarket.length})</div>
            ${pendingMarket.length === 0 ? '<div style="font-size:12px;color:var(--muted);">Нет товаров на модерации</div>' :
                pendingMarket.map(m => `
                    <div style="background:var(--surface2);padding:10px;border-radius:12px;margin-bottom:8px;">
                        <div style="font-weight:800;">${m.title}</div>
                        <div style="font-size:11px;color:var(--muted);">Продавец: ${m.sellerName} | Цена: ${m.price} ₽ | Кол-во: ${m.quantity} шт</div>
                        <div style="display:flex;gap:6px;margin-top:6px;">
                            <button class="btn btn-primary" style="padding:4px 10px;font-size:11px;" onclick="approveMarketListing('${m.id}')">✅ Одобрить</button>
                            <button class="btn btn-red" style="padding:4px 10px;font-size:11px;" onclick="rejectMarketListing('${m.id}')">❌ Отклонить</button>
                        </div>
                    </div>
                `).join('')
            }
        </div>

        <div class="mayor-section">
            <div style="font-weight:800;font-size:16px;margin-bottom:10px;">📰 Модерация К-Новостей (${pendingNews.length})</div>
            ${pendingNews.length === 0 ? '<div style="font-size:12px;color:var(--muted);">Нет новостей на модерации</div>' :
                pendingNews.map(n => `
                    <div style="background:var(--surface2);padding:10px;border-radius:12px;margin-bottom:8px;">
                        <div style="font-weight:800;">${n.title}</div>
                        <div style="font-size:11px;color:var(--muted);">Автор: ${n.authorName}</div>
                        <div style="font-size:12px;margin:4px 0;">${n.text}</div>
                        <div style="display:flex;gap:6px;margin-top:6px;">
                            <button class="btn btn-primary" style="padding:4px 10px;font-size:11px;" onclick="approveNewsArticle('${n.id}')">✅ Одобрить и опубликовать</button>
                            <button class="btn btn-red" style="padding:4px 10px;font-size:11px;" onclick="rejectNewsArticle('${n.id}')">❌ Отклонить</button>
                        </div>
                    </div>
                `).join('')
            }
        </div>

        <div class="mayor-section">
            <div style="font-weight:800;font-size:16px;margin-bottom:10px;">🏠 Модерация Недвижимости (${pendingRe.length})</div>
            ${pendingRe.length === 0 ? '<div style="font-size:12px;color:var(--muted);">Нет объектов на модерации</div>' :
                pendingRe.map(r => `
                    <div style="background:var(--surface2);padding:10px;border-radius:12px;margin-bottom:8px;">
                        <div style="font-weight:800;">${r.title}</div>
                        <div style="font-size:11px;color:var(--muted);">Адрес: ${r.address} | Аренда: ${r.rentPrice} ₽/мес</div>
                        <div style="display:flex;gap:6px;margin-top:6px;">
                            <button class="btn btn-primary" style="padding:4px 10px;font-size:11px;" onclick="approveRealEstate('${r.id}')">✅ Одобрить</button>
                            <button class="btn btn-red" style="padding:4px 10px;font-size:11px;" onclick="rejectRealEstate('${r.id}')">❌ Отклонить</button>
                        </div>
                    </div>
                `).join('')
            }
        </div>

        <div class="mayor-section">
            <div style="font-weight:800;font-size:16px;margin-bottom:10px;">🏛 Предложения Депутатов (${proposals.length})</div>
            ${proposals.length === 0 ? '<div style="font-size:12px;color:var(--muted);">Нет новых предложений</div>' :
                proposals.map(p => `
                    <div style="background:var(--surface2);padding:10px;border-radius:12px;margin-bottom:8px;">
                        <div style="font-weight:800;">Депутат: ${p.deputyName}</div>
                        <div style="font-size:12px;margin:4px 0;">${p.text}</div>
                        <button class="btn btn-primary" style="padding:4px 10px;font-size:11px;margin-top:6px;" onclick="answerDeputyProposal('${p.id}', '${p.deputy}')">Принять и ответить</button>
                    </div>
                `).join('')
            }
        </div>

        <div class="mayor-section">
            <div style="font-weight:800;font-size:16px;margin-bottom:10px;">💸 Выдача Субсидий / Начисление Средств</div>
            <button class="btn btn-gold" style="width:100%;" onclick="openGrantModal()">💰 Выдать грант гражданину</button>
        </div>
    `;
}

window.approveMarketListing = async function(id) {
    const item = await dbGet(`market/${id}`);
    await dbUpdate(`market/${id}`, { status: 'approved' });
    if (item) {
        await pushNotification(item.seller, `✅ Ваш товар «${item.title}» одобрен Мэрией и опубликован в К-Маркете!`, 'market', '#market');
    }
    alert("Товар одобрен!");
    renderMayorView(document.getElementById('service_mayor'));
};

window.rejectMarketListing = async function(id) {
    await dbUpdate(`market/${id}`, { status: 'rejected' });
    alert("Товар отклонён!");
    renderMayorView(document.getElementById('service_mayor'));
};

window.approveNewsArticle = async function(id) {
    const article = await dbGet(`news_articles/${id}`);
    await dbUpdate(`news_articles/${id}`, { status: 'published' });
    if (article) {
        await pushNotification(article.author, `🎉 Ваша статья «${article.title}» опубликована в К-Новостях!`, 'news', '#news');
    }
    alert("Статья опубликована!");
    renderMayorView(document.getElementById('service_mayor'));
};

window.rejectNewsArticle = async function(id) {
    await dbUpdate(`news_articles/${id}`, { status: 'rejected' });
    alert("Статья отклонена.");
    renderMayorView(document.getElementById('service_mayor'));
};

window.approveRealEstate = async function(id) {
    const prop = await dbGet(`real_estate/${id}`);
    await dbUpdate(`real_estate/${id}`, { status: 'approved' });
    if (prop) {
        await pushNotification(prop.owner, `✅ Ваш объект «${prop.title}» одобрен Мэрией!`, 'realestate', '#realestate');
    }
    alert("Объект недвижимости одобрен!");
    renderMayorView(document.getElementById('service_mayor'));
};

window.rejectRealEstate = async function(id) {
    await dbUpdate(`real_estate/${id}`, { status: 'rejected' });
    alert("Объект отклонён.");
    renderMayorView(document.getElementById('service_mayor'));
};

window.answerDeputyProposal = async function(id, deputyNick) {
    const reply = prompt("Введите ответ депутату:");
    if (reply) {
        await dbUpdate(`deputy_proposals/${id}`, { status: 'answered', reply });
        await pushNotification(deputyNick, `🏛 Мэр ответил на вашу инициативу: ${reply}`, 'jobs', '#jobs');
        alert("Ответ отправлен депутату!");
        renderMayorView(document.getElementById('service_mayor'));
    }
};

window.openGrantModal = async function() {
    const targetNick = prompt("Введите ник гражданина:");
    const amt = prompt("Сумма выплата/гранта (₽):");
    const desc = prompt("Назначение выплаты:");

    if (targetNick && amt) {
        const u = await dbGet(`users/${targetNick}`);
        if (u) {
            const num = Number(amt);
            await dbUpdate(`users/${targetNick}`, { balance: (u.balance || 0) + num });
            await pushNotification(targetNick, `🏛 Вам начислена государственная субсидия ${num} ₽: ${desc || 'Грант Мэрии'}`, 'finance', '#bank');
            alert(`Субсидия ${num} ₽ зачислена гражданину ${targetNick}!`);
        } else {
            alert("Гражданин не найден.");
        }
    }
};
