/* Kapani Web Push Service Worker.
 * One Service Worker only: receives standard Web Push and renders system notifications.
 */
const SW_VERSION = 'kapani-webpush-2026-10-03-v5';
const KAPANI_APP_PATH = '/kapani/';

function resolveNotificationUrl(requestedUrl) {
  try {
    const raw = String(requestedUrl || '').trim();
    if (!raw) return new URL(KAPANI_APP_PATH, self.location.origin).href;
    const url = new URL(raw, self.location.origin);
    if (url.origin !== self.location.origin) return new URL(KAPANI_APP_PATH, self.location.origin).href;
    if (url.pathname === '/index.html') {
      const canonical = new URL(KAPANI_APP_PATH, self.location.origin);
      canonical.search = url.search; canonical.hash = url.hash; return canonical.href;
    }
    return url.href;
  } catch (_) { return new URL(KAPANI_APP_PATH, self.location.origin).href; }
}

const DEDUPE_TTL = 7 * 86400000;
let databasePromise;
function pushDatabase(){
  return databasePromise ||= new Promise((resolve,reject)=>{
    const request=indexedDB.open('KapaniPushDB',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('shownNotifications',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>{databasePromise=null;reject(request.error);};
  });
}
async function reserveNotification(id){
  const db=await pushDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('shownNotifications','readwrite'),store=tx.objectStore('shownNotifications');
    let reserved=false;
    const request=store.get(id);
    request.onsuccess=()=>{
      if(!request.result || Date.now()-request.result.timestamp>DEDUPE_TTL){store.put({id,timestamp:Date.now()});reserved=true;}
    };
    const cursor=store.openCursor();
    cursor.onsuccess=()=>{const c=cursor.result;if(c){if(Date.now()-c.value.timestamp>DEDUPE_TTL)c.delete();c.continue();}};
    tx.oncomplete=()=>resolve(reserved);tx.onabort=()=>reject(tx.error);
  });
}
async function forgetNotification(id){
  const db=await pushDatabase();
  return new Promise((resolve,reject)=>{const tx=db.transaction('shownNotifications','readwrite');tx.objectStore('shownNotifications').delete(id);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
}
// Serialize foreground + push handlers; IDB remains authoritative across worker restarts.
let displayQueue=Promise.resolve();
function showKapaniPush(data){
  const task=displayQueue.then(()=>displayKapaniPush(data));
  displayQueue=task.catch(()=>{});
  return task;
}

async function displayKapaniPush(data = {}) {
  const notificationId = String(data.notificationId || '').trim();
  const dedupeId=String(data.recipientNick||'')+':'+notificationId;
  const body = String(data.body || data.text || '').trim(); if (!body) return false;
  const category = String(data.category || 'system');
  const title = String(data.title || 'Капани');
  const targetUrl = resolveNotificationUrl(data.url);
  if(notificationId && !await reserveNotification(dedupeId)) return false;
  try {
  await self.registration.showNotification(title, {
    body,
    icon: new URL('/kapani/image.png', self.location.origin).href,
    badge: new URL('/kapani/image.png', self.location.origin).href,
    tag: notificationId ? `kapani-${notificationId}` : `kapani-${category}-${Date.now()}`,
    renotify: false,
    data: { ...data, url: targetUrl, category, swVersion: SW_VERSION, receivedAt: Date.now() }
  });
  } catch(error) {
    if(notificationId) await forgetNotification(dedupeId);
    throw error;
  }
  return true;
}

function isKapaniUrl(url) {
  try {
    const parsed = new URL(url, self.location.origin);
    return parsed.origin === self.location.origin && (
      parsed.pathname === KAPANI_APP_PATH ||
      parsed.pathname === KAPANI_APP_PATH.replace(/\/$/, '') ||
      parsed.pathname === '/index.html'
    );
  } catch (_) { return false; }
}

self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

/* Foreground helper: the page may explicitly ask the same SW to display a
 * system notification, so there is no second display implementation. */
self.addEventListener('message', event => {
  if (event?.data?.type === 'KAPANI_FOREGROUND_PUSH') {
    event.waitUntil(showKapaniPush(event.data.payload || {}).catch(err => console.error('[Kapani SW] foreground push failed:', err)));
  }
});

/* Standard Web Push. This event is the critical closed-tab path. */
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; }
    catch (_) {
      try { data = { body: event.data ? event.data.text() : '' }; } catch (_) { data = {}; }
    }
    await showKapaniPush(data);
  })().catch(err => console.error('[Kapani SW] push event failed:', err)));
});

/* Browser implementations may rotate subscriptions. The active page will
 * receive this signal and persist the new subscription server-side. */
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) client.postMessage({ type: 'KAPANI_PUSHSUBSCRIPTION_CHANGED' });
    } catch (error) { console.warn('[Kapani SW] pushsubscriptionchange notification failed:', error); }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification?.data || {};
  const targetUrl = resolveNotificationUrl(data.url);
  event.waitUntil((async () => {
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if (!client.url || !isKapaniUrl(client.url)) continue;
        /* The app is already open: focus it and let the page route in-app (no reload). */
        let routed = false;
        try { client.postMessage({ type: 'KAPANI_NOTIFICATION_CLICK', url: targetUrl }); routed = true; } catch (_) {}
        try { await client.focus(); } catch (_) {}
        if (!routed) { try { if ('navigate' in client) await client.navigate(targetUrl); } catch (_) {} }
        return client;
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    } catch (error) {
      console.error('[Kapani SW] notification click failed:', error);
      try { if (self.clients.openWindow) return self.clients.openWindow(resolveNotificationUrl('')); } catch (_) {}
    }
    return undefined;
  })());
});
