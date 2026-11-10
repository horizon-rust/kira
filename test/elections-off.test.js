// KIRA_ELECTIONS off (the default), with KIRA_GOVERNANCE on: no /elect, /poll and /vote exactly as before, every poll
// 24 hours, and `/vote body:` never reaches the elections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kira-elections-off-'));
process.env.KIRA_STATE = join(dir, 'state.json');
process.env.KIRA_DECISIONS = join(dir, 'decisions.json');
process.env.GITHUB_TOKEN = 'test-token-not-used';
process.env.KIRA_GOVERNANCE = 'on';
delete process.env.KIRA_ELECTIONS;
const { ELECTIONS } = await import('../src/config.js');
const poll = await import('../src/features/poll.js');
const el = await import('../src/features/elections.js');
const kit = await import('../src/poll-kit.js');

test('off: no /elect, no new options on /poll or /vote, no body-vote hook', () => {
  assert.equal(ELECTIONS.on, false);
  assert.deepEqual(el.commands, []);
  const [p, v] = poll.commands.map((c) => c.toJSON());
  assert.deepEqual(p.options[0].options.map((o) => o.name), ['kind', 'question', 'member', 'role', 'action']);
  assert.deepEqual(v.options.map((o) => o.name), ['question', 'type', 'two_thirds']);
  assert.equal(poll.hooks.bodyVote, null);
});

test('off: every poll lasts 24 hours, money included', () => {
  assert.deepEqual(kit.hoursFor('money', false, false), { hours: 24 });
  assert.deepEqual(kit.hoursFor('rule', true, false), { hours: 24 });
});

test('off: startElection and startVote refuse', async () => {
  assert.match((await el.startElection('1', { post: 'mod', member: '2' })).why, /not on yet/);
  assert.match((await el.startVote('1', { body: 'mods', question: 'Anything at all here?' })).why, /not on yet/);
});
