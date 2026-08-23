import { getCurrentUser, getCurrentNick, displayNick } from "../auth.js";
import { dbGet, dbSet, dbPush, dbUpdate } from "../firebase.js";
import { pushNotification } from "../notifications.js";

const JOBS = [
    { id: 'janitor', title: 'Уборщик 🧹', salary: '1 500 ₽ / неделя', examMin: 40, desc: 'Отправка отчётов об уборке улиц в Мэрию' },
    { id: 'courier', title: 'Курьер 📦', salary: 'Зависит от заказов', examMin: 53, desc: 'Доставка товаров из К-Маркета и К-Авито' },
    { id: 'driver', title: 'Водитель Такси 🛵', salary: 'Зависит от заказов', examMin: 60, needLicense: true, desc: 'Перевозка пассажиров по Капаням' },
    { id: 'journalist', title: 'Журналист 📰', salary: '2 800 ₽ / неделя', examMin: 71, desc: 'Написание статей и новостей для К-Новостей' },
    { id: 'police', title: 'Полицейский 👮', salary: '3 400 ₽ / неделя', examMin: 80, desc: 'Охрана порядка, штрафы и проверка документов' },
    { id: 'ksb', title: 'Сотрудник КСБ 🛡', salary: '4 000 ₽ / неделя', examMin: 90, desc: 'Служба безопасности Капаней' },
    { id: 'deputy', title: 'Депутат 🏛', salary: '5 000 ₽ / неделя', examMin: 95, desc: 'Законодательные инициативы и предложения' }
];

export function initJobsService() {
    const container = document.getElementById('service_jobs');
    if (!container) return;

    renderJobsView(container);

    window.addEventListener('serviceMounted', (e) => {
        if (e.detail?.serviceId === 'jobs') {
            renderJobsView(container);
        }
    });
}

async function renderJobsView(container) {
    const user = getCurrentUser();
    const userNick = getCurrentNick();
    if (!user || !userNick) return;

    const currentJob = user.job && user.job !== 'Безработный' ? user.job : null;

    container.innerHTML = `
        <div style="margin-bottom:16px;">
            <h2 style="font-family:'Unbounded',sans-serif;font-size:20px;">💼 К-Работа</h2>
            <div style="font-size:12px;color:var(--muted);margin-top:2px;">Трудоустройство и карьеры Капаней</div>
        </div>

        ${currentJob ? `
            <div class="job-my-panel">
                <div style="font-size:11px;color:var(--primary);font-weight:800;text-transform:uppercase;">Моя текущая профессия</div>
                <div style="font-size:20px;font-weight:900;margin:4px 0;">${currentJob}</div>
                <div style="font-size:12px;color:var(--muted);margin-bottom:16px;">Вы трудоустроены. Оплата начисляется каждую неделю автоматически.</div>

                ${renderJobActionPanel(currentJob)}

                <button class="btn btn-red" style="margin-top:16px;width:100%;font-size:12px;" onclick="quitJobFlow()">🚪 Уволиться с работы</button>
            </div>
        ` : `
            <div style="font-weight:800;font-size:15px;margin-bottom:12px;">Доступные Вакансии</div>
            <div>
                ${JOBS.map(j => {
                    const hasScore = (user.examScore || 0) >= j.examMin;
                    const hasLicense = !j.needLicense || user.driversLicense;
                    const canApply = hasScore && hasLicense;

                    return `
                        <div class="job-card">
                            <div style="display:flex;justify-content:space-between;align-items:center;">
                                <div style="font-weight:800;font-size:16px;">${j.title}</div>
                                <div style="font-weight:900;color:var(--primary);">${j.salary}</div>
                            </div>
                            <div style="font-size:12px;color:var(--muted);margin:6px 0;">${j.desc}</div>
                            <div style="font-size:11px;color:${canApply ? 'var(--primary)' : 'var(--red)'};font-weight:700;">
                                📋 Требования: КВЭ ≥ ${j.examMin} баллов ${j.needLicense ? '+ Права на скутер' : ''}
                            </div>
                            <button class="btn ${canApply ? 'btn-primary' : 'btn-ghost'}" style="width:100%;margin-top:10px;" ${canApply ? `onclick="applyForJob('${j.title}')"` : 'disabled'}>
                                ${canApply ? 'Устроиться на работу' : 'Требования не выполнены'}
                            </button>
                        </div>
                    `;
                }).join('')}
            </div>
        `}
    `;
}

