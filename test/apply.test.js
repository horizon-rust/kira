// /apply, the Discord side of the applications (docs/staff-api.md): the link only ever in a DM, the refusals in
// words, and the decisions coming back from the dashboards: the role on accept, the applicant's DM, Ludovic's notice
// for the Team, never a throw. A fake staff side and fake Discord objects; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-apply-')), 'state.json');
process.env.APPLY_FORM_LIVE = '1';
const { APPLY, GUILD_ID, OWNER_ID, LAYOUT } = await import('../src/config.js');
const core = await import('../src/core.js');
const hooks = await import('../src/staff-hooks.js');
const kit = await import('../src/apply-kit.js');
const feature = await import('../src/features/apply.js');

Object.assign(core.state.roles, { support: 'R-support', mod: 'R-mod', team: 'R-team' });
Object.assign(core.state.channels, { modlog: 'ml', horizonsupport: 'sup' });
const logs = [];
core.client.channels.cache.set('ml', { send: async (m) => { logs.push(m.embeds[0].data); return m; } });

test('the roles: the ones the staff side knows', () => {
  assert.deepEqual(Object.keys(APPLY.roles).sort(), [...hooks.APPLY_ROLES].sort());
  assert.ok(!LAYOUT.flatMap((g) => g.channels).some((c) => c.key === 'applications'), 'applications live on the dashboards, not in a channel');
});

function slash(role, { dmOk = true } = {}) {
  const said = [];
  const dms = [];
  return {
    said, dms,
    options: { getString: () => role },
    user: { id: 'u1', send: async (m) => { if (!dmOk) throw new Error('Cannot send messages to this user'); dms.push(m.content); } },
    reply: async (m) => { said.push(m); }, deferReply: async () => {}, editReply: async (m) => { said.push(m); },
  };
}

