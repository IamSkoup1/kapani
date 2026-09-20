/**
 * Kapani free Web Push — Cloudflare Worker (no Firebase Functions, no FCM SDK).
 *
 *   site ──► pushOutbox/<job> (RTDB) ──► POST /event ──► this Worker
 *                                                         ├─ reads the real message/notification from RTDB
 *                                                         ├─ writes inbox records users/<nick>/notifications/*
 *                                                         └─ sends Web Push (VAPID + aes128gcm, WebCrypto)
 *   cron (every minute) re-processes jobs that were not delivered immediately.
 *
 * Bindings / config (see SETUP.md):
 *   KV  PUSH_KV                       — all push subscriptions live in the single key "subs"
 *   var FIREBASE_DATABASE_URL, VAPID_PUBLIC_KEY, VAPID_SUBJECT, APP_URL, ALLOWED_ORIGINS, MAX_PUSH_PER_RUN
 *   secret VAPID_PRIVATE_KEY, FIREBASE_SERVICE_ACCOUNT_JSON
 */

const te = new TextEncoder();
const enc = encodeURIComponent;
const PUSH_HOST_ALLOW = /(^|\.)(googleapis\.com|mozilla\.com|mozaws\.net|apple\.com|windows\.com)$/i;
const MAX_DEVICES_PER_USER = 8;
const CATEGORIES = ['messages', 'money', 'taxi_orders', 'delivery_orders', 'market', 'news', 'system'];

/* ───────────── small helpers ───────────── */
function b64uEnc(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uDec(str) {
  let s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...arrs) {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
async function sha256Hex(str) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(String(str))));
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const validNick = n => typeof n === 'string' && /^[^/.#$\[\]\s][^/.#$\[\]]{0,63}$/.test(n);
const validKey = k => typeof k === 'string' && /^[-\w]{3,80}$/.test(k);
function moscowTime(ts) {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
}
function sanitizePrefs(src) {
  const s = src && typeof src === 'object' ? src : {};
  const p = { enabled: s.enabled !== false };
  for (const c of CATEGORIES) if (Object.prototype.hasOwnProperty.call(s, c)) p[c] = s[c] !== false;
  return p;
}
const prefsAllow = (sub, cat) => sub.prefs?.enabled !== false && sub.prefs?.[cat] !== false;

/* ───────────── HTTP plumbing ───────────── */
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = origin && (allowed.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin : (allowed[0] || '*'),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
const json = (request, env, data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...corsHeaders(request, env) } });

