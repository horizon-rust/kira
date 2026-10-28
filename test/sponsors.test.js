// Unit tests for 💚 Sponsor (src/sponsor-kit.js): the GitHub check, the Verify button and the daily recheck. No Discord.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSponsor, verify, link, recheck, startChallenge, codeText, LOGIN } from '../src/sponsor-kit.js';
import { SPONSORS, ROLES } from '../src/config.js';

const now = Date.parse('2026-10-28T15:00:00Z');
const gql = (answer) => ({ calls: [], async graphql(q, v) { this.calls.push(v); return typeof answer === 'function' ? answer(v) : answer; } });

test('sponsor: GitHub isSponsoredBy decides; an unknown account is not a sponsor; other errors decide nothing', async () => {
  const yes = gql({ data: { user: { isSponsoredBy: true } } });
  assert.equal(await isSponsor(yes, 'ludovic111', 'd3grando'), true);
  assert.deepEqual(yes.calls[0], { maintainer: 'ludovic111', login: 'd3grando' });
  assert.equal(await isSponsor(gql({ data: { user: { isSponsoredBy: false } } }), 'ludovic111', 'torvalds'), false);
  assert.equal(await isSponsor(gql({ data: { user: null }, errors: [{ type: 'NOT_FOUND', message: 'no such login' }] }), 'ludovic111', 'nobody-zz9'), false);
  await assert.rejects(isSponsor(gql({ errors: [{ type: 'RATE_LIMITED', message: 'slow down' }] }), 'ludovic111', 'x'), /slow down/);
  await assert.rejects(isSponsor(gql(null), 'ludovic111', 'x'));
  const never = gql(() => { throw new Error('must not ask GitHub'); });
  assert.equal(await isSponsor(never, 'ludovic111', 'bad login!'), false); // never sent to GitHub
  for (const ok of ['d3grando', 'BrokenEffects', 'a', 'a-b-c']) assert.ok(LOGIN.test(ok), ok);
  for (const bad of ['-a', 'a-', 'a--b', 'a b', 'a'.repeat(40), '../x']) assert.ok(!LOGIN.test(bad), bad);
});

test('sponsor: Verify needs the code on the account AND the sponsorship; the login alone is never enough', async () => {
  const sp = {};
  const published = async (login, code) => login === 'd3grando' && code === sp.challenges?.u1?.code;
  assert.equal((await verify({ sp, id: 'u1', now, published, sponsor: async () => true })).result, 'nocode');
  const c = startChallenge(sp, 'u1', 'd3grando', now, SPONSORS.codeTtlMs);
  assert.match(c.code, /^kira-[a-z2-9]{8}$/);
  assert.match(codeText('d3grando', c), new RegExp(c.code));
  // Not published yet: no role, the code stays.
  assert.equal((await verify({ sp, id: 'u1', now, published: async () => false, sponsor: async () => true })).result, 'unpublished');
  assert.ok(sp.challenges.u1);
  // Published but GitHub stopped reporting the sponsorship.
  assert.equal((await verify({ sp, id: 'u1', now, published, sponsor: async () => false })).result, 'notsponsor');
  // Someone else pressing Verify has no code of their own.
  assert.equal((await verify({ sp, id: 'u2', now, published, sponsor: async () => true })).result, 'nocode');
  const ok = await verify({ sp, id: 'u1', now, published, sponsor: async () => true });
  assert.deepEqual(ok, { result: 'ok', login: 'd3grando', takenFrom: [] });
  assert.equal(sp.challenges.u1, undefined, 'the code is used up');
});

test('sponsor: an expired code is dropped; proof moves a login from another member', async () => {
  const sp = {};
  startChallenge(sp, 'u1', 'BrokenEffects', now, SPONSORS.codeTtlMs);
  assert.equal((await verify({ sp, id: 'u1', now: now + SPONSORS.codeTtlMs, published: async () => true, sponsor: async () => true })).result, 'expired');
  assert.equal(sp.challenges.u1, undefined);
  link(sp, 'old', 'brokeneffects', 'kira', now - 1000);
  startChallenge(sp, 'u1', 'BrokenEffects', now, SPONSORS.codeTtlMs);
  const ok = await verify({ sp, id: 'u1', now, published: async () => true, sponsor: async () => true });
  assert.deepEqual(ok.takenFrom, ['old']);
});

test('sponsor: the daily recheck looks only at roles Kira gave, keeps one-time sponsors GitHub still reports, survives errors', async () => {
  const sp = {};
  link(sp, 'monthly', 'm', 'kira', now);
  link(sp, 'onetime', 'd3grando', 'kira', now);
  link(sp, 'ended', 'gone', 'kira', now);
  link(sp, 'flaky', 'flaky', 'kira', now);
  link(sp, 'sculk', 'dezerx', 'had', now);   // held the role before /sponsor (.dezerx, given by hand)
  link(sp, 'private', null, 'hand', now);    // /sponsor-grant
  const asked = [];
  const sponsor = async (login) => {
    asked.push(login);
    if (login === 'flaky') throw new Error('GitHub down');
    return login !== 'gone' && login !== 'dezerx';
  };
  let slept = 0;
  const out = await recheck({ sp, sponsor, sleep: async () => { slept++; } });
  assert.deepEqual(out, { checked: 4, lapsed: ['ended'], errors: 1 });
  assert.deepEqual(asked, ['m', 'd3grando', 'gone', 'flaky']); // never the hand-given ones
  assert.equal(slept, 4);
});

test('sponsor: the role and the settings', () => {
  assert.equal(ROLES.find((r) => r.key === SPONSORS.role).name, '💚 Sponsor');
  assert.equal(SPONSORS.recheckEveryMs, 24 * 3_600_000);
  assert.ok(SPONSORS.perHour > 0 && SPONSORS.perHour <= 10);
});
