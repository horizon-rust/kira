// /verify-github, granting, the role clean-up and the sweep, against a fake server and a fake GitHub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collection } from 'discord.js';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-verify-')), 'state.json');
process.env.GITHUB_TOKEN = 'test-token-not-used';
const { GUILD_ID, OWNER_ID, CONTRIBUTORS } = await import('../src/config.js');
CONTRIBUTORS.searchPaceMs = 0; // no wait between searches in tests
const core = await import('../src/core.js');
const c = await import('../src/features/contributors.js');

// A server with members; a member has roles, can be DMed and has permissions.
const sent = { contributors: [], announcements: [], dms: [] };
const members = new Collection();
const member = (id, { roles = [], staff = false, bot = false, dmOpen = true } = {}) => {
  const set = new Set(roles);
  const m = {
    id, user: { bot }, permissions: { has: () => staff },
    roles: { cache: set, add: async (r) => void set.add(r), remove: async (r) => void set.delete(r) },
    send: async (text) => { if (!dmOpen) throw new Error('closed'); sent.dms.push([id, text]); },
  };
  members.set(id, m);
  return m;
};
core.client.guilds.cache.set(GUILD_ID, { members: { cache: members, fetch: async (id) => (id ? members.get(id) ?? Promise.reject(new Error('gone')) : members) } });
core.state.roles.contributor = 'ROLE';
core.state.channels.contributors = 'C1';
core.state.channels.announcements = 'C2';
core.client.channels.cache.set('C1', { send: async (m) => sent.contributors.push(m) });
core.client.channels.cache.set('C2', { send: async (m) => sent.announcements.push(m) });

// GitHub: bios, gists and merged counts by login.
const hub = { bio: {}, merged: {}, down: false };
c._test.setGitHub({
  get: async (path) => {
    if (hub.down) throw new Error('HTTP 500');
    const user = path.match(/^\/users\/([^/?]+)$/)?.[1];
    if (user) return { login: user, bio: hub.bio[user] ?? '' };
    if (path.includes('/gists')) return [];
    const login = decodeURIComponent(path).match(/author:([\w-]+)/)?.[1];
    if (login) return { total_count: hub.merged[login] ?? 0 };
    return null;
  },
  write: async () => ({}),
});
const work = c._test.work;
work.links ??= {};

const run = async (userId, { check = false, target = null, staff = false } = {}) => {
  const out = [];
  await c.handlers['verify-github']({
    user: { id: userId }, member: { permissions: { has: () => staff } },
    options: { getUser: () => (target ? { id: target } : null), getBoolean: () => check },
    deferReply: async () => {}, editReply: async (m) => out.push(m.content),
  });
  return out.at(-1);
};

test('no link: asked to link first; a link: a code to put in the bio', async () => {
  member('u1');
  assert.match(await run('u1'), /\/link-github/);
  work.links.u1 = 'ana-gh';
  const reply = await run('u1');
  assert.match(reply, /kira-[a-z2-9]{8}/);
  assert.match(reply, /bio/);
  assert.equal(work.challenges.u1.login, 'ana-gh');
});

