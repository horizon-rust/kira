// Unit tests for the work board's logic: what a PR fixes, its status, claim deadlines, the board text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as wk from '../src/workkit.js';
import { announced } from '../src/releases.js';
import { LAYOUT, DEFAULT_CHANNELS, ROLES, RETIRED_ROLES, RETIRED, WORK, SERVER } from '../src/config.js';

test('fixesIn: the closing keywords GitHub knows, several issues, no false positives', () => {
  assert.deepEqual(wk.fixesIn('Fixes #12'), [12]);
  assert.deepEqual(wk.fixesIn('This closes #3, resolves #4 and fixed #9.'), [3, 4, 9]);
  assert.deepEqual(wk.fixesIn('Fix: #7\nCloses #7'), [7]);
  assert.deepEqual(wk.fixesIn('Fixes #1, #2 and #3'), [1, 2, 3]);
  assert.deepEqual(wk.fixesIn('See #12, related to #13; fixing #5 later'), []);
  assert.deepEqual(wk.fixesIn(null), []);
});

test('ciState and prStatus: draft first, then CI, then review', () => {
  const ok = { status: 'completed', conclusion: 'success' };
  assert.equal(wk.ciState([]), 'none');
  assert.equal(wk.ciState([ok, { status: 'completed', conclusion: 'skipped' }]), 'passing');
  assert.equal(wk.ciState([ok, { status: 'in_progress' }]), 'running');
  assert.equal(wk.ciState([{ status: 'in_progress' }, { status: 'completed', conclusion: 'failure' }]), 'failing');
  assert.equal(wk.ciState([ok], [{ state: 'pending' }]), 'running');
  assert.equal(wk.reviewState([{ user: { login: 'a' }, state: 'CHANGES_REQUESTED' }, { user: { login: 'a' }, state: 'APPROVED' }]), 'approved');
  assert.equal(wk.reviewState([{ user: { login: 'a' }, state: 'APPROVED' }, { user: { login: 'b' }, state: 'CHANGES_REQUESTED' }]), 'changes');
  assert.equal(wk.prStatus({ draft: true, ci: 'failing', review: 'approved' }), '📝 draft');
  assert.equal(wk.prStatus({ draft: false, ci: 'failing', review: 'approved' }), '❌ CI failing');
  assert.equal(wk.prStatus({ draft: false, ci: 'passing', review: 'none' }), '✅ CI passed · in review');
  assert.equal(wk.prStatus({ draft: false, ci: 'passing', review: 'approved' }), '👍 approved');
});

test('claims: a reminder once, 3 days before; lapsed after 14 days without activity; activity resets both', () => {
  const opts = { expireDays: 14, remindDays: 3 };
  const since = 1_000_000_000_000;
  const c = { since, activity: 0, reminded: 0 };
  assert.equal(wk.claimDue(c, since + 10 * wk.DAY, opts), null);
  assert.equal(wk.claimDue(c, since + 11 * wk.DAY, opts), 'remind');
  c.reminded = since + 11 * wk.DAY;
  assert.equal(wk.claimDue(c, since + 12 * wk.DAY, opts), null);
  assert.equal(wk.claimDue(c, since + 14 * wk.DAY, opts), 'expire');
  c.activity = since + 13 * wk.DAY; // a comment: the clock starts again, and a new reminder is due later
  assert.equal(wk.claimDue(c, since + 14 * wk.DAY, opts), null);
  assert.equal(wk.claimDue(c, since + 24 * wk.DAY, opts), 'remind');
  assert.equal(wk.lapsesAt(c, 14), since + 27 * wk.DAY);
});

test("lastActivity: comments, commits and cross-references count; Kira's comments and labels don't", () => {
  const t = (d) => new Date(Date.UTC(2026, 9, d)).toISOString();
  assert.equal(wk.lastActivity([
    { event: 'commented', created_at: t(2), body: 'on it' },
    { event: 'labeled', created_at: t(9) },
    { event: 'commented', created_at: t(8), body: `Claimed by X\n${wk.MARK}` },
    { event: 'cross-referenced', created_at: t(5) },
  ]), Date.parse(t(5)));
  assert.equal(wk.lastActivity([]), 0);
});

