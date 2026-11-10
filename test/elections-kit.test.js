// The election rules with no Discord (src/elections-kit.js): one test per case of GOVERNANCE.md 5.3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as k from '../src/elections-kit.js';

const NOW = Date.UTC(2026, 10, 10, 12);
const DAY = k.DAY;
const ids = (n, p = 'v') => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);
const ballots = (o) => Object.fromEntries(Object.entries(o));

test('quorum is a third of the electorate and at least 3; below 3 voters nothing passes', () => {
  assert.equal(k.quorumOf(3), 3);
  assert.equal(k.quorumOf(9), 3);
  assert.equal(k.quorumOf(10), 4);
  assert.equal(k.quorumOf(30), 10);
  const two = k.countYesNo({ ballots: { a: 'yes', b: 'yes' }, voters: ['a', 'b'], threshold: 'simple' });
  assert.equal(two.passed, false);
  assert.equal(two.why, 'no quorum');
  const v = ids(10);
  const short = k.countYesNo({ ballots: { v1: 'yes', v2: 'yes', v3: 'yes' }, voters: v, threshold: 'simple' });
  assert.equal(short.quorum, false, '3 of 10 is under a third');
  const abst = k.countYesNo({ ballots: { v1: 'yes', v2: 'abstain', v3: 'abstain', v4: 'abstain' }, voters: v, threshold: 'simple' });
  assert.equal(abst.quorum, true, 'Abstain counts for the quorum');
  assert.equal(abst.passed, true);
});

test('a tie fails, except that the Chief of Mods breaks it in the mods\' votes', () => {
  const voters = ['a', 'b', 'c', 'chief'];
  const tie = { a: 'yes', b: 'no', c: 'no', chief: 'yes' };
  assert.equal(k.countYesNo({ ballots: tie, voters, threshold: 'simple' }).passed, false);
  const broken = k.countYesNo({ ballots: tie, voters, threshold: 'simple', tieBreaker: 'chief' });
  assert.equal(broken.passed, true);
  assert.match(broken.why, /broken by the Chief of Mods \(Yes\)/);
  const chiefNo = k.countYesNo({ ballots: { a: 'yes', b: 'yes', c: 'no', chief: 'no' }, voters, threshold: 'simple', tieBreaker: 'chief' });
  assert.equal(chiefNo.passed, false);
  const chiefAway = k.countYesNo({ ballots: { a: 'yes', b: 'no', c: 'abstain' }, voters, threshold: 'simple', tieBreaker: 'chief' });
  assert.equal(chiefAway.passed, false, 'no tie-break without their ballot');
  const chiefOut = k.countYesNo({ ballots: tie, voters: ['a', 'b', 'c'], threshold: 'simple', tieBreaker: 'chief' });
  assert.equal(chiefOut.passed, false, 'a Chief left out (the subject) breaks nothing');
});

test('two thirds needs 2/3 of Yes + No and at least 3 Yes', () => {
  const voters = ids(5);
  assert.equal(k.countYesNo({ ballots: { v1: 'yes', v2: 'yes', v3: 'no' }, voters, threshold: 'two-thirds' }).passed, false, '2 Yes');
  assert.equal(k.countYesNo({ ballots: { v1: 'yes', v2: 'yes', v3: 'yes', v4: 'no' }, voters, threshold: 'two-thirds' }).passed, true);
  assert.equal(k.countYesNo({ ballots: { v1: 'yes', v2: 'yes', v3: 'yes', v4: 'no', v5: 'no' }, voters, threshold: 'two-thirds' }).passed, false);
});

test('a vote closes early only once the result is locked', () => {
  const voters = ids(5);
  assert.deepEqual(k.lockedYesNo({ ballots: { v1: 'yes', v2: 'yes' }, voters, threshold: 'simple' }), { locked: false, passed: false });
  assert.deepEqual(k.lockedYesNo({ ballots: { v1: 'yes', v2: 'yes', v3: 'yes' }, voters, threshold: 'simple' }), { locked: true, passed: true });
  assert.deepEqual(k.lockedYesNo({ ballots: { v1: 'no', v2: 'no', v3: 'no' }, voters, threshold: 'simple' }), { locked: true, passed: false });
  assert.equal(k.lockedYesNo({ ballots: { v1: 'yes', v2: 'yes', v3: 'no' }, voters, threshold: 'simple' }).locked, false, '2 left could tie or flip it');
  const team = ids(6);
  assert.deepEqual(k.lockedYesNo({ ballots: { v1: 'yes', v2: 'yes', v3: 'yes', v4: 'yes' }, voters: team, threshold: 'two-thirds' }), { locked: true, passed: true }, '4 Yes of 6: two more No still leave two thirds');
  assert.equal(k.lockedYesNo({ ballots: { v1: 'yes', v2: 'yes', v3: 'yes' }, voters: team, threshold: 'two-thirds' }).locked, false, '3-3 would fail');
  assert.deepEqual(k.lockedYesNo({ ballots: { v1: 'no', v2: 'no', v3: 'no', v4: 'no' }, voters: team, threshold: 'two-thirds' }), { locked: true, passed: false });
});

