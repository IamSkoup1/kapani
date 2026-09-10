// Kapani Free Push Bridge — production push path.
// Kapani Free Push Bridge
// RTDB -> Cloudflare Worker -> FCM HTTP v1
// RTDB у проекта разрешает публичные read/write правила,
// поэтому для RTDB-запросов авторизация не используется.
// OAuth используется только для FCM.

function rtdbUrl(env, path) {
  const base = String(
    env.FIREBASE_DATABASE_URL || ''
  ).replace(/\/$/, '');

  return `${base}/${path}.json`;
}

// IMPORTANT:
// No Authorization header here.
// Your RTDB Rules already allow public read/write.
async function rtdbGet(env, path) {
  const response = await fetch(
    rtdbUrl(env, path)
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `RTDB GET ${path}: ${response.status} ${text}`
    );
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(
      `RTDB GET ${path}: invalid JSON response`
    );
  }
}

// IMPORTANT:
// No Authorization header here either.
async function rtdbPatch(env, patch) {
  if (!Object.keys(patch).length) return;

  const response = await fetch(
    rtdbUrl(env, ''),
    {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(patch)
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `RTDB PATCH: ${response.status} ${text}`
    );
  }
}


async function tokenKey(token) {
  const value = String(token || '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

function getBearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function authenticateRequest(request, env) {
  const idToken = getBearerToken(request);
  if (!idToken) throw new Error('Missing Firebase ID token');
  const apiKey = String(env.FIREBASE_WEB_API_KEY || '').trim();
  if (!apiKey) throw new Error('FIREBASE_WEB_API_KEY is not configured');

  const response = await fetch(`${IDENTITY_LOOKUP_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Firebase Auth verification failed: ${response.status} ${text}`);
  const json = JSON.parse(text);
  const account = Array.isArray(json.users) ? json.users[0] : null;
  const uid = String(account?.localId || '').trim();
  if (!uid) throw new Error('Firebase ID token has no localId');
  return { uid, account };
}

function extractPrefs(input) {
  const src = input && typeof input === 'object' ? input : {};
  const allowed = ['enabled','messages','money','taxi_orders','delivery_orders','market','news','system'];
  const out = {};
  for (const key of allowed) {
    if (src[key] !== undefined) out[key] = src[key] !== false;
  }
  return out;
}

async function handleRegister(request, env) {
  let input;
  try { input = await request.json(); } catch (_) { return jsonResponse({ ok:false, error:'Invalid JSON' }, 400, request); }
  try {
    const { uid } = await authenticateRequest(request, env);
    const token = String(input?.token || '').trim();
    if (!token || token.length < 20) return jsonResponse({ ok:false, error:'Invalid FCM token' }, 400, request);
    const tokenId = await tokenKey(token);
    const now = Date.now();
    const prefs = extractPrefs(input?.prefs);
    const index = await rtdbGet(env, `fcmTokenIndex/${encodeURIComponent(tokenId)}`);
    const updates = {};

    if (index && index.uid && String(index.uid) !== uid) {
      const oldUid = encodeURIComponent(String(index.uid));
      updates[`users/${oldUid}/fcmTokens/${tokenId}`] = null;
      if (String(index.token || '') === token) updates[`users/${oldUid}/fcmToken`] = null;
    }

    updates[`users/${encodeURIComponent(uid)}/fcmTokens/${tokenId}`] = {
      token,
      updatedAt: now,
      userAgent: String(input?.userAgent || '').slice(0, 500),
      pushPrefs: prefs
    };
    updates[`users/${encodeURIComponent(uid)}/fcmToken`] = token;
    updates[`users/${encodeURIComponent(uid)}/fcmUpdatedAt`] = now;
    if (Object.keys(prefs).length) updates[`users/${encodeURIComponent(uid)}/pushPrefs`] = prefs;
    updates[`fcmTokenIndex/${tokenId}`] = { uid, token, updatedAt: now };
    await rtdbPatch(env, updates);
    return jsonResponse({ ok:true, success:true, tokenId, uid }, 200, request);
  } catch (error) {
    return jsonResponse({ ok:false, error:String(error?.message || error) }, 401, request);
  }
}

async function handleUnregister(request, env) {
  let input;
  try { input = await request.json(); } catch (_) { return jsonResponse({ ok:false, error:'Invalid JSON' }, 400, request); }
  try {
    const { uid } = await authenticateRequest(request, env);
    const tokenId = String(input?.tokenId || '').trim();
    const token = String(input?.token || '').trim();
    const resolved = tokenId || await tokenKey(token);
    if (!resolved) return jsonResponse({ ok:false, error:'tokenId or token required' }, 400, request);
    const userPath = encodeURIComponent(uid);
    const tokenSnap = await rtdbGet(env, `users/${userPath}/fcmTokens/${encodeURIComponent(resolved)}`);
    const legacy = await rtdbGet(env, `users/${userPath}/fcmToken`);
    const updates = {
      [`users/${userPath}/fcmTokens/${encodeURIComponent(resolved)}`]: null,
      [`fcmTokenIndex/${encodeURIComponent(resolved)}`]: null
    };
    const stored = typeof tokenSnap === 'string' ? tokenSnap : String(tokenSnap?.token || '');
    if ((stored && legacy === stored) || (!tokenSnap && token && legacy === token)) {
      updates[`users/${userPath}/fcmToken`] = null;
      updates[`users/${userPath}/fcmUpdatedAt`] = null;
    }
    await rtdbPatch(env, updates);
    return jsonResponse({ ok:true, success:true, tokenId:resolved, removed:!!tokenSnap || !!legacy }, 200, request);
  } catch (error) {
    return jsonResponse({ ok:false, error:String(error?.message || error) }, 401, request);
  }
}

async function handleDiagnostics(request, env) {
  try {
    const { uid } = await authenticateRequest(request, env);
    const user = await rtdbGet(env, `users/${encodeURIComponent(uid)}`) || {};
    const tokens = collectTokens(user);
    return jsonResponse({
      ok:true,
      user:uid,
      tokenCount:tokens.length,
      tokens:await Promise.all(tokens.map(async entry => {
        const tokenId = await tokenKey(entry.token);
        const record = user?.fcmTokens?.[tokenId];
        return { tokenId, updatedAt:Number(record?.updatedAt || user?.fcmUpdatedAt || 0) || null };
      }))
    }, 200, request);
  } catch (error) {
    return jsonResponse({ ok:false, error:String(error?.message || error) }, 401, request);
  }
}

function collectTokens(user) {
  const entries = [];
  const seen = new Set();

  const add = (token, path) => {
    const value = String(token || '').trim();

    if (!value || seen.has(value)) {
      return;
    }

    seen.add(value);
    entries.push({
      token: value,
      path
    });
  };

  add(user?.fcmToken, null);

  const many =
    user?.fcmTokens &&
    typeof user.fcmTokens === 'object'
      ? user.fcmTokens
      : {};

  for (const [id, entry] of Object.entries(many)) {
    if (typeof entry === 'string') {
      add(
        entry,
        `fcmTokens/${id}`
      );
    } else if (
      entry &&
      typeof entry.token === 'string'
    ) {
      add(
        entry.token,
        `fcmTokens/${id}`
      );
    }
  }

  return entries;
}

async function handlePush(request, env) {
  return jsonResponse({
    ok: false,
    deprecated: true,
    code: 'CANONICAL_PIPELINE',
    message: 'Direct FCM sending through Cloudflare is disabled. Firebase Functions notificationQueue is the sole production delivery path.'
  }, 410, request);
}

const ALLOWED_ORIGINS = new Set([
  'https://iamskoup1.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);

function getAllowedOrigin(request) {
  const origin = String(request.headers.get('Origin') || '');
  if (!origin) return null;
  return ALLOWED_ORIGINS.has(origin) ? origin : null;
}

function corsHeaders(request) {
  const origin = getAllowedOrigin(request);
  const requested = String(request.headers.get('Access-Control-Request-Headers') || '');
  const requestedHeaders = requested
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set(['content-type', 'authorization']);
  const reflected = requestedHeaders.filter((header) => allowed.has(header));

  return {
    ...(origin ? {
      'access-control-allow-origin': origin,
      'vary': 'Origin'
    } : {}),
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': reflected.length ? reflected.join(', ') : 'Content-Type, Authorization',
    'access-control-max-age': '86400'
  };
}

function jsonResponse(data, status = 200, request = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(request ? corsHeaders(request) : {})
    }
  });
}

function preflightResponse(request) {
  const origin = getAllowedOrigin(request);
  if (request.headers.get('Origin') && !origin) {
    return new Response(JSON.stringify({ ok: false, error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }
  const requestedMethod = String(request.headers.get('Access-Control-Request-Method') || '').toUpperCase();
  if (requestedMethod && !['GET', 'POST'].includes(requestedMethod)) {
    return new Response(null, { status: 405, headers: corsHeaders(request) });
  }
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return preflightResponse(request);
    }

    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
        return jsonResponse({ ok: true, service: 'kapani-free-push-bridge', canonicalDelivery: 'firebase-functions' }, 200, request);
      }
      if (request.method !== 'POST') return jsonResponse({ ok:false, error:'Method not allowed' }, 405, request);
      if (url.pathname === '/register') return await handleRegister(request, env);
      if (url.pathname === '/unregister') return await handleUnregister(request, env);
      if (url.pathname === '/diagnostics') return await handleDiagnostics(request, env);
      if (url.pathname === '/push' || url.pathname === '/send') {
        try { await authenticateRequest(request, env); }
        catch (error) { return jsonResponse({ ok:false, error:String(error?.message || error) }, 401, request); }
        return await handlePush(request, env);
      }
      return jsonResponse({ ok:false, error:'Not found' }, 404, request);
    } catch (error) {
      console.error('[Kapani Free Push]', error);
      return jsonResponse({ ok:false, error:String(error?.message || error) }, 500, request);
    }
  }
};