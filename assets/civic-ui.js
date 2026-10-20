// The shared palette and mayor workspace use the app's existing Firebase instance.
const MONTHS = [
  ['Январь','Морозное утро','#edf5f7','#d1e8f0','#176c8d'],
  ['Февраль','Иней и синие сумерки','#e9eef5','#cdd8e8','#3d548c'],
  ['Март','Оттепель и первые ростки','#f0f5ec','#dcebd6','#386b46'],
  ['Апрель','Дождь и свежая зелень','#edf3f1','#d1e6df','#236b70'],
  ['Май','Цветение и солнечный свет','#f5f3e9','#e9ebc7','#57722e'],
  ['Июнь','Трава и длинный день','#ecf4ef','#d1e9d8','#176e63'],
  ['Июль','Тёплое сухое лето','#f6f1df','#eee1ac','#776116'],
  ['Август','Урожай и медовый свет','#f7f0e4','#f1ddba','#925418'],
  ['Сентябрь','Охра и прохладный воздух','#f3efe8','#e9d8bf','#865424'],
  ['Октябрь','Красные листья и тыквы','#f5ede7','#f1d2b0','#9c4528'],
  ['Ноябрь','Туман и графит','#eceff1','#d9e1e5','#476274'],
  ['Декабрь','Снег и хвойный лес','#edf5f6','#d3e9e9','#186879']
];

const initialMonth = new Date().getMonth() + 1;
let savedMonth = initialMonth;
let previewMonth = initialMonth;
let appearanceUnsubscribe = null;
let appearanceStatus = 'Ожидание защищённого подключения…';
let saving = false;

function setSeason(month) {
  if (!Number.isInteger(month) || month < 1 || month > 12) return;
  document.documentElement.dataset.season = String(month);
  const color = MONTHS[month - 1][4];
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}
setSeason(initialMonth);

function safeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}

function updateAppearanceUI() {
  const status = document.getElementById('civicAppearanceStatus');
  if (status) status.textContent = appearanceStatus;
  const current = document.getElementById('civicCurrentMonth');
  if (current) current.textContent = MONTHS[savedMonth - 1][0];
  const apply = document.getElementById('civicApplyMonth');
  if (apply) apply.disabled = saving || previewMonth === savedMonth;
  document.querySelectorAll('.civic-month').forEach(button => {
    const month = Number(button.dataset.month);
    button.setAttribute('aria-pressed', String(month === previewMonth));
    button.setAttribute('aria-label', `${MONTHS[month - 1][0]}: ${MONTHS[month - 1][1]}${month === savedMonth ? ', выбран сейчас' : ''}`);
  });
}

function chooseMonth(month) {
  if (window._getCurrentNick?.() !== window.ADMIN) return;
  previewMonth = month;
  setSeason(month);
  appearanceStatus = `Предпросмотр: ${MONTHS[month - 1][0]}. Изменения пока не сохранены.`;
  updateAppearanceUI();
}

async function applyMonth() {
  if (saving || previewMonth === savedMonth || window._getCurrentNick?.() !== window.ADMIN) return;
  const month = previewMonth;
  if (!window.confirm(`Применить оформление «${MONTHS[month - 1][0]}» для всех жителей?`)) return;
  saving = true;
  appearanceStatus = 'Сохраняем оформление…';
  updateAppearanceUI();
  try {
    const auth = await window.kapaniGetAuth();
    const user = auth.currentUser;
    if (!user || user.uid !== window.ADMIN || !(await user.getIdTokenResult()).claims.admin) {
      throw new Error('Для изменения оформления нужна действующая сессия мэра.');
    }
    await window.dbSet(window.dbRef(window.db, 'siteAppearance'), {month, updatedAt:Date.now()});
    savedMonth = month;
    appearanceStatus = `Сохранено: ${MONTHS[month - 1][0]}. Все подключённые жители получат обновление.`;
  } catch (error) {
    previewMonth = savedMonth;
    setSeason(savedMonth);
    appearanceStatus = `Не удалось сохранить. Вернули оформление «${MONTHS[savedMonth - 1][0]}». ${error?.message || 'Проверьте соединение.'}`;
  } finally {
    saving = false;
    updateAppearanceUI();
  }
}

