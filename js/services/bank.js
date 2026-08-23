import { getCurrentUser, getCurrentNick, displayNick } from "../auth.js";
import { dbGet } from "../firebase.js";
import { transferMoney, applyForLoan, repayLoan } from "../economy.js";

export function initBankService() {
    const container = document.getElementById('service_bank');
    if (!container) return;

    renderBankView(container);

    window.addEventListener('serviceMounted', (e) => {
        if (e.detail?.serviceId === 'bank') {
            renderBankView(container);
        }
    });
}

async function renderBankView(container) {
    const user = getCurrentUser();
    const userNick = getCurrentNick();
    if (!user || !userNick) return;

    const txlogObj = await dbGet(`users/${userNick}/txlog`) || {};
    const loansObj = await dbGet(`users/${userNick}/loans`) || {};

    const txs = Object.keys(txlogObj).map(k => txlogObj[k]).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const loans = Object.keys(loansObj).map(k => ({ ...loansObj[k], key: k })).filter(l => l.status === 'active');

    container.innerHTML = `
        <div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
            <h2 style="font-family:'Unbounded',sans-serif;font-size:20px;">💳 К-Банк</h2>
            <span style="font-size:12px;color:var(--muted); font-weight:700;">Капанёвские рубли</span>
        </div>

        <div class="bank-card">
            <div class="bank-card-chip"></div>
            <div style="font-size:11px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.5px;">Доступный баланс</div>
            <div class="bank-balance-num">${(user.balance || 0).toLocaleString()} ₽</div>
            <div style="margin-top:16px;display:flex;gap:16px;font-size:12px;color:rgba(255,255,255,0.8);">
                <div>Кешбэк: <b style="color:var(--gold);">5%</b></div>
                <div>Карта: <b>• ${userNick.slice(0, 8)}</b></div>
            </div>
        </div>

        <div class="bank-actions">
            <div class="bank-action-btn" onclick="openTransferModal()">
                <div style="font-size:22px;margin-bottom:4px;">💸</div>
                <div style="font-size:12px;font-weight:800;">Перевод</div>
            </div>
            <div class="bank-action-btn" onclick="openLoanModal()">
                <div style="font-size:22px;margin-bottom:4px;">🏦</div>
                <div style="font-size:12px;font-weight:800;">Кредит</div>
            </div>
            <div class="bank-action-btn" onclick="openTaxModal()">
                <div style="font-size:22px;margin-bottom:4px;">📜</div>
                <div style="font-size:12px;font-weight:800;">Налоги</div>
            </div>
        </div>

        ${loans.length > 0 ? `
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:14px;margin-bottom:20px;">
                <div style="font-weight:800;font-size:14px;margin-bottom:8px;">🏦 Активные кредиты</div>
                ${loans.map(l => `
                    <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface2);padding:10px;border-radius:12px;margin-top:6px;">
                        <div>
                            <div style="font-weight:800;font-size:13px;">Кредит #${l.id.slice(-4)}</div>
                            <div style="font-size:11px;color:var(--muted);">Остаток: ${l.remainingAmount.toLocaleString()} ₽</div>
                        </div>
                        <button class="btn btn-gold" style="padding:6px 12px;font-size:12px;" onclick="openRepayLoanModal('${l.key}', ${l.remainingAmount})">Погасить</button>
                    </div>
                `).join('')}
            </div>
        ` : ''}

        <div style="font-weight:800;font-size:15px;margin-bottom:12px;">📊 История операций</div>
        <div>
            ${txs.length === 0 ? '<div style="color:var(--muted);text-align:center;padding:20px;">Операций пока нет</div>' :
                txs.slice(0, 20).map(t => `
                    <div class="tx-item">
                        <div>
                            <div style="font-weight:800;font-size:13px;">${t.who || 'Система'}</div>
                            <div style="font-size:11px;color:var(--muted);">${t.desc || ''} • ${t.date || ''} ${t.time || ''}</div>
                        </div>
                        <div class="tx-amount ${t.type}">${t.type === 'in' ? '+' : '-'}${t.amt} ₽</div>
                    </div>
                `).join('')
            }
        </div>
    `;
}

