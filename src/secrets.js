// Sealed secrets, for a host (Railway) whose variables are set through tools that would otherwise see them.
// At its first start Kira makes an RSA key pair on its own volume (seal-key.pem, never leaves it) and serves
// the public half at GET /seal-key. On the machine that holds the secret:
//
//   ~/fleet/op read "op://Agents/Discord bot Kira/credential" | node scripts/seal.mjs https://mcp.playhorizon.dev/seal-key
//
// prints a base64 blob only this volume's key opens; it goes in the variable DISCORD_TOKEN_SEALED. At start,
// every FOO_SEALED becomes FOO (a plain FOO, if set, wins). A new volume means a new key: seal again.
import { generateKeyPairSync, createPrivateKey, createPublicKey, privateDecrypt, publicEncrypt, constants } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OAEP = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' };
export let publicKey = null;

export function unseal(dir, env = process.env) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'seal-key.pem');
  if (!existsSync(file)) {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
    writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    console.log('sealed secrets: new key pair made');
  }
  const key = createPrivateKey(readFileSync(file));
  publicKey = createPublicKey(key).export({ type: 'spki', format: 'pem' });
  const opened = [];
  for (const [name, value] of Object.entries(env)) {
    if (!name.endsWith('_SEALED') || !value) continue;
    const plain = name.slice(0, -'_SEALED'.length);
    try {
      env[plain] ??= value.split('.').map((part) => privateDecrypt({ key, ...OAEP }, Buffer.from(part, 'base64')).toString('utf8')).join('');
      opened.push(plain);
    } catch {
      console.error(`sealed secrets: ${name} doesn't open with this volume's key (seal it again)`);
    }
  }
  if (opened.length) console.log('sealed secrets opened:', opened.join(', '));
  return publicKey;
}

// RSA-OAEP holds at most 318 bytes with a 3072-bit key: a longer secret (a PEM key) is sealed in parts, joined by '.'.
const PART = 300;
export function seal(publicPem, secret) {
  const parts = [];
  for (let i = 0; i < secret.length; i += PART) {
    parts.push(publicEncrypt({ key: publicPem, ...OAEP }, Buffer.from(secret.slice(i, i + PART), 'utf8')).toString('base64'));
  }
  return parts.join('.');
}
