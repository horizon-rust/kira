// The 18+ declaration with both switches on, against a fake Discord: who is asked (once), what the DM says and never
// says, what the button stores (id, yes, time; nothing else), the late list in #council (once), and a passed poll that
// can't give a role of trust without a declaration. The switch-off case is in test/governance.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collection } from 'discord.js';

const dir = mkdtempSync(join(tmpdir(), 'kira-age-'));
process.env.KIRA_STATE = join(dir, 'state.json');
process.env.KIRA_DECISIONS = join(dir, 'decisions.json');
process.env.GITHUB_TOKEN = 'test-token-not-used';
process.env.KIRA_GOVERNANCE = 'on';
process.env.KIRA_AGE_DECLARATION = 'on';
const { GUILD_ID, GOVERNANCE, AGE } = await import('../src/config.js');
const core = await import('../src/core.js');
const kit = await import('../src/age-kit.js');
const age = await import('../src/features/age.js');
const poll = await import('../src/features/poll.js');

AGE.dmGapMs = 0;
const R = GOVERNANCE.roles;
const NOW = Date.UTC(2026, 10, 10, 9);
const members = new Collection();
const member = (id, roles, bot = false) => {
  const set = new Set(roles);
  members.set(id, { id, user: { id, bot }, roles: { cache: new Map([...set].map((r) => [r, {}])), add: async (r) => { set.add(r); }, remove: async () => {} } });
};
member('100000000000000001', [R.council, R.team]);
member('100000000000000002', [R.mod]);
member('100000000000000003', [AGE.extraRoles.servermanager]);
member('100000000000000004', [R.support]); // Support: no age rule
member('100000000000000005', []); // an ordinary member
member('100000000000000006', [R.mod], true); // a bot
member('100000000000000007', [R.chiefmod]); // DMs closed
for (const id of Object.keys(GOVERNANCE.founding)) if (!members.has(id)) member(id, [R.council]);
core.client.guilds.cache.set(GUILD_ID, { members: { cache: members, fetch: async (id) => (id ? members.get(id) ?? Promise.reject(new Error('Unknown Member')) : members) } });
const dms = [];
core.client.users.fetch = async (id) => ({ send: async (m) => { if (id === '100000000000000007') throw new Error('Cannot send messages to this user'); dms.push([id, m]); } });
const council = [];
core.client.channels.cache.set(GOVERNANCE.channels.council, { id: GOVERNANCE.channels.council, send: async (m) => { council.push(m); return { id: 'C' }; } });
const press = async (id, guildId = null) => { let out; await age.onButton({ user: { id }, guildId, reply: async (m) => { out = m; } }, NOW + 1000); return out; };

test('the rules: holders of a role of trust, bots and Support left out; ask once; late after the days', () => {
  const ms = [{ id: 'a', bot: false, roles: ['T'] }, { id: 'b', bot: true, roles: ['T'] }, { id: 'c', bot: false, roles: ['S'] }, { id: 'a', bot: false, roles: ['T'] }];
  assert.deepEqual(kit.holders(ms, ['T', undefined]), ['a']);
  const declared = kit.record({}, 'x', NOW);
  assert.deepEqual(declared, { x: { yes: true, at: new Date(NOW).toISOString() } }, 'only yes and the time');
  assert.deepEqual(kit.toAsk(['x', 'y', 'z'], declared, { z: NOW }), ['y']);
  assert.deepEqual(kit.overdue(['x', 'y', 'z'], declared, { x: NOW, y: NOW, z: NOW + kit.DAY }, NOW + 7 * kit.DAY, 7), ['y']);
});

