import { getCurrentUser, getCurrentNick, displayNick } from "../auth.js";
import { dbGet, dbSet, dbPush, dbUpdate, dbRemove, dbOnValue, uploadFile } from "../firebase.js";
import { pushNotification } from "../notifications.js";

let activeChatType = 'global';
let activeChatId = 'global';
let activeChatPartner = null;
let currentUnsub = null;

export function initMessengerService() {
    const container = document.getElementById('service_messenger');
    if (!container) return;

    renderMessengerView(container);

    window.addEventListener('serviceMounted', (e) => {
        if (e.detail?.serviceId === 'messenger') {
            renderMessengerView(container);
        }
    });
}

function getDmKey(nick1, nick2) {
    return [nick1, nick2].sort().join('_');
}

async function renderMessengerView(container) {
    const user = getCurrentUser();
    const userNick = getCurrentNick();
    if (!user || !userNick) return;

    container.innerHTML = `
        <div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">
            <h2 style="font-family:'Unbounded',sans-serif;font-size:20px;">💬 Капанёвский Мессенджер</h2>
            <div style="display:flex;gap:6px;">
                <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px;" onclick="openCreateGroupModal()">➕ Группа</button>
                <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px;" onclick="openNewDmModal()">💬 Написать</button>
            </div>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:12px;overflow-x:auto;" id="chatTabsHeader">
            <button class="btn ${activeChatType === 'global' ? 'btn-primary' : 'btn-ghost'}" onclick="switchMessengerChat('global', 'global')">🌐 Общий чат</button>
            <div id="dynamicChatTabs" style="display:flex;gap:8px;"></div>
        </div>

        <div class="msg-container">
            <div class="msg-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-size:18px;">${activeChatType === 'global' ? '🌐' : '💬'}</span>
                    <div>
                        <div style="font-weight:800;font-size:14px;" id="msgHeaderTitle">Общий чат Капаней</div>
                        <div style="font-size:10px;color:var(--muted);" id="msgHeaderSubtitle">Все жители онлайн</div>
                    </div>
                </div>
            </div>

            <div id="msgPinnedArea"></div>

            <div class="msg-body" id="msgBodyList">
                <div style="text-align:center;color:var(--muted);padding:20px;">Загрузка сообщений…</div>
            </div>

            <div class="msg-input-bar">
                <input type="file" id="msgMediaFileInput" style="display:none;" onchange="handleMsgFileUpload(this)">
                <button class="btn btn-ghost" style="padding:8px;font-size:16px;" onclick="document.getElementById('msgMediaFileInput').click()">📎</button>
                <input type="text" id="msgTextInput" placeholder="Сообщение..." onkeypress="if(event.key==='Enter') sendChatMessage()">
                <button class="btn btn-primary" style="padding:8px 16px;" onclick="sendChatMessage()">🚀</button>
            </div>
        </div>
    `;

    loadUserChats();
    attachMessageStream();
}

async function loadUserChats() {
    const userNick = getCurrentNick();
    const dmsObj = await dbGet('dms') || {};
    const groupsObj = await dbGet('groups') || {};

    const tabsDiv = document.getElementById('dynamicChatTabs');
    if (!tabsDiv) return;

    let html = '';

    Object.keys(dmsObj).forEach(key => {
        if (key.includes(userNick)) {
            const partnerNick = key.split('_').find(n => n !== userNick) || userNick;
            html += `<button class="btn ${activeChatId === key ? 'btn-primary' : 'btn-ghost'}" onclick="switchMessengerChat('dm', '${key}', '${partnerNick}')">👤 ${partnerNick}</button>`;
        }
    });

    Object.keys(groupsObj).forEach(gId => {
        const group = groupsObj[gId];
        if (group && (group.owner === userNick || (group.members && group.members.includes(userNick)))) {
            html += `<button class="btn ${activeChatId === gId ? 'btn-primary' : 'btn-ghost'}" onclick="switchMessengerChat('group', '${gId}')">👥 ${group.name}</button>`;
        }
    });

    tabsDiv.innerHTML = html;
}

window.switchMessengerChat = function(type, id, partnerNick = null) {
    activeChatType = type;
    activeChatId = id;
    activeChatPartner = partnerNick;

    const titleEl = document.getElementById('msgHeaderTitle');
    const subEl = document.getElementById('msgHeaderSubtitle');

    if (type === 'global') {
        if (titleEl) titleEl.textContent = 'Общий чат Капаней';
        if (subEl) subEl.textContent = 'Все жители онлайн';
    } else if (type === 'dm') {
        if (titleEl) titleEl.textContent = `Чат с ${partnerNick}`;
        if (subEl) subEl.textContent = 'Личная переписка';
    } else if (type === 'group') {
        if (titleEl) titleEl.textContent = `Группа: ${id}`;
        if (subEl) subEl.textContent = 'Групповой чат';
    }

    attachMessageStream();
};