function makeAppearanceCard() {
  const card = document.createElement('div');
  card.className = 'civic-admin-card';
  card.id = 'civicAppearanceCard';
  card.innerHTML = `<h2>Оформление города</h2><p>Выберите месяц, посмотрите его на сайте и примените для всех жителей.</p>
    <p>Сейчас используется: <strong id="civicCurrentMonth"></strong></p>
    <div class="civic-months" role="group" aria-label="Сезонные оформления">${MONTHS.map(([name, description, bg, mark, accent], index) =>
      `<button type="button" class="civic-month" data-month="${index + 1}" style="--swatch-bg:${bg};--swatch-mark:${mark};--swatch-accent:${accent}"><span class="swatch" aria-hidden="true"></span><b>${name}</b><small>${description}</small></button>`).join('')}</div>
    <div class="civic-status" id="civicAppearanceStatus" role="status"></div>
    <button type="button" class="btn btn-primary" id="civicApplyMonth">Применить для всех</button>`;
  card.querySelectorAll('.civic-month').forEach(button => button.addEventListener('click', () => chooseMonth(Number(button.dataset.month))));
  card.querySelector('#civicApplyMonth').addEventListener('click', applyMonth);
  return card;
}

const TAB_NAMES = {overview:'Обзор',requests:'Заявки',residents:'Жители',economy:'Экономика',city:'Город и события',appearance:'Оформление'};
const ICON_PATHS = {
  list:'M4 6h16 M4 12h16 M4 18h16',
  person:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-4 3-7 8-7s8 3 8 7',
  money:'M3 7h18v11H3z M3 10h18 M16 14h2',
  city:'M3 21V7l6-3 6 3v14 M15 10h6v11 M7 10h4 M7 14h4',
  check:'M4 12l5 5L20 6',
  close:'M5 5l14 14 M19 5L5 19',
  message:'M4 5h16v12H8l-4 3z',
  calendar:'M4 5h16v16H4z M4 9h16 M8 3v4 M16 3v4',
  settings:'M4 6h16 M4 12h16 M4 18h16 M8 4v4 M16 10v4 M10 16v4'
};
function iconFor(text) {
  if (/отклон|удал|закры|отказ|изъят|очист/i.test(text)) return 'close';
  if (/одобр|подтверд|принят|сохран|выдать|назнач/i.test(text)) return 'check';
  if (/жител|аккаунт|профил|сотрудник|роль/i.test(text)) return 'person';
  if (/баланс|казн|штраф|сумм|банк|вывест|пополн/i.test(text)) return 'money';
  if (/город|бизнес|здан|мэр/i.test(text)) return 'city';
  if (/чат|сообщ|уведом/i.test(text)) return 'message';
  if (/день|гонк|событ|отчёт/i.test(text)) return 'calendar';
  if (/настрой|тема|оформ/i.test(text)) return 'settings';
  return 'list';
}
function harmonizeIcons(root) {
  if (!root) return;
  const iconPattern = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;
  const targets = [
    ...(root.matches?.('.card-title,button') ? [root] : []),
    ...root.querySelectorAll('.card-title,button')
  ];
  targets.forEach(element => {
    if (element.dataset.civicIcon === '1') return;
    const original = element.textContent.trim();
    if (!iconPattern.test(original)) return;
    iconPattern.lastIndex = 0;
    const walker = document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) node.textContent = node.textContent.replace(iconPattern,'').replace(/\s{2,}/g,' ');
    if (!element.textContent.trim()) element.appendChild(document.createTextNode(/❌|🗑|🚫/.test(original) ? 'Отклонить' : 'Подтвердить'));
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');
    svg.setAttribute('width','17'); svg.setAttribute('height','17');
    svg.setAttribute('fill','none'); svg.setAttribute('stroke','currentColor');
    svg.setAttribute('stroke-width','1.8'); svg.setAttribute('stroke-linecap','round'); svg.setAttribute('stroke-linejoin','round');
    svg.setAttribute('aria-hidden','true');
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',ICON_PATHS[iconFor(original)]); svg.appendChild(path);
    svg.style.cssText = 'display:inline-block;vertical-align:-3px;flex:none;margin-right:6px';
    element.prepend(svg);
    element.dataset.civicIcon = '1';
  });
}
const QUEUES = [
  ['appList','Работа'],['unverifiedAccounts','Аккаунты'],['janitorAdminList','Отчёты'],
  ['adminBizApps','Открытие бизнеса'],['adminBizDeleteReqs','Закрытие бизнеса'],
  ['adminAtmRequests','Банкоматы'],['kapaniScooterApps','Права'],
  ['kapaniKEducationApps','Образование'],['adminDeputyProposals','Депутаты'],['adminPoliceReqs','Полиция']
];
let activeTab = 'overview';
let adminObserver = null;
let queueObserver = null;
let residentObserver = null;
let arrangePending = false;