test('several candidates: approval, the winner needs half of the voters, else a run-off of the top two', () => {
  const voters = ids(6);
  const c = ['A', 'B', 'C'];
  const win = k.countApproval({ ballots: { v1: ['A'], v2: ['A', 'B'], v3: ['A'], v4: ['B'] }, voters, candidates: c });
  assert.equal(win.winner, 'A');
  assert.equal(win.passed, true);
  const split = k.countApproval({ ballots: { v1: ['A'], v2: ['B'], v3: ['C'], v4: ['A'], v5: [] }, voters, candidates: c });
  assert.equal(split.winner, null);
  assert.deepEqual(split.runoff, ['A', 'B'], 'B before C: nominated first');
  const tieTop = k.countApproval({ ballots: { v1: ['A'], v2: ['B'], v3: ['A', 'B'] }, voters, candidates: c });
  assert.deepEqual(tieTop.runoff, ['A', 'B'], 'a tie at the top goes to a run-off');
  const none = k.countApproval({ ballots: { v1: [], v2: [], v3: [] }, voters, candidates: c });
  assert.equal(none.passed, false);
  assert.equal(none.runoff, null);
  assert.equal(k.countApproval({ ballots: { v1: ['A'], v2: ['A'] }, voters, candidates: c }).why, 'no quorum');
  // locked early: A has 4 of 5 voters, one left
  assert.deepEqual(k.lockedApproval({ ballots: { v1: ['A'], v2: ['A'], v3: ['A'], v4: ['A'], v5: ['B'] }, voters, candidates: c }), { locked: true, passed: true });
  assert.equal(k.lockedApproval({ ballots: { v1: ['A'], v2: ['A'], v3: ['B'] }, voters, candidates: c }).locked, false);
});

test('a run-off: more votes wins, a tie fails', () => {
  const voters = ids(5);
  const r = k.countRunoff({ ballots: { v1: 'A', v2: 'A', v3: 'B' }, voters, pair: ['A', 'B'] });
  assert.equal(r.winner, 'A');
  assert.equal(k.countRunoff({ ballots: { v1: 'A', v2: 'B', v3: 'abstain' }, voters, pair: ['A', 'B'] }).passed, false);
  assert.deepEqual(k.lockedRunoff({ ballots: { v1: 'A', v2: 'A', v3: 'A', v4: 'B' }, voters, pair: ['A', 'B'] }), { locked: true, passed: true });
  assert.equal(k.lockedRunoff({ ballots: { v1: 'A', v2: 'A', v3: 'B' }, voters, pair: ['A', 'B'] }).locked, false);
});

test('who may start: by post, and never about yourself', () => {
  const IDS = { mod: 'R_mod', chiefmod: 'R_chief', team: 'R_team', 'lead-server': 'R_ls', 'lead-ui': 'R_lui' };
  const kinds = (...r) => k.kindsOf(new Set(r), IDS);
  assert.equal(k.mayStart('mod', null, kinds('R_mod')), null);
  assert.match(k.mayStart('mod', null, kinds('R_team')), /a mod, a council member/);
  assert.equal(k.mayStart('mod', null, k.kindsOf(new Set(), IDS, { council: true })), null);
  assert.equal(k.mayStart('op', null, kinds('R_ls')), null);
  assert.ok(k.mayStart('op', null, kinds('R_mod')), 'a plain mod does not start an operator election');
  assert.equal(k.mayStart('op', null, kinds('R_chief')), null);
  assert.equal(k.mayStart('lead', 'ui', kinds('R_lui')), null, 'the current lead');
  assert.ok(k.mayStart('lead', 'server', kinds('R_lui')), "another group's lead");
  assert.equal(k.mayStart('lead', 'ui', kinds('R_team')), null);
  assert.equal(k.mayStart('team', null, kinds('R_team')), null);
  assert.equal(k.mayStartVote('mods', kinds('R_chief')), null);
  assert.ok(k.mayStartVote('team', kinds('R_mod')));
  assert.equal(k.mayStartVote('group:ui', kinds('R_lui')), null);
  const self = k.startCheck({ post: 'mod', member: 'x', action: 'add', starter: 'x' }, { now: NOW });
  assert.match(self.why, /about yourself/);
});

