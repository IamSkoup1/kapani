(function() {
    window.initNewsService = function() {
        const container = document.getElementById('service_news');
        if (!container) return;

        renderNewsView(container);

        window.addEventListener('serviceMounted', (e) => {
            if (e.detail?.serviceId === 'news') {
                renderNewsView(container);
            }
        });
    };

    async function renderNewsView(container) {
        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();

        if (!user || !userNick) return;

        const isJournalist = user.job === 'journalist' || window.KP.isMayor(user);

        const articlesObj = await window.KP_DB.dbGet('news_articles') || {};
        const articles = Object.keys(articlesObj)
            .map(k => ({ ...articlesObj[k], id: k }))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        container.innerHTML = `
            <div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
                <h2 style="font-family:'Unbounded',sans-serif;font-size:20px;">📰 К-Новости</h2>
                ${isJournalist ? `<button class="btn btn-primary" style="padding:6px 12px;font-size:12px;" onclick="openCreateNewsModal()">✍️ Написать статью</button>` : ''}
            </div>

            <div style="display:flex;flex-direction:column;gap:16px;">
                ${articles.length === 0 ? '<div style="text-align:center;color:var(--muted);padding:30px;">Новостей пока нет</div>' :
                    articles.map(art => `
                        <div class="news-card">
                            ${art.photo ? `<img class="news-img" src="${art.photo}">` : ''}
                            <div class="news-body">
                                <div style="font-size:10px;color:var(--accent);font-weight:700;text-transform:uppercase;">${art.category || 'Главное'} • ${new Date(art.createdAt || Date.now()).toLocaleDateString()}</div>
                                <div class="news-title">${art.title}</div>
                                <div class="news-text">${art.text}</div>
                                <div style="font-size:11px;color:var(--muted);margin-top:8px;">Редактор: <b>${art.authorName || art.author}</b></div>
                            </div>
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
                <input type="text" id="newsTitleInput" placeholder="Главное событие дня...">

                <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Категория</label>
                <select id="newsCategorySelect">
                    <option value="Политика">Политика</option>
                    <option value="Экономика">Экономика</option>
                    <option value="Происшествия">Происшествия</option>
                    <option value="Культура">Культура</option>
                </select>

                <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Текст новости</label>
                <textarea id="newsTextInput" style="height:120px;" placeholder="Текст статьи..."></textarea>

                <button class="btn btn-primary" onclick="submitNewsArticleFlow()" style="width:100%;margin-top:10px;">Опубликовать новость</button>
            </div>
        `;

        modal.style.display = 'flex';
    };

    window.closeCreateNewsModal = function() {
        const modal = document.getElementById('createNewsModal');
        if (modal) modal.style.display = 'none';
    };

    window.submitNewsArticleFlow = async function() {
        const title = document.getElementById('newsTitleInput').value;
        const category = document.getElementById('newsCategorySelect').value;
        const text = document.getElementById('newsTextInput').value;

        if (!title || !text) return alert("Заполните заголовок и текст");

        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();

        const article = {
            title,
            category,
            text,
            author: userNick,
            authorName: window.KP.displayNick(user),
            createdAt: Date.now()
        };

        await window.KP_DB.dbPush('news_articles', article);
        alert("🎉 Статья опубликована в К-Новостях!");
        closeCreateNewsModal();
        renderNewsView(document.getElementById('service_news'));
    };
})();
