// Staff dashboards: passwords, one-time links, sessions (src/staff-auth.js) and their file (src/staff-store.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStaffStore, BACKUPS_KEPT } from '../src/staff-store.js';
import * as auth from '../src/staff-auth.js';

const T0 = Date.UTC(2026, 9, 30, 12);
const fresh = (opts) => openStaffStore(join(mkdtempSync(join(tmpdir(), 'kira-staff-')), 'staff.json'), opts);

test('passwords are scrypt hashes, checked in constant time', async () => {
  const h = await auth.hashPassword('correct horse battery');
  assert.match(h, /^scrypt\$32768\$8\$1\$/);
  assert.doesNotMatch(h, /correct/);
  assert.equal(await auth.checkPassword('correct horse battery', h), true);
  assert.equal(await auth.checkPassword('correct horse batterz', h), false);
  assert.equal(await auth.checkPassword('x', 'garbage'), false);
});

test('password rules', () => {
  assert.match(auth.passwordProblem('short'), /12/);
  assert.match(auth.passwordProblem('my name is cosmic!!', 'Cosmic'), /username/);
  assert.equal(auth.passwordProblem('a long enough phrase', 'cosmic'), null);
  assert.match(auth.passwordProblem('x'.repeat(201)), /200/);
});

test('a link works once, for its purpose, until it expires; a new one voids the old', () => {
  const store = fresh();
  const a = auth.issueLink(store, { user: '1', purpose: 'password' }, T0);
  assert.equal(auth.peekLink(store, a.token, 'apply', T0), null);
  assert.equal(auth.peekLink(store, a.token, 'password', T0 + auth.LINK_TTL.password), null);
  const b = auth.issueLink(store, { user: '1', purpose: 'password' }, T0 + 1);
  assert.equal(auth.peekLink(store, a.token, 'password', T0 + 2), null);
  assert.equal(auth.useLink(store, b.token, 'password', T0 + 2).user, '1');
  assert.equal(auth.useLink(store, b.token, 'password', T0 + 3), null);
  // apply links are per role, and the file holds no token
  const m = auth.issueLink(store, { user: '1', purpose: 'apply', role: 'mod' }, T0);
  const s = auth.issueLink(store, { user: '1', purpose: 'apply', role: 'support' }, T0);
  assert.equal(auth.peekLink(store, m.token, 'apply', T0).role, 'mod');
  assert.equal(auth.peekLink(store, s.token, 'apply', T0).role, 'support');
  assert.ok(!JSON.stringify(store.data).includes(m.token));
  assert.equal(auth.peekLink(store, '../../etc', 'apply', T0), null);
});

test('login, sessions, CSRF, logout, sign out everywhere, forget', async () => {
  const store = fresh();
  assert.deepEqual(await auth.setPassword(store, { user: '1', name: 'Cosmic', password: 'short' }, T0), { ok: false, why: 'At least 12 characters.' });
  assert.equal((await auth.setPassword(store, { user: '1', name: 'Cosmic', password: 'a long enough phrase' }, T0)).ok, true);
  assert.ok(!JSON.stringify(store.data).includes('a long enough phrase'));
  assert.deepEqual(await auth.login(store, { name: 'cosmic', password: 'wrong wrong wrong' }, T0), { ok: false });
  assert.deepEqual(await auth.login(store, { name: 'nobody', password: 'a long enough phrase' }, T0), { ok: false });
  const s = await auth.login(store, { name: ' COSMIC ', password: 'a long enough phrase' }, T0);
  assert.equal(s.ok, true);
  assert.equal(s.user, '1');
  assert.ok(!JSON.stringify(store.data).includes(s.token));
  const sess = auth.session(store, s.token, T0 + 1000);
  assert.equal(sess.user, '1');
  assert.equal(auth.csrfOk(sess, s.csrf), true);
  assert.equal(auth.csrfOk(sess, s.csrf.slice(1)), false);
  assert.equal(auth.csrfOk(sess, ''), false);
  // idle for 12 hours: gone
  assert.equal(auth.session(store, s.token, T0 + auth.SESSION_IDLE + 2000), null);
  // seen every few hours: still at most 7 days
  const t = await auth.login(store, { name: 'cosmic', password: 'a long enough phrase' }, T0);
  for (let at = T0; at < T0 + auth.SESSION_MAX; at += 6 * auth.HOUR) assert.ok(auth.session(store, t.token, at));
  assert.equal(auth.session(store, t.token, T0 + auth.SESSION_MAX + 1), null);
  // logout, logoutAll
  const u = await auth.login(store, { name: 'cosmic', password: 'a long enough phrase' }, T0);
  auth.logout(store, u.token);
  assert.equal(auth.session(store, u.token, T0), null);
  await auth.login(store, { name: 'cosmic', password: 'a long enough phrase' }, T0);
  await auth.login(store, { name: 'cosmic', password: 'a long enough phrase' }, T0);
  assert.equal(auth.logoutAll(store, '1'), 2);
  // a new password ends the sessions; forget removes everything
  const v = await auth.login(store, { name: 'cosmic', password: 'a long enough phrase' }, T0);
  await auth.setPassword(store, { user: '1', name: 'cosmic', password: 'another long phrase' }, T0);
  assert.equal(auth.session(store, v.token, T0), null);
  auth.issueLink(store, { user: '1', purpose: 'password' }, T0);
  assert.equal(auth.forget(store, '1'), true);
  assert.equal(auth.forget(store, '1'), false);
  assert.deepEqual(store.data.accounts, {});
  assert.deepEqual(store.data.links, {});
});

test('the file is mode 600; one backup a day, the last 7 kept, mode 600', () => {
  let now = T0;
  const dir = mkdtempSync(join(tmpdir(), 'kira-staff-'));
  const file = join(dir, 'staff.json');
  const store = openStaffStore(file, { now: () => now });
  store.update((d) => { d.counters.x = 1; });
  assert.equal(statSync(file).mode & 0o777, 0o600);
  for (let i = 0; i < 10; i++) { now += auth.DAY; store.update((d) => { d.counters.x = i; }); store.update(() => {}); }
  const kept = readdirSync(store.backupsDir).sort();
  assert.equal(kept.length, BACKUPS_KEPT);
  assert.equal(kept.at(-1), `staff-${new Date(now).toISOString().slice(0, 10)}.json`);
  for (const f of kept) assert.equal(statSync(join(store.backupsDir, f)).mode & 0o777, 0o600);
  // the day's backup is the file before the day's first write
  assert.equal(JSON.parse(readFileSync(join(store.backupsDir, kept.at(-1)), 'utf8')).counters.x, 8);
  assert.equal(openStaffStore(file).data.counters.x, 9);
  writeFileSync(file, '{broken');
  assert.throws(() => openStaffStore(file), /restore a backup/);
});