test('/apply: the link goes by DM only, the answer in the channel is ephemeral and has no link', async () => {
  const asked = [];
  hooks.setStaffSide({
    canApply: async (id, role) => ({ ok: true }),
    issueApplyLink: async (id, role) => { asked.push([id, role]); return { ok: true, url: 'https://playhorizon.dev/apply#tok123', expiresAt: Date.UTC(2026, 9, 31) }; },
  });
  const i = slash('support');
  await feature.handlers.apply(i);
  assert.deepEqual(asked, [['u1', 'support']]);
  assert.match(i.dms[0], /apply for \*\*🤝 Support\*\*[\s\S]*<https:\/\/playhorizon\.dev\/apply#tok123>[\s\S]*works once, until <t:\d+:D>/);
  assert.match(i.said[0].content, /^Check your DMs/);
  assert.doesNotMatch(i.said[0].content, /playhorizon\.dev\/apply/);
  assert.ok(i.said[0].flags);
  const closed = slash('mod', { dmOk: false });
  await feature.handlers.apply(closed);
  assert.match(closed.said[0].content, /couldn't DM you/);
});

test('/apply: "open soon" and no link until APPLY_FORM_LIVE=1 (the website\'s form is deployed)', async () => {
  delete process.env.APPLY_FORM_LIVE;
  hooks.setStaffSide({ canApply: async () => assert.fail('not asked'), issueApplyLink: async () => assert.fail('not asked') });
  const early = slash('support');
  await feature.handlers.apply(early);
  assert.match(early.said[0].content, /Applications open soon/);
  assert.equal(early.dms.length, 0);
  process.env.APPLY_FORM_LIVE = '1';
});

test('/apply: refusals in words, from the staff side\'s reasons; closed when the staff side isn\'t loaded', async () => {
  hooks.setStaffSide(null);
  const off = slash('team');
  await feature.handlers.apply(off);
  assert.match(off.said[0].content, /Applications are closed right now/);
  const retryAt = Date.UTC(2026, 10, 13);
  hooks.setStaffSide({ canApply: async () => ({ ok: false, why: 'cooldown', retryAt }), issueApplyLink: async () => assert.fail('not asked') });
  const cool = slash('mod');
  await feature.handlers.apply(cool);
  assert.equal(cool.said[0].content, `You can apply for 🛡️ Mod again from <t:${retryAt / 1000}:D>.`);
  assert.match(kit.refusal('open', 'support'), /still waiting/);
  assert.match(kit.refusal('has-role', 'team'), /already have 🌌 Horizon Team/);
});

// A fake guild for the decisions.
const given = [];
const taken = [];
const dms = [];
let dmsClosed = false;
const user = (id) => ({ id, send: async (m) => { if (dmsClosed && id !== OWNER_ID) throw new Error('closed'); dms.push([id, m.content]); } });
core.client.guilds.cache.set(GUILD_ID, { id: GUILD_ID, members: { fetch: async (id) => (id === 'gone' ? Promise.reject(new Error('Unknown Member')) : { id, user: user(id), roles: { add: async (r) => { given.push([id, r]); }, remove: async (r) => { if (id === 'locked') throw new Error('Missing Permissions'); taken.push([id, r]); } } }) } });
core.client.users.fetch = async (id) => user(id);

test('a decision from the dashboards: accept gives the role and DMs where to start; Ludovic gets no second DM', async () => {
  hooks.setDiscordSide(null);
  feature.setup();
  const r = await hooks.decide({ applicationId: 'a1', userId: 'u5', role: 'support', outcome: 'accept', decidedBy: 'm1' });
  assert.deepEqual(r, { granted: true, dmSent: true, error: null });
  assert.deepEqual(given.at(-1), ['u5', 'R-support']);
  assert.match(dms.at(-1)[1], /accepted[\s\S]*<#sup>/);
  dms.length = 0;
  await hooks.decide({ applicationId: 'a2', userId: 'u6', role: 'team', outcome: 'accept', decidedBy: 't1', url: 'https://playhorizon.dev/staff/team#a2' });
  assert.deepEqual(dms.map(([id]) => id), ['u6'], 'the veto-window DM was his one DM: none from decide');
  assert.match(dms[0][1], /GitHub organisation or its teams is set up by Ludovic by hand/);
  assert.match(logs.at(-1).title, /accepted/);
});

test('a decline DMs a polite no with the date; failures are reported, never thrown', async () => {
  dms.length = 0;
  const until = Date.UTC(2026, 10, 13);
  assert.deepEqual(await hooks.decide({ applicationId: 'a3', userId: 'u7', role: 'mod', outcome: 'decline', decidedBy: 'm1', cooldownUntil: until }), { granted: false, dmSent: true, error: null });
  assert.match(dms.at(-1)[1], new RegExp(`not taking your application this time\\. You can apply again from <t:${until / 1000}:D>\\.$`));
  const left = await hooks.decide({ applicationId: 'a4', userId: 'gone', role: 'support', outcome: 'accept', decidedBy: 'm1' });
  assert.equal(left.granted, false);
  assert.equal(left.error, 'not on the server');
  dmsClosed = true;
  const closed = await hooks.decide({ applicationId: 'a5', userId: 'u8', role: 'support', outcome: 'accept', decidedBy: 'm1' });
  assert.deepEqual(closed, { granted: true, dmSent: false, error: 'their DMs are closed' });
  dmsClosed = false;
  assert.equal((await hooks.decide({ applicationId: 'a6', userId: 'u9', role: 'admin', outcome: 'accept', decidedBy: 'm1' })).error, 'unknown role');
});

test('dm(): the staff side\'s DMs (Ludovic\'s veto window), no pings, never a throw', async () => {
  dms.length = 0;
  const until = Date.UTC(2026, 9, 31, 2);
  const text = hooks.DECISION_TEXTS.vetoWindow({ userId: 'u6', role: 'team', yes: 4, no: 1, url: 'https://playhorizon.dev/staff/team#a2', until });
  assert.match(text, new RegExp(`^🗳️ The vote passed: <@u6> for 🌌 Horizon Team \\(4 for, 1 against\\)\\. It goes through <t:${until / 1000}:R> unless you veto it on the card: https://playhorizon\\.dev/staff/team#a2\\nOnce it does, GitHub`));
  assert.doesNotMatch(hooks.DECISION_TEXTS.vetoWindow({ userId: 'u6', role: 'mod', yes: 2, no: 0, url: 'u', until }), /GitHub/);
  assert.deepEqual(await hooks.dm({ userId: OWNER_ID, content: text }), { sent: true, error: null });
  assert.deepEqual(dms.at(-1), [OWNER_ID, text]);
  assert.deepEqual(await hooks.dm({ userId: 'not-an-id', content: 'x' }), { sent: false, error: 'bad request' });
  dmsClosed = true;
  assert.deepEqual(await hooks.dm({ userId: '123456789012345678', content: 'x' }), { sent: false, error: 'their DMs are closed' });
  dmsClosed = false;
  hooks.setDiscordSide(null);
  assert.deepEqual(await hooks.dm({ userId: OWNER_ID, content: 'x' }), { sent: false, error: 'discord side not loaded' });
  feature.setup();
});

test('revokeRole(): Ludovic takes a role back from the dashboard: removed, logged, no DM, never a throw', async () => {
  hooks.setDiscordSide(null);
  feature.setup();
  dms.length = 0;
  assert.deepEqual(await hooks.revokeRole({ applicationId: 'a7', userId: 'u5', role: 'support', by: OWNER_ID }), { removed: true, error: null });
  assert.deepEqual(taken.at(-1), ['u5', 'R-support']);
  assert.match(logs.at(-1).title, /taken back/);
  assert.equal(dms.length, 0);
  assert.deepEqual(await hooks.revokeRole({ applicationId: 'a8', userId: 'gone', role: 'mod', by: OWNER_ID }), { removed: false, error: 'not on the server' });
  assert.deepEqual(await hooks.revokeRole({ applicationId: 'a9', userId: 'locked', role: 'mod', by: OWNER_ID }), { removed: false, error: 'Missing Permissions' });
  assert.match(logs.at(-1).description, /NOT removed/);
  assert.equal((await hooks.revokeRole({ applicationId: 'a10', userId: 'u5', role: 'admin', by: OWNER_ID })).error, 'unknown role');
});