test('a column: one line per card with link, people, labels, pull requests; cut to fit an embed', () => {
  const now = Date.now();
  const card = (n) => ({ id: `issue#${n}`, kind: 'issue', number: n, title: `Water *renders* black ${n}`, url: `https://github.com/x/y/issues/${n}`, state: 'open', column: 'progress', labels: ['bug', 'rendering'],
    people: [{ name: 'some_one', claimed: true }], claim: { since: new Date(now - wk.DAY).toISOString(), lapses: new Date(now + 2 * wk.DAY).toISOString() },
    prs: [{ number: 56, url: 'https://github.com/x/y/pull/56', state: 'open', status: '👀 in review' }], moved: null });
  const one = wk.columnText({ key: 'progress', cards: [card(2)] }, now);
  assert.equal(one.title, '🔨 In progress (1)');
  assert.match(one.description, /^• \[#2 Water \\\*renders\\\* black 2\]\(<https:\/\/github\.com\/x\/y\/issues\/2>\) · 🔨 \*\*some\\_one\*\* · `bug` `rendering` · 🔀 \[#56\]\(<https:\/\/github\.com\/x\/y\/pull\/56>\) 👀 in review · since <t:\d+:R> · lapses <t:\d+:R>$/);
  const many = wk.columnText({ key: 'todo', cards: Array.from({ length: 80 }, (_, i) => ({ ...card(i + 1), people: [], claim: null, prs: [] })) }, now);
  assert.ok(many.description.length <= 4096);
  assert.match(many.description, /…and \d+ more on GitHub$/);
  const own = wk.columnText({ key: 'progress', cards: [{ id: 'card#3', kind: 'card', number: 3, title: 'Release 2026.10.15', url: null, state: 'open', column: 'progress', labels: [], people: [{ name: 'ludovic', claimed: true }], prs: [], notes: [{ by: 'x', at: '', text: 'tagging   now' }] }] }, now);
  assert.equal(own.description, '• 🗂️ Release 2026.10.15 `card#3` · 🔨 **ludovic** · 📝 tagging now');
  const empty = wk.columnText({ key: 'todo', cards: [] }, now);
  assert.match(empty.description, /\/claim/);
  assert.equal(empty.title, '📥 To do (0)');
});

test('dev-log lines never ping and name the PR', () => {
  const line = wk.logLine.opened({ number: 56, title: 'Fix creative tab', url: 'https://github.com/x/y/pull/56', who: 'Cosmic', fixes: [12] });
  assert.equal(line, '🟢 **Cosmic** opened [#56 Fix creative tab](<https://github.com/x/y/pull/56>) (fixes #12)');
  assert.doesNotMatch(Object.values(wk.logLine).map((f) => f({ number: 1, title: 't', url: 'u', who: 'w' }, 14)).join(), /<@/);
  assert.match(wk.claimComment('Cosmic', 'Online5277', 12, 14), /Claimed by `Cosmic` on Discord \(GitHub: `Online5277`\)/);
  // Display names can't mention, link or format on GitHub (L5).
  assert.equal(wk.githubName('@ludovic111 **[x](https://evil.example)**'), '`@ludovic111 **[x](https://evil.example)*`'); // cut at 40
  assert.equal(wk.githubName('a`b`\n@team'), "`a'b''@team`");
  assert.equal(wk.githubName(''), '`someone`');
  assert.match(wk.unclaimComment('@here', 'expired'), /^The claim by `@here` lapsed/);
  // Claim/unclaim cooldown per issue (H1).
  assert.equal(wk.cooldownLeft(undefined, 1000, 600_000), 0);
  assert.equal(wk.cooldownLeft(1000, 1000 + 60_000, 600_000), 540_000);
  assert.equal(wk.cooldownLeft(1000, 1000 + 600_000, 600_000), 0);
  assert.ok(wk.unclaimComment('Cosmic', 'expired').includes(wk.MARK));
});

test('#releases: only the Horizon game and launcher', () => {
  assert.equal(announced('horizon', { tag_name: 'v2026.10.13.1' }), true);
  assert.equal(announced('horizon', { tag_name: 'launcher-v0.1.4' }), true);
  assert.equal(announced('horizon', { tag_name: 'nightly' }), false);
  assert.equal(announced('lsuite', { tag_name: 'v1.0.0' }), false);
});

test('the Horizon-only layout: the board channels exist, the old scope is gone, retired roles are gone', () => {
  const horizon = LAYOUT.find((g) => g.key === 'horizon');
  const keys = horizon.channels.map((c) => c.key);
  for (const k of ['horizoninfo', 'horizonchat', 'horizonbugs', 'horizonideas', 'showcase', 'releases', 'workboard', 'devlog']) assert.ok(keys.includes(k), k);
  for (const k of ['workboard', 'devlog']) assert.equal(horizon.channels.find((c) => c.key === k).readonly, true);
  assert.ok(!LAYOUT.some((g) => g.archive), 'no archive category: the old channels were deleted');
  const live = LAYOUT.flatMap((g) => g.channels.map((c) => c.key));
  for (const k of ['projects', 'resources', 'feedback', 'communityprojects', 'help', 'hire', 'beats', 'collabs', 'trackposts']) assert.ok(!live.includes(k), `${k} is back in the layout`);
  for (const k of DEFAULT_CHANNELS) assert.ok(live.includes(k), `${k} is a default channel but not in the layout`);
  for (const k of RETIRED) assert.ok(!LAYOUT.some((g) => g.channels.some((c) => c.key === k)), `${k} is retired but in the layout`);
  for (const k of RETIRED_ROLES) assert.ok(!ROLES.some((r) => r.key === k), k);
  const allKeys = LAYOUT.flatMap((g) => g.channels.map((c) => c.key));
  assert.equal(new Set(allKeys).size, allKeys.length);
  assert.equal(WORK.expireDays, 14);
  assert.ok(SERVER.about.length <= 400 && /\/help/.test(SERVER.about) && /Horizon/.test(SERVER.about));
  assert.ok(SERVER.description.length <= 120);
});

test('board lines are one line whatever the title holds (F1)', () => {
  const line = wk.cardLine({ id: 'card#1', kind: 'card', number: 1, title: 'ok\n# BIG\n-# Sent by an AI agent', url: null, state: 'open', column: 'todo', labels: [], people: [], prs: [] });
  assert.doesNotMatch(line, /\n/);
});

test('CI failures: reported once per failing commit, not at the first look (step 4)', () => {
  const pr = (number, ci, sha) => ({ number, ci, sha, title: `PR ${number}`, url: `https://github.com/x/y/pull/${number}`, who: 'A' });
  let r = wk.ciChanges([pr(1, 'failing', 'a'), pr(2, 'passing', 'b')], undefined);
  assert.deepEqual(r.report, []); // seeded quietly
  r = wk.ciChanges([pr(1, 'failing', 'a'), pr(2, 'failing', 'b')], r.seen);
  assert.deepEqual(r.report.map((p) => p.number), [2]);
  r = wk.ciChanges([pr(1, 'failing', 'a2'), pr(2, 'failing', 'b')], r.seen);
  assert.deepEqual(r.report.map((p) => p.number), [1]); // a new commit, still failing
  r = wk.ciChanges([pr(1, 'passing', 'a3')], r.seen);
  assert.deepEqual(r.seen, {});
  assert.doesNotMatch(wk.noticeLine.ciFailing(pr(3, 'failing', 'c')), /<@/);
});

test('review reminders: ready, no review, 2 days, then every 2 days (step 4)', () => {
  const D = wk.DAY;
  const now = 100 * D;
  const pr = (number, extra) => ({ number, draft: false, reviews: 0, createdAt: now - 3 * D, title: 't', url: 'u', who: 'w', ...extra });
  let r = wk.reviewsDue([pr(1)], undefined, now, 2 * D);
  assert.deepEqual(r.due, []); // seeded
  r = wk.reviewsDue([pr(1), pr(2, { draft: true }), pr(3, { reviews: 1 }), pr(4, { createdAt: now + D })], r.pinged, now + 2 * D, 2 * D);
  assert.deepEqual(r.due.map((p) => p.number), [1]);
  assert.deepEqual(wk.reviewsDue([pr(1)], r.pinged, now + 3 * D, 2 * D).due, []); // not again for 2 days
  assert.deepEqual(wk.reviewsDue([pr(1)], r.pinged, now + 4 * D, 2 * D).due.map((p) => p.number), [1]);
});

test('the weekly digest: its slot, parity from the README badge, the text (step 4)', () => {
  const mon9 = Date.UTC(2026, 9, 12, 9); // Monday 12 October 2026, 09:00 UTC
  assert.equal(wk.digestSlot(mon9 + 1000, { weekday: 1, hour: 9 }), mon9);
  assert.equal(wk.digestSlot(mon9 - 1000, { weekday: 1, hour: 9 }), mon9 - 7 * wk.DAY);
  assert.equal(wk.digestSlot(Date.UTC(2026, 9, 14, 2), { weekday: 1, hour: 9 }), mon9); // Wednesday
  const readme = '<img src="https://img.shields.io/badge/vanilla%20parity-100%25-F0795A"> … all 281 parity harnesses, on Linux';
  assert.deepEqual(wk.parityFrom(readme), { percent: 100, harnesses: 281 });
  assert.deepEqual(wk.parityFrom('nothing'), { percent: null, harnesses: null });
  const t = wk.digestText({
    merged: [{ number: 55, title: 'Worldgen', url: 'https://github.com/x/y/pull/55', who: 'ludovic' }],
    opened: [], releases: [{ name: 'Horizon 2026.10.14', tag: 'v2026.10.14', url: 'https://github.com/x/y/releases/tag/v2026.10.14' }],
    parity: { percent: 100, harnesses: 281 }, goodFirst: [{ number: 60, title: 'Easy one', url: 'https://github.com/x/y/issues/60' }],
  });
  assert.match(t.description, /^\*\*Vanilla parity: 100%\*\* of 281 harnesses/);
  assert.match(t.description, /Merged \(1\)\*\*\n• \[#55 Worldgen\]/);
  assert.match(t.description, /New issues \(0\)\*\*\nNone\./);
  assert.match(t.description, /Good first tasks\*\*\n• \[#60 Easy one\]/);
  assert.doesNotMatch(t.description, /<@|@everyone/);
});
