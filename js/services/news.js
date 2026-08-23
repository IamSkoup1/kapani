import { getCurrentUser, getCurrentNick, displayNick } from "../auth.js";
import { dbGet, dbSet, dbPush } from "../firebase.js";

export function initNewsService() {
    const container = document.getElementById('service_news');
    if (!container) return;

    renderNewsView(container);

    window.addEventListener('serviceMounted', (e) => {
        if (e.detail?.serviceId === 'news') {
            renderNewsView(container);
        }
    });
}

async function renderNewsView(container) {
    const user = getCurrentUser();
    const userNick = getCurrentNick();
    if (!user || !userNick) return;

    const isJournalist = user.job === 'Журналист' || (user.examScore || 0) >= 71;
    const articlesObj = await dbGet('news_articles') || {};
    const articles = Object.keys(articlesObj)
        .map(k => ({ ...articlesObj[k], id: k }))
        .filter(a => a.status === 'published')
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    container.innerHTML = `
        <div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
            <h2 style="font-family:'Unbounded',sans-serif;font-size:20px;">📰 К-Новости</h2>
            ${isJournalist ? `<button class="btn btn-primary" style="padding:8px 14px;font-size:12px;" onclick="openCreateNewsModal()">✍️ Написать статью</button>` : ''}
        </div>

        <div id="newsArticlesList">
            ${articles.length === 0 ? '<div style="text-align:center;color:var(--muted);padding:30px;">Новостей пока нет</div>' :
                articles.map(a => `
                    <div class="news-card">
                        ${a.photo ? `<img class="news-card-img" src="${a.photo}">` : ''}
                        <div style="font-family:'Unbounded',sans-serif;font-weight:800;font-size:16px;margin-bottom:6px;">${a.title}</div>
                        <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Автор: <b>${a.authorName || a.author}</b> • ${new Date(a.createdAt).toLocaleDateString('ru')}</div>
                        <div style="font-size:13px;line-height:1.6;color:var(--text);">${a.text}</div>
                    </div>
                `).join('')
            }
        </div>
    `;
}

window.openCreateNewsModal = function() {
    let modal = document.getElementById('createNewsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'createNewsModal';
        modal.className = 'modal-backdrop';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="modal-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 style="font-family:'Unbounded',sans-serif;font-size:18px;">📰 Публикация Статьи</h3>
                <span style="font-size:22px;cursor:pointer;color:var(--muted);" onclick="closeCreateNewsModal()">✕</span>
            </div>

            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Заголовок</label>
            <input type="text" id="newsTitleInput" placeholder="Заголовок новости...">

            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Текст статьи</label>
            <textarea id="newsTextInput" style="min-height:120px;" placeholder="Текст новости..."></textarea>

            <button class="btn btn-primary" onclick="submitNewsArticleFlow()" style="width:100%;margin-top:10px;">Отправить на модерацию в Мэрию</button>
        </div>
    `;

    modal.style.display = 'flex';
};

window.closeCreateNewsModal = function() {
    const modal = document.getElementById('createNewsModal');
    if (modal) modal.style.display = 'none';
};

window.submitNewsArticleFlow = async function() {
    const user = getCurrentUser();
    const userNick = getCurrentNick();
    const title = document.getElementById('newsTitleInput').value;
    const text = document.getElementById('newsTextInput').value;

    if (!title || !text) return alert("Заполните заголовок и текст статьи");

    await dbPush('news_articles', {
        title,
        text,
        author: userNick,
        authorName: displayNick(user),
        status: 'pending_moderation',
        createdAt: Date.now()
    });

    alert("🎉 Статья отправлена на модерацию в Мэрию!");
    closeCreateNewsModal();
    renderNewsView(document.getElementById('service_news'));
};
