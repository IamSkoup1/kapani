(function() {
    window.initJobsService = function() {
        const container = document.getElementById('service_jobs');
        if (!container) return;

        renderJobsView(container);

        window.addEventListener('serviceMounted', (e) => {
            if (e.detail?.serviceId === 'jobs') {
                renderJobsView(container);
            }
        });
    };

    async function renderJobsView(container) {
        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();

        if (!user || !userNick) return;

        const currentJob = user.job || null;
        const examPoints = Number(user.examPoints || user.kve || 0);

        container.innerHTML = `
            <div style="margin-bottom:16px;">
                <h2 style="font-family:'Unbounded',sans-serif;font-size:20px;">💼 К-Работа</h2>
                <div style="font-size:12px;color:var(--muted);margin-top:2px;">
                    Ваши баллы экзамена / КВЭ: <b style="color:var(--accent);">${examPoints}</b>
                </div>
            </div>

            ${currentJob ? renderMyJobPanel(currentJob, user) : renderVacancyList(examPoints)}
        `;
    }

    function renderMyJobPanel(job, user) {
        let jobTitle = 'Работа не указана';
        let salaryInfo = '—';
        let customControls = '';

        if (job === 'taxi') {
            jobTitle = '🛵 Водитель Такси';
            salaryInfo = 'Сдельная (зависит от количества принятых заказов)';
            customControls = '<button class="btn btn-primary" onclick="window.location.hash=\'#taxi\'">Перейти в Такси Панель</button>';
        } else if (job === 'courier') {
            jobTitle = '📦 Курьер / Доставщик';
            salaryInfo = 'Сдельная (зависит от заказов Авито и Маркета)';
            customControls = '<button class="btn btn-primary" onclick="alert(\'Доступные заказы смотрите в сервисе К-Маркет\')">Смотреть заказы</button>';
        } else if (job === 'janitor') {
            jobTitle = '🧹 Уборщик';
            salaryInfo = '1 500 ₽ / неделю (автоматически на карту)';
            customControls = `
                <div style="margin-top:12px;">
                    <textarea id="janitorReportInput" placeholder="Отчёт о выполненной уборке..."></textarea>
                    <button class="btn btn-primary" onclick="submitJanitorReport()" style="width:100%;margin-top:6px;">Отправить отчёт в Мэрию</button>
                </div>
            `;
        } else if (job === 'journalist') {
            jobTitle = '📰 Журналист';
            salaryInfo = '2 800 ₽ / неделю';
            customControls = '<button class="btn btn-primary" onclick="window.location.hash=\'#news\'">Открыть Редактор Новостей</button>';
        } else if (job === 'police') {
            jobTitle = '👮 Полицейский';
            salaryInfo = '3 400 ₽ / неделю';
            customControls = '<button class="btn btn-primary" onclick="window.location.hash=\'#ksb\'">Открыть Спецпанель КСБ/Полиции</button>';
        } else if (job === 'ksb') {
            jobTitle = '🛡 Сотрудник КСБ';
            salaryInfo = '4 000 ₽ / неделю';
            customControls = '<button class="btn btn-primary" onclick="window.location.hash=\'#ksb\'">Открыть Спецпанель КСБ/Полиции</button>';
        } else if (job === 'deputy') {
            jobTitle = '🏛 Депутат';
            salaryInfo = '5 000 ₽ / неделю';
            customControls = `
                <div style="margin-top:12px;">
                    <textarea id="deputyProposalInput" placeholder="Текст законодательной инициативы или предложения..."></textarea>
                    <button class="btn btn-primary" onclick="submitDeputyProposal()" style="width:100%;margin-top:6px;">Внести инициативу в Мэрию</button>
                </div>
            `;
        }

        return `
            <div class="card">
                <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Текущая Профессия</div>
                <div style="font-family:'Unbounded',sans-serif;font-size:18px;font-weight:900;color:var(--accent);margin:6px 0;">${jobTitle}</div>
                <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">Оплата: ${salaryInfo}</div>

                ${customControls}

                <div style="border-top:1px solid var(--border);margin-top:16px;padding-top:12px;">
                    <button class="btn btn-red" style="width:100%;" onclick="quitJobFlow()">Уволиться по собственному желанию</button>
                </div>
            </div>
        `;
    }

    function renderVacancyList(examPoints) {
        const vacancies = [
            { id: 'janitor', title: '🧹 Уборщик', req: 40, salary: '1 500 ₽/нед' },
            { id: 'courier', title: '📦 Курьер / Доставщик', req: 53, salary: 'Сдельная' },
            { id: 'taxi', title: '🛵 Водитель Такси', req: 60, reqExt: 'Права на скутер', salary: 'Сдельная' },
            { id: 'journalist', title: '📰 Журналист', req: 71, salary: '2 800 ₽/нед' },
            { id: 'police', title: '👮 Полицейский', req: 80, salary: '3 400 ₽/нед' },
            { id: 'ksb', title: '🛡 Сотрудник КСБ', req: 90, salary: '4 000 ₽/нед' },
            { id: 'deputy', title: '🏛 Депутат', req: 95, salary: '5 000 ₽/нед' }
        ];

        return `
            <div style="display:flex;flex-direction:column;gap:12px;">
                ${vacancies.map(v => {
                    const passes = examPoints >= v.req;
                    return `
                        <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                            <div>
                                <div style="font-weight:800;font-size:15px;color:var(--text);">${v.title}</div>
                                <div style="font-size:12px;color:var(--accent);font-weight:700;margin:2px 0;">💰 ${v.salary}</div>
                                <div style="font-size:11px;color:var(--muted);">Требуется баллов: <b>${v.req}</b> ${v.reqExt ? `(${v.reqExt})` : ''}</div>
                            </div>
                            <button class="btn ${passes ? 'btn-primary' : 'btn-secondary'}"
                                ${!passes ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}
                                onclick="applyForJob('${v.id}')">
                                ${passes ? 'Устроиться' : 'Недоступно'}
                            </button>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    window.applyForJob = async function(jobId) {
        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();

        if (jobId === 'taxi') {
            const licenses = user.licenses || {};
            if (!licenses.scooter) {
                return alert("Для работы водителем такси необходимы права на скутер!");
            }
        }

        await window.KP_DB.dbUpdate(`users/${userNick}`, { job: jobId });
        alert("🎉 Поздравляем с трудоустройством!");
        renderJobsView(document.getElementById('service_jobs'));
    };

    window.quitJobFlow = async function() {
        if (confirm("Вы точно хотите уволиться?")) {
            const userNick = window.KP.getCurrentNick();
            await window.KP_DB.dbUpdate(`users/${userNick}`, { job: null });
            renderJobsView(document.getElementById('service_jobs'));
        }
    };

    window.submitJanitorReport = async function() {
        const text = document.getElementById('janitorReportInput').value;
        if (!text) return alert("Введите отчёт");

        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();

        await window.KP_DB.dbPush('janitor_reports', {
            worker: userNick,
            workerName: window.KP.displayNick(user),
            reportText: text,
            createdAt: Date.now()
        });

        alert("Отчёт уборщика отправлен в Мэрию!");
        document.getElementById('janitorReportInput').value = '';
    };

    window.submitDeputyProposal = async function() {
        const text = document.getElementById('deputyProposalInput').value;
        if (!text) return alert("Введите текст инициативы");

        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();

        await window.KP_DB.dbPush('deputy_proposals', {
            author: userNick,
            authorName: window.KP.displayNick(user),
            text: text,
            status: 'submitted',
            createdAt: Date.now()
        });

        alert("Законодательная инициатива направлена Мэру!");
        document.getElementById('deputyProposalInput').value = '';
    };
})();
