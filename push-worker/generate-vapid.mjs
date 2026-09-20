// node generate-vapid.mjs  → prints a NEW VAPID key pair in the format the worker and config.js expect.
import { generateKeyPairSync } from 'node:crypto';
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const j = privateKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')]).toString('base64url');
console.log('VAPID_PUBLIC_KEY  (wrangler.toml [vars] AND config.js webPushVapidPublicKey):\n' + pub + '\n');
console.log('VAPID_PRIVATE_KEY (secret, only for `wrangler secret put VAPID_PRIVATE_KEY`, keep it private):\n' + j.d + '\n');
