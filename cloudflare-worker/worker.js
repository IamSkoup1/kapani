// Kapani Free Push Bridge — production push path.
// Kapani Free Push Bridge
// RTDB -> Cloudflare Worker -> FCM HTTP v1
// RTDB у проекта разрешает публичные read/write правила,
// поэтому для RTDB-запросов авторизация не используется.
// OAuth используется только для FCM.

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const KAPANI_CANONICAL_URL = 'https://iamskoup1.github.io/kapani/';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const IDENTITY_LOOKUP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';

let cachedAccessToken = null;
let cachedAccessTokenExp = 0;

function base64UrlEncode(input) {
  const bytes =
    input instanceof Uint8Array
      ? input
      : new TextEncoder().encode(String(input));

  let binary = '';
  const chunk = 0x8000;

  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, i + chunk)
    );
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function pemToArrayBuffer(pem) {
  const base64 = String(pem || '')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

async function getGoogleAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);

  if (
    cachedAccessToken &&
    cachedAccessTokenExp - now > 120
  ) {
    return cachedAccessToken;
  }

  let serviceAccount;

  try {
    serviceAccount = JSON.parse(
      env.FIREBASE_SERVICE_ACCOUNT_JSON
    );
  } catch (error) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON is invalid JSON'
    );
  }

  if (
    !serviceAccount.client_email ||
    !serviceAccount.private_key
  ) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON is missing client_email or private_key'
    );
  }

  const header = base64UrlEncode(
    JSON.stringify({
      alg: 'RS256',
      typ: 'JWT'
    })
  );

  const payload = base64UrlEncode(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: FCM_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600
    })
  );

  const unsigned = `${header}.${payload}`;

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(serviceAccount.private_key),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(unsigned)
  );

  const assertion =
    `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type':
        'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type:
        'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Google OAuth failed: ${response.status} ${responseText}`
    );
  }

  let json;

  try {
    json = JSON.parse(responseText);
  } catch (_) {
    throw new Error(
      'Google OAuth returned invalid JSON'
    );
  }

  if (!json.access_token) {
    throw new Error(
      'Google OAuth response does not contain access_token'
    );
  }

  cachedAccessToken = json.access_token;
  cachedAccessTokenExp =
    now + Number(json.expires_in || 3600);

  return cachedAccessToken;
}

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


function tokenKey(token) {
  const value = String(token || '');
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
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
  try { input = await request.json(); } catch (_) { return jsonResponse({ ok:false, error:'Invalid JSON' }, 400); }
  try {
    const { uid } = await authenticateRequest(request, env);
    const token = String(input?.token || '').trim();
    if (!token || token.length < 20) return jsonResponse({ ok:false, error:'Invalid FCM token' }, 400);
    const tokenId = tokenKey(token);
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
    return jsonResponse({ ok:true, success:true, tokenId, uid }, 200);
  } catch (error) {
    return jsonResponse({ ok:false, error:String(error?.message || error) }, 401);
  }
}

