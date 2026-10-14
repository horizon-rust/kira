// The kanban board as data (src/board.js): where cards go, manual moves, the snapshot, finding cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as board from '../src/board.js';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const day = 86_400_000;
const iso = (t) => new Date(t).toISOString();
const issue = (number, extra = {}) => ({ number, title: `Issue ${number}`, html_url: `https://github.com/x/y/issues/${number}`, state: 'open', labels: [], assignees: [], user: { login: 'ludovic111' }, updated_at: iso(NOW - day), ...extra });
const pull = (number, extra = {}) => ({ number, title: `PR ${number}`, html_url: `https://github.com/x/y/pull/${number}`, state: 'open', draft: false, user: { login: 'Online5277' }, body: '', labels: [], assignees: [], updated_at: iso(NOW - day), status: '👀 in review', ...extra });
const gh = (extra) => ({ repo: 'x/y', issues: [], pulls: [], branches: [], ...extra });
const where = (snap) => Object.fromEntries(board.cards(snap).map((c) => [c.id, c.column]));

test('auto columns: To do, In progress (claim, assignee, branch, draft PR), Review, Backlog label, Done', () => {
  const { snapshot } = board.build(gh({
    issues: [
      issue(1), issue(2, { assignees: [{ login: 'Online5277' }] }), issue(3), issue(4), issue(5), issue(6),
      issue(7, { labels: [{ name: 'backlog' }] }),
      issue(8, { state: 'closed', closed_at: iso(NOW - 2 * day), state_reason: 'completed' }),
      issue(9, { state: 'closed', closed_at: iso(NOW - 30 * day) }), // too old for Done
      { ...issue(10), pull_request: {} }, // the issues API lists pull requests too
      issue(11, { labels: [{ name: 'test' }] }), // Kira's own test issues stay off the board
    ],
    pulls: [
      pull(20, { draft: true, body: 'Fixes #4' }), pull(21, { body: 'Closes #5' }), pull(22), pull(23, { draft: true }),
      pull(24, { state: 'closed', merged_at: iso(NOW - day) }), pull(25, { state: 'closed', merged_at: iso(NOW - day), body: 'fixes #8' }),
    ],
    branches: ['6-water-renders-black', 'launcher-0.1.2', 'parity/blocks', 'main'],
  }), { claims: { 3: { user: 'u1', who: 'Cosmic', since: NOW - day } } }, { now: NOW });
  assert.deepEqual(where(snapshot), {
    'issue#1': 'todo', 'issue#2': 'progress', 'issue#3': 'progress', 'issue#4': 'progress', 'issue#5': 'review', 'issue#6': 'progress',
    'issue#7': 'backlog', 'issue#8': 'done', 'pr#22': 'review', 'pr#23': 'progress', 'pr#24': 'done',
  });
  const five = board.find(snapshot, 5);
  assert.deepEqual(five.prs.map((p) => p.number), [21]); // the PR shows on its issue, not as its own card
  assert.deepEqual(board.find(snapshot, 8).prs.map((p) => p.number), [25]);
  assert.deepEqual(board.find(snapshot, '#6').branches, ['6-water-renders-black']);
  assert.equal(snapshot.version, board.SNAPSHOT_VERSION);
  assert.deepEqual(snapshot.columns.map((c) => c.key), ['backlog', 'todo', 'progress', 'review', 'done']);
});

test('people: the Discord claim first, then assignees and PR authors, with their Discord names when linked', () => {
  const person = (login) => (login === 'Online5277' ? { login, discordId: 'u1', name: 'Cosmic' } : { login, discordId: null, name: login });
  const { snapshot } = board.build(gh({ issues: [issue(3, { assignees: [{ login: 'Online5277' }] }), issue(4)], pulls: [pull(30, { body: 'Fixes #4' })] }),
    { claims: { 3: { user: 'u1', who: 'Cosmic', since: NOW - day } } }, { now: NOW, person });
  assert.deepEqual(board.find(snapshot, 3).people, [{ login: null, discordId: 'u1', name: 'Cosmic', claimed: true }]);
  assert.deepEqual(board.find(snapshot, 4).people.map((p) => p.name), ['Cosmic']);
  assert.match(board.find(snapshot, 3).claim.lapses, /^2026-10-27/); // 14 days after the claim
  assert.deepEqual(board.list(snapshot, { person: 'Cosmic' }).map((c) => c.id), ['issue#3', 'issue#4']);
  assert.deepEqual(board.list(snapshot, { person: 'online5277', column: 'review' }).map((c) => c.id), ['issue#4']);
});

