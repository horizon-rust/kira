// Vacancies, /grant, #staff-log and the monthly reminders against a fake Discord (KIRA_GOVERNANCE and KIRA_ELECTIONS on).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collection } from 'discord.js';

const dir = mkdtempSync(join(tmpdir(), 'kira-elections-upkeep-'));
process.env.KIRA_STATE = join(dir, 'state.json');
process.env.KIRA_DECISIONS = join(dir, 'decisions.json');
process.env.GITHUB_TOKEN = 'test-token-not-used';
process.env.KIRA_GOVERNANCE = 'on';
process.env.KIRA_ELECTIONS = 'on';
const { GUILD_ID, GOVERNANCE, ELECTIONS } = await import('../src/config.js');
const core = await import('../src/core.js');
const kit = await import('../src/elections-kit.js');
const poll = await import('../src/features/poll.js');
const el = await import('../src/features/elections.js');

const R = GOVERNANCE.roles;
const id = (n) => `40000000000000000${String(n).padStart(2, '0')}`;
const [M1, M2, M3, CHIEF, T1, T2, T3, LEADM, A, B, G1, PLAIN, BOT, M4] = Array.from({ length: 14 }, (_, n) => id(n + 1));
const H = kit.HOUR;
const NOW = Date.UTC(2026, 10, 10, 12);
const SUPPORT = ELECTIONS.grants.support.role;
const HELPER = ELECTIONS.grants['modding-team'].role;

const members = new Collection();
const member = (mid, roles = []) => {
  const set = new Set(roles);
  const m = { id: mid, displayName: mid, joinedTimestamp: NOW - 100 * kit.DAY, user: { id: mid, bot: mid === BOT, username: mid }, roles: { cache: { has: (r) => set.has(r), keys: () => set.keys() }, add: async (r) => { set.add(r); }, remove: async (r) => { set.delete(r); } }, set };
  members.set(mid, m);
  return m;
};
for (const c of [M1, M2, M3, M4]) member(c, [R.mod]);
member(CHIEF, [R.mod, R.chiefmod]);
for (const c of [T1, T2, T3]) member(c, [R.team]);
member(LEADM, [R['lead-modding']]);
for (const c of [A, B, PLAIN]) member(c);
member(G1, [ELECTIONS.groups.ui.role]);
member(BOT);
const audit = []; // { targetId, executorId, changes }
core.client.guilds.cache.set(GUILD_ID, {
  members: { cache: members, fetch: async (x) => (x === undefined ? members : members.get(x) ?? Promise.reject(new Error('Unknown Member'))) },
  fetchAuditLogs: async () => ({ entries: new Collection(audit.map((e, n) => [String(n), e])) }),
});
const sent = [];
const msgs = new Map();
const makeChannel = (cid) => ({
  id: cid,
  send: async (m) => {
    sent.push([cid, m]);
    const msg = { id: `M${sent.length}`, channelId: cid, content: m.content, components: m.components, edit: async (x) => { Object.assign(msg, x); }, startThread: async () => { const th = makeChannel(`T${sent.length}`); core.client.channels.cache.set(th.id, th); return th; } };
    msgs.set(msg.id, msg);
    return msg;
  },
  messages: { fetch: async (mid) => msgs.get(mid) ?? Promise.reject(new Error('Unknown Message')) },
});
const MODS = ELECTIONS.channels.mods;
const LOG = ELECTIONS.channels.stafflog;
const COUNCIL = GOVERNANCE.channels.council;
for (const c of [GOVERNANCE.channels.polls, COUNCIL, MODS, LOG, ...Object.values(ELECTIONS.groups).map((g) => g.channel)]) core.client.channels.cache.set(c, makeChannel(c));
core.client.users.fetch = async () => ({ send: async () => {} });

const cards = new Map();
el.setEvidence({
  loginOf: (x) => (x === G1 ? 'g1' : null),
  recent: async () => 0,
  candidate: async (m) => ({ inGuild: !!m, joinedAt: NOW - 100 * kit.DAY, level: 0, verified: true, merged: 0, reviews: 0, areaMerged: 0, areaReviews: 0, declared: true, roles: el.kindsOfMember(m), modSince: null, ...(cards.get(m?.id) ?? {}) }),
});
const lastIn = (cid) => sent.filter(([c]) => c === cid).at(-1)?.[1];
const openE = () => Object.values(core.state.elections.open);
const snap = (m) => ({ id: m.id, user: m.user, roles: { cache: new Set(m.set) } });