function renderJobActionPanel(jobTitle) {
    if (jobTitle.includes('Уборщик')) {
        return `
            <div style="background:var(--surface2);padding:12px;border-radius:12px;">
                <div style="font-weight:800;font-size:13px;margin-bottom:6px;">🧹 Отчёт об уборке</div>
                <textarea id="janitorReportInput" placeholder="Опишите выполненную уборку территории..."></textarea>
                <button class="btn btn-primary" style="width:100%;margin-top:6px;" onclick="submitJanitorReport()">Отправить отчёт в Мэрию</button>
            </div>
        `;
    } else if (jobTitle.includes('Депутат')) {
        return `
            <div style="background:var(--surface2);padding:12px;border-radius:12px;">
                <div style="font-weight:800;font-size:13px;margin-bottom:6px;">🏛 Законодательная инициатива</div>
                <textarea id="deputyProposalInput" placeholder="Ваше предложение для развития Капаней..."></textarea>
                <button class="btn btn-gold" style="width:100%;margin-top:6px;" onclick="submitDeputyProposal()">Отправить инициативу Мэру</button>
            </div>
        `;
    } else if (jobTitle.includes('Журналист')) {
        return `
            <button class="btn btn-primary" style="width:100%;" onclick="window.location.hash='#news'">📰 Перейти в панель журналиста</button>
        `;
    } else if (jobTitle.includes('Такси')) {
        return `
            <button class="btn btn-primary" style="width:100%;" onclick="window.location.hash='#taxi'">🚕 Панель водителя такси</button>
        `;
    } else if (jobTitle.includes('Полицейский') || jobTitle.includes('КСБ')) {
        return `
            <button class="btn btn-primary" style="width:100%;" onclick="window.location.hash='#ksb'">🛡 Панель сотрудника КСБ</button>
        `;
    }
    return '';
}

window.applyForJob = async function(title) {
    const userNick = getCurrentNick();
    if (!userNick) return;

    await dbUpdate(`users/${userNick}`, { job: title });
    alert(`🎉 Вы устроились на работу «${title}»!`);
    renderJobsView(document.getElementById('service_jobs'));
};

window.quitJobFlow = async function() {
    const userNick = getCurrentNick();
    if (!userNick) return;

    if (confirm("Вы уверены, что хотите уволиться?")) {
        await dbUpdate(`users/${userNick}`, { job: 'Безработный' });
        renderJobsView(document.getElementById('service_jobs'));
    }
};

window.submitJanitorReport = async function() {
    const text = document.getElementById('janitorReportInput').value;
    if (!text) return alert("Введите текст отчёта");

    const user = getCurrentUser();
    const userNick = getCurrentNick();

    await dbPush('janitor_submissions', {
        worker: userNick,
        workerName: displayNick(user),
        text,
        createdAt: Date.now()
    });

    alert("Отчёт об уборке отправлен в Мэрию!");
    document.getElementById('janitorReportInput').value = '';
};

window.submitDeputyProposal = async function() {
    const text = document.getElementById('deputyProposalInput').value;
    if (!text) return alert("Введите текст инициативы");

    const user = getCurrentUser();
    const userNick = getCurrentNick();

    await dbPush('deputy_proposals', {
        deputy: userNick,
        deputyName: displayNick(user),
        text,
        status: 'pending',
        createdAt: Date.now()
    });

    alert("Законодательная инициатива отправлена Мэру!");
    document.getElementById('deputyProposalInput').value = '';
};