async function handleUnregister(request, env) {
  let input;
  try { input = await request.json(); } catch (_) { return jsonResponse({ ok:false, error:'Invalid JSON' }, 400); }
  try {
    const { uid } = await authenticateRequest(request, env);
    const tokenId = String(input?.tokenId || '').trim();
    const token = String(input?.token || '').trim();
    const resolved = tokenId || tokenKey(token);
    if (!resolved) return jsonResponse({ ok:false, error:'tokenId or token required' }, 400);
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
    return jsonResponse({ ok:true, success:true, tokenId:resolved, removed:!!tokenSnap || !!legacy }, 200);
  } catch (error) {
    return jsonResponse({ ok:false, error:String(error?.message || error) }, 401);
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
      tokens:tokens.map(entry => ({ tokenId:tokenKey(entry.token), updatedAt:Number(user?.fcmTokens?.[tokenKey(entry.token)]?.updatedAt || user?.fcmUpdatedAt || 0) || null }))
    }, 200);
  } catch (error) {
    return jsonResponse({ ok:false, error:String(error?.message || error) }, 401);
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

async function sendOneFcm(
  env,
  accessToken,
  token,
  notificationId,
  notification
) {
  const projectId = String(
    env.FIREBASE_PROJECT_ID || 'kapanisite'
  );

  const url =
    `https://fcm.googleapis.com/v1/projects/` +
    `${encodeURIComponent(projectId)}/messages:send`;

  const title = String(
    notification?.title || 'Капани'
  );

  const body = String(
    notification?.text ||
    notification?.body ||
    ''
  );

  const category = String(
    notification?.cat || 'system'
  );

  const targetUrl = String(
    notification?.url || KAPANI_CANONICAL_URL
  );

  const createdAt = String(
    notification?.createdAt || Date.now()
  );

  const payload = {
    message: {
      token,

      data: {
        title,
        body,
        text: body,
        category,
        notificationId: String(notificationId),
        url: targetUrl,
        createdAt
      },

      webpush: {
        headers: {
          Urgency: 'high'
        }
      }
    }
  };

  const response = await fetch(
    url,
    {
      method: 'POST',
      headers: {
        Authorization:
          `Bearer ${accessToken}`,
        'content-type':
          'application/json; UTF-8'
      },
      body: JSON.stringify(payload)
    }
  );

  const text = await response.text();

  let json = null;

  try {
    json = JSON.parse(text);
  } catch (_) {}

  return {
    ok: response.ok,
    status: response.status,
    json,
    text
  };
}

function shouldRemoveToken(result) {
  const status =
    Number(result?.status || 0);

  const errorCode =
    String(
      result?.json?.error?.details?.[0]
        ?.errorCode || ''
    );

  const errorStatus =
    String(
      result?.json?.error?.status || ''
    );

  return (
    status === 404 ||
    status === 400 ||
    errorStatus === 'NOT_FOUND' ||
    errorCode === 'UNREGISTERED'
  );
}

async function handlePush(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse(
      {
        ok: true,
        service:
          'kapani-free-push-bridge'
      },
      200
    );
  }

  let input;

  try {
    input = await request.json();
  } catch (_) {
    return jsonResponse(
      {
        ok: false,
        error: 'Invalid JSON'
      },
      400
    );
  }

  const nick = String(
    input?.nick || ''
  ).trim();

  const notificationId = String(
    input?.notificationId || ''
  ).trim();

  if (!nick || !notificationId) {
    return jsonResponse(
      {
        ok: false,
        error:
          'nick and notificationId are required'
      },
      400
    );
  }

  const safeNick =
    encodeURIComponent(nick);

  const safeId =
    encodeURIComponent(notificationId);

  // Read notification directly from public RTDB.
  const notification =
    await rtdbGet(
      env,
      `users/${safeNick}/notifications/${safeId}`
    );

  if (
    !notification ||
    notification.push === false
  ) {
    return jsonResponse(
      {
        ok: true,
        skipped: true
      },
      200
    );
  }

  const createdAt =
    Number(notification.createdAt || 0);

  if (
    !createdAt ||
    Math.abs(Date.now() - createdAt) >
      10 * 60 * 1000
  ) {
    return jsonResponse(
      {
        ok: false,
        error:
          'Notification is outside the push window'
      },
      409
    );
  }

  // Read user from RTDB without OAuth.
  const user =
    await rtdbGet(
      env,
      `users/${safeNick}`
    );

  const tokens =
    collectTokens(user).slice(0, 25);

  if (!tokens.length) {
    return jsonResponse(
      {
        ok: true,
        sent: 0,
        reason: 'no tokens'
      },
      200
    );
  }

  // OAuth is required only for FCM.
  const accessToken =
    await getGoogleAccessToken(env);

  const results =
    await Promise.all(
      tokens.map(
        async (entry) => {
          try {
            const result =
              await sendOneFcm(
                env,
                accessToken,
                entry.token,
                notificationId,
                notification
              );

            return {
              ...entry,
              result
            };
          } catch (error) {
            return {
              ...entry,
              result: {
                ok: false,
                status: 500,
                error:
                  String(
                    error?.message ||
                    error
                  )
              }
            };
          }
        }
      )
    );

  const cleanup = {};

  let sent = 0;
  let removed = 0;

  for (const item of results) {
    if (item.result.ok) {
      sent++;
      continue;
    }

    if (
      shouldRemoveToken(item.result)
    ) {
      if (item.path) {
        cleanup[
          `users/${safeNick}/${item.path}`
        ] = null;
      } else {
        cleanup[
          `users/${safeNick}/fcmToken`
        ] = null;
      }
    }
  }

  if (
    Object.keys(cleanup).length
  ) {
    await rtdbPatch(
      env,
      cleanup
    );

    removed =
      Object.keys(cleanup).length;
  }

  // Mark notification as processed.
  try {
    await rtdbPatch(
      env,
      {
        [`users/${safeNick}/notifications/${safeId}/pushBridgeProcessedAt`]:
          Date.now()
      }
    );
  } catch (_) {}

  return jsonResponse(
    {
      ok: true,
      sent,
      attempted: tokens.length,
      removed
    },
    200
  );
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods':
      'POST, OPTIONS',
    'access-control-allow-headers':
      'content-type'
  };
}

function jsonResponse(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        'content-type':
          'application/json; charset=utf-8',
        ...corsHeaders()
      }
    }
  );
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
        return jsonResponse({ ok: true, service: 'kapani-free-push-bridge' }, 200);
      }
      if (request.method !== 'POST') return jsonResponse({ ok:false, error:'Method not allowed' }, 405);
      if (url.pathname === '/register') return await handleRegister(request, env);
      if (url.pathname === '/unregister') return await handleUnregister(request, env);
      if (url.pathname === '/diagnostics') return await handleDiagnostics(request, env);
      if (url.pathname === '/push' || url.pathname === '/send') {
        try { await authenticateRequest(request, env); }
        catch (error) { return jsonResponse({ ok:false, error:String(error?.message || error) }, 401); }
        return await handlePush(request, env);
      }
      return jsonResponse({ ok:false, error:'Not found' }, 404);
    } catch (error) {
      console.error('[Kapani Free Push]', error);
      return jsonResponse({ ok:false, error:String(error?.message || error) }, 500);
    }
  }
};