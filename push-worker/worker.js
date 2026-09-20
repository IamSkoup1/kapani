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
  try {
    sa = JSON.parse(String(env.FIREBASE_SERVICE_ACCOUNT_JSON || ''));
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing or not valid JSON');
  }
  if (!sa || sa.type !== 'service_account' || !sa.client_email || !sa.private_key) {
    throw new Error('service account JSON lacks type=service_account/client_email/private_key');
  }

  const tokenUri = String(sa.token_uri || 'https://oauth2.googleapis.com/token');
  if (tokenUri !== 'https://oauth2.googleapis.com/token') {
    throw new Error(`Unsupported service-account token_uri: ${tokenUri}`);
  }

  // Google-documented service-account JWT assertion header.
  // `kid` selects the exact public key matching `private_key_id`.
  const headerObj = {
    alg: 'RS256',
    typ: 'JWT',
    ...(sa.private_key_id ? { kid: String(sa.private_key_id) } : {})
  };
  const claimsObj = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database',
    aud: tokenUri,
    iat: now - 5,
    exp: now + 3595
  };
  const header = b64uEnc(te.encode(JSON.stringify(headerObj)));
  const claims = b64uEnc(te.encode(JSON.stringify(claimsObj)));

  const pem = String(sa.private_key)
    .replace(/\r/g, '')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=_-]+$/.test(pem)) throw new Error('service account private_key contains invalid characters');

  let der;
  try {
    der = Uint8Array.from(atob(pem.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  } catch {
    throw new Error('service account private_key is not valid base64');
  }

  let key;
  try {
    key = await crypto.subtle.importKey(
      'pkcs8', der,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['sign']
    );
  } catch (e) {
    throw new Error(`service account private_key import failed: ${String(e?.message || e)}`);
  }

  const sig = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, te.encode(`${header}.${claims}`)
  ));
  const assertion = `${header}.${claims}.${b64uEnc(sig)}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  const raw = await res.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!res.ok || !data.access_token) {
    const reason = [data?.error, data?.error_description].filter(Boolean).join(': ') || raw.slice(0, 300);
    console.error('Google OAuth token exchange failed', {
      status: res.status,
      error: data?.error,
      description: data?.error_description,
      serviceAccount: sa.client_email,
      keyId: sa.private_key_id || null
    });
    throw new Error(`Google OAuth failed: ${res.status}${reason ? ` — ${reason}` : ''}`);
  }

  tokenCache = {
    value: data.access_token,
    exp: Math.floor(Date.now() / 1000) + Math.max(300, Number(data.expires_in || 3600)) - 120
  };
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

/** Turns a job into a processing plan.
 * kind = done    -> process normally
 * kind = retry   -> keep the job; a required RTDB record is not visible yet
 * kind = discard -> the job is invalid, already handled, or explicitly suppressed
 */
async function planJob(env, job) {
  const now = Date.now();
  if (job.type === 'deliver') {
    return {
      kind: 'done',
      payload: job.payload,
      nicks: job.nicks || [],
      inbox: {},
      marks: job.marks || {}
    };
  }

  if (job.type === 'notification') {
    if (!validNick(job.to) || !validKey(job.id)) return { kind: 'discard', reason: 'invalid notification job' };

    const path = `users/${job.to}/notifications/${job.id}`;
    const n = await rtdbGet(env, `users/${enc(job.to)}/notifications/${enc(job.id)}`);

    // The site can create pushOutbox/<jobId> and the notification record in two
    // separate RTDB writes. If /event arrives first, KEEP the job instead of
    // deleting it. Cron will retry it after the notification becomes visible.
    if (!n) return { kind: 'retry', reason: 'notification record not visible yet' };

    if (n.pushedAt) return { kind: 'discard', reason: 'notification already pushed' };
    if (n.push === false) return { kind: 'discard', reason: 'push disabled for notification' };

    const payload = payloadFromNotification(env, job.id, n);
    if (!payload.body) return { kind: 'discard', reason: 'notification has empty body' };

    if (n.source === 'dm' && n.from) {
      const open = await rtdbGet(env, `presence/${enc(job.to)}/dmOpenWith`);
      if (open === n.from) {
        return {
          kind: 'done',
          payload,
          nicks: [],
          inbox: {},
          marks: { [`${path}/pushedAt`]: now }
        };
      }
    }

    return {
      kind: 'done',
      payload,
      nicks: [job.to],
      inbox: {},
      marks: { [`${path}/pushedAt`]: now }
    };
  }

  if (job.type === 'chat' || job.type === 'news') {
    if (!validKey(job.id) || !validNick(job.sender)) return { kind: 'discard', reason: 'invalid fanout job' };

    const key = `${job.type}_${job.id}`;
    if (await rtdbGet(env, `pushDone/${enc(key)}`)) {
      return { kind: 'discard', reason: 'fanout already completed' };
    }

    const item = await rtdbGet(env, `${job.type === 'chat' ? 'chat' : 'news'}/${enc(job.id)}`);
    // Same race protection as notifications: the source object may appear
    // milliseconds after pushOutbox/<jobId>.
    if (!item) return { kind: 'retry', reason: `${job.type} source record not visible yet` };

    const author = job.type === 'chat' ? item.nick : item.author;
    if (author !== job.sender) {
      return { kind: 'discard', reason: 'sender does not match source author' };
    }

    const usersRaw = await rtdbGet(env, 'users', '?shallow=true');
    if (usersRaw === null) return { kind: 'retry', reason: 'users index not visible yet' };
    const users = usersRaw || {};

    let text, cat, url, source, extra = {};
    if (job.type === 'chat') {
      const name = (await rtdbGet(env, `users/${enc(author)}/displayName`)) || author;
      text = `💬 ${name} написал в общий чат: ${previewOf(item)}`;
      cat = 'messages';
      url = `${appUrl(env)}?kpSection=messages`;
      source = 'general_chat';
      extra = { from: author };
    } else {
      text = `📰 Новая новость в Капани\n${String(item.title || '').trim() || 'Новая публикация'}`;
      cat = 'news';
      url = `${appUrl(env)}?kpSection=news&news=${enc(job.id)}`;
      source = 'news';
      extra = { newsId: job.id };
    }

    const createdAt = Number(item.createdAt || now);
    const record = {
      text,
      title: 'Капани',
      time: moscowTime(createdAt),
      cat,
      createdAt,
      url,
      push: true,
      source,
      sourceMessageId: job.id,
      ...extra
    };

    const inbox = {}, recipients = [];
    for (const nick of Object.keys(users)) {
      if (nick === author) continue;
      inbox[`users/${nick}/notifications/${key}`] = record;
      recipients.push(nick);
    }

    let nicks = recipients;
    if (job.type === 'chat') {
      const presence = (await rtdbGet(env, 'presence')) || {};
      nicks = recipients.filter(n => presence[n]?.generalChatOpen !== true);
    }

    return {
      kind: 'done',
      payload: payloadFromNotification(env, key, record),
      nicks,
      inbox,
      // For fanout jobs, delay pushDone until the final continuation job
      // completes. This prevents a partial send from permanently suppressing retries.
      marks: nicks.length ? { [`pushDone/${key}`]: now } : { [`pushDone/${key}`]: now },
      fanoutKey: key
    };
  }

  return { kind: 'discard', reason: 'unknown job type' };
}

/** Processes one job. budget.left = how many pushes this invocation may still send. */
async function processJob(env, jobId, budget, preloaded) {
  const job = preloaded || await rtdbGet(env, `pushOutbox/${enc(jobId)}`);
  const finish = async (extra = {}) => {
    await rtdbPatch(env, { [`pushOutbox/${jobId}`]: null, ...extra });
  };
  if (!job || typeof job !== 'object') {
    console.log('push job missing', jobId);
    return { sent: 0, next: null };
  }

  const plan = await planJob(env, job);

  // IMPORTANT: never delete a job just because the source/notification record
  // is not visible yet. This is the race that was losing normal Kapani pushes.
  if (plan?.kind === 'retry') {
    const attempts = Number(job.attempts || 0) + 1;
    const nextJob = {
      ...job,
      attempts,
      queuedAt: Number(job.queuedAt || job.ts || Date.now()),
      ts: Date.now(),
      lastRetryReason: String(plan.reason || 'temporary condition').slice(0, 160)
    };
    await rtdbPatch(env, { [`pushOutbox/${jobId}`]: nextJob });
    console.log('push job retry', jobId, attempts, plan.reason || 'temporary condition');
    return { sent: 0, next: null, retry: true, reason: plan.reason };
  }

  if (plan?.kind === 'discard' || !plan) {
    await finish();
    console.log('push job discarded', jobId, plan?.reason || 'no plan');
    return { sent: 0, next: null, discarded: true, reason: plan?.reason };
  }

  if (Object.keys(plan.inbox).length) {
    await rtdbPatch(env, plan.inbox); // inbox first: record exists before the push arrives
  }

  const all = await loadSubs(env);
  const dead = [];
  let sent = 0, i = 0, hadPushErrors = false, attempted = 0;

  for (; i < plan.nicks.length; i++) {
    const nick = plan.nicks[i];
    const subs = (all[nick] || []).filter(s => prefsAllow(s, plan.payload.category));

    // If this recipient alone would exceed the remaining budget, defer the
    // whole recipient to a continuation job. This avoids dropping devices.
    if (subs.length && budget.left < subs.length && sent > 0) break;

    for (const s of subs) {
      if (budget.left <= 0) break;
      budget.left--;
      attempted++;

      try {
        const status = await sendPush(env, s, plan.payload);
        console.log('push send result', jobId, nick, s.id, status);

        if (status === 404 || status === 410) {
          dead.push([nick, s.id]);
        } else if (status >= 200 && status < 300) {
          sent++;
        } else {
          hadPushErrors = true;
          console.warn('push status', status, new URL(s.endpoint).host);
        }
      } catch (e) {
        hadPushErrors = true;
        console.warn('push error', jobId, nick, String(e?.message || e));
      }
    }

    if (budget.left <= 0) break;
  }

  if (dead.length) {
    const fresh = await loadSubs(env);
    for (const [nick, id] of dead) {
      if (fresh[nick]) {
        fresh[nick] = fresh[nick].filter(s => s.id !== id);
        if (!fresh[nick].length) delete fresh[nick];
      }
    }
    await saveSubs(env, fresh);
  }

  // A normal notification is only considered delivered after at least one
  // real Web Push succeeds. Temporary send failures keep the job alive.
  if (job.type === 'notification' && plan.nicks.length && sent === 0) {
    const attempts = Number(job.attempts || 0) + 1;
    const retryJob = {
      ...job,
      attempts,
      queuedAt: Number(job.queuedAt || job.ts || Date.now()),
      ts: Date.now(),
      lastRetryReason: attempted ? (hadPushErrors ? 'push delivery failed' : 'no eligible push device') : 'no eligible push device'
    };

    // If there is still no active device, keep the job until the normal
    // 24-hour outbox retention limit. This lets a newly-registered device
    // receive the queued notification instead of losing it immediately.
    await rtdbPatch(env, { [`pushOutbox/${jobId}`]: retryJob });
    console.log('notification queued for retry', jobId, retryJob.lastRetryReason);
    return { sent: 0, next: null, retry: true, reason: retryJob.lastRetryReason };
  }

  const rest = plan.nicks.slice(i);
  let next = null;
  const extra = {};

  // For fanout jobs, do NOT mark pushDone until all recipients fit in the
  // current invocation and have been handed off/processed.
  if (rest.length) {
    next = `${String(jobId).replace(/_c[0-9a-z]+$/, '')}_c${Date.now().toString(36)}`;
    extra[`pushOutbox/${next}`] = {
      type: 'deliver',
      payload: plan.payload,
      nicks: rest,
      marks: plan.marks,
      queuedAt: Number(job.queuedAt || job.ts || Date.now()),
      ts: Date.now()
    };
  } else {
    Object.assign(extra, plan.marks);
  }

  await finish(extra);
  console.log('push job completed', jobId, { sent, attempted, next });
  return { sent, next };
}

async function runCron(env) {
  const jobs = await rtdbGet(env, 'pushOutbox', '?orderBy=%22%24key%22&limitToFirst=10');
  if (!jobs) return;
  const budget = { left: maxPush(env) };
  for (const [id, job] of Object.entries(jobs)) {
    if (budget.left <= 0) break;
    const age = Date.now() - Number(job?.queuedAt || job?.ts || 0);
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
async function handleTest(request, env, body) {
  if (!(await verifyUser(env, body.nick, body.ph))) return json(request, env, { error: 'unauthorized' }, 401);

  const all = await loadSubs(env);
  const subs = (all[body.nick] || []).filter(s => prefsAllow(s, String(body.category || 'system')));
  if (!subs.length) return json(request, env, { ok: true, sent: 0, devices: 0, message: 'no active push devices for this user' });

  const payload = {
    title: String(body.title || 'Капани — тест Push').slice(0, 120),
    body: String(body.body || 'Тестовое Push-уведомление успешно отправлено.').trim().slice(0, 1000),
    category: String(body.category || 'system'),
    notificationId: `test_${Date.now().toString(36)}`,
    url: String(body.url || appUrl(env)),
    createdAt: Date.now(),
    source: 'worker_test',
    sourceMessageId: ''
  };

  let sent = 0;
  const dead = new Set();
  const results = [];
  for (const sub of subs) {
    try {
      const status = await sendPush(env, sub, payload);
      results.push({ id: sub.id, status });
      if (status === 404 || status === 410) dead.add(sub.id);
      else if (status >= 200 && status < 300) sent++;
    } catch (e) {
      results.push({ id: sub.id, error: String(e?.message || e).slice(0, 200) });
    }
  }

  if (dead.size) {
    const fresh = await loadSubs(env);
    if (fresh[body.nick]) {
      fresh[body.nick] = fresh[body.nick].filter(s => !dead.has(s.id));
      if (!fresh[body.nick].length) delete fresh[body.nick];
      await saveSubs(env, fresh);
    }
  }

  return json(request, env, { ok: true, sent, devices: subs.length, results });
}

async function handleEvent(request, env, body) {
  let jobId = String(body.jobId || '');
  if (body.job) {                                                                 // fallback: the browser could not write the outbox itself
    if (!(await verifyUser(env, body.nick, body.ph))) return json(request, env, { error: 'unauthorized' }, 401);
    const j = body.job;
    if (!['notification', 'chat', 'news'].includes(j?.type)) return json(request, env, { error: 'bad job' }, 400);
    jobId = `w${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
    const now = Date.now();
    await rtdb(env, 'PUT', `pushOutbox/${jobId}`, {
      type: j.type,
      id: String(j.id || ''),
      to: String(j.to || ''),
      sender: body.nick,
      queuedAt: now,
      ts: now
    });
  }
  if (!validKey(jobId)) return json(request, env, { error: 'bad jobId' }, 400);
  const budget = { left: maxPush(env) };
  console.log('push event received', jobId, body.job ? 'inline-job' : 'outbox-job');
  const r = await processJob(env, jobId, budget);
  return json(request, env, {
    ok: true,
    sent: r.sent,
    next: r.next,
    retry: !!r.retry,
    discarded: !!r.discarded,
    reason: r.reason || null
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    try {
      if (url.pathname === '/') {
        return json(request, env, {
          ok: true,
          service: 'kapani-push',
          endpoints: { health: 'GET /health', subscribe: 'POST /subscribe', unsubscribe: 'POST /unsubscribe', prefs: 'POST /prefs', event: 'POST /event', test: 'POST /test' }
        });
      }
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
      if (url.pathname === '/test') return await handleTest(request, env, body);
      return json(request, env, { error: 'not found' }, 404);
    } catch (e) {
      console.error('worker error', String(e?.message || e));
      return json(request, env, { error: 'server error', detail: String(e?.message || e).slice(0, 200) }, 500);
    }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(runCron(env)); }
};
