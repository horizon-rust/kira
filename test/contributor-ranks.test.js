// Contributor ranks: the rank roles made by the admin route, settled when Kira grants, on a merge and in the sweep,
// one line in #contributors per climb, /ranks and /rank's part, against a fake server and a fake GitHub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collection } from 'discord.js';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-ranks-')), 'state.json');
process.env.GITHUB_TOKEN = 'test-token-not-used';
const { GUILD_ID, CONTRIBUTORS } = await import('../src/config.js');
CONTRIBUTORS.searchPaceMs = 0;
const core = await import('../src/core.js');
const c = await import('../src/features/contributors.js');
const work = c._test.work;
const settled = () => new Promise((ok) => setTimeout(ok, 30));

// Roles: @everyone, Contributor, lvl 50 (the ranks go right above it), Booster.
const roles = new Collection();
const addRole = (id, name, position, extra = {}) => roles.set(id, { id, name, position, ...extra });
addRole('1000', '@everyone', 0); addRole('1001', '🛠️ Contributor', 1); addRole('1002', 'lvl 50', 2); addRole('1003', '💎 Booster', 3);
let nextId = 2000;
const created = [];
const moves = [];
const guildRoles = {
  cache: roles,
  fetch: async () => roles,
  create: async (data) => { const id = String(nextId++); created.push(data); addRole(id, data.name, 1); return roles.get(id); },
  setPositions: async (list) => { moves.push(list); for (const { role, position } of list) roles.get(role).position = position; },
};
const members = new Collection();
const member = (id) => {
  const set = new Set();
  const change = (fn) => async (r) => { for (const x of [r].flat()) fn(x); };
  const m = { id, user: { bot: false, username: id }, displayName: id, permissions: { has: () => false }, roles: { cache: set, add: change((x) => set.add(x)), remove: change((x) => set.delete(x)) }, send: async () => {} };
  members.set(id, m);
  return m;
};
core.client.guilds.cache.set(GUILD_ID, { roles: guildRoles, members: { cache: members, fetch: async (id) => (id ? members.get(id) ?? Promise.reject(new Error('gone')) : members) } });
core.state.roles.contributor = '1001';
core.state.roles.lvl50 = '1002';
core.state.channels.contributors = 'C1';
const lines = [];
core.client.channels.cache.set('C1', { send: async (m) => lines.push(m) });

// GitHub: the Horizon-only count, and the count summed with horizon-mods.
const hub = { horizon: {}, all: {} };
c._test.setGitHub({
  get: async (path) => {
    const q = decodeURIComponent(path);
    const login = q.match(/author:([\w-]+)/)?.[1];
    if (login) return { total_count: (q.includes('horizon-mods') ? hub.all : hub.horizon)[login] ?? 0 };
    return null;
  },
  write: async () => ({}),
});
work.links ??= {}; work.verified ??= {};
const verify = (id, login) => { work.links[id] = login; work.verified[id] = login; };
const has = (id, key) => members.get(id).roles.cache.has(core.state.roles[key] ?? work.rankRoles?.[key]);

test('before the rank roles exist, granting gives only 🛠️ Contributor and records no rank', async () => {
  member('a'); verify('a', 'ana'); hub.horizon.ana = 30; hub.all.ana = 35;
  await c.afterRefresh({ pulls: [{ merged_at: new Date().toISOString(), user: { login: 'ana' } }] });
  assert.equal(has('a', 'contributor'), true);
  assert.equal(work.ranks?.a, undefined);
  assert.equal(lines.length, 1, 'the welcome line only');
  assert.doesNotMatch(lines[0].content, /Iron/);
  assert.match(c.rankNote('a'), /not counted yet/);
});

