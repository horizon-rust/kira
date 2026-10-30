// The vote on applications and Ludovic's veto window (src/application-votes.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStaffStore } from '../src/staff-store.js';
import * as v from '../src/application-votes.js';

const T0 = Date.UTC(2026, 9, 30, 12);
const H = 3_600_000;
const OWNER = 'owner';

function setup({ role = 'mod', mods = ['m1', 'm2', 'm3', 'm4', 'm5'], team = ['t1', 't2'], active = null } = {}) {
  const store = openStaffStore(join(mkdtempSync(join(tmpdir(), 'kira-votes-')), 'staff.json'));
  const app = { id: 'a1', user: 'applicant', role, answers: { why: 'x' }, status: 'open', vote: v.newVote(T0), submittedAt: T0 };
  store.update((d) => { d.applications.a1 = app; });
  const calls = { decide: [], dm: [], revoke: [] };
  const lastActive = Object.fromEntries((active ?? [...mods, ...team]).map((id) => [id, T0]));
  const ctx = (now) => ({
    now, owner: OWNER, holders: { mod: new Set([...mods, 'applicant', OWNER]), team: new Set(team) }, lastActive, url: () => 'https://playhorizon.dev/staff/mod#application-a1',
    hooks: {
      decide: async (e) => { calls.decide.push(e); return { granted: e.outcome === 'accept', dmSent: true, error: null }; },
      dm: async (e) => { calls.dm.push(e); return { sent: true, error: null }; },
      revokeRole: async (e) => { calls.revoke.push(e); return { removed: true, error: null }; },
    },
  });
  return { store, app, calls, ctx, lastActive };
}