test('the electorate: by body, the candidate left out, only active group members', () => {
  const m = (id, kinds, active) => ({ id, kinds: new Set(kinds), active });
  const members = [m('mod1', ['mods']), m('chief', ['mods', 'chiefmod']), m('t1', ['team']), m('ls', ['lead-server']), m('g1', [], { ui: true }), m('g2', [], { ui: false })];
  assert.deepEqual(k.electorate('mods', members), ['chief', 'mod1']);
  assert.deepEqual(k.electorate('mods', members, { exclude: ['mod1'] }), ['chief']);
  assert.deepEqual(k.electorate('op', members), ['chief', 'ls', 'mod1']);
  assert.deepEqual(k.electorate('group:ui', members), ['g1', 't1']);
  assert.deepEqual(k.electorate('team', members), ['t1']);
  // active: the group role for 14 days (unknown start counts) and one counted contribution in 60 days
  assert.equal(k.isActive({ since: null, recent: 1 }, NOW), true);
  assert.equal(k.isActive({ since: NOW - 13 * DAY, recent: 5 }, NOW), false, 'a new sockpuppet waits 14 days');
  assert.equal(k.isActive({ since: NOW - 14 * DAY, recent: 1 }, NOW), true);
  assert.equal(k.isActive({ since: null, recent: 0 }, NOW), false);
});

test('floors: the lines that fall short, for the candidate only', () => {
  const ok = { inGuild: true, joinedAt: NOW - 40 * DAY, level: 12, verified: true, merged: 50, reviews: 30, areaMerged: 9, areaReviews: 0, declared: true, roles: new Set(['mods']), modSince: null };
  assert.deepEqual(k.shortOf('mod', null, ok, NOW), []);
  assert.deepEqual(k.shortOf('team', null, ok, NOW), []);
  assert.deepEqual(k.shortOf('lead', 'ui', ok, NOW), []);
  assert.deepEqual(k.shortOf('chiefmod', null, ok, NOW), []);
  const young = { ...ok, declared: false };
  assert.match(k.shortOf('op', null, young, NOW).join(), /18\+ declaration/);
  assert.match(k.shortOf('mod', null, { ...ok, lastCaseAt: NOW - 10 * DAY }, NOW).join(), /clean record/);
  assert.match(k.shortOf('mod', null, { ...ok, level: 3 }, NOW).join(), /Kira level 10 \(now 3\)/);
  assert.match(k.shortOf('lead', 'ui', { ...ok, areaMerged: 2, areaReviews: 5 }, NOW).join(), /8 merged pull requests or 20 reviews/);
  assert.deepEqual(k.shortOf('lead', 'ui', { ...ok, areaMerged: 0, areaReviews: 20 }, NOW), [], 'reviews count instead');
  assert.match(k.shortOf('lead', 'translations', { ...ok, areaMerged: 4, areaReviews: 50 }, NOW).join(), /5 merged translation/);
  assert.match(k.shortOf('team', null, { ...ok, merged: 39 }, NOW).join(), /40 merged/);
  assert.match(k.shortOf('chiefmod', null, { ...ok, modSince: NOW - 5 * DAY }, NOW).join(), /30 days as a moderator/);
  assert.match(k.shortOf('chiefmod', null, { ...ok, roles: new Set() }, NOW).join(), /30 days as a moderator/);
  assert.deepEqual(k.shortOf('mod', null, { inGuild: false }, NOW), ['you need to be a member of the Discord server']);
  assert.match(k.notNow('<@1>'), /doesn't meet this post's requirements/);
  assert.doesNotMatch(k.notNow('<@1>'), /18|age|declaration|level|record/i, 'the person starting never learns why');
});