test('the admin route: a dry run creates nothing; the real one makes the roles without permissions, above lvl 50, and backfills quietly', async () => {
  const dry = await c.ensureRankRoles();
  assert.deepEqual(dry.roles.map((r) => r.action), ['would create', 'would create', 'would create', 'would create']);
  assert.equal(created.length, 0);
  assert.equal(core.state.roles.iron, undefined);
  const real = await c.ensureRankRoles({ dry: false });
  assert.deepEqual(real.roles.map((r) => r.name), ['⛏️ Iron', '🥇 Gold', '💎 Diamond', '🟪 Netherite']);
  assert.ok(created.every((r) => r.hoist === true && r.mentionable === false && r.permissions.length === 0));
  assert.equal(new Set(created.map((r) => r.colors.primaryColor)).size, 4, 'distinct colours');
  const order = [...roles.values()].sort((x, y) => x.position - y.position).map((r) => r.name);
  assert.deepEqual(order, ['@everyone', '🛠️ Contributor', 'lvl 50', '⛏️ Iron', '🥇 Gold', '💎 Diamond', '🟪 Netherite', '💎 Booster']);
  await settled(); // the sweep it started
  assert.equal(has('a', 'iron'), true, '35 summed: Iron');
  assert.equal(work.ranks.a.key, 'iron');
  assert.equal(lines.length, 1, 'the backfill is not announced');
  assert.equal((await c.ensureRankRoles({ dry: false })).moved, 0, 'a second run finds them in place');
  assert.equal(created.length, 4);
});

test('climbing: the new rank replaces the old one, one line in #contributors with no ping', async () => {
  hub.all.ana = 41;
  await c.afterRefresh({ pulls: [{ merged_at: new Date().toISOString(), user: { login: 'ana' } }] });
  assert.equal(has('a', 'gold'), true);
  assert.equal(has('a', 'iron'), false);
  assert.equal(has('a', 'contributor'), true, 'the base stays');
  assert.equal(lines.length, 2);
  assert.match(lines[1].content, /<@a> reached \*\*🥇 Gold\*\*: 41 merged pull requests/);
  assert.deepEqual(lines[1].allowedMentions, { parse: [] });
  await c.sweep();
  assert.equal(lines.length, 2, 'the same rank again is not announced');
  hub.all.ana = 150;
  await c.afterRefresh({ pulls: [{ merged_at: '2026-01-01T00:00:00Z', user: { login: 'ana' } }] });
  assert.equal(work.ranks.a.count, 41, 'a merge older than the stored count is not searched again');
});

test('ranks only go up: a lower count keeps the rank', async () => {
  hub.all.ana = 20;
  await c.sweep();
  assert.equal(has('a', 'gold'), true);
  assert.equal(work.ranks.a.key, 'gold');
});

test('a fresh verification above the base: the welcome line says the rank, no separate line', async () => {
  member('b'); verify('b', 'bo'); hub.horizon.bo = 110; hub.all.bo = 120;
  await c.afterRefresh({ pulls: [{ merged_at: new Date().toISOString(), user: { login: 'bo' } }] });
  assert.equal(has('b', 'diamond'), true);
  assert.equal(lines.length, 3);
  assert.match(lines[2].content, /Welcome <@b>.*at \*\*💎 Diamond\*\* already/);
});

test('/ranks: the top by count, public in #contributors and only for the asker elsewhere; /rank shows the count and the next rank', async () => {
  const run = async (channelId) => { let out; await c.handlers.ranks({ channelId, reply: async (m) => { out = m; } }); return out; };
  const here = await run('C1');
  assert.equal(here.flags, undefined);
  assert.deepEqual(here.allowedMentions, { parse: [] });
  assert.match(here.content, /\*\*1\.\*\* 💎 <@b> · bo · 120\n\*\*2\.\*\* 🥇 <@a> · ana · 20/);
  assert.ok((await run('elsewhere')).flags, 'ephemeral outside #contributors');
  assert.match(c.rankNote('b'), /💎 Diamond.*120 merged pull requests by \*\*bo\*\*.*next: \*\*🟪 Netherite\*\* at 200 \(80 to go\)/);
  assert.equal(c.rankNote('nobody'), '', 'no GitHub link: nothing added to /rank');
});

test('the rank goes with the link: roles removed, the record dropped, off the board', async () => {
  await c.relinked('b');
  assert.equal(has('b', 'diamond'), false);
  assert.equal(work.ranks.b, undefined);
  let out;
  await c.handlers.ranks({ channelId: 'C1', reply: async (m) => { out = m; } });
  assert.doesNotMatch(out.content, /<@b>/);
});
