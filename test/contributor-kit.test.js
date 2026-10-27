// The contributor rules with no Discord: the code, where it is looked for, who is verified, the merged-PR count, the grace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as kit from '../src/contributor-kit.js';

const fakeGh = (answers) => {
  const calls = [];
  return { calls, get: async (path) => { calls.push(path); const hit = Object.keys(answers).filter((k) => path.startsWith(k)).sort((a, b) => b.length - a.length)[0]; return hit ? answers[hit] : null; } };
};

test('a code is kira- and 8 characters people can read, different each time', () => {
  const codes = new Set(Array.from({ length: 50 }, () => kit.newCode()));
  assert.equal(codes.size, 50);
  for (const c of codes) assert.match(c, /^kira-[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
});

test('the same code until it expires, then a new one; another login gets a new one', () => {
  const work = {};
  const a = kit.startChallenge(work, '1', 'ana', 1000, 30 * 60_000);
  assert.equal(a.expires, 1000 + 30 * 60_000);
  assert.equal(kit.startChallenge(work, '1', 'Ana', 2000, 30 * 60_000).code, a.code);
  assert.notEqual(kit.startChallenge(work, '1', 'bob', 2000, 30 * 60_000).code, a.code);
  const b = work.challenges['1'];
  assert.equal(kit.expired(b, b.expires - 1), false);
  assert.equal(kit.expired(b, b.expires), true, 'expired');
  assert.notEqual(kit.startChallenge(work, '1', 'bob', b.expires + 1, 1000).code, b.code);
});

test('the code is found in the bio, or in a public gist named kira.txt; a wrong code or another file is not', async () => {
  const code = 'kira-abcd2345';
  assert.equal(await kit.codeIsPublished(fakeGh({ '/users/ana': { bio: `hi ${code} there` } }), 'ana', code), true);
  const gists = { '/users/ana/gists': [{ id: 'g1', files: { 'notes.txt': {} } }, { id: 'g2', files: { 'kira.txt': {} } }], '/gists/g1': { files: { 'notes.txt': { content: code } } }, '/gists/g2': { files: { 'kira.txt': { content: `${code}\n` } } } };
  const gh = fakeGh({ '/users/ana': { bio: 'nothing' }, ...gists });
  assert.equal(await kit.codeIsPublished(gh, 'ana', code), true);
  assert.ok(!gh.calls.includes('/gists/g1'), 'only kira.txt gists are read');
  assert.equal(await kit.codeIsPublished(fakeGh({ '/users/ana': { bio: 'kira-zzzzzzzz' }, ...gists }), 'ana', 'kira-wrong234'), false);
  assert.equal(await kit.codeIsPublished(fakeGh({ '/users/ana': { bio: code }, '/users/ana/gists': [{ id: 'g1', files: { 'notes.txt': {} } }], '/gists/g1': { files: { 'notes.txt': { content: code } } } }), 'ana', 'kira-other234'), false);
  assert.equal(await kit.codeIsPublished(fakeGh({}), 'not a login!', code), false, 'nothing is asked for a bad login');
});

test('merged pull requests: 0 and 3, counted by the search API for that repo and author', async () => {
  const gh = fakeGh({ '/search/issues': { total_count: 3 } });
  assert.equal(await kit.mergedCount(gh, 'ludovic111', 'horizon', 'ana-gh'), 3);
  const q = decodeURIComponent(gh.calls[0]);
  assert.match(q, /repo:ludovic111\/horizon is:pr is:merged author:ana-gh&per_page=1/);
  assert.equal(await kit.mergedCount(fakeGh({ '/search/issues': { total_count: 0 } }), 'o', 'r', 'ana'), 0);
  assert.equal(await kit.mergedCount(fakeGh({}), 'o', 'r', 'ana'), 0);
  assert.equal(await kit.mergedCount(gh, 'o', 'r', 'x y'), 0);
});

test('verified: the proved login, or the maintainers\' own; a changed link is not verified', () => {
  const fixed = { M: 'maint' };
  const work = { links: { 1: 'ana', 2: 'bob', M: 'maint' }, verified: { 1: 'Ana', 2: 'old-bob' } };
  assert.equal(kit.isVerified(work, '1', fixed), true);
  assert.equal(kit.isVerified(work, '2', fixed), false, 'verified another login than the linked one');
  assert.equal(kit.isVerified(work, 'M', fixed), true);
  assert.equal(kit.isVerified({ links: {} }, 'M', fixed), true);
  assert.equal(kit.isVerified(work, '3', fixed), false);
  assert.deepEqual(kit.verifiedPairs(work, fixed).sort(), [['1', 'ana'], ['M', 'maint']]);
  assert.equal(kit.holderOf(work, 'ANA', fixed), '1');
});

test('verifying a login takes it from anyone else who linked it', () => {
  const work = { links: { 1: 'ana', 2: 'ana' }, verified: {}, challenges: { 1: { code: 'x' } } };
  kit.markVerified(work, '1', 'ana');
  assert.deepEqual(work.links, { 1: 'ana' });
  assert.deepEqual(work.verified, { 1: 'ana' });
  assert.equal(work.challenges[1], undefined);
  kit.clearVerification(work, '1');
  assert.deepEqual(work.verified, {});
});

test('grace: 7 days from the first notice, kept if asked again', () => {
  const work = {};
  const g = kit.startGrace(work, '1', 1000, 7);
  assert.equal(g.until, 1000 + 7 * 86_400_000);
  assert.equal(kit.startGrace(work, '1', 5000, 7), g);
  assert.deepEqual(kit.graceOver(work, g.until - 1), []);
  assert.deepEqual(kit.graceOver(work, g.until), ['1']);
});