test('a seat that empties opens 24 hours of nominations; Kira never picks anyone; then the vote with every nominee', async () => {
  assert.deepEqual(await el.sweepSeats(NOW), [], 'the first look only records');
  members.get(CHIEF).set.delete(R.chiefmod);
  assert.deepEqual(await el.sweepSeats(NOW), ['chiefmod']);
  const e = openE().at(-1);
  assert.equal(e.stage, 'nominating');
  assert.deepEqual(e.candidates, []);
  assert.match(lastIn(MODS).content, /The seat is open\. Nobody nominated yet/);
  assert.deepEqual(await el.sweepSeats(NOW + H), [], 'one vacancy, one post');
  assert.match((await el.startElection(M1, { post: 'chiefmod', member: M2 }, { now: NOW + H })).election.id, new RegExp(e.id));
  assert.equal((await el.startElection(M3, { post: 'chiefmod', member: CHIEF }, { now: NOW + 2 * H })).joined, true);
  await el.tick(NOW + 25 * H);
  assert.equal(e.stage, 'vote');
  assert.deepEqual(e.candidates, [M2, CHIEF]);
  assert.deepEqual(e.voters, [M1, M3, M4].sort(), 'the nominees do not vote');
  assert.match(msgs.get(e.messageId).content, /Approve as many as you like/);
});

test('nominations with nobody nominated end quietly: no decision, the seat stays open', async () => {
  members.get(LEADM).set.delete(R['lead-modding']);
  await el.sweepSeats(NOW);
  const e = openE().find((x) => x.post === 'lead' && x.group === 'modding');
  assert.ok(e);
  await el.tick(NOW + 25 * H);
  assert.equal(core.state.elections.open[e.id], undefined);
  assert.ok(!poll.log.all().some((d) => d.election === e.id));
  assert.match(sent.at(-1)[1].content, /nobody was nominated, so the seat stays open/);
  members.get(LEADM).set.add(R['lead-modding']);
  await el.sweepSeats(NOW);
});

test('/grant: a mod gives Support, the Modding lead its helper role, others cannot; each is one #staff-log line', async () => {
  assert.match(await el.grant(T1, { role: 'support', member: A }, NOW), /Only a moderator/);
  assert.match(await el.grant(M1, { role: 'support', member: A }, NOW), /Done: gave 🤝 Support/);
  assert.ok(members.get(A).set.has(SUPPORT));
  assert.match(lastIn(LOG).content, new RegExp(`<@${M1}> gave 🤝 Support to <@${A}>`));
  assert.match(await el.grant(M1, { role: 'support', member: A }, NOW), /already have/);
  assert.match(await el.grant(M1, { role: 'modding-team', member: B }, NOW), /Only the modding lead/);
  assert.match(await el.grant(LEADM, { role: 'modding-team', member: B }, NOW), /Done/);
  const before = sent.length;
  const after = snap(members.get(A));
  const was = { ...after, roles: { cache: new Set([...after.roles.cache].filter((r) => r !== SUPPORT)) } };
  assert.deepEqual(await el.onMemberUpdate(was, after, NOW), [], "Kira's own change is not logged twice");
  assert.equal(sent.length, before);
});

test('hand-made changes of a watched role go to #staff-log with who did it; group roles start their 14 days', async () => {
  const was = snap(members.get(PLAIN));
  members.get(PLAIN).set.add(R.mod);
  audit.push({ targetId: PLAIN, executorId: CHIEF, changes: [{ key: '$add', new: [{ id: R.mod }] }] });
  const lines = await el.onMemberUpdate(was, snap(members.get(PLAIN)), NOW);
  assert.deepEqual(lines, [`<@${CHIEF}> gave 🛡️ Mod to <@${PLAIN}> by hand.`]);
  assert.equal(core.state.elections.roleSince[`mod:${PLAIN}`], NOW);
  const g = snap(members.get(B));
  members.get(B).set.add(ELECTIONS.groups.ui.role);
  assert.deepEqual(await el.onMemberUpdate(g, snap(members.get(B)), NOW), [], 'a group role is not a watched role');
  assert.equal(core.state.elections.roleSince[`ui:${B}`], NOW);
  assert.deepEqual(await el.onMemberUpdate({ partial: true }, snap(members.get(B)), NOW), [], 'an uncached member: nothing');
});

test('monthly: a reminder only where a group has no lead, a private list in #council, once a month, never about age', async () => {
  core.state.work = { ranks: { [A]: { count: 55 } } };
  cards.set(A, { merged: 55, reviews: 25, declared: false });
  const r = await el.monthly(NOW);
  assert.ok(!r.groups.includes('modding'), 'Modding has a lead and nobody at the floor');
  assert.ok(r.groups.includes('ui'));
  assert.match(lastIn(ELECTIONS.groups.ui.channel).content, /This group has no lead yet/);
  assert.doesNotMatch(lastIn(ELECTIONS.groups.ui.channel).content, /<@\d/, 'no names in public');
  const list = lastIn(COUNCIL).content;
  assert.match(list, new RegExp(`<@${A}>: 🌌 Horizon Team \\(55 merged, 25 reviews\\)`), 'listed although undeclared: the list never hints at age');
  assert.doesNotMatch(list, /18|age|declar/i);
  assert.equal(await el.monthly(NOW + kit.DAY), null, 'once a month');
  assert.ok(await el.monthly(Date.UTC(2026, 11, 1, 1)), 'next month again');
});
