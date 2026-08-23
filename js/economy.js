(function() {
    window.KP = window.KP || {};

    async function transferMoney(toUserNick, amount, description = "Перевод") {
        const senderNick = window.KP.getCurrentNick();
        const senderUser = window.KP.getCurrentUser();

        if (!senderNick || !senderUser) throw new Error("Необходимо авторизоваться");
        if (!toUserNick || toUserNick === senderNick) throw new Error("Нельзя переводить самому себе");

        const numAmount = Math.round(Number(amount));
        if (isNaN(numAmount) || numAmount <= 0) throw new Error("Укажите корректную сумму");
        if ((senderUser.balance || 0) < numAmount) throw new Error("Недостаточно средств на балансе");

        const targetUser = await window.KP_DB.dbGet(`users/${toUserNick}`);
        if (!targetUser) throw new Error("Получатель не найден");

        const senderDisplayName = window.KP.displayNick(senderUser);
        const targetDisplayName = window.KP.displayNick(targetUser);

        const newSenderBal = (senderUser.balance || 0) - numAmount;
        await window.KP_DB.dbUpdate(`users/${senderNick}`, { balance: newSenderBal });

        const newTargetBal = (targetUser.balance || 0) + numAmount;
        const newTotalEarned = (targetUser.totalEarned || 0) + numAmount;
        await window.KP_DB.dbUpdate(`users/${toUserNick}`, { balance: newTargetBal, totalEarned: newTotalEarned });

        const now = Date.now();
        const dateStr = new Date().toLocaleDateString('ru');
        const timeStr = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });

        await window.KP_DB.dbPush(`users/${senderNick}/txlog`, {
            type: 'out',
            who: targetDisplayName,
            amt: numAmount,
            desc: description,
            date: dateStr,
            time: timeStr,
            ts: now
        });

        await window.KP_DB.dbPush(`users/${toUserNick}/txlog`, {
            type: 'in',
            who: senderDisplayName,
            amt: numAmount,
            desc: description,
            date: dateStr,
            time: timeStr,
            ts: now
        });

        await window.KP.pushNotification(toUserNick, `💸 Вам поступил перевод ${numAmount} ₽ от ${senderDisplayName}`, 'finance', '#bank');

        return {
            sender: senderDisplayName,
            recipient: targetDisplayName,
            amount: numAmount,
            date: dateStr + ' ' + timeStr,
            description
        };
    }

    async function applyForLoan(amount, termWeeks = 4) {
        const userNick = window.KP.getCurrentNick();
        const user = window.KP.getCurrentUser();
        if (!userNick || !user) throw new Error("Авторизуйтесь");

        const numAmount = Math.round(Number(amount));
        if (isNaN(numAmount) || numAmount <= 0 || numAmount > 100000) throw new Error("Сумма кредита от 1 до 100 000 капанёвских рублей");

        const interestRate = 0.10;
        const totalRepay = Math.round(numAmount * (1 + interestRate));

        const loanData = {
            id: 'loan_' + Date.now(),
            amount: numAmount,
            totalRepay,
            remainingAmount: totalRepay,
            termWeeks,
            interestRate: 10,
            createdAt: Date.now(),
            status: 'active'
        };

        await window.KP_DB.dbPush(`users/${userNick}/loans`, loanData);
        await window.KP_DB.dbUpdate(`users/${userNick}`, { balance: (user.balance || 0) + numAmount });

        const dateStr = new Date().toLocaleDateString('ru');
        const timeStr = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });

        await window.KP_DB.dbPush(`users/${userNick}/txlog`, {
            type: 'in',
            who: 'К-Банк',
            amt: numAmount,
            desc: `Оформление кредита под 10%`,
            date: dateStr,
            time: timeStr,
            ts: Date.now()
        });

        await window.KP.pushNotification(userNick, `🏦 Вы получили кредит на сумму ${numAmount} ₽`, 'finance', '#bank');
        return loanData;
    }

    async function repayLoan(loanId, paymentAmount) {
        const userNick = window.KP.getCurrentNick();
        const user = window.KP.getCurrentUser();
        if (!userNick || !user) throw new Error("Авторизуйтесь");

        const loans = await window.KP_DB.dbGet(`users/${userNick}/loans`) || {};
        let targetKey = null;
        let targetLoan = null;

        for (const key in loans) {
            if (loans[key] && (loans[key].id === loanId || key === loanId)) {
                targetKey = key;
                targetLoan = loans[key];
                break;
            }
        }

        if (!targetLoan) throw new Error("Кредит не найден");

        const pAmt = Math.min(Math.round(Number(paymentAmount)), targetLoan.remainingAmount);
        if ((user.balance || 0) < pAmt) throw new Error("Недостаточно средств для погашения");

        const newRemaining = targetLoan.remainingAmount - pAmt;
        const newStatus = newRemaining <= 0 ? 'paid' : 'active';

        await window.KP_DB.dbUpdate(`users/${userNick}/loans/${targetKey}`, {
            remainingAmount: newRemaining,
            status: newStatus
        });

        await window.KP_DB.dbUpdate(`users/${userNick}`, { balance: user.balance - pAmt });

        const dateStr = new Date().toLocaleDateString('ru');
        const timeStr = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });

        await window.KP_DB.dbPush(`users/${userNick}/txlog`, {
            type: 'out',
            who: 'К-Банк',
            amt: pAmt,
            desc: newStatus === 'paid' ? 'Полное погашение кредита' : 'Частичное погашение кредита',
            date: dateStr,
            time: timeStr,
            ts: Date.now()
        });

        await window.KP.pushNotification(userNick, `💳 Оплачено ${pAmt} ₽ по кредиту`, 'finance', '#bank');
    }

    async function processWeeklyEconomy() {
        const userNick = window.KP.getCurrentNick();
        const user = window.KP.getCurrentUser();
        if (!userNick || !user) return;

        const now = Date.now();
        const lastProcessed = user.economyLastProcessedAt || 0;
        const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

        if (now - lastProcessed < ONE_WEEK) return;

        const salaryMap = {
            'Уборщик': 1500,
            'Журналист': 2800,
            'Полицейский': 3400,
            'КСБ': 4000,
            'Депутат': 5000
        };

        const salary = salaryMap[user.job] || 0;
        let newBalance = user.balance || 0;

        if (salary > 0) {
            newBalance += salary;
            const dateStr = new Date().toLocaleDateString('ru');
            const timeStr = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });

            await window.KP_DB.dbPush(`users/${userNick}/txlog`, {
                type: 'in',
                who: 'Мэрия Капаней',
                amt: salary,
                desc: `Недельная зарплата: ${user.job}`,
                date: dateStr,
                time: timeStr,
                ts: now
            });

            await window.KP.pushNotification(userNick, `🎉 Начислена зарплата ${salary} ₽ за профессию «${user.job}»!`, 'finance', '#jobs');
        }

        await window.KP_DB.dbUpdate(`users/${userNick}`, {
            balance: newBalance,
            economyLastProcessedAt: now
        });
    }

    window.KP.transferMoney = transferMoney;
    window.KP.applyForLoan = applyForLoan;
    window.KP.repayLoan = repayLoan;
    window.KP.processWeeklyEconomy = processWeeklyEconomy;
})();