function adminPanel(tab) { return document.querySelector(`#civic-panel-${tab}`); }
function selectAdminTab(tab, focus = false) {
  if (window._getCurrentNick?.() !== window.ADMIN || !TAB_NAMES[tab]) return;
  activeTab = tab;
  Object.keys(TAB_NAMES).forEach(key => {
    const panel = adminPanel(key);
    const button = document.getElementById(`civic-tab-${key}`);
    if (panel) panel.hidden = key !== tab;
    if (button) button.setAttribute('aria-selected', String(key === tab));
  });
  if (focus) document.getElementById(`civic-tab-${tab}`)?.focus();
}

function classify(card) {
  const has = selector => !!card.querySelector(selector);
  if (has('#adminStats')) return 'overview';
  if (has('#civicAppearanceCard')) return 'appearance';
  if (has('#appList,#unverifiedAccounts,#janitorAdminList,#adminBizApps,#adminBizDeleteReqs,#adminAtmRequests,#kapaniScooterApps,#kapaniKEducationApps,#adminDeputyProposals,#adminPoliceReqs')) return 'requests';
  if (has('#adminTarget,#adminForceHireTarget,#kveTarget,#allUsersList,#adminLicenseStatus')) return 'residents';
  if (has('#kapaniTreasuryBalance,#adminOrders,#adminAdvertiserStats')) return 'economy';
  return 'city';
}

function arrangeAdminCards() {
  const page = document.getElementById('adminPage');
  if (!page || window._getCurrentNick?.() !== window.ADMIN) return;
  Array.from(page.children).filter(node => node.classList?.contains('card')).forEach(card => {
    adminPanel(classify(card))?.appendChild(card);
  });
  updateQueueLinks();
  applyResidentFilter();
}

