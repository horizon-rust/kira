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
