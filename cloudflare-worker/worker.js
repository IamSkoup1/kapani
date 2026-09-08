// Kapani Free Push Bridge
// RTDB -> Cloudflare Worker -> FCM HTTP v1
// RTDB у проекта разрешает публичные read/write правила,
// поэтому для RTDB-запросов авторизация не используется.
// OAuth используется только для FCM.

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

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
    notification?.url || './index.html'
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
    if (
      request.method === 'OPTIONS'
    ) {
      return new Response(
        null,
        {
          status: 204,
          headers: corsHeaders()
        }
      );
    }

    try {
      return await handlePush(
        request,
        env
      );
    } catch (error) {
      console.error(
        '[Kapani Free Push]',
        error
      );

      return jsonResponse(
        {
          ok: false,
          error:
            String(
              error?.message ||
              error
            )
        },
        500
      );
    }
  }
};