function queueCount(container) {
  if (!container) return '—';
  const text = container.textContent.trim();
  if (!text || /^(нет|загрузка|ошибка)/i.test(text)) return /загрузка/i.test(text) ? '…' : '0';
  if (container.id === 'kapaniKEducationApps') return String(container.children.length);
  const buttons = Array.from(container.querySelectorAll('button')).filter(button => {
    const action = button.getAttribute('onclick') || '';
    if (/false|'rejected'|"rejected"/.test(action)) return false;
    return /одобр|принять|подтверд|выдать|выплат/i.test(button.textContent) ||
      /(?:approveApp|adminVerifyAccount|payoutJanitorSubmission|adminApproveBiz|reviewAtmRequest|kapaniReviewScooter|approvePoliceRequest)\(/.test(action);
  });
  return String(buttons.length);
}

function updateQueueLinks() {
  const host = document.getElementById('civicQueueLinks');
  if (!host) return;
  QUEUES.forEach(([id]) => {
    const badge = document.getElementById(`civic-count-${id}`);
    if (badge) badge.textContent = queueCount(document.getElementById(id));
  });
}

function applyResidentFilter() {
  const list = document.getElementById('allUsersList');
  const search = document.getElementById('civicResidentSearch');
  const sort = document.getElementById('civicResidentSort');
  if (!list || !search || !sort) return;
  const term = search.value.trim().toLocaleLowerCase('ru');
  const rows = Array.from(list.children);
  rows.forEach(row => { row.hidden = !row.textContent.toLocaleLowerCase('ru').includes(term); });
  rows.sort((a,b) => a.textContent.trim().localeCompare(b.textContent.trim(),'ru') * (sort.value === 'desc' ? -1 : 1));
  if (rows.some((row,index) => list.children[index] !== row)) rows.forEach(row => list.appendChild(row));
  const result = document.getElementById('civicResidentResult');
  if (result) result.textContent = `${rows.filter(row => !row.hidden).length} из ${rows.length}`;
}

function buildAdminWorkspace() {
  const page = document.getElementById('adminPage');
  if (!page || document.getElementById('civicAdminHead') || window._getCurrentNick?.() !== window.ADMIN) return;
  const head = document.createElement('div');
  head.id = 'civicAdminHead';
  head.className = 'civic-admin-head';
  head.innerHTML = '<h1>Мэрия</h1><p>Заявки, жители и управление городом в одном месте.</p>';
  page.prepend(head);
  const tabs = document.createElement('div');
  tabs.className = 'civic-admin-tabs';
  tabs.setAttribute('role','tablist');
  tabs.setAttribute('aria-label','Разделы мэрии');
  tabs.innerHTML = Object.entries(TAB_NAMES).map(([id,label]) => `<button type="button" role="tab" id="civic-tab-${id}" aria-controls="civic-panel-${id}" aria-selected="false">${label}</button>`).join('');
  head.after(tabs);
  Object.keys(TAB_NAMES).forEach(id => {
    const panel = document.createElement('div');
    panel.className = 'civic-admin-panel';
    panel.id = `civic-panel-${id}`;
    panel.dataset.panel = id;
    panel.setAttribute('role','tabpanel');
    panel.setAttribute('aria-labelledby',`civic-tab-${id}`);
    tabs.after(panel);
    document.getElementById(`civic-tab-${id}`).addEventListener('click', () => selectAdminTab(id));
  });
  const overview = document.createElement('div');
  overview.className = 'civic-admin-card';
  overview.innerHTML = `<h2>Ожидают решения</h2><p>Откройте очередь, чтобы рассмотреть заявки.</p><div class="civic-queue-links" id="civicQueueLinks">${QUEUES.map(([id,label]) => `<button type="button" data-queue="${id}"><span>${safeText(label)}</span><strong id="civic-count-${id}">—</strong></button>`).join('')}</div>`;
  adminPanel('overview').appendChild(overview);
  overview.querySelectorAll('[data-queue]').forEach(button => button.addEventListener('click', () => {
    selectAdminTab('requests');
    document.getElementById(button.dataset.queue)?.closest('.card')?.scrollIntoView({block:'start',behavior:'smooth'});
  }));
  const residentTools = document.createElement('div');
  residentTools.className = 'civic-admin-card civic-filter';
  residentTools.innerHTML = '<h2>Найти жителя</h2><label for="civicResidentSearch">Поиск по имени, роли или балансу</label><input id="civicResidentSearch" type="search" placeholder="Имя или роль"><label for="civicResidentSort">Порядок</label><select id="civicResidentSort"><option value="asc">По имени: А–Я</option><option value="desc">По имени: Я–А</option></select><div id="civicResidentResult" class="civic-status" role="status"></div>';
  adminPanel('residents').prepend(residentTools);
  residentTools.querySelector('input').addEventListener('input',applyResidentFilter);
  residentTools.querySelector('select').addEventListener('change',applyResidentFilter);
  adminPanel('appearance').appendChild(makeAppearanceCard());
  arrangeAdminCards();
  harmonizeIcons(page);
  selectAdminTab(activeTab);
  updateAppearanceUI();
  adminObserver = new MutationObserver(() => {
    if (arrangePending) return;
    arrangePending = true;
    queueMicrotask(() => { arrangePending = false; arrangeAdminCards(); });
  });
  adminObserver.observe(page,{childList:true});
  queueObserver = new MutationObserver(() => {
    if (!arrangePending) requestAnimationFrame(() => { updateQueueLinks(); applyResidentFilter(); });
  });
  adminPanel('requests').addEventListener('click', updateQueueLinks);
  queueObserver.observe(adminPanel('requests'),{childList:true,subtree:true,characterData:true});
  const residentList = document.getElementById('allUsersList');
  if (residentList) {
    residentObserver = new MutationObserver(() => queueMicrotask(applyResidentFilter));
    residentObserver.observe(residentList,{childList:true});
  }
}

async function watchAppearance() {
  try {
    const auth = await window.kapaniGetAuth();
    const {onAuthStateChanged} = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    onAuthStateChanged(auth, user => {
      if (appearanceUnsubscribe) { appearanceUnsubscribe(); appearanceUnsubscribe = null; }
      if (!user) { savedMonth = initialMonth; previewMonth = savedMonth; setSeason(savedMonth); return; }
      const appearanceRef = window.dbRef(window.db,'siteAppearance');
      appearanceUnsubscribe = window.dbOnValue(appearanceRef, async snapshot => {
        const value = snapshot.val();
        const month = Number(value?.month);
        savedMonth = Number.isInteger(month) && month >= 1 && month <= 12 ? month : initialMonth;
        previewMonth = savedMonth;
        setSeason(savedMonth);
        appearanceStatus = value ? `Сейчас используется ${MONTHS[savedMonth - 1][0]}.` : `Начальное оформление: ${MONTHS[savedMonth - 1][0]}.`;
        updateAppearanceUI();
        if (!value && user.uid === window.ADMIN) {
          try {
            if ((await user.getIdTokenResult()).claims.admin) {
              await window.runTransaction(appearanceRef, current => current || {month:initialMonth,updatedAt:Date.now()});
            }
          } catch (error) {
            appearanceStatus = `Начальное оформление пока не сохранено: ${error?.message || 'ошибка сети'}`;
            updateAppearanceUI();
          }
        }
      }, error => {
        previewMonth = savedMonth;
        setSeason(savedMonth);
        appearanceStatus = `Не удалось загрузить общее оформление: ${error?.message || 'ошибка сети'}`;
        updateAppearanceUI();
      });
    });
  } catch (error) {
    appearanceStatus = `Не удалось подключить оформление: ${error?.message || 'ошибка'}`;
    updateAppearanceUI();
  }
}

if (window.KAPANI_READY) {
  window.KAPANI_READY.then(() => {
    watchAppearance();
    const pendingIcons = new Set();
    let iconFrame = 0;
    const iconObserver = new MutationObserver(records => {
      records.forEach(record => record.addedNodes.forEach(node => {
        if (node.nodeType === 1 && !node.closest?.('#chatMessages,#dmMessages')) pendingIcons.add(node);
      }));
      if (iconFrame || !pendingIcons.size) return;
      iconFrame = requestAnimationFrame(() => {
        iconFrame = 0;
        pendingIcons.forEach(harmonizeIcons);
        pendingIcons.clear();
      });
    });
    const appRoot = document.getElementById('mainApp');
    if (appRoot) iconObserver.observe(appRoot,{childList:true,subtree:true});
    const originalNav = window.navTo;
    window.navTo = function(id) {
      if (id === 'adminPage' && window._getCurrentNick?.() !== window.ADMIN) return;
      const result = originalNav?.apply(this, arguments);
      requestAnimationFrame(() => harmonizeIcons(document.getElementById(id)));
      if (id === 'adminPage' && document.getElementById('adminPage')?.classList.contains('active')) {
        buildAdminWorkspace();
        setTimeout(arrangeAdminCards, 220);
      }
      return result;
    };
    if (document.getElementById('adminPage')?.classList.contains('active')) buildAdminWorkspace();
  });
}
