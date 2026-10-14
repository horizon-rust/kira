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
  const r = await fetch(`${url}/admin/restore`, { method: 'POST', headers: auth, body: JSON.stringify({ state: { channels: { b: '2' } }, agents: { tokens: { x: 1 } } }) });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(readFileSync(files.state, 'utf8')), { channels: { b: '2' } });
  assert.deepEqual(JSON.parse(readFileSync(files.agents, 'utf8')), { tokens: { x: 1 } });
  await new Promise((ok) => setTimeout(ok, 600));
  assert.ok(exited);
  // Failed attempts are rate-limited.
  let last;
  for (let i = 0; i < 3; i++) last = await fetch(`${url}/admin/restore`, { method: 'POST', headers: { Authorization: 'Bearer nope' }, body: '{}' });
  assert.equal(last.status, 429);
  server.closeAllConnections();
  server.close();
});
