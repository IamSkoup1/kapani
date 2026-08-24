(function() {
    window.KP = window.KP || {};

    let currentUser = null;
    let currentNick = localStorage.getItem('kp_s') || sessionStorage.getItem('kp_s') || null;
    let userListeners = [];
    let currentDbUnsub = null;

    function normalizePublicName(s) {
        return String(s || '').trim().toLowerCase();
    }

    async function sha256Hex(str) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function hashPassword(password, salt) {
        return sha256Hex(`kapani::${normalizePublicName(salt)}::${String(password || '')}`);
    }

    function getCurrentNick() {
        return currentNick;
    }

    function getCurrentUser() {
        return currentUser;
    }

    function displayNick(user) {
        if (!user) return 'Гражданин';
        if (typeof user === 'string') return user;
        return user.displayName || user.name || user.nick || 'Гражданин';
    }

    function isMayor(user = currentUser) {
        if (!user) return false;
        const name = displayNick(user);
        return name === window.KP_CONFIG.admin.displayName || name === 'Кайон' || name === 'Денис';
    }

    async function findUserByName(nameInput) {
        const q = normalizePublicName(nameInput);
        if (!q) return null;

        const allUsers = await window.KP_DB.dbGet('users') || {};
        for (const nick in allUsers) {
            const u = allUsers[nick];
            if (!u) continue;
            const dn = normalizePublicName(u.displayName || u.name || nick);
            const nk = normalizePublicName(nick);
            if (dn === q || nk === q) {
                return { nick, ...u };
            }
        }
        return null;
    }

    function makeNickFromName(nameInput) {
        let base = String(nameInput || '').trim().replace(/[\.\#\$\[\]\s]/g, '_');
        if (!base) base = 'citizen_' + Date.now().toString(36);
        return base;
    }

    function attachUserListener(nick) {
        if (currentDbUnsub) currentDbUnsub();
        if (!nick) return;

        currentDbUnsub = window.KP_DB.dbOnValue(`users/${nick}`, (val) => {
            if (val) {
                val.nick = nick;
                currentUser = val;
            } else {
                currentUser = null;
            }
            notifyAuthSubscribers();
        });
    }

    async function loginUser(nameOrLogin, password) {
        const trimmedName = String(nameOrLogin || '').trim();
        if (!trimmedName || !password) {
            throw new Error("Заполните имя пользователя и пароль");
        }

        const existing = await findUserByName(trimmedName);

        if (!existing) {
            // New User Registration
            const nick = makeNickFromName(trimmedName);
            const passwordHash = await hashPassword(password, nick);
            const now = Date.now();

            const newUser = {
                nick,
                displayName: trimmedName,
                name: trimmedName,
                balance: 1000,
                examScore: 0,
                driversLicense: false,
                job: 'Безработный',
                vehicle: '',
                avatar: window.KP_CONFIG.ui.defaultAvatarUrl,
                accountVerified: true,
                accountFrozen: false,
                createdAt: now,
                economyLastProcessedAt: now,
                totalEarned: 0,
                passwordHash
            };

            await window.KP_DB.dbSet(`users/${nick}`, newUser);
            currentUser = newUser;
            currentNick = nick;
        } else {
            // Existing User Login
            const enteredHash = await hashPassword(password, existing.nick);
            if (existing.passwordHash) {
                if (existing.passwordHash !== enteredHash) {
                    throw new Error("Неверный пароль");
                }
            } else {
                // First login for legacy account without password hash
                await window.KP_DB.dbUpdate(`users/${existing.nick}`, { passwordHash: enteredHash });
                existing.passwordHash = enteredHash;
            }
            currentUser = existing;
            currentNick = existing.nick;
        }

        localStorage.setItem('kp_s', currentNick);
        sessionStorage.setItem('kp_s', currentNick);
        localStorage.setItem('kp_auth', JSON.stringify({
            nick: currentNick,
            displayName: displayNick(currentUser)
        }));

        attachUserListener(currentNick);
        notifyAuthSubscribers();
        return currentUser;
    }

    function logoutUser() {
        if (currentDbUnsub) currentDbUnsub();
        localStorage.removeItem('kp_s');
        sessionStorage.removeItem('kp_s');
        localStorage.removeItem('kp_auth');
        currentUser = null;
        currentNick = null;
        notifyAuthSubscribers();
        window.location.reload();
    }

    function subscribeAuth(callback) {
        userListeners.push(callback);
        callback(currentUser);
    }

    function notifyAuthSubscribers() {
        userListeners.forEach(cb => cb(currentUser));
    }

    function initAuth(onUserLoaded) {
        subscribeAuth(onUserLoaded);
        if (currentNick) {
            attachUserListener(currentNick);
        } else {
            notifyAuthSubscribers();
        }
    }

    window.KP.getCurrentNick = getCurrentNick;
    window.KP.getCurrentUser = getCurrentUser;
    window.KP.displayNick = displayNick;
    window.KP.isMayor = isMayor;
    window.KP.loginUser = loginUser;
    window.KP.logoutUser = logoutUser;
    window.KP.subscribeAuth = subscribeAuth;
    window.KP.initAuth = initAuth;
    window.KP.hashPassword = hashPassword;
})();
