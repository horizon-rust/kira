import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { makeAppToken, githubToken } from '../src/github-app.js';
import { makeGitHub } from '../src/github.js';
import { seal, unseal } from '../src/secrets.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });

function fakeGitHub(t0) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization, method: opts.method });
    const json = url.endsWith('/orgs/horizon-rust/installation') ? { id: 42 }
      : url.endsWith('/app/installations/42/access_tokens') ? { token: `ghs_${calls.length}`, expires_at: new Date(t0 + 3_600_000).toISOString() }
      : { ok: true };
    return { ok: true, status: 200, json: async () => json, headers: { get: () => null } };
  };
  return { calls, fetchImpl };
}

test('the app mints an installation token with a signed JWT and keeps it until near expiry', async () => {
  let now = Date.parse('2026-10-28T20:00:00Z');
  const { calls, fetchImpl } = fakeGitHub(now);
  const token = makeAppToken({ appId: 5514019, privateKey: pem, fetchImpl, now: () => now });
  const [a, b] = await Promise.all([token(), token()]);
  assert.equal(a, b);
  assert.equal(calls.length, 2); // one installation lookup, one mint, even with two callers
  const jwt = calls[0].auth.replace('Bearer ', '');
  const [h, p, sig] = jwt.split('.');
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, sig, 'base64url'));
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(claims.iss, '5514019');
  assert.ok(claims.exp - claims.iat <= 600);
  now += 50 * 60_000;
  assert.equal(await token(), a);
  now += 6 * 60_000; // 4 minutes left: a new one
  assert.notEqual(await token(), a);
  assert.equal(calls.length, 3); // the installation id is kept
});

test('the GitHub client sends the app token', async () => {
  const seen = [];
  const gh = makeGitHub({ token: async () => 'ghs_app', fetchImpl: async (url, opts) => { seen.push(opts.headers.Authorization); return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } }; } });
  await gh.get('/repos/horizon-rust/horizon');
  assert.deepEqual(seen, ['Bearer ghs_app']);
});

test('githubToken: the app when its variables are set, else GITHUB_TOKEN', () => {
  assert.equal(githubToken({ GITHUB_TOKEN: ' ghp_x ' }), 'ghp_x');
  assert.equal(typeof githubToken({ GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: pem, GITHUB_TOKEN: 'ghp_x' }), 'function');
});

test('a secret longer than one RSA block seals in parts and opens whole', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kira-seal-'));
  const pub = unseal(dir, {});
  const env = { GITHUB_APP_PRIVATE_KEY_SEALED: seal(pub, pem) };
  assert.ok(env.GITHUB_APP_PRIVATE_KEY_SEALED.includes('.'));
  unseal(dir, env);
  assert.equal(env.GITHUB_APP_PRIVATE_KEY, pem);
});