test('manual moves hold until GitHub changes the card, and moving back clears them', () => {
  const work = { claims: {}, moves: {} };
  let { snapshot } = board.build(gh({ issues: [issue(1), issue(2)] }), work, { now: NOW });
  const r = board.move(work, snapshot, 1, 'Backlog', 'Ludovic', NOW);
  assert.deepEqual([r.from, r.to], ['todo', 'backlog']);
  ({ snapshot } = board.build(gh({ issues: [issue(1), issue(2)] }), work, { now: NOW }));
  assert.equal(board.find(snapshot, 1).column, 'backlog');
  assert.equal(board.find(snapshot, 1).moved.by, 'Ludovic');
  // GitHub moves on (someone is assigned): the manual move is stale.
  const after = board.build(gh({ issues: [issue(1, { assignees: [{ login: 'a' }] }), issue(2)] }), work, { now: NOW });
  assert.equal(board.find(after.snapshot, 1).column, 'progress');
  assert.deepEqual(after.stale, ['issue#1']);
  // Moving a card where GitHub puts it keeps no manual move.
  board.move(work, snapshot, 2, 'todo', 'Ludovic');
  assert.equal(work.moves['issue#2'], undefined);
  assert.throws(() => board.move(work, snapshot, 2, 'nowhere', 'L'), /isn't a column/);
  assert.throws(() => board.move(work, snapshot, 99, 'done', 'L'), /isn't on the board/);
});

test('assign and unassign are claims; refs and column names parse', () => {
  const work = {};
  board.assign(work, 40, { user: 'u1', who: 'Cosmic' }, NOW);
  assert.equal(work.claims[40].since, NOW);
  assert.throws(() => board.assign(work, 40, { user: 'u2', who: 'Other' }), /already claimed by Cosmic/);
  assert.equal(board.assign(work, 40, { user: 'u1', who: 'Cosmic' }, NOW + 5).activity, NOW + 5);
  assert.equal(board.unassign(work, 40).who, 'Cosmic');
  assert.equal(board.unassign(work, 40), null);
  assert.deepEqual(board.parseRef('pr#56'), { kind: 'pr', number: 56 });
  assert.deepEqual(board.parseRef('#40'), { kind: null, number: 40 });
  assert.equal(board.parseRef('hello'), null);
  assert.equal(board.columnKey('In progress'), 'progress');
  assert.equal(board.columnKey('To do'), 'todo');
  assert.equal(board.columnKey('done'), 'done');
  assert.equal(board.branchIssue('40-water-renders-black'), 40);
  assert.equal(board.branchIssue('fix/issue-12'), 12);
  assert.equal(board.branchIssue('launcher-0.1.2'), null);
  assert.equal(board.branchIssue('t3/achieve-full-parity'), null);
});

test('the snapshot is plain JSON', () => {
  const { snapshot } = board.build(gh({ issues: [issue(1)], pulls: [pull(2)] }), {}, { now: NOW });
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
});

test('writes count only claims and owned Kira cards, never linked GitHub logins (M1)', () => {
  const person = (login) => ({ login, discordId: login === 'Online5277' ? 'u1' : null, name: login });
  const work = { claims: { 3: { user: 'u2', who: 'B', since: NOW } }, cards: {} };
  board.addCard(work, { title: 'mine', owner: { discordId: 'u1', name: 'Cosmic' } }, NOW);
  const { snapshot } = board.build(gh({ issues: [issue(3), issue(4, { assignees: [{ login: 'Online5277' }] })], pulls: [pull(9)] }), work, { now: NOW, person });
  assert.ok(board.isMine(board.find(snapshot, 'pr#9'), 'u1')); // shown as theirs (/mytasks)…
  assert.ok(!board.ownsForWrite(board.find(snapshot, 'pr#9'), 'u1')); // …but not theirs to move
  assert.ok(!board.ownsForWrite(board.find(snapshot, 4), 'u1')); // assigned through a linked login: no
  assert.ok(board.ownsForWrite(board.find(snapshot, 3), 'u2')); // claimed: yes
  assert.ok(board.ownsForWrite(board.find(snapshot, 'card#1'), 'u1')); // their Kira card: yes
  assert.ok(!board.ownsForWrite(board.find(snapshot, 'card#1'), 'u2'));
  assert.ok(!board.ownsForWrite(board.find(snapshot, 3), null));
});

test('card links: https on github.com or playhorizon.dev only, nothing that breaks a Markdown link (M3)', () => {
  for (const ok of ['https://github.com/ludovic111/horizon/issues/40', 'https://playhorizon.dev/', 'https://www.github.com/x', 'https://docs.playhorizon.dev/a?b=c#d']) assert.ok(board.safeCardUrl(ok), ok);
  for (const bad of [
    'https://a.com/x>)[free nitro](https://evil.example)', 'https://github.com/x>)[free nitro](https://evil.example)',
    'https://github.com/a b', 'https://github.com/x)', 'https://github.com/<x>', 'http://github.com/x', 'javascript:alert(1)',
    'https://evil.example/', 'https://github.com.evil.example/', 'https://user:pw@github.com/', 'https://github.com:8443/',
    'https://GITHUB.com/x', 'https://github.com/x\\y', 'https://github.com/[x]', 'https://github.com/`x`',
  ]) assert.ok(!board.safeCardUrl(bad), bad);
  assert.throws(() => board.addCard({}, { title: 'x y z', owner: { discordId: 'u' }, url: 'https://evil.example/' }), /github.com or playhorizon.dev/);
});

test('at most 10 open Kira cards per member (H1)', () => {
  const work = {};
  for (let i = 0; i < 10; i++) board.addCard(work, { title: `card ${i}`, owner: { discordId: 'u1', name: 'C' } }, NOW);
  assert.throws(() => board.addCard(work, { title: 'one more', owner: { discordId: 'u1', name: 'C' } }, NOW), /already have 10 open cards/);
  assert.ok(board.addCard(work, { title: 'theirs', owner: { discordId: 'u2', name: 'D' } }, NOW)); // per member
  work.cards[1].closedAt = NOW; // one done: room again
  assert.ok(board.addCard(work, { title: 'now ok', owner: { discordId: 'u1', name: 'C' } }, NOW));
  assert.throws(() => board.move({}, { columns: [] }, 1, 'todo', 'x'), (e) => e.expose === true); // refusals are shown
});

test('Kira cards stored before the rules are fixed once: bad links and labels dropped (N3, re-validation)', () => {
  const work = { cards: {
    1: { title: 'old', column: 'todo', url: 'https://a.com/x>)[free nitro](https://evil.example)', labels: ['ok', 'Bad<>', 'fine-2'] },
    2: { title: 'good', column: 'todo', url: 'https://github.com/x', labels: ['a'] },
  } };
  assert.equal(board.sanitizeCards(work), 1);
  assert.equal(work.cards[1].url, null);
  assert.deepEqual(work.cards[1].labels, ['ok', 'fine-2']);
  assert.equal(work.cards[2].url, 'https://github.com/x');
  assert.equal(board.sanitizeCards(work), 0); // idempotent
  assert.throws(() => board.addCard({}, { title: 'x y z', owner: { discordId: 'u' }, labels: ['UPPER'] }), /Labels are lowercase/);
});
