(function() {
    window.initMessengerService = function() {
        const container = document.getElementById('service_messenger');
        if (!container) return;

        renderMessengerView(container);

        window.addEventListener('serviceMounted', (e) => {
            if (e.detail?.serviceId === 'messenger') {
                renderMessengerView(container);
            }
        });
    };

    let activeChatId = null;
    let activeChatType = 'direct';

    async function renderMessengerView(container) {
        const user = window.KP.getCurrentUser();
        const userNick = window.KP.getCurrentNick();

        if (!user || !userNick) return;

        const allUsers = await window.KP_DB.dbGet('users') || {};
        const chatsList = Object.keys(allUsers)
            .filter(k => k !== userNick)
            .map(k => ({ nick: k, name: window.KP.displayNick(allUsers[k]), avatar: allUsers[k].avatar }));

        container.innerHTML = `
            <div style="display:flex;height:calc(100vh - 120px);background:var(--surface);border-radius:16px;border:1px solid var(--border);overflow:hidden;">

                <!-- Dialogs Sidebar -->
                <div style="width:280px;border-right:1px solid var(--border);display:flex;flex-direction:column;background:var(--surface2);">
                    <div style="padding:12px;border-bottom:1px solid var(--border);font-family:'Unbounded',sans-serif;font-weight:700;font-size:14px;color:var(--accent);">
                        💬 Мессенджер
                    </div>
                    <div style="flex:1;overflow-y:auto;" id="dialogsContainer">
                        ${chatsList.map(c => `
                            <div class="msg-dialog-item ${activeChatId === c.nick ? 'active' : ''}" onclick="selectMessengerChat('${c.nick}')">
                                <div class="msg-avatar">${c.avatar ? `<img src="${c.avatar}" style="width:100%;height:100%;border-radius:50%;">` : c.name.charAt(0)}</div>
                                <div>
                                    <div style="font-weight:700;font-size:13px;color:var(--text);">${c.name}</div>
                                    <div style="font-size:11px;color:var(--muted);">Нажмите, чтобы открыть чат</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Active Chat Container -->
                <div style="flex:1;display:flex;flex-direction:column;" id="chatArea">
                    ${activeChatId ? renderChatBox(activeChatId, allUsers[activeChatId]) : `
                        <div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px;">
                            Выберите диалог из списка слева
                        </div>
                    `}
                </div>
            </div>
        `;

        if (activeChatId) {
            setupMessageListener(activeChatId);
        }
    }

    window.selectMessengerChat = function(partnerNick) {
        activeChatId = partnerNick;
        renderMessengerView(document.getElementById('service_messenger'));
    };

    function renderChatBox(partnerNick, partnerUser) {
        const partnerName = partnerUser ? window.KP.displayNick(partnerUser) : partnerNick;

        return `
            <div style="padding:12px;border-bottom:1px solid var(--border);background:var(--surface);font-weight:700;font-size:14px;display:flex;align-items:center;gap:8px;">
                <span>👤 ${partnerName}</span>
            </div>

            <div style="flex:1;padding:16px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;" id="msgListContainer">
                <div style="text-align:center;color:var(--muted);font-size:11px;">Загрузка сообщений...</div>
            </div>

            <div style="padding:12px;border-top:1px solid var(--border);background:var(--surface);display:flex;gap:8px;">
                <input type="text" id="msgInputText" placeholder="Напишите сообщение..." onkeydown="if(event.key==='Enter') sendChatMessage()">
                <button class="btn btn-primary" onclick="sendChatMessage()" style="padding:0 16px;">Отправить</button>
            </div>
        `;
    }

    let currentUnsub = null;

    function setupMessageListener(partnerNick) {
        if (currentUnsub) currentUnsub();

        const myNick = window.KP.getCurrentNick();
        const chatId = [myNick, partnerNick].sort().join('_');

        currentUnsub = window.KP_DB.dbOnValue(`chats/${chatId}/messages`, (messagesObj) => {
            const listDiv = document.getElementById('msgListContainer');
            if (!listDiv) return;

            if (!messagesObj) {
                listDiv.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:11px;">История сообщений пуста</div>';
                return;
            }

            const messages = Object.keys(messagesObj).map(k => messagesObj[k]).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

            listDiv.innerHTML = messages.map(m => {
                const isMe = m.sender === myNick;
                return `
                    <div style="align-self:${isMe ? 'flex-end' : 'flex-start'};max-width:70%;">
                        <div class="msg-bubble ${isMe ? 'msg-sent' : 'msg-recv'}">
                            ${m.text}
                        </div>
                        <div style="font-size:9px;color:var(--muted);margin-top:2px;text-align:${isMe ? 'right' : 'left'};">
                            ${new Date(m.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                    </div>
                `;
            }).join('');

            listDiv.scrollTop = listDiv.scrollHeight;
        });
    }

    window.sendChatMessage = async function() {
        const input = document.getElementById('msgInputText');
        if (!input || !input.value.trim() || !activeChatId) return;

        const text = input.value.trim();
        input.value = '';

        const myNick = window.KP.getCurrentNick();
        const myUser = window.KP.getCurrentUser();
        const chatId = [myNick, activeChatId].sort().join('_');

        const msgObj = {
            sender: myNick,
            senderName: window.KP.displayNick(myUser),
            text: text,
            createdAt: Date.now()
        };

        await window.KP_DB.dbPush(`chats/${chatId}/messages`, msgObj);
        await window.KP.pushNotification(activeChatId, 'Новое сообщение', `${window.KP.displayNick(myUser)}: ${text}`);
    };
})();
