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
  assert.equal(await kit.mergedCount(gh, 'horizon-rust', 'horizon', 'ana-gh'), 3);
  const q = decodeURIComponent(gh.calls[0]);
  assert.match(q, /repo:horizon-rust\/horizon is:pr is:merged author:ana-gh&per_page=1/);
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

test('names against logins: spaces, dots and underscores do not count; contains only from 5 characters; the best match wins', () => {
  assert.equal(kit.squash(' Dave_The.Dev '), 'davethedev');
  const logins = ['davethedev', 'gus', 'gustavo-fring', 'bobby', 'kacpherek'];
  assert.equal(kit.matchLogin(['dave.the_dev'], logins), 'davethedev');
  assert.equal(kit.matchLogin(['DAVE THE DEV', null], logins), 'davethedev');
  assert.equal(kit.matchLogin(['xx_gustavo-fring_xx'], logins), 'gustavo-fring', 'contains, both long enough');
  assert.equal(kit.matchLogin(['gus'], logins), 'gus', 'equal is enough at any length');
  assert.equal(kit.matchLogin(['gust'], ['gustavo-fring']), null, 'four characters are too short to be contained');
  assert.equal(kit.matchLogin(['bob'], logins), null);
  assert.equal(kit.matchLogin(['the bobby show'], logins), 'bobby');
  assert.equal(kit.matchLogin(['kacpherek', 'Kacp'], ['kacp', 'kacpherek']), 'kacpherek', 'equal beats contains');
  assert.equal(kit.matchLogin([undefined, '', null], logins), null);
});

test('merged authors: every page, bots left out, a window of more than 1000 is split by dates', async () => {
  const calls = [];
  const day = (q) => decodeURIComponent(q).match(/merged:(\S+?)\.\.(\S+?)(&|$)/).slice(1, 3);
  const gh = {
    get: async (path, opts) => {
      calls.push([path, opts]);
      if (path.startsWith('/repos/')) return { created_at: '2026-10-01T10:00:00Z' };
      const [a, b] = day(path.split('?q=')[1]);
      const page = Number(path.match(/&page=(\d+)/)[1]);
      if (a === '2026-10-01' && b === '2026-10-04') return { total_count: 1500, items: [] }; // too many: halves
      if (a === '2026-10-01' && b === '2026-10-02') return { total_count: 250, items: Array.from({ length: page === 3 ? 50 : 100 }, (_, i) => ({ user: { login: `u${page}-${i}` } })) };
      if (a === '2026-10-03') return { total_count: 2, items: [{ user: { login: 'Ana-GH' } }, { user: { login: 'dependabot[bot]' } }] };
      return { total_count: 0, items: [] };
    },
  };
  const authors = await kit.mergedAuthors(gh, 'horizon-rust', 'horizon', { today: new Date('2026-10-04T12:00:00Z') });
  assert.equal(authors.size, 251, '250 from the first window and Ana');
  assert.equal(authors.get('ana-gh'), 'Ana-GH');
  assert.ok(!authors.has('dependabot[bot]'));
  assert.ok(calls.filter(([p]) => p.includes('search')).every(([, o]) => o?.cache === false), 'long searches are not cached');
  assert.equal(calls.filter(([p]) => p.includes('&page=3')).length, 1);
});

test('look-alike digits count as letters; a digit-laden username does not match a longer login by its letters', () => {
  assert.equal(kit.squashLeet('Excurs1ons.'), 'excursions');
  assert.equal(kit.matchLogin(['excursions.'], ['Excurs1ons', 'other']), 'Excurs1ons');
  assert.equal(kit.matchLogin(['murilinho145'], ['Murilinho145SG']), 'Murilinho145SG');
  assert.equal(kit.matchLogin(['domanffe_gg'], ['Domanffe']), 'Domanffe');
  assert.equal(kit.matchLogin(['louis9987_98481'], ['Louistuis']), null, 'the weak match stays weak');
  assert.equal(kit.matchLogin(['short_fox'], ['TheGaner']), null);
});