test('cooldown: 30 days after a failed, lost or vetoed election, per person, post and action', () => {
  const fail = { id: 'D1', type: 'election', post: 'mod', group: null, action: 'add', candidates: ['x'], result: { passed: false }, closedAt: NOW - 5 * DAY };
  assert.equal(k.cooldownBlock([fail], { post: 'mod', member: 'x' }, NOW)?.id, 'D1');
  assert.equal(k.cooldownBlock([fail], { post: 'mod', member: 'x' }, NOW + 26 * DAY), null, 'over after 30 days');
  assert.equal(k.cooldownBlock([fail], { post: 'team', member: 'x' }, NOW), null, 'another post');
  assert.equal(k.cooldownBlock([fail], { post: 'mod', member: 'y' }, NOW), null, 'another person');
  assert.equal(k.cooldownBlock([fail], { post: 'mod', member: 'x', action: 'remove' }, NOW), null, 'a recall is its own action');
  const lost = { id: 'D2', type: 'election', post: 'lead', group: 'ui', action: 'add', candidates: ['x', 'y'], result: { passed: true, winner: 'y' }, closedAt: NOW - DAY };
  assert.equal(k.cooldownBlock([lost], { post: 'lead', group: 'ui', member: 'x' }, NOW)?.id, 'D2');
  assert.equal(k.cooldownBlock([lost], { post: 'lead', group: 'ui', member: 'y' }, NOW), null);
  const veto = { id: 'D3', type: 'veto', post: 'mod', group: null, action: 'add', member: 'z', passed: true, at: NOW - DAY };
  assert.equal(k.cooldownBlock([veto], { post: 'mod', member: 'z' }, NOW)?.id, 'D3');
  assert.equal(k.cooldownBlock([{ ...veto, passed: false }], { post: 'mod', member: 'z' }, NOW), null, 'a veto that failed blocks nothing');
});

test('starting: held seats, the 12-hour join window, the cap of 3, the council already voting', () => {
  const base = { post: 'mod', member: 'c', action: 'add', starter: 's' };
  const open3 = ['a', 'b', 'd'].map((x, i) => ({ id: `E${i}`, post: 'mod', body: 'mods', action: 'add', candidates: [x] }));
  assert.match(k.startCheck(base, { open: open3, now: NOW }).why, /already has 3 elections/);
  assert.equal(k.startCheck(base, { open: open3.slice(0, 2), now: NOW }).ok, true);
  assert.match(k.startCheck(base, { holders: ['c'], now: NOW }).why, /already hold/);
  assert.match(k.startCheck({ ...base, action: 'remove' }, { now: NOW }).why, /don't hold/);
  assert.match(k.startCheck(base, { polls: [{ outcome: { member: 'c', role: 'mod' } }], now: NOW }).why, /council is already voting/);
  assert.match(k.startCheck(base, { open: [{ post: 'mod', body: 'mods', candidates: ['c'] }], now: NOW }).why, /already running/);
  const chief = { post: 'chiefmod', member: 'c', action: 'add', starter: 's' };
  assert.match(k.startCheck(chief, { holders: ['h'], seats: 1, now: NOW }).why, /seat is held/);
  const running = { id: 'E9', post: 'chiefmod', body: 'mods', action: 'add', candidates: ['a'], joinUntil: NOW + k.HOUR, stage: 'vote' };
  assert.equal(k.startCheck(chief, { open: [running], seats: 1, now: NOW }).join, running, 'joins the same ballot');
  assert.match(k.startCheck(chief, { open: [running], seats: 1, now: NOW + 2 * k.HOUR }).why, /12 hours for more candidates are over/);
  const nominating = { ...running, stage: 'nominating', joinUntil: 0, candidates: [] };
  assert.equal(k.startCheck(chief, { open: [nominating], seats: 1, now: NOW }).join, nominating, 'a vacancy collects nominations');
  const full = { ...running, candidates: ['1', '2', '3', '4', '5'] };
  assert.match(k.startCheck(chief, { open: [full], seats: 1, now: NOW }).why, /ballot is full/);
  assert.equal(k.seatsFor('lead', 7), 1);
  assert.equal(k.seatsFor('lead', 8), 2, 'a co-lead from 8 active members');
  assert.equal(k.seatsFor('team'), null);
});

test('veto window, vacancies, monthly reminders', () => {
  assert.equal(k.vetoOpen(NOW, NOW + 23 * k.HOUR), true);
  assert.equal(k.vetoOpen(NOW, NOW + 24 * k.HOUR), false);
  assert.deepEqual(k.vacated({ chiefmod: ['p'], 'lead:ui': [] }, { chiefmod: [], 'lead:ui': [], 'lead:server': [] }), ['chiefmod'], 'only seats that were held');
  assert.deepEqual(k.vacated({}, { chiefmod: [] }), [], 'first look: nothing is a vacancy');
  assert.equal(k.monthlyDue('2026-10', NOW), true);
  assert.equal(k.monthlyDue('2026-11', NOW), false);
  assert.equal(k.groupReminderDue({ leads: 0, meetsFloor: 0 }), true);
  assert.equal(k.groupReminderDue({ leads: 1, meetsFloor: 0 }), false, 'a group with a lead and nobody at the floor: no spam');
  assert.equal(k.groupReminderDue({ leads: 1, meetsFloor: 2 }), true);
});