window.openTransferModal = async function() {
    let modal = document.getElementById('transferModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'transferModal';
        modal.className = 'modal-backdrop';
        document.body.appendChild(modal);
    }

    const allUsers = await dbGet('users') || {};
    const currentUserNick = getCurrentNick();

    const recipientOptions = Object.keys(allUsers)
        .filter(key => key !== currentUserNick)
        .map(key => {
            const u = allUsers[key];
            return `<option value="${key}">${displayNick(u)} (${key})</option>`;
        }).join('');

    modal.innerHTML = `
        <div class="modal-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 style="font-family:'Unbounded',sans-serif;font-size:18px;">💸 Перевод средств</h3>
                <span style="font-size:22px;cursor:pointer;color:var(--muted);" onclick="closeTransferModal()">✕</span>
            </div>
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Получатель</label>
            <select id="transferRecipientSelect">
                ${recipientOptions}
            </select>

            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Сумма (₽)</label>
            <input type="number" id="transferAmountInput" placeholder="Введите сумму">

            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Назначение / Комментарий</label>
            <input type="text" id="transferDescInput" placeholder="За что перевод?">

            <button class="btn btn-primary" onclick="submitTransferFlow()" style="width:100%;margin-top:10px;">Подтвердить перевод</button>
        </div>
    `;

    modal.style.display = 'flex';
};

window.closeTransferModal = function() {
    const modal = document.getElementById('transferModal');
    if (modal) modal.style.display = 'none';
};

window.submitTransferFlow = async function() {
    const recipient = document.getElementById('transferRecipientSelect').value;
    const amount = document.getElementById('transferAmountInput').value;
    const desc = document.getElementById('transferDescInput').value;

    try {
        const receipt = await transferMoney(recipient, amount, desc);
        closeTransferModal();
        showReceiptModal(receipt);
        renderBankView(document.getElementById('service_bank'));
    } catch (e) {
        alert("Ошибка перевода: " + e.message);
    }
};

function showReceiptModal(receipt) {
    let modal = document.getElementById('receiptModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'receiptModal';
        modal.className = 'modal-backdrop';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="modal-card" style="max-width:400px;">
            <div class="receipt-card">
                <div style="font-size:40px;margin-bottom:8px;">✅</div>
                <div style="font-family:'Unbounded',sans-serif;font-weight:900;font-size:18px;color:var(--primary);">Перевод выполнен</div>
                <div style="font-size:24px;font-weight:900;margin:12px 0;">${receipt.amount.toLocaleString()} ₽</div>
                <div style="text-align:left;background:rgba(255,255,255,0.04);padding:12px;border-radius:12px;font-size:12px;line-height:1.6;">
                    <div>Отправитель: <b>${receipt.sender}</b></div>
                    <div>Получатель: <b>${receipt.recipient}</b></div>
                    <div>Дата: <b>${receipt.date}</b></div>
                    <div>Назначение: <b>${receipt.description || 'Перевод'}</b></div>
                    <div>Статус: <b style="color:var(--primary);">Успешно ✅</b></div>
                </div>
            </div>
            <button class="btn btn-primary" onclick="closeReceiptModal()" style="width:100%;margin-top:16px;">Готово</button>
        </div>
    `;

    modal.style.display = 'flex';
}

window.closeReceiptModal = function() {
    const modal = document.getElementById('receiptModal');
    if (modal) modal.style.display = 'none';
};

window.openLoanModal = function() {
    let modal = document.getElementById('loanModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'loanModal';
        modal.className = 'modal-backdrop';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="modal-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 style="font-family:'Unbounded',sans-serif;font-size:18px;">🏦 Оформить Кредит</h3>
                <span style="font-size:22px;cursor:pointer;color:var(--muted);" onclick="closeLoanModal()">✕</span>
            </div>
            <div style="font-size:13px;color:var(--muted);margin-bottom:12px;">Вы можете получить до 100 000 ₽ под 10% годовых на срок 4 недели.</div>

            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Сумма кредита (до 100 000 ₽)</label>
            <input type="number" id="loanAmountInput" placeholder="Например: 10000">

            <button class="btn btn-gold" onclick="submitLoanFlow()" style="width:100%;margin-top:10px;">Получить кредит</button>
        </div>
    `;

    modal.style.display = 'flex';
};

window.closeLoanModal = function() {
    const modal = document.getElementById('loanModal');
    if (modal) modal.style.display = 'none';
};

window.submitLoanFlow = async function() {
    const amount = document.getElementById('loanAmountInput').value;
    try {
        await applyForLoan(amount);
        alert("🎉 Кредит успешно оформлен и средства зачислены!");
        closeLoanModal();
        renderBankView(document.getElementById('service_bank'));
    } catch (e) {
        alert("Ошибка: " + e.message);
    }
};

window.openRepayLoanModal = function(loanKey, remaining) {
    const p = prompt(`Введите сумму для погашения (максимум ${remaining} ₽):`, remaining);
    if (p) {
        repayLoan(loanKey, p).then(() => {
            alert("Оплата по кредиту принята!");
            renderBankView(document.getElementById('service_bank'));
        }).catch(e => alert("Ошибка: " + e.message));
    }
};

window.openTaxModal = function() {
    alert("Налоги и абонентские платы начисляются автоматически каждую неделю. Задолженностей по налогам нет ✅");
};
