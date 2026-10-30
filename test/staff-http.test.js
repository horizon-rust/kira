// The staff dashboards' HTTP API (src/staff-http.js) behind the website's proxy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/mcp.js';
import { openStore } from '../src/agents.js';
import { openStaffStore } from '../src/staff-store.js';
import { staffRoutes, failures, COOKIE } from '../src/staff-http.js';
import * as auth from '../src/staff-auth.js';

const KEY = 'k'.repeat(40);
const ORIGIN = 'https://playhorizon.dev';
const roles = { 1: { name: 'cosmic', dashboards: ['team'] }, 2: { name: 'modder', dashboards: ['mod'] }, 3: { name: 'gone', dashboards: [] } };

async function serve(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kira-staffh-'));
  const store = openStaffStore(join(dir, 'staff.json'));
  const people = structuredClone(roles);
  const logs = [];
  const routes = staffRoutes({
    store, key: KEY, origin: ORIGIN, access: async (u) => people[u] ?? null, log: (t) => logs.push(t),
    extra: [
      { method: 'GET', path: 'team/ping', role: 'team', handler: () => ({ body: { team: true } }) },
      { method: 'POST', path: 'team/write', role: 'team', handler: (ctx) => ({ body: { by: ctx.user, got: ctx.body.x } }) },
      { method: 'GET', path: 'mod/ping', role: 'mod', handler: () => ({ body: { mod: true } }) },
    ],
    ...opts,
  });
  const server = await startServer(0, { store: openStore(join(dir, 'a.json')), api: { snapshot: () => null }, routes });
  const base = `http://127.0.0.1:${server.address().port}/staff/api/`;
  const call = async (method, path, { body, cookie, csrf, origin = ORIGIN, key = KEY, ip = '9.9.9.9' } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'X-Staff-Client-Ip': ip };
    if (key) headers['X-Staff-Proxy-Key'] = key;
    if (method === 'POST' && origin) headers.Origin = origin;
    if (cookie) headers.Cookie = `${COOKIE}=${cookie}`;
    if (csrf) headers['X-Staff-Csrf'] = csrf;
    const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie');
    return { status: r.status, json: await r.json(), cookie: set?.match(new RegExp(`${COOKIE}=([^;]*)`))?.[1], set };
  };
  const close = () => { server.closeAllConnections(); server.close(); };
  return { store, people, logs, call, close };
}

test('no key, or a short one: no routes', () => {
  assert.deepEqual(staffRoutes({ store: null, key: undefined }), {});
  assert.deepEqual(staffRoutes({ store: null, key: 'short' }), {});
});

test('only through the proxy: a missing or wrong key is a 404', async () => {
  const s = await serve();
  assert.equal((await s.call('GET', 'me', { key: null })).status, 404);
  assert.equal((await s.call('POST', 'login', { key: 'x'.repeat(40), body: {} })).status, 404);
  assert.equal((await s.call('GET', 'me')).status, 401);
  s.close();
});

test('setup link → password → logged in; the cookie is HttpOnly, Secure, SameSite=Strict, __Host-', async () => {
  const s = await serve();
  const { token } = auth.issueLink(s.store, { user: '1', purpose: 'password' });
  assert.equal((await s.call('POST', 'setup/peek', { body: { token } })).json.name, 'cosmic');
  assert.equal((await s.call('POST', 'setup', { body: { token, password: 'cosmic is my name!' } })).status, 400);
  const r = await s.call('POST', 'setup', { body: { token, password: 'a long enough phrase' } });
  assert.equal(r.status, 200);
  assert.match(r.set, /^__Host-staff=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800$/);
  assert.deepEqual(r.json.dashboards, ['team']);
  assert.equal((await s.call('POST', 'setup', { body: { token, password: 'a long enough phrase' } })).status, 404);
  const me = await s.call('GET', 'me', { cookie: r.cookie });
  assert.equal(me.json.name, 'cosmic');
  assert.ok(s.logs.some((l) => l.includes('password set')));
  assert.ok(!s.logs.join(' ').includes('a long enough phrase'));
  s.close();
});