test('wrong code: nothing is verified, the member is told what is missing', async () => {
  hub.bio['ana-gh'] = 'kira-wrongwrong';
  assert.match(await run('u1', { check: true }), /don't see `kira-/);
  assert.equal(work.verified?.u1, undefined);
  assert.equal(members.get('u1').roles.cache.has('ROLE'), false);
});

test('checking before asking for a code says so', async () => {
  member('u2');
  work.links.u2 = 'bo-gh';
  assert.match(await run('u2', { check: true }), /no code yet/);
});

test('right code and a merged pull request: verified, the role is granted, one welcome line in #contributors', async () => {
  hub.bio['ana-gh'] = `maintainer ${work.challenges.u1.code}`;
  hub.merged['ana-gh'] = 2;
  const reply = await run('u1', { check: true });
  assert.match(reply, /yours now/);
  assert.match(reply, /Contributor/);
  assert.equal(work.verified.u1, 'ana-gh');
  assert.equal(work.challenges.u1, undefined, 'the code is single use');
  assert.equal(members.get('u1').roles.cache.has('ROLE'), true);
  assert.equal(sent.contributors.length, 1);
  assert.match(sent.contributors[0].content, /<@u1>.*ana-gh/);
  assert.deepEqual(sent.contributors[0].allowedMentions, { users: ['u1'] });
});

test('right code, 0 merged pull requests: verified, no role, no welcome', async () => {
  work.links.u3 = 'cy-gh';
  member('u3');
  await run('u3');
  hub.bio['cy-gh'] = work.challenges.u3.code;
  const reply = await run('u3', { check: true });
  assert.match(reply, /No merged pull request/);
  assert.equal(work.verified.u3, 'cy-gh');
  assert.equal(members.get('u3').roles.cache.has('ROLE'), false);
  assert.equal(sent.contributors.length, 1);
});

test('an expired code is refused without asking GitHub', async () => {
  work.links.u4 = 'di-gh';
  member('u4');
  await run('u4');
  hub.bio['di-gh'] = work.challenges.u4.code;
  work.challenges.u4.expires = Date.now() - 1;
  hub.down = true; // would throw if GitHub were asked
  assert.match(await run('u4', { check: true }), /expired/);
  hub.down = false;
  assert.equal(work.challenges.u4, undefined);
  assert.equal(work.verified?.u4, undefined);
});

test('GitHub failing is a friendly answer, not a crash', async () => {
  work.links.u5 = 'ed-gh';
  member('u5');
  await run('u5');
  hub.down = true;
  assert.match(await run('u5', { check: true }), /not answering/);
  hub.down = false;
});

test('a mod verifies someone by hand; others cannot', async () => {
  work.links.u6 = 'flo-gh';
  member('u6');
  member('mod1', { staff: true });
  hub.merged['flo-gh'] = 1;
  assert.match(await run('u1', { target: 'u6' }), /Only mods/);
  assert.equal(work.verified?.u6, undefined);
  assert.match(await run('mod1', { target: 'u6', staff: true }), /verified as \*\*flo-gh\*\*/);
  assert.equal(work.verified.u6, 'flo-gh');
  assert.equal(members.get('u6').roles.cache.has('ROLE'), true);
  assert.match(await run('mod1', { target: 'nobody', staff: true }), /not linked/);
});

test('a merged pull request seen in the feed grants a verified author, and only a verified one', async () => {
  work.links.u7 = 'gus-gh'; // linked, not verified
  member('u7');
  work.links.u8 = 'hal-gh';
  work.verified.u8 = 'hal-gh';
  member('u8');
  const before = sent.contributors.length;
  await c.afterRefresh({ pulls: [{ merged_at: '2026-10-27T00:00:00Z', user: { login: 'Hal-GH' } }, { merged_at: '2026-10-27T00:00:00Z', user: { login: 'gus-gh' } }, { merged_at: null, user: { login: 'hal-gh' } }] });
  assert.equal(members.get('u8').roles.cache.has('ROLE'), true);
  assert.equal(members.get('u7').roles.cache.has('ROLE'), false);
  assert.equal(sent.contributors.length, before + 1);
  await c.afterRefresh({ pulls: [{ merged_at: '2026-10-27T00:00:00Z', user: { login: 'hal-gh' } }] });
  assert.equal(sent.contributors.length, before + 1, 'already has it: no second welcome');
});

test('changing the link drops the verification and the role; staff keep theirs', async () => {
  work.links.u1 = 'ana-other';
  await c.relinked('u1');
  assert.equal(work.verified.u1, undefined);
  assert.equal(members.get('u1').roles.cache.has('ROLE'), false);
  const m = member('mod2', { staff: true, roles: ['ROLE'] });
  work.verified.mod2 = 'x';
  await c.relinked('mod2');
  assert.equal(m.roles.cache.has('ROLE'), true);
});

// ── The clean-up of the role holders ─────────────────────────────────────────

function holders() {
  members.clear();
  for (const k of Object.keys(work.links)) delete work.links[k];
  for (const k of Object.keys(work.verified)) delete work.verified[k];
  for (const k of Object.keys(work.grace ?? {})) delete work.grace[k];
  for (const k of Object.keys(hub.merged)) delete hub.merged[k];
  sent.dms.length = 0;
  sent.announcements.length = 0;
  const has = { roles: ['ROLE'] };
  member('keep', has); work.links.keep = 'keep-gh'; work.verified.keep = 'keep-gh'; hub.merged['keep-gh'] = 4;
  member('nudge', has); work.links.nudge = 'nudge-gh'; hub.merged['nudge-gh'] = 1;
  member('closed', { ...has, dmOpen: false }); work.links.closed = 'closed-gh'; hub.merged['closed-gh'] = 1;
  member('nopr', has); work.links.nopr = 'nopr-gh';
  member('nolink', has);
  member('staff', { ...has, staff: true });
  member(OWNER_ID, has);
  member('bot', { ...has, bot: true });
  member('outsider'); work.links.outsider = 'outsider-gh'; hub.merged['outsider-gh'] = 2; // linked, no role, qualifies
  member('plain');
}

test('dry run: counts only, nothing changes, nobody is told', async () => {
  holders();
  const snapshot = JSON.stringify(work);
  const r = await c.cleanup({ dry: true });
  assert.deepEqual(r, { dry: true, holders: 7, staff: 2, keepVerified: 1, graceDm: 2, graceAlready: 0, removeNoLink: 1, removeNoMergedPr: 1, unknown: 0, linked: 5, linkedQualify: 4, linkedQualifyNeedVerify: 3, dmFailed: 0, removeFailed: 0 });
  assert.equal(JSON.stringify(work), snapshot);
  for (const m of members.values()) assert.equal(m.roles.cache.has('ROLE'), m.user.bot || ['keep', 'nudge', 'closed', 'nopr', 'nolink', 'staff', OWNER_ID].includes(m.id));
  assert.equal(sent.dms.length, 0);
  assert.equal(sent.announcements.length, 0);
  assert.ok(!JSON.stringify(r).match(/gh|\d{5}/), 'no names or ids in the counts');
});

test('real run: unlinked and no-PR holders lose the role, the others get 7 days and a DM, one announcement', async () => {
  const r = await c.cleanup({ dry: false });
  assert.equal(r.removeNoLink, 1);
  assert.equal(r.removeNoMergedPr, 1);
  assert.equal(r.graceDm, 2);
  assert.equal(r.dmFailed, 1);
  const has = (id) => members.get(id).roles.cache.has('ROLE');
  assert.deepEqual(['keep', 'nudge', 'closed', 'nopr', 'nolink', 'staff', OWNER_ID].map(has), [true, true, true, false, false, true, true]);
  assert.equal(sent.dms.length, 1);
  assert.match(sent.dms[0][1], /\/verify-github.*within|before <t:/);
  assert.ok(work.grace.nudge.until > Date.now() + 6.9 * 86_400_000);
  assert.equal(work.grace.closed.dmFailed, true);
  assert.equal(sent.announcements.length, 1);
  assert.match(sent.announcements[0].content, /Contributor now means a merged PR in Horizon, verified with `\/verify-github`; it opens (<#C1>|#contributors)\./);
  assert.deepEqual(sent.announcements[0].allowedMentions, { parse: [] });
  // Run again: nobody is told twice, no second announcement.
  const again = await c.cleanup({ dry: false });
  assert.equal(again.graceAlready, 2);
  assert.equal(sent.dms.length, 1);
  assert.equal(sent.announcements.length, 1);
});

test('a GitHub error leaves the holder alone', async () => {
  members.get('nopr').roles.cache.add('ROLE');
  hub.down = true;
  const r = await c.cleanup({ dry: false });
  hub.down = false;
  assert.equal(r.unknown, 4); // keep, nudge, closed, nopr: all looked up
  assert.equal(members.get('nopr').roles.cache.has('ROLE'), true);
});

// ── The sweep ────────────────────────────────────────────────────────────────

test('sweep: a verified member with a merged PR gets the role; grace over without verifying loses it', async () => {
  hub.merged['outsider-gh'] = 2;
  work.verified.outsider = 'outsider-gh';
  work.grace.nudge.until = Date.now() - 1; // not verified: loses it
  work.grace.closed.until = Date.now() - 1;
  work.verified.closed = 'closed-gh'; // verified in the meantime: keeps it
  await c.sweep();
  const has = (id) => members.get(id).roles.cache.has('ROLE');
  assert.equal(has('outsider'), true);
  assert.equal(has('nudge'), false);
  assert.equal(has('closed'), true);
  assert.equal(work.grace.nudge, undefined);
  assert.equal(work.grace.closed, undefined);
  assert.ok(work.sweepAt > 0);
  const welcomes = sent.contributors.filter((m) => /<@outsider>/.test(m.content)).length;
  assert.equal(welcomes, 1);
});