function attachMessageStream() {
    if (currentUnsub) currentUnsub();

    let path = 'chat';
    if (activeChatType === 'dm') {
        path = `dms/${activeChatId}/messages`;
    } else if (activeChatType === 'group') {
        path = `groups/${activeChatId}/messages`;
    }

    currentUnsub = dbOnValue(path, (data) => {
        const listEl = document.getElementById('msgBodyList');
        if (!listEl) return;

        if (!data) {
            listEl.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;">Сообщений пока нет. Напишите первым!</div>';
            return;
        }

        const userNick = getCurrentNick();
        const msgs = Object.keys(data).map(k => ({ ...data[k], id: k })).sort((a, b) => (a.ts || 0) - (b.ts || 0));

        listEl.innerHTML = msgs.map(m => {
            const isMine = (m.sender === userNick || m.nick === userNick);
            const senderName = m.displayName || m.nick || m.sender || 'Гражданин';
            return `
                <div class="msg-bubble ${isMine ? 'mine' : 'other'}">
                    ${!isMine ? `<div class="msg-bubble-author">${senderName}</div>` : ''}
                    ${m.mediaUrl ? `<img src="${m.mediaUrl}" style="max-width:100%;border-radius:8px;margin-bottom:4px;">` : ''}
                    <div>${m.text || ''}</div>
                    <div class="msg-bubble-time">${m.time || ''}</div>
                </div>
            `;
        }).join('');

        listEl.scrollTop = listEl.scrollHeight;
    });
}

window.sendChatMessage = async function() {
    const input = document.getElementById('msgTextInput');
    if (!input || !input.value.trim()) return;

    const user = getCurrentUser();
    const userNick = getCurrentNick();
    const text = input.value.trim();
    input.value = '';

    const dateStr = new Date().toLocaleDateString('ru');
    const timeStr = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });

    const msgObj = {
        sender: userNick,
        nick: userNick,
        displayName: displayNick(user),
        text,
        date: dateStr,
        time: timeStr,
        ts: Date.now()
    };

    let path = 'chat';
    if (activeChatType === 'dm') {
        path = `dms/${activeChatId}/messages`;
        if (activeChatPartner) {
            await pushNotification(activeChatPartner, `💬 Новое сообщение от ${displayNick(user)}: ${text}`, 'chat', '#messenger');
        }
    } else if (activeChatType === 'group') {
        path = `groups/${activeChatId}/messages`;
    }

    await dbPush(path, msgObj);
};

window.handleMsgFileUpload = async function(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const user = getCurrentUser();
    const userNick = getCurrentNick();

    try {
        const url = await uploadFile(`chat_files/${Date.now()}_${file.name}`, file);
        const dateStr = new Date().toLocaleDateString('ru');
        const timeStr = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });

        const msgObj = {
            sender: userNick,
            nick: userNick,
            displayName: displayNick(user),
            text: file.name,
            mediaUrl: url,
            date: dateStr,
            time: timeStr,
            ts: Date.now()
        };

        let path = 'chat';
        if (activeChatType === 'dm') path = `dms/${activeChatId}/messages`;
        else if (activeChatType === 'group') path = `groups/${activeChatId}/messages`;

        await dbPush(path, msgObj);
    } catch (e) {
        alert("Ошибка загрузки файла: " + e.message);
    }
};

window.openNewDmModal = async function() {
    const allUsers = await dbGet('users') || {};
    const myNick = getCurrentNick();

    const target = prompt("Выберите или введите ник собеседника:");
    if (target) {
        const key = getDmKey(myNick, target);
        switchMessengerChat('dm', key, target);
        loadUserChats();
    }
};

window.openCreateGroupModal = async function() {
    const name = prompt("Введите название новой группы:");
    if (name) {
        const userNick = getCurrentNick();
        const groupKey = 'group_' + Date.now();
        await dbSet(`groups/${groupKey}`, {
            id: groupKey,
            name,
            owner: userNick,
            members: [userNick],
            createdAt: Date.now()
        });
        switchMessengerChat('group', groupKey);
        loadUserChats();
    }
};
