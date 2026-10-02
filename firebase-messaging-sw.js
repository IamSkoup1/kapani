/* Kapani Web Push Service Worker.
 * One Service Worker only: receives standard Web Push and renders system notifications.
 */
const SW_VERSION = 'kapani-webpush-2026-10-02-idb-v1';
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

const PUSH_DB_NAME = 'KapaniPushDB';
const PUSH_DB_VERSION = 1;
const PUSH_STORE = 'shownNotifications';
const PUSH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function openPushDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(PUSH_DB_NAME,PUSH_DB_VERSION);
    req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains(PUSH_STORE)) db.createObjectStore(PUSH_STORE); };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('IndexedDB unavailable'));
  });
}
async function shownNotification(id){
  if(!id) return false;
  try{
    const db=await openPushDb();
    const value=await new Promise((resolve,reject)=>{ const tx=db.transaction(PUSH_STORE,'readonly'); const r=tx.objectStore(PUSH_STORE).get(id); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
    db.close();
    return Number(value||0)>Date.now()-PUSH_TTL_MS;
  }catch(_){ return false; }
}
async function rememberNotification(id){
  if(!id) return;
  try{
    const db=await openPushDb();
    await new Promise((resolve,reject)=>{ const tx=db.transaction(PUSH_STORE,'readwrite'); tx.objectStore(PUSH_STORE).put(Date.now(),id); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); });
    const db2=await openPushDb();
    const tx=db2.transaction(PUSH_STORE,'readwrite'), store=tx.objectStore(PUSH_STORE), req=store.openCursor(), cutoff=Date.now()-PUSH_TTL_MS;
    req.onsuccess=()=>{ const c=req.result; if(!c) return; if(Number(c.value||0)<cutoff) c.delete(); c.continue(); };
    tx.oncomplete=()=>db2.close();
    db.close();
  }catch(_){ /* push must still display even if the local cache is unavailable */ }
}

async function showKapaniPush(data = {}) {
  const notificationId = String(data.notificationId || '').trim();
  if (notificationId && await shownNotification(notificationId)) return false;
  const body = String(data.body || data.text || '').trim(); if (!body) return false;
  const category = String(data.category || 'system');
  const title = String(data.title || 'Капани');
  const targetUrl = resolveNotificationUrl(data.url);
  await self.registration.showNotification(title, {
    body,
    icon: new URL('/kapani/image.png', self.location.origin).href,
    badge: new URL('/kapani/image.png', self.location.origin).href,
    tag: notificationId ? `kapani-${notificationId}` : `kapani-${category}-${Date.now()}`,
    renotify: false,
    data: { ...data, url: targetUrl, category, swVersion: SW_VERSION, receivedAt: Date.now() }
  });
  if (notificationId) await rememberNotification(notificationId);
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
