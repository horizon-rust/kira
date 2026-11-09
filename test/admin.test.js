// The admin routes (src/admin.js): backup and restore of Kira's files, only with the admin token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { startServer } from '../src/mcp.js';
import { adminRoutes } from '../src/admin.js';
import { rateLimiter, openStore } from '../src/agents.js';

const SECRET = 'a-long-random-admin-secret';
const hash = createHash('sha256').update(SECRET).digest('hex');
const api = { snapshot: () => null };

async function serve(routes, limiter) {
  const server = await startServer(0, { store: openStore(join(mkdtempSync(join(tmpdir(), 'kira-adm-')), 'a.json')), api, routes, limiter });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test('no hash configured: no admin routes at all', async () => {
  assert.deepEqual(adminRoutes({ hash: undefined, files: {}, limiter: rateLimiter() }), {});
  assert.deepEqual(adminRoutes({ hash: 'short', files: {}, limiter: rateLimiter() }), {});
  const { server, url } = await serve({});
  assert.equal((await fetch(`${url}/admin/backup`)).status, 404);
  server.closeAllConnections();
  server.close();
});

test('backup and restore need the admin token; restore replaces the files and restarts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kira-adm-'));
  const files = { state: join(dir, 'state.json'), agents: join(dir, 'agents.json') };
  writeFileSync(files.state, JSON.stringify({ channels: { a: '1' } }));
  writeFileSync(files.agents, JSON.stringify({ tokens: {} }));
  let exited = false;
  const limiter = rateLimiter({ auth: [3, 60_000] });
  const { server, url } = await serve(adminRoutes({ hash, files, limiter, save: () => {}, freeze: () => {}, exit: () => { exited = true; } }), limiter);
  const auth = { Authorization: `Bearer ${SECRET}` };
  assert.equal((await fetch(`${url}/admin/backup`)).status, 401);
  assert.equal((await fetch(`${url}/admin/backup`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  const backup = await (await fetch(`${url}/admin/backup`, { headers: auth })).json();
  assert.deepEqual(backup, { state: { channels: { a: '1' } }, agents: { tokens: {} } });
  assert.equal((await fetch(`${url}/admin/restore`, { method: 'POST', headers: auth, body: '{"state":{}}' })).status, 400);
  // agents.json must look like Kira's (M4).
  const record = { hash: 'a'.repeat(64), user: '622720516779802630', name: 'L', scope: 'read', label: null, createdAt: 1, expiresAt: 2, revokedAt: null, lastUsedAt: null };
  for (const agents of [{ tokens: { x: 1 } }, { tokens: [] }, { tokens: { abcdef12: { ...record, scope: 'root' } } }, { tokens: { abcdef12: { ...record, hash: 'zz' } } }, { tokens: { abcdef12: { ...record, user: 'bob' } } }, { tokens: { ABCDEF: record } }, { tokens: { abcdef12: { ...record, expiresAt: '2' } } }]) {
    assert.equal((await fetch(`${url}/admin/restore`, { method: 'POST', headers: auth, body: JSON.stringify({ state: { channels: {} }, agents }) })).status, 400, JSON.stringify(agents));
  }
  assert.ok(!exited);
  const r = await fetch(`${url}/admin/restore`, { method: 'POST', headers: auth, body: JSON.stringify({ state: { channels: { b: '2' } }, agents: { tokens: { abcdef12: record } } }) });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(readFileSync(files.state, 'utf8')), { channels: { b: '2' } });
  assert.deepEqual(JSON.parse(readFileSync(files.agents, 'utf8')), { tokens: { abcdef12: record } });
  await new Promise((ok) => setTimeout(ok, 600));
  assert.ok(exited);
  // Failed attempts are rate-limited.
  let last;
  for (let i = 0; i < 3; i++) last = await fetch(`${url}/admin/restore`, { method: 'POST', headers: { Authorization: 'Bearer nope' }, body: '{}' });
  assert.equal(last.status, 429);
  server.closeAllConnections();
  server.close();
});

test('the contributor rank roles: a dry run unless told otherwise; the token is needed', async () => {
  const calls = [];
  const ranks = async ({ dry }) => { calls.push(dry); return { dry, roles: [{ key: 'iron', action: dry ? 'would create' : 'created' }] }; };
  const limiter = rateLimiter({ auth: [50, 60_000] });
  const { server, url } = await serve(adminRoutes({ hash, files: {}, limiter, save: () => {}, freeze: () => {}, ranks }), limiter);
  const auth = { Authorization: `Bearer ${SECRET}` };
  assert.equal((await fetch(`${url}/admin/contributor-ranks`, { method: 'POST', body: '{"dry":false}' })).status, 401);
  assert.deepEqual(calls, []);
  const dry = await fetch(`${url}/admin/contributor-ranks`, { method: 'POST', headers: auth, body: 'not json' });
  assert.equal(dry.status, 200);
  assert.equal((await dry.json()).roles[0].action, 'would create');
  assert.equal((await (await fetch(`${url}/admin/contributor-ranks`, { method: 'POST', headers: auth, body: '{"dry":false}' })).json()).roles[0].action, 'created');
  assert.deepEqual(calls, [true, false]);
  server.closeAllConnections();
  server.close();
});

test('the contributor clean-up: a dry run unless told otherwise, one at a time, counts back; the token is needed', async () => {
  const calls = [];
  let release;
  const cleanup = ({ dry }) => { calls.push(dry); return new Promise((ok) => { release = () => ok({ dry, holders: 3 }); }); };
  const limiter = rateLimiter({ auth: [50, 60_000] });
  const { server, url } = await serve(adminRoutes({ hash, files: {}, limiter, save: () => {}, freeze: () => {}, cleanup }), limiter);
  const auth = { Authorization: `Bearer ${SECRET}` };
  assert.equal((await fetch(`${url}/admin/contributors-cleanup`, { method: 'POST', body: '{"dry":false}' })).status, 401);
  assert.equal((await fetch(`${url}/admin/contributors-cleanup`)).status, 401);
  assert.equal((await fetch(`${url}/admin/contributors-cleanup`, { method: 'POST', headers: auth, body: 'not json' })).status, 202);
  assert.deepEqual(calls, [true], 'anything but dry:false is a dry run');
  assert.equal((await fetch(`${url}/admin/contributors-cleanup`, { method: 'POST', headers: auth, body: '{"dry":false}' })).status, 409);
  assert.deepEqual(await (await fetch(`${url}/admin/contributors-cleanup`, { headers: auth })).json(), { dry: true, running: true });
  release();
  await new Promise((ok) => setTimeout(ok, 20));
  assert.deepEqual(await (await fetch(`${url}/admin/contributors-cleanup`, { headers: auth })).json(), { dry: true, holders: 3, running: false });
  assert.equal((await fetch(`${url}/admin/contributors-cleanup`, { method: 'POST', headers: auth, body: '{"dry":false}' })).status, 202);
  assert.deepEqual(calls, [true, false]);
  release();
  server.closeAllConnections();
  server.close();
});
