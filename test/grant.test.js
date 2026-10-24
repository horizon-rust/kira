// Unit tests for the one-off "give everyone the 🎬 Videos role" (src/grant.js). No network: Discord is a stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discordApi, findRole, grantRole } from '../src/grant.js';

const GUILD = '111111111111111111';
const ROLE = '222222222222222222';
const user = (n, bot = false) => ({ user: { id: String(300000000000000000n + BigInt(n)), bot }, roles: [] });

// A fake Discord: a member list, the calls it saw, and optional scripted answers for the next PUTs.
function fake(list, { answers = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname.replace('/api/v10', '');
    calls.push(`${init.method} ${path}${new URL(url).search}`);
    assert.match(init.headers.Authorization, /^Bot /);
    if (init.method === 'GET' && path.endsWith('/roles')) return Response.json([{ id: ROLE, name: '🎬 Videos' }, { id: '5', name: 'other' }]);
    if (init.method === 'GET') {
      const after = BigInt(new URL(url).searchParams.get('after'));
      return Response.json(list.filter((m) => BigInt(m.user.id) > after).slice(0, 1000));
    }
    const scripted = answers.shift();
    if (scripted) return scripted;
    const id = path.split('/')[4];
    list.find((m) => m.user.id === id)?.roles.push(ROLE);
    return new Response(null, { status: 204 });
  };
  return { calls, fetchImpl };
}

test('every human gets the role once; bots and members who have it are skipped', async () => {
  const list = [user(1), user(2, true), { ...user(3), roles: [ROLE] }, user(4)];
  const { calls, fetchImpl } = fake(list);
  const api = discordApi('tok', { fetchImpl, sleep: async () => {} });
  const c = await grantRole({ api, guildId: GUILD, roleId: ROLE, log: () => {} });
  assert.deepEqual(c, { members: 4, bots: 1, had: 1, granted: 2, gone: 0, failed: 0 });
  assert.equal(calls.filter((x) => x.startsWith('PUT')).length, 2);
  assert.ok(calls.filter((x) => x.startsWith('PUT')).every((x) => x.endsWith(`/roles/${ROLE}`)));
  // run again: nothing left to do (idempotent)
  const again = await grantRole({ api, guildId: GUILD, roleId: ROLE, log: () => {} });
  assert.equal(again.granted, 0);
  assert.equal(again.had, 3);
});

test('--dry-run changes nothing and logs only counts', async () => {
  const list = [user(1), user(2), user(3, true)];
  const { calls, fetchImpl } = fake(list);
  const logged = [];
  const c = await grantRole({ api: discordApi('tok', { fetchImpl }), guildId: GUILD, roleId: ROLE, dryRun: true, log: (x) => logged.push(x) });
  assert.deepEqual(c, { members: 3, bots: 1, had: 0, granted: 0, gone: 0, failed: 0, wouldGrant: 2 });
  assert.ok(calls.every((x) => x.startsWith('GET')));
  assert.deepEqual(logged, []);
  assert.ok(list.every((m) => m.roles.length === 0));
});

test('members are read in pages of 1000', async () => {
  const list = Array.from({ length: 2300 }, (_, i) => user(i + 1));
  const { calls, fetchImpl } = fake(list);
  const c = await grantRole({ api: discordApi('tok', { fetchImpl }), guildId: GUILD, roleId: ROLE, dryRun: true });
  assert.equal(c.members, 2300);
  assert.equal(calls.length, 3);
});

test('a 429 waits retry_after and tries the same request again, one at a time', async () => {
  const list = [user(1), user(2)];
  const slept = [];
  const limited = Response.json({ message: 'You are being rate limited.', retry_after: 1.5, global: false }, { status: 429 });
  const { calls, fetchImpl } = fake(list, { answers: [limited] });
  const c = await grantRole({ api: discordApi('tok', { fetchImpl, sleep: async (ms) => slept.push(ms) }), guildId: GUILD, roleId: ROLE, log: () => {} });
  assert.equal(c.granted, 2);
  assert.equal(slept.length, 1);
  assert.ok(slept[0] >= 1500);
  assert.equal(calls.filter((x) => x.startsWith('PUT')).length, 3); // the first PUT twice, then the second member
  // a bucket with nothing left makes the next request wait for its reset
  const waits = [];
  const api = discordApi('tok', { fetchImpl: async () => new Response(null, { status: 204, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '2' } }), sleep: async (ms) => waits.push(ms) });
  await api.request('PUT', '/guilds/1/members/2/roles/3');
  assert.ok(waits[0] >= 2000);
});

test('a member who left is counted, another error is counted and does not stop the rest; no ids in the output', async () => {
  const list = [user(1), user(2), user(3)];
  const { fetchImpl } = fake(list, { answers: [new Response('', { status: 404 }), new Response('', { status: 403 })] });
  const logged = [];
  const c = await grantRole({ api: discordApi('tok', { fetchImpl }), guildId: GUILD, roleId: ROLE, log: (x) => logged.push(x) });
  assert.deepEqual([c.gone, c.failed, c.granted], [1, 1, 1]);
  assert.ok(logged.every((x) => !/\d{15,}/.test(x) && !/tok/.test(x)));
});

test('the role is found by name; none or several is an error', async () => {
  const { fetchImpl } = fake([]);
  assert.equal(await findRole(discordApi('tok', { fetchImpl }), GUILD, '🎬 Videos'), ROLE);
  await assert.rejects(findRole(discordApi('tok', { fetchImpl }), GUILD, 'nope'), /0 roles/);
});