test('the sweep DMs each holder once, with the declaration button and no reason beyond the 18+ rule', async () => {
  const asked = await age.sweep(NOW, async () => {});
  const holders = ['100000000000000001', '100000000000000002', '100000000000000003', ...Object.keys(GOVERNANCE.founding)];
  assert.deepEqual(asked.sort(), [...new Set(holders)].sort(), 'Support, plain members, bots and closed DMs are not in it');
  const [, m] = dms[0];
  assert.match(m.content, /Every important role on Horizon is 18\+/);
  assert.match(m.content, /I confirm that I am 18 or older/);
  assert.match(m.content, /<t:\d+:F>/, 'the deadline');
  assert.match(m.content, /no age, no birth date, no ID/);
  assert.doesNotMatch(m.content, /suspect|report|doubt|because you/i);
  assert.deepEqual(m.allowedMentions, { parse: [] });
  assert.equal(m.components[0].components[0].custom_id, 'age:yes');
  const before = dms.length;
  assert.deepEqual(await age.sweep(NOW + 3600_000, async () => {}), [], 'asked once: a restart sends nothing new');
  assert.equal(dms.length, before);
  assert.equal(core.state.age.asked['100000000000000007'], undefined, 'closed DMs: asked again on the next start');
});

test('the button stores the id, yes and the time, nothing else; a second press changes nothing', async () => {
  const out = await press('100000000000000002');
  assert.equal(out.content, kit.thanks);
  assert.equal(out.flags, undefined, 'a DM reply is not ephemeral');
  assert.deepEqual(core.state.age.declared['100000000000000002'], { yes: true, at: new Date(NOW + 1000).toISOString() });
  assert.equal((await press('100000000000000002', GUILD_ID)).content, kit.already);
  assert.deepEqual(Object.keys(core.state.age.declared['100000000000000002']).sort(), ['at', 'yes']);
  assert.equal(age.isDeclared('100000000000000002'), true);
  let reply;
  await age.handlers['age-declaration']({ user: { id: '100000000000000005' }, reply: async (m) => { reply = m; } });
  assert.match(reply.content, /Every important role on Horizon is 18\+/);
  assert.equal(reply.components[0].components[0].custom_id, 'age:yes');
});

test('after the days: the holders still not declared are listed once in #council, never in public', async () => {
  for (const id of Object.keys(GOVERNANCE.founding)) await press(id);
  assert.deepEqual(await age.report(NOW + 6 * kit.DAY), [], 'not before the days are up');
  const late = await age.report(NOW + 7 * kit.DAY);
  assert.deepEqual(late.sort(), ['100000000000000001', '100000000000000003']);
  assert.match(council.at(-1).content, /2 role holders asked 7 days ago have not confirmed yet/);
  assert.deepEqual(council.at(-1).allowedMentions, { parse: [] });
  assert.deepEqual(await age.report(NOW + 8 * kit.DAY), [], 'listed once');
});

test('a passed poll cannot give a role of trust without a declaration; Support needs none', async () => {
  assert.equal(age.required('team'), true);
  assert.equal(age.required('support'), false);
  const polls = core.state.polls ??= {};
  const open = (id, o) => { polls[id] = { id, kind: o.kind, where: 'public', key: id, question: 'Q?', threshold: 'simple', subject: o.outcome.member, outcome: o.outcome, ballots: {}, recused: [], reminded: [], openedBy: 'x', startedAt: NOW, endsAt: NOW, channelId: 'none', messageId: 'none' }; return polls[id]; };
  const voters = Object.keys(GOVERNANCE.founding);
  const p = open('P1', { kind: 'mod', outcome: { member: '100000000000000005', role: 'mod', action: 'add' } });
  for (const id of voters) p.ballots[id] = 'yes';
  const d = await poll.close(p, NOW);
  const applied = poll.log.all().find((e) => e.type === 'applied' && e.of === d.id);
  assert.equal(applied.ok, false);
  assert.match(applied.error, /no 18\+ declaration yet/);
  assert.equal(members.get('100000000000000005').roles.cache.has(R.mod), false);
  const s = open('P2', { kind: 'mod', outcome: { member: '100000000000000005', role: 'support', action: 'add' } });
  for (const id of voters) s.ballots[id] = 'yes';
  const d2 = await poll.close(s, NOW);
  assert.equal(poll.log.all().find((e) => e.type === 'applied' && e.of === d2.id).ok, true);
});