test('who votes: Mods on Mod, Mods and Team on Support, Team on Team; never the applicant or the owner', () => {
  const s = setup();
  assert.deepEqual([...v.eligible(s.app, s.ctx(T0))].sort(), ['m1', 'm2', 'm3', 'm4', 'm5']);
  assert.deepEqual([...v.eligible({ ...s.app, role: 'support' }, s.ctx(T0))].sort(), ['m1', 'm2', 'm3', 'm4', 'm5', 't1', 't2']);
  assert.deepEqual([...v.eligible({ ...s.app, role: 'team' }, s.ctx(T0))].sort(), ['t1', 't2']);
  assert.throws(() => v.castBallot(s.store, s.app, { voter: 't1', choice: 'for' }, s.ctx(T0)), /don't vote/);
  assert.throws(() => v.castBallot(s.store, s.app, { voter: 'applicant', choice: 'for' }, s.ctx(T0)), /don't vote/);
  assert.throws(() => v.castBallot(s.store, s.app, { voter: OWNER, choice: 'for' }, s.ctx(T0)), /don't vote/);
});

test('ballots: against needs a comment; changeable; blind while open; recusal', () => {
  const s = setup();
  assert.throws(() => v.castBallot(s.store, s.app, { voter: 'm1', choice: 'against' }, s.ctx(T0)), /Say why/);
  v.castBallot(s.store, s.app, { voter: 'm1', choice: 'for' }, s.ctx(T0 + H));
  assert.equal(s.app.vote.closesAt, T0 + 73 * H); // 72 h from the first ballot
  v.castBallot(s.store, s.app, { voter: 'm1', choice: 'against', comment: 'Too new here.' }, s.ctx(T0 + 2 * H));
  assert.equal(s.app.vote.closesAt, T0 + 73 * H);
  v.recuse(s.store, s.app, 'm2', s.ctx(T0 + 2 * H));
  const seen = v.voteView(s.app, 'm3', s.ctx(T0 + 2 * H));
  assert.equal(seen.cast, 1);
  assert.equal(seen.ballots, null);
  assert.equal(seen.mine, null);
  assert.equal(seen.eligible, 4);
  assert.equal(v.voteView(s.app, 'm1', s.ctx(T0)).mine.choice, 'against');
  assert.ok(v.auditView(s.store, s.app).every((e) => !e.choice && !e.comment));
  assert.deepEqual(s.store.data.audit.map((e) => e.action), ['ballot', 'ballot-changed', 'recused']);
});

test('a pass: quorum, 2/3 For, closes early when every active voter voted; one DM to the owner; accepted after 12 h', async () => {
  const s = setup({ active: ['m1', 'm2', 'm3'] }); // m4, m5 inactive: quorum max(2, ceil(0.4 * 3)) = 2
  assert.equal(v.count(s.app, s.ctx(T0)).quorum, 2);
  v.castBallot(s.store, s.app, { voter: 'm1', choice: 'for' }, s.ctx(T0));
  v.castBallot(s.store, s.app, { voter: 'm2', choice: 'for' }, s.ctx(T0));
  assert.equal(await v.advance(s.store, s.app, s.ctx(T0 + H)), null); // m3 hasn't voted, 72 h not over
  v.castBallot(s.store, s.app, { voter: 'm3', choice: 'against', comment: 'no' }, s.ctx(T0 + H));
  assert.equal(await v.advance(s.store, s.app, s.ctx(T0 + H)), 'passed'); // 2 of 3 = 2/3
  assert.equal(s.app.status, 'veto-window');
  assert.equal(s.calls.dm.length, 1);
  assert.equal(s.calls.dm[0].userId, OWNER);
  assert.match(s.calls.dm[0].content, /2 for, 1 against/);
  assert.equal(await v.advance(s.store, s.app, s.ctx(T0 + 12 * H)), null);
  assert.equal(await v.advance(s.store, s.app, s.ctx(T0 + 13 * H)), 'accepted');
  assert.equal(s.calls.decide[0].outcome, 'accept');
  assert.equal(s.calls.decide[0].decidedBy, 'vote');
  assert.equal(s.calls.dm.length, 1);
  assert.equal(v.voteView(s.app, 'm4', s.ctx(T0)).ballots.length, 3); // open after close
});

test('a decline goes out at once; abstentions count for quorum, not for the share', async () => {
  const s = setup({ active: ['m1', 'm2', 'm3'] });
  v.castBallot(s.store, s.app, { voter: 'm1', choice: 'for' }, s.ctx(T0));
  v.castBallot(s.store, s.app, { voter: 'm2', choice: 'against', comment: 'no' }, s.ctx(T0));
  v.castBallot(s.store, s.app, { voter: 'm3', choice: 'abstain' }, s.ctx(T0));
  assert.equal(await v.advance(s.store, s.app, s.ctx(T0)), 'declined');
  assert.equal(s.app.status, 'declined');
  assert.equal(s.calls.decide[0].outcome, 'decline');
  assert.ok(s.calls.decide[0].cooldownUntil > T0);
  assert.equal(s.calls.dm.length, 0);
});

test('no quorum: extended once by 48 h, then stalled for the owner; too few active voters: the owner decides', async () => {
  const s = setup(); // 7 active → quorum 2
  v.castBallot(s.store, s.app, { voter: 'm1', choice: 'for' }, s.ctx(T0));
  assert.equal(await v.advance(s.store, s.app, s.ctx(T0 + 72 * H)), 'extended');
  assert.equal(s.app.vote.closesAt, T0 + 120 * H);
  assert.equal(await v.advance(s.store, s.app, s.ctx(T0 + 120 * H)), 'stalled');
  assert.equal(s.calls.decide.length, 0); // no automatic decline
  await v.ownerAct(s.store, s.app, 'approve', s.ctx(T0 + 121 * H));
  assert.equal(s.app.status, 'accepted');
  assert.equal(s.calls.decide[0].decidedBy, OWNER);

  const t = setup({ active: ['m1'] });
  assert.equal(await v.advance(t.store, t.app, t.ctx(T0 + 72 * H)), 'owner');
  await v.ownerAct(t.store, t.app, 'decline', t.ctx(T0 + 73 * H));
  assert.equal(t.app.status, 'declined');
});

test('the owner: veto while open or in the window, approve early, take the role back later; all audited', async () => {
  const s = setup();
  await v.ownerAct(s.store, s.app, 'veto', s.ctx(T0));
  assert.equal(s.app.status, 'declined');
  await assert.rejects(v.ownerAct(s.store, s.app, 'veto', s.ctx(T0)), /declined/);

  const t = setup({ active: ['m1', 'm2'] });
  v.castBallot(t.store, t.app, { voter: 'm1', choice: 'for' }, t.ctx(T0));
  v.castBallot(t.store, t.app, { voter: 'm2', choice: 'for' }, t.ctx(T0));
  assert.equal(await v.advance(t.store, t.app, t.ctx(T0)), 'passed');
  await v.ownerAct(t.store, t.app, 'approve', t.ctx(T0 + H));
  assert.equal(t.app.status, 'accepted');
  await assert.rejects(v.ownerAct(t.store, t.app, 'approve', t.ctx(T0 + H)), /accepted/);
  await v.ownerAct(t.store, t.app, 'revoke', t.ctx(T0 + 48 * H));
  assert.deepEqual(t.calls.revoke[0], { applicationId: 'a1', userId: 'applicant', role: 'mod', by: OWNER });
  assert.equal(t.app.revoked.result.removed, true);
  await assert.rejects(v.ownerAct(t.store, t.app, 'revoke', t.ctx(T0 + 49 * H)), /Can't revoke/);
  assert.deepEqual(t.store.data.audit.map((e) => e.action), ['ballot', 'ballot', 'passed', 'accepted', 'role-revoked']);
});

test('nobody votes within 72 hours: treated as no quorum', async () => {
  const s = setup();
  assert.equal(await v.advance(s.store, s.app, s.ctx(T0 + 71 * H)), null);
  assert.equal(await v.advance(s.store, s.app, s.ctx(T0 + 72 * H)), 'extended');
});