/* ───────────── Firebase RTDB over REST (service account OAuth2) ───────────── */
let tokenCache = { value: null, exp: 0 };
async function accessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.value && tokenCache.exp - now > 120) return tokenCache.value;
  let sa;
  try { sa = JSON.parse(String(env.FIREBASE_SERVICE_ACCOUNT_JSON || '')); }
  catch { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing or not valid JSON'); }
  if (!sa.client_email || !sa.private_key) throw new Error('service account JSON lacks client_email/private_key');
  const header = b64uEnc(te.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64uEnc(te.encode(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  })));
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, te.encode(`${header}.${claims}`)));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${b64uEnc(sig)}` })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google OAuth failed: ${res.status}`);
  tokenCache = { value: data.access_token, exp: now + Number(data.expires_in || 3600) };
  return tokenCache.value;
}
async function rtdb(env, method, path, body, query = '') {
  const base = String(env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
  const res = await fetch(`${base}/${path}.json${query}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken(env)}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`RTDB ${method} ${path}: ${res.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}
const rtdbGet = (env, path, query) => rtdb(env, 'GET', path, undefined, query);
const rtdbPatch = (env, patch) => (Object.keys(patch).length ? rtdb(env, 'PATCH', '', patch) : null);

/* Identity model = the site's own: nick + passwordHash that the site keeps in RTDB. */
async function verifyUser(env, nick, ph) {
  if (!validNick(nick) || typeof ph !== 'string' || ph.length < 32) return false;
  const real = await rtdbGet(env, `users/${enc(nick)}/passwordHash`);
  return typeof real === 'string' && safeEqual(real, ph);
}

/* ───────────── subscriptions in KV (single key) ───────────── */
async function loadSubs(env) {
  try { return (await env.PUSH_KV.get('subs', 'json')) || {}; } catch { return {}; }
}
const saveSubs = (env, all) => env.PUSH_KV.put('subs', JSON.stringify(all));

/* ───────────── Web Push: VAPID + aes128gcm (RFC 8291 / 8292) with WebCrypto ───────────── */
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}
async function encryptPayload(sub, text) {
  const uaPub = b64uDec(sub.keys.p256dh), auth = b64uDec(sub.keys.auth);
  if (uaPub.length !== 65 || uaPub[0] !== 4 || auth.length < 16) throw new Error('invalid subscription keys');
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(te.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(te.encode(text), new Uint8Array([2]))));
  const head = new Uint8Array(21);
  head.set(salt, 0); head.set([0, 0, 0x10, 0], 16); head[20] = 65;      // record size 4096, key id length 65
  return concat(head, asPub, ct);
}
let vapidKey = null;
const jwtCache = new Map();
async function vapidJwt(env, endpoint) {
  const aud = new URL(endpoint).origin, now = Math.floor(Date.now() / 1000);
  const hit = jwtCache.get(aud);
  if (hit && hit.exp - now > 3600) return hit.jwt;
  if (!vapidKey) {
    const pub = b64uDec(env.VAPID_PUBLIC_KEY);
    if (pub.length !== 65) throw new Error('VAPID_PUBLIC_KEY must be a 65-byte uncompressed P-256 key (base64url)');
    vapidKey = crypto.subtle.importKey('jwk',
      { kty: 'EC', crv: 'P-256', x: b64uEnc(pub.subarray(1, 33)), y: b64uEnc(pub.subarray(33, 65)), d: b64uEnc(b64uDec(env.VAPID_PRIVATE_KEY)), ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']).catch(e => { vapidKey = null; throw e; });
  }
  const exp = now + 12 * 3600;
  const input = `${b64uEnc(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))}.${b64uEnc(te.encode(JSON.stringify({ aud, exp, sub: env.VAPID_SUBJECT || env.APP_URL })))}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidKey, te.encode(input)));
  const jwt = `${input}.${b64uEnc(sig)}`;
  jwtCache.set(aud, { jwt, exp });
  return jwt;
}
/** Returns the HTTP status of the push service. 404/410 = subscription is gone. */
async function sendPush(env, sub, payload) {
  const body = await encryptPayload(sub, JSON.stringify(payload));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: '86400', Urgency: 'high',
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      Authorization: `vapid t=${await vapidJwt(env, sub.endpoint)}, k=${env.VAPID_PUBLIC_KEY}`
    },
    body
  });
  await res.arrayBuffer().catch(() => {});
  return res.status;
}

/* ───────────── jobs (pushOutbox/<jobId>) ───────────── */
const maxPush = env => Math.max(1, Math.min(40, Number(env.MAX_PUSH_PER_RUN) || 10));
const appUrl = env => String(env.APP_URL || 'https://iamskoup1.github.io/kapani/');

function payloadFromNotification(env, id, n) {
  return {
    title: String(n.title || 'Капани').slice(0, 120),
    body: String(n.text || n.body || '').trim().slice(0, 1000),
    category: String(n.cat || 'system'),
    notificationId: id,
    url: String(n.url || appUrl(env)),
    createdAt: Number(n.createdAt || Date.now()),
    source: String(n.source || ''), sourceMessageId: String(n.sourceMessageId || ''), newsId: String(n.newsId || '')
  };
}
function previewOf(m) {
  let p = String(m.text || m.caption || '').trim();
  if (!p) p = m.msgType === 'image' ? '📷 Фото' : m.msgType === 'voice' ? '🎤 Голосовое сообщение'
    : m.msgType === 'video' ? '🎬 Видео' : m.msgType === 'video_circle' ? '⭕ Видеосообщение' : m.mediaData ? '📎 Вложение' : 'Новое сообщение';
  return p.length > 80 ? p.slice(0, 77) + '...' : p;
}

/** Turns a job into {payload, nicks, inbox, marks}. Returns null when there is nothing to do. */
async function planJob(env, job) {
  const now = Date.now();
  if (job.type === 'deliver') return { payload: job.payload, nicks: job.nicks || [], inbox: {}, marks: {} };

  if (job.type === 'notification') {
    if (!validNick(job.to) || !validKey(job.id)) return null;
    const path = `users/${job.to}/notifications/${job.id}`;
    const n = await rtdbGet(env, `users/${enc(job.to)}/notifications/${enc(job.id)}`);
    if (!n || n.pushedAt || n.push === false) return null;
    const payload = payloadFromNotification(env, job.id, n);
    if (!payload.body) return null;
    if (n.source === 'dm' && n.from) {
      const open = await rtdbGet(env, `presence/${enc(job.to)}/dmOpenWith`);
      if (open === n.from) return { payload, nicks: [], inbox: {}, marks: { [`${path}/pushedAt`]: now } };
    }
    return { payload, nicks: [job.to], inbox: {}, marks: { [`${path}/pushedAt`]: now } };
  }

  if (job.type === 'chat' || job.type === 'news') {
    if (!validKey(job.id) || !validNick(job.sender)) return null;
    const key = `${job.type}_${job.id}`;
    if (await rtdbGet(env, `pushDone/${enc(key)}`)) return null;                 // already fanned out
    const item = await rtdbGet(env, `${job.type === 'chat' ? 'chat' : 'news'}/${enc(job.id)}`);
    if (!item) return null;
    const author = job.type === 'chat' ? item.nick : item.author;
    if (author !== job.sender) return null;                                      // cannot fan out someone else's post
    const users = (await rtdbGet(env, 'users', '?shallow=true')) || {};
    let text, cat, url, source, extra = {};
    if (job.type === 'chat') {
      const name = (await rtdbGet(env, `users/${enc(author)}/displayName`)) || author;
      text = `💬 ${name} написал в общий чат: ${previewOf(item)}`;
      cat = 'messages'; url = `${appUrl(env)}?kpSection=messages`; source = 'general_chat';
      extra = { from: author };
    } else {
      text = `📰 Новая новость в Капани\n${String(item.title || '').trim() || 'Новая публикация'}`;
      cat = 'news'; url = `${appUrl(env)}?kpSection=news&news=${enc(job.id)}`; source = 'news';
      extra = { newsId: job.id };
    }
    const createdAt = Number(item.createdAt || now);
    const record = { text, title: 'Капани', time: moscowTime(createdAt), cat, createdAt, url, push: true, source, sourceMessageId: job.id, ...extra };
    const inbox = {}, recipients = [];
    for (const nick of Object.keys(users)) {
      if (nick === author) continue;
      inbox[`users/${nick}/notifications/${key}`] = record;
      recipients.push(nick);
    }
    let nicks = recipients;
    if (job.type === 'chat') {
      const presence = (await rtdbGet(env, 'presence')) || {};
      nicks = recipients.filter(n => presence[n]?.generalChatOpen !== true);      // chat is open on screen -> no push
    }
    return { payload: payloadFromNotification(env, key, record), nicks, inbox, marks: { [`pushDone/${key}`]: now } };
  }
  return null;
}

/** Processes one job. budget.left = how many pushes this invocation may still send. */
async function processJob(env, jobId, budget, preloaded) {
  const job = preloaded || await rtdbGet(env, `pushOutbox/${enc(jobId)}`);
  const finish = async (extra = {}) => { await rtdbPatch(env, { [`pushOutbox/${jobId}`]: null, ...extra }); };
  if (!job || typeof job !== 'object') return { sent: 0, next: null };
  const plan = await planJob(env, job);
  if (!plan) { await finish(); return { sent: 0, next: null }; }

  if (Object.keys(plan.inbox).length) await rtdbPatch(env, plan.inbox);          // inbox first: the record exists before the push arrives

  const all = await loadSubs(env);
  const dead = [];
  let sent = 0, i = 0;
  for (; i < plan.nicks.length; i++) {
    const nick = plan.nicks[i];
    const subs = (all[nick] || []).filter(s => prefsAllow(s, plan.payload.category));
    if (subs.length && budget.left < subs.length && sent > 0) break;              // continue in the next invocation
    for (const s of subs) {
      if (budget.left <= 0) break;
      budget.left--;
      try {
        const status = await sendPush(env, s, plan.payload);
        if (status === 404 || status === 410) dead.push([nick, s.id]);
        else if (status >= 200 && status < 300) sent++;
        else console.warn('push status', status, new URL(s.endpoint).host);
      } catch (e) { console.warn('push error', nick, String(e?.message || e)); }
    }
    if (budget.left <= 0) { i++; break; }
  }
  if (dead.length) {
    const fresh = await loadSubs(env);
    for (const [nick, id] of dead) if (fresh[nick]) { fresh[nick] = fresh[nick].filter(s => s.id !== id); if (!fresh[nick].length) delete fresh[nick]; }
    await saveSubs(env, fresh);
  }
  const rest = plan.nicks.slice(i);
  const extra = { ...plan.marks };                                                // pushDone / pushedAt: written once, so a repeated /event cannot fan out twice
  let next = null;
  if (rest.length) {                                                              // over budget: hand the remaining recipients to a continuation job
    next = `${String(jobId).replace(/_c[0-9a-z]+$/, '')}_c${Date.now().toString(36)}`;
    extra[`pushOutbox/${next}`] = { type: 'deliver', payload: plan.payload, nicks: rest, ts: Date.now() };
  }
  await finish(extra);
  return { sent, next };
}

async function runCron(env) {
  const jobs = await rtdbGet(env, 'pushOutbox', '?orderBy=%22%24key%22&limitToFirst=10');
  if (!jobs) return;
  const budget = { left: maxPush(env) };
  for (const [id, job] of Object.entries(jobs)) {
    if (budget.left <= 0) break;
    const age = Date.now() - Number(job?.ts || 0);
    if (age > 24 * 3600e3) { await rtdbPatch(env, { [`pushOutbox/${id}`]: null }); continue; }
    if (age < 15000) continue;                                                    // the live /event call is probably handling it
    try { await processJob(env, id, budget, job); }
    catch (e) {
      const attempts = Number(job.attempts || 0) + 1;
      console.warn('job failed', id, String(e?.message || e));
      await rtdbPatch(env, { [`pushOutbox/${id}`]: attempts >= 5 ? null : { ...job, attempts } }).catch(() => {});
    }
  }
}

/* ───────────── request handlers ───────────── */
async function handleSubscribe(request, env, body) {
  const { nick, ph, subscription: s, prefs, userAgent } = body;
  if (!(await verifyUser(env, nick, ph))) return json(request, env, { error: 'unauthorized' }, 401);
  let host = '';
  try { const u = new URL(String(s?.endpoint || '')); if (u.protocol === 'https:') host = u.hostname; } catch {}
  if (!host || !PUSH_HOST_ALLOW.test(host) || !s?.keys?.p256dh || !s?.keys?.auth) return json(request, env, { error: 'bad subscription' }, 400);
  const id = (await sha256Hex(s.endpoint)).slice(0, 32);
  const all = await loadSubs(env);
  for (const n of Object.keys(all)) {                                             // a device belongs to one account
    if (n === nick) continue;
    all[n] = all[n].filter(x => x.id !== id);
    if (!all[n].length) delete all[n];
  }
  const mine = (all[nick] || []).filter(x => x.id !== id);
  mine.unshift({ id, endpoint: s.endpoint, keys: { p256dh: String(s.keys.p256dh), auth: String(s.keys.auth) }, prefs: sanitizePrefs(prefs), ua: String(userAgent || '').slice(0, 200), updatedAt: Date.now() });
  all[nick] = mine.slice(0, MAX_DEVICES_PER_USER);
  await saveSubs(env, all);
  return json(request, env, { success: true, subscriptionId: id });
}
async function handleUnsubscribe(request, env, body) {
  if (!(await verifyUser(env, body.nick, body.ph))) return json(request, env, { error: 'unauthorized' }, 401);
  const all = await loadSubs(env);
  const before = (all[body.nick] || []).length;
  all[body.nick] = (all[body.nick] || []).filter(x => x.id !== body.subscriptionId);
  if (!all[body.nick].length) delete all[body.nick];
  await saveSubs(env, all);
  return json(request, env, { success: true, removed: before !== (all[body.nick] || []).length });
}
async function handlePrefs(request, env, body) {
  if (!(await verifyUser(env, body.nick, body.ph))) return json(request, env, { error: 'unauthorized' }, 401);
  const all = await loadSubs(env);
  const sub = (all[body.nick] || []).find(x => x.id === body.subscriptionId);
  if (!sub) return json(request, env, { error: 'subscription not found' }, 404);
  sub.prefs = sanitizePrefs(body.prefs);
  await saveSubs(env, all);
  return json(request, env, { success: true, prefs: sub.prefs });
}
async function handleEvent(request, env, body) {
  let jobId = String(body.jobId || '');
  if (body.job) {                                                                 // fallback: the browser could not write the outbox itself
    if (!(await verifyUser(env, body.nick, body.ph))) return json(request, env, { error: 'unauthorized' }, 401);
    const j = body.job;
    if (!['notification', 'chat', 'news'].includes(j?.type)) return json(request, env, { error: 'bad job' }, 400);
    jobId = `w${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
    await rtdb(env, 'PUT', `pushOutbox/${jobId}`, { type: j.type, id: String(j.id || ''), to: String(j.to || ''), sender: body.nick, ts: Date.now() });
  }
  if (!validKey(jobId)) return json(request, env, { error: 'bad jobId' }, 400);
  const budget = { left: maxPush(env) };
  const r = await processJob(env, jobId, budget);
  return json(request, env, { ok: true, sent: r.sent, next: r.next });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    try {
      if (url.pathname === '/health') {
        const subs = await loadSubs(env);
        return json(request, env, {
          ok: true,
          kv: !!env.PUSH_KV,
          vapidPublic: !!env.VAPID_PUBLIC_KEY, vapidPrivate: !!env.VAPID_PRIVATE_KEY,
          serviceAccount: !!env.FIREBASE_SERVICE_ACCOUNT_JSON,
          subscribers: Object.keys(subs).length, devices: Object.values(subs).reduce((n, l) => n + l.length, 0)
        });
      }
      if (request.method !== 'POST') return json(request, env, { error: 'not found' }, 404);
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object') return json(request, env, { error: 'bad json' }, 400);
      if (url.pathname === '/subscribe') return await handleSubscribe(request, env, body);
      if (url.pathname === '/unsubscribe') return await handleUnsubscribe(request, env, body);
      if (url.pathname === '/prefs') return await handlePrefs(request, env, body);
      if (url.pathname === '/event') return await handleEvent(request, env, body);
      return json(request, env, { error: 'not found' }, 404);
    } catch (e) {
      console.error('worker error', String(e?.message || e));
      return json(request, env, { error: 'server error', detail: String(e?.message || e).slice(0, 200) }, 500);
    }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(runCron(env)); }
};