test('login, roles per route, CSRF, Origin, logout', async () => {
  const s = await serve();
  await auth.setPassword(s.store, { user: '1', name: 'cosmic', password: 'a long enough phrase' });
  await auth.setPassword(s.store, { user: '2', name: 'modder', password: 'a long enough phrase' });
  assert.equal((await s.call('POST', 'login', { body: { name: 'cosmic', password: 'wrong password!!' } })).status, 401);
  const t = await s.call('POST', 'login', { body: { name: 'cosmic', password: 'a long enough phrase' } });
  assert.equal(t.status, 200);
  const m = await s.call('POST', 'login', { body: { name: 'modder', password: 'a long enough phrase' } });
  assert.equal((await s.call('GET', 'team/ping', { cookie: t.cookie })).status, 200);
  assert.equal((await s.call('GET', 'mod/ping', { cookie: t.cookie })).status, 403);
  assert.equal((await s.call('GET', 'team/ping', { cookie: m.cookie })).status, 403);
  assert.equal((await s.call('GET', 'mod/ping', { cookie: m.cookie })).status, 200);
  // writes need the CSRF token and the website's Origin
  assert.equal((await s.call('POST', 'team/write', { cookie: t.cookie, body: { x: 1 } })).status, 403);
  assert.equal((await s.call('POST', 'team/write', { cookie: t.cookie, csrf: m.json.csrf, body: { x: 1 } })).status, 403);
  assert.equal((await s.call('POST', 'team/write', { cookie: t.cookie, csrf: t.json.csrf, origin: 'https://evil.example', body: { x: 1 } })).status, 403);
  assert.equal((await s.call('POST', 'login', { origin: null, body: { name: 'cosmic', password: 'a long enough phrase' } })).status, 403);
  assert.deepEqual((await s.call('POST', 'team/write', { cookie: t.cookie, csrf: t.json.csrf, body: { x: 1 } })).json, { by: '1', got: 1 });
  // logout ends that session only
  const out = await s.call('POST', 'logout', { cookie: t.cookie, csrf: t.json.csrf });
  assert.match(out.set, /Max-Age=0/);
  assert.equal((await s.call('GET', 'me', { cookie: t.cookie })).status, 401);
  assert.equal((await s.call('GET', 'me', { cookie: m.cookie })).status, 200);
  s.close();
});

test('a role taken away closes the dashboard at the next request; no role at all ends the sessions', async () => {
  const s = await serve();
  await auth.setPassword(s.store, { user: '1', name: 'cosmic', password: 'a long enough phrase' });
  const t = await s.call('POST', 'login', { body: { name: 'cosmic', password: 'a long enough phrase' } });
  s.people[1].dashboards = ['mod'];
  assert.equal((await s.call('GET', 'team/ping', { cookie: t.cookie })).status, 403);
  s.people[1].dashboards = [];
  assert.equal((await s.call('GET', 'me', { cookie: t.cookie })).status, 401);
  s.people[1].dashboards = ['team'];
  assert.equal((await s.call('GET', 'me', { cookie: t.cookie })).status, 401);
  // and someone without a role can't log in with a password set before
  await auth.setPassword(s.store, { user: '3', name: 'gone', password: 'a long enough phrase' });
  assert.equal((await s.call('POST', 'login', { body: { name: 'gone', password: 'a long enough phrase' } })).status, 401);
  assert.equal(Object.values(s.store.data.sessions).filter((x) => x.user === '3').length, 0);
  s.close();
});

test('failed logins are limited per account and per address', async () => {
  const s = await serve({ limits: failures({ staffUser: [3, 60_000], staffIp: [5, 60_000] }) });
  await auth.setPassword(s.store, { user: '1', name: 'cosmic', password: 'a long enough phrase' });
  for (let i = 0; i < 3; i++) assert.equal((await s.call('POST', 'login', { ip: `1.1.1.${i}`, body: { name: 'cosmic', password: 'nope nope nope' } })).status, 401);
  const blocked = await s.call('POST', 'login', { ip: '1.1.1.9', body: { name: 'cosmic', password: 'a long enough phrase' } });
  assert.equal(blocked.status, 429);
  for (let i = 0; i < 5; i++) await s.call('POST', 'login', { ip: '2.2.2.2', body: { name: `x${i}`, password: 'nope nope nope' } });
  assert.equal((await s.call('POST', 'login', { ip: '2.2.2.2', body: { name: 'other', password: 'nope' } })).status, 429);
  assert.equal((await s.call('POST', 'setup', { ip: '2.2.2.2', body: { token: 'x', password: 'y' } })).status, 429);
  s.close();
});
