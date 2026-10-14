// The Discord side of agents (src/features/agents.js): tokens die with membership, the 5-second membership
// check, and text from agents made harmless in Discord.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let feat, ag, core;
before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kira-feat-'));
  process.env.KIRA_STATE = join(dir, 'state.json'); // never the real state
  process.env.KIRA_AGENTS = join(dir, 'agents.json');
  core = await import('../src/core.js');
  ag = await import('../src/agents.js');
  feat = await import('../src/features/agents.js');
});

test('leaving or being banned revokes all of a member\'s tokens (H2)', async () => {
  const a = ag.issue(feat.store, { user: '111111111111111111', name: 'Leaver', scope: 'write' });
  const b = ag.issue(feat.store, { user: '111111111111111111', name: 'Leaver' });
  const keep = ag.issue(feat.store, { user: '222222222222222222', name: 'Stays' });
  await feat._test.dropTokens({ id: '111111111111111111', username: 'leaver' }, 'banned');
  assert.equal(ag.verify(feat.store, a.token).why, 'revoked');
  assert.equal(ag.verify(feat.store, b.token).why, 'revoked');
  assert.equal(ag.verify(feat.store, keep.token).ok, true);
});

test('membership is asked from Discord, remembered 5 s at most; gone or timed out → refused (H2)', async () => {
  const now = Date.now();
  const answers = {
    '1': { user: { id: '1' } },
    '2': { user: { id: '2' }, communication_disabled_until: new Date(now + 3_600_000).toISOString() },
    '3': { user: { id: '3' }, communication_disabled_until: new Date(now - 1000).toISOString() },
  };
  let calls = 0;
  core.client.rest.get = async (route) => {
    calls++;
    const id = route.split('/').pop();
    if (!answers[id]) throw Object.assign(new Error('Unknown Member'), { status: 404 });
    return answers[id];
  };
  assert.equal(await feat.isActiveMember('1', now), true);
  assert.equal(await feat.isActiveMember('2', now), false); // timed out
  assert.equal(await feat.isActiveMember('3', now), true); // timeout over
  assert.equal(await feat.isActiveMember('4', now), false); // not a member
  const before = calls;
  assert.equal(await feat.isActiveMember('1', now + 4_000), true); // cached
  assert.equal(calls, before);
  delete answers['1']; // they leave
  assert.equal(await feat.isActiveMember('1', now + 5_001), false); // asked again after 5 s
  assert.equal(calls, before + 1);
});

test('clean(): no masked links, mentions or @everyone from agent text (M3)', () => {
  const out = feat.clean('[free nitro](https://evil.example) @everyone <@123456789012345678> \\[x](y)', 500);
  assert.doesNotMatch(out, /(?<!\\)\[/); // every [ is escaped
  assert.doesNotMatch(out, /(?<!\\)\]/);
  assert.doesNotMatch(out, /@everyone/);
  assert.doesNotMatch(out, /<@\d+>/);
  assert.equal(feat.clean('a'.repeat(50), 10), 'aaaaaaaaaa');
});

test('claim then unclaim within 10 minutes is refused; names go to GitHub in a code span (H1, L5)', async () => {
  const wb = await import('../src/features/workboard.js');
  const writes = [];
  wb._test.setGitHub({
    get: async (path) => (path.endsWith('/labels/in%20progress') ? {} : { number: 77, title: 'An issue', html_url: 'https://github.com/x/y/issues/77', state: 'open', labels: [] }),
    write: async (method, path, body) => { writes.push({ method, path, body }); return {}; },
  });
  const user = { id: '333333333333333333', globalName: '@everyone **[x](https://evil.example)**', username: 'u' };
  assert.match(await wb.claim(user, null, 77), /is yours/);
  const comment = writes.find((w) => w.path.endsWith('/comments')).body.body;
  assert.match(comment, /^Claimed by `@everyone \*\*\[x\]\(https:\/\/evil\.example\)\*\*` on Discord/);
  const n = writes.length;
  assert.match(await wb.unclaim(user, null, 77), /unclaim it in 10 min/);
  assert.equal(writes.length, n); // nothing written to GitHub
  wb._test.work.githubAt[77] -= 10 * 60_000; // ten minutes later
  assert.match(await wb.unclaim(user, null, 77), /free again/);
  const again = { ...user, id: '444444444444444444' };
  assert.match(await wb.claim(again, null, 77), /a moment ago/); // and no instant re-claim either
});
