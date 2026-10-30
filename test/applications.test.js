// Applications (src/applications.js): eligibility, the link, the form, the lists, retention. The vote:
// test/application-votes.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStaffStore } from '../src/staff-store.js';
import * as apps from '../src/applications.js';
import { setStaffSide, canApply as hookCanApply } from '../src/staff-hooks.js';
import { finalize, castBallot } from '../src/application-votes.js';
import { DAY } from '../src/staff-auth.js';

const T0 = Date.UTC(2026, 9, 30, 12);
const SITE = 'https://playhorizon.dev';
const fresh = () => openStaffStore(join(mkdtempSync(join(tmpdir(), 'kira-apps-')), 'staff.json'));
const answers = (role) => Object.fromEntries(apps.questions(role).filter((q) => q.required).map((q) => [q.id, q.short ? '10' : 'Because I like Horizon.']));
const tokenOf = (url) => url.split('#')[1];
const ctx = (now = T0) => ({
  now, owner: 'owner', holders: { mod: new Set(['9']), team: new Set(['8']) }, lastActive: {}, url: (a) => `${SITE}/x#${a.id}`,
  hooks: { decide: async (e) => ({ granted: e.outcome === 'accept', dmSent: true, error: null }) },
});

function apply(store, user, role, at = T0, contributor = null) {
  const link = apps.issueApplyLink(store, user, role, false, SITE, at);
  assert.equal(link.ok, true, JSON.stringify(link));
  assert.match(link.url, /^https:\/\/playhorizon\.dev\/apply#[A-Za-z0-9_-]{43}$/);
  return apps.submit(store, { token: tokenOf(link.url), answers: answers(role), name: `u${user}`, contributor, hasRole: false }, at);
}

test('who may apply: a known role, not held, one open per role, 14 days after a decline', async () => {
  const store = fresh();
  assert.deepEqual(apps.canApply(store, '1', 'admin', false, T0), { ok: false, why: 'role' });
  assert.deepEqual(apps.canApply(store, '1', 'mod', true, T0), { ok: false, why: 'has-role' });
  const a = apply(store, '1', 'mod');
  assert.deepEqual(apps.canApply(store, '1', 'mod', false, T0), { ok: false, why: 'open' });
  assert.equal(apps.canApply(store, '1', 'support', false, T0).ok, true);
  store.update(() => { a.status = 'veto-window'; });
  assert.deepEqual(apps.canApply(store, '1', 'mod', false, T0), { ok: false, why: 'open' });
  await finalize(store, a, 'decline', 'vote', ctx(T0));
  const c = apps.canApply(store, '1', 'mod', false, T0 + DAY);
  assert.equal(c.why, 'cooldown');
  assert.equal(c.retryAt, T0 + 14 * DAY);
  assert.equal(apps.canApply(store, '1', 'mod', false, T0 + 14 * DAY).ok, true);
});

test('the form: required answers, length caps, control characters dropped; a link works once', () => {
  const store = fresh();
  const link = apps.issueApplyLink(store, '1', 'team', false, SITE, T0);
  const token = tokenOf(link.url);
  assert.throws(() => apps.submit(store, { token, answers: {}, hasRole: false }, T0), /Please answer/);
  assert.throws(() => apps.submit(store, { token, answers: { ...answers('team'), why: 'x'.repeat(1501) }, hasRole: false }, T0), /At most 1500/);
  const a = apps.submit(store, { token, answers: { ...answers('team'), why: 'ok\u0007\r\nfine', extra: 'ignored' }, hasRole: false }, T0);
  assert.equal(a.answers.why, 'ok\nfine');
  assert.equal(a.answers.extra, undefined);
  assert.equal(a.status, 'open');
  assert.equal(a.vote.closesAt, T0 + 72 * 3_600_000);
  assert.throws(() => apps.submit(store, { token, answers: answers('team'), hasRole: false }, T0), /unknown, used or expired/);
  assert.throws(() => apps.submit(store, { token: 'nope', answers: answers('team'), hasRole: false }, T0), /unknown/);
});

test('each dashboard sees its roles (Support on both); verified contributors with merged pull requests first', () => {
  const store = fresh();
  apply(store, '1', 'mod', T0);
  apply(store, '2', 'support', T0 + 1, { login: 'b', verified: true, merged: 3, prs: [] });
  apply(store, '3', 'mod', T0 + 2, { login: 'c', verified: false, merged: 50, prs: [] });
  apply(store, '4', 'team', T0 + 3, { login: 'd', verified: true, merged: 1, prs: [] });
  apply(store, '5', 'team', T0 + 4, { login: 'e', verified: true, merged: 9, prs: [] });
  assert.deepEqual(apps.list(store, 'mod', '9', ctx()).map((a) => a.user), ['2', '1', '3']);
  const team = apps.list(store, 'team', '8', ctx());
  assert.deepEqual(team.map((a) => a.user), ['5', '2', '4']);
  assert.equal(team[0].githubManual, true);
  assert.equal(team[0].vote.canVote, true);
  assert.equal(team[0].vote.ballots, null);
  assert.equal(team[0].owner, false);
  assert.equal(apps.list(store, 'mod', '9', ctx())[1].githubManual, false);
});

test('90 days after the decision only what the cooldown needs is kept', async () => {
  const store = fresh();
  const a = apply(store, '1', 'support', T0, { login: 'x', verified: true, merged: 1, prs: [] });
  castBallot(store, a, { voter: '9', choice: 'against', comment: 'Too new here.' }, ctx(T0));
  await finalize(store, a, 'decline', 'vote', ctx(T0));
  assert.equal(apps.list(store, 'mod', '9', ctx(T0 + 89 * DAY)).length, 1);
  assert.equal(apps.list(store, 'mod', '9', ctx(T0 + 91 * DAY)).length, 0);
  assert.deepEqual(store.data.applications[a.id], { id: a.id, user: '1', role: 'support', status: 'declined', decidedAt: T0 });
  const ballot = store.data.audit.find((e) => e.app === a.id && e.action === 'ballot');
  assert.deepEqual(ballot, { at: T0, by: '9', app: a.id, action: 'ballot', choice: 'against' });
});

test('the hooks answer for the staff side once registered', async () => {
  const store = fresh();
  setStaffSide({ canApply: async (u, r) => apps.canApply(store, u, r, false, T0) });
  assert.deepEqual(await hookCanApply('1', 'team'), { ok: true });
  setStaffSide(null);
});
