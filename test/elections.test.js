// /elect, ballots, results, the veto and body votes against a fake Discord, with KIRA_GOVERNANCE and KIRA_ELECTIONS on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collection } from 'discord.js';

const dir = mkdtempSync(join(tmpdir(), 'kira-elections-'));
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
const { publicView } = await import('../src/decisions-kit.js');

const [LUDO, KACPER, LEVZZZ, RDBT, ONLINE, DEZER] = Object.keys(GOVERNANCE.founding);
const R = GOVERNANCE.roles;
const id = (n) => `30000000000000000${String(n).padStart(2, '0')}`;
const [M1, M2, M3, M4, CHIEF, T1, T2, T3, T4, CAND, CAND2, SL, G1, G2, G3, G4, NEWBIE, CAND3] = Array.from({ length: 18 }, (_, n) => id(n + 1));
const H = kit.HOUR;
let NOW = Date.UTC(2026, 10, 10, 12);

// ── The fake Discord ─────────────────────────────────────────────────────────
const members = new Collection();
const member = (mid, roles = [], name = mid) => {
  const set = new Set(roles);
  const m = { id: mid, displayName: name, joinedTimestamp: NOW - 100 * kit.DAY, user: { id: mid, bot: false, username: name }, roles: { cache: { has: (r) => set.has(r), keys: () => set.keys() }, add: async (r, why) => { set.add(r); m.log.push(['add', r, why]); }, remove: async (r, why) => { set.delete(r); m.log.push(['remove', r, why]); } }, log: [], set };
  members.set(mid, m);
  return m;
};
for (const c of [LUDO, KACPER, LEVZZZ, RDBT, ONLINE, DEZER]) member(c, [R.council]);
for (const c of [M1, M2, M3, M4]) member(c, [R.mod]);
member(CHIEF, [R.mod, R.chiefmod]);
for (const c of [T1, T2, T3, T4]) member(c, [R.team]);
for (const c of [CAND, CAND2, CAND3, NEWBIE]) member(c, [], `name-${c.slice(-2)}`);
member(SL, [R['lead-server']]);
for (const c of [G1, G2, G3, G4]) member(c, [ELECTIONS.groups.ui.role]);
core.client.guilds.cache.set(GUILD_ID, { members: { cache: members, fetch: async (x) => (x === undefined ? members : members.get(x) ?? Promise.reject(new Error('Unknown Member'))) } });

const sent = [];
const msgs = new Map();
const makeChannel = (cid) => ({
  id: cid,
  send: async (m) => {
    sent.push([cid, m]);
    const msg = { id: `M${sent.length}`, channelId: cid, content: m.content, components: m.components, edit: async (x) => { Object.assign(msg, x); }, delete: async () => {}, startThread: async (t) => { const th = makeChannel(`T${msg.id}`); core.client.channels.cache.set(th.id, th); return th; } };
    msgs.set(msg.id, msg);
    return msg;
  },
  messages: { fetch: async (mid) => msgs.get(mid) ?? Promise.reject(new Error('Unknown Message')) },
});
const MODS = ELECTIONS.channels.mods;
const TEAMCH = ELECTIONS.channels.team;
const UI = ELECTIONS.groups.ui.channel;
for (const c of [GOVERNANCE.channels.polls, GOVERNANCE.channels.council, MODS, TEAMCH, UI]) core.client.channels.cache.set(c, makeChannel(c));
const dms = [];
core.client.users.fetch = async (u) => ({ send: async (m) => { dms.push([u, m.content, m.components]); } });

// Evidence: every candidate meets the floor unless listed; group activity by id.
const short = new Map(); // id → card overrides
const recent = { [G1]: 2, [G2]: 1, [G3]: 1, [G4]: 0 };
const logins = { [CAND]: 'cand-gh', [G1]: 'g1', [G2]: 'g2', [G3]: 'g3', [G4]: 'g4' };
el.setEvidence({
  loginOf: (x) => logins[x] ?? null,
  recent: async (x) => recent[x] ?? 0,
  candidate: async (m) => ({ inGuild: !!m, joinedAt: NOW - 100 * kit.DAY, level: 20, verified: true, merged: 50, reviews: 30, areaMerged: 10, areaReviews: 0, declared: true, roles: el.kindsOfMember(m), modSince: null, ...(short.get(m?.id) ?? {}) }),
});
el.setup();

const elect = async (by, o) => {
  let out;
  await el.handlers.elect({ user: { id: by }, options: { getString: (k) => o[k] ?? null, getUser: () => (o.member ? { id: o.member } : null) }, deferReply: async () => {}, editReply: async (m) => { out = m; } });
  return out.content;
};
const press = async (by, eid, verb) => {
  let out;
  const e = core.state.elections.open[eid] ?? core.state.elections.closed[eid];
  await el.onButton({ customId: `elect:${eid}:${verb}`, user: { id: by }, message: e && msgs.get(e.messageId), reply: async (m) => { out = m; } }, NOW);
  return out?.content;
};
const decisions = () => poll.log.all();
const lastSent = (cid) => sent.filter(([c]) => c === cid).at(-1)?.[1];
const openE = () => Object.values(core.state.elections.open);

test('only the right people start an election, and never about themselves', async () => {
  assert.match(await elect(T1, { post: 'mod', member: CAND }), /Only a mod, a council member/);
  assert.match(await elect(M1, { post: 'op', member: CAND }), /Server lead/);
  assert.match(await elect(M1, { post: 'mod', member: M1 }), /about yourself/);
  assert.match(await elect(M1, { post: 'lead', member: CAND }), /needs the group/);
  assert.equal(sent.length, 0, 'refusals post nothing');
});

test('a candidate below the floor: the starter gets a neutral "not now", the candidate a private list, nothing is posted', async () => {
  short.set(NEWBIE, { declared: false, level: 2 });
  const reply = await elect(M1, { post: 'mod', member: NEWBIE });
  assert.match(reply, /doesn't meet this post's requirements yet/);
  assert.doesNotMatch(reply, /18|declaration|level/i);
  const dm = dms.find(([u]) => u === NEWBIE);
  assert.ok(dm, 'the candidate is told privately');
  assert.match(dm[1], /18\+ declaration/);
  assert.match(dm[1], /Kira level 10 \(now 2\)/);
  assert.equal(sent.length, 0, 'nothing posted anywhere');
  assert.equal(openE().length, 0);
});

test('a mod election: posted in #mod-chat with the ping, turnout not names, the candidate never votes, early close, role applied', async () => {
  const reply = await elect(M1, { post: 'mod', member: CAND });
  assert.match(reply, /Election E1 started/);
  const [ch, m] = sent.at(-1);
  assert.equal(ch, MODS);
  assert.match(m.content, new RegExp(`<@&${R.mod}>`));
  assert.match(m.content, /Who votes: the mods \(5\)/);
  assert.match(m.content, /the Chief of Mods breaks a tie/);
  assert.deepEqual(m.components[0].components.map((b) => b.label), ['Yes', 'No', 'Abstain', 'Decline (candidate)']);
  assert.match(await press(CAND, 'E1', 'yes'), /about you/);
  assert.match(await press(T1, 'E1', 'yes'), /Only the mods vote here/);
  await press(M1, 'E1', 'yes');
  await press(M2, 'E1', 'yes');
  assert.match(msgs.get(core.state.elections.open.E1.messageId).content, /Voted: 2 of 5/);
  assert.doesNotMatch(msgs.get(core.state.elections.open.E1.messageId).content, new RegExp(M2), 'who voted is never shown');
  await press(M3, 'E1', 'yes'); // 3 of 5 Yes: locked
  assert.equal(core.state.elections.open.E1, undefined, 'closed early once locked');
  assert.ok(members.get(CAND).set.has(R.mod), 'Kira gave the role');
  const d = decisions().find((x) => x.type === 'election');
  assert.equal(d.result.passed, true);
  assert.equal(members.get(CAND).log[0][2], `Election ${d.id}`);
  const result = sent.find(([c, x]) => c === MODS && /Passed/.test(x.content))[1];
  assert.equal(result.components[0].components[0].label, 'Veto (council)');
  assert.match(lastSent(GOVERNANCE.channels.polls).content, new RegExp(`<@${CAND}> elected 🛡️ Mod`));
  assert.equal(publicView(decisions()).find((x) => x.type === 'election').ballots, null, 'no ballots in public');
});

test('the veto: council only, a council poll in #council, overturned → Kira takes the role back, and 30 days of cooldown', async () => {
  assert.match(await press(M1, 'E1', 'veto'), /Only council members/);
  assert.match(await press(KACPER, 'E1', 'veto'), /Veto poll P\d+ started/);
  assert.match(await press(LEVZZZ, 'E1', 'veto'), /already running/);
  const p = Object.values(core.state.polls).find((x) => x.kind === 'veto');
  assert.equal(p.where, 'council');
  assert.equal(p.channelId, GOVERNANCE.channels.council);
  for (const c of [KACPER, LEVZZZ, RDBT]) await poll.onButton({ customId: `poll:${p.id}:yes`, user: { id: c }, message: msgs.get(p.messageId), reply: async () => {} }, NOW);
  await poll.close(core.state.polls[p.id], NOW + H);
  assert.equal(members.get(CAND).set.has(R.mod), false, 'undone');
  const veto = decisions().find((x) => x.type === 'veto');
  assert.equal(veto.passed, true);
  assert.match(lastSent(MODS).content, /overturned/);
  assert.match(await elect(M2, { post: 'mod', member: CAND }), /can't be started again for this person and post before/);
});

test('a candidate can decline: the election ends, nothing is logged against them', async () => {
  await elect(M1, { post: 'mod', member: CAND2 });
  const e = openE().at(-1);
  assert.match(await press(M1, e.id, 'decline'), /Only a candidate/);
  assert.match(await press(CAND2, e.id, 'decline'), /You declined/);
  assert.equal(core.state.elections.open[e.id], undefined);
  assert.ok(!decisions().some((x) => x.election === e.id));
  assert.equal(kit.cooldownBlock(decisions(), { post: 'mod', member: CAND2 }, NOW), null);
});

test('a tie in the mods: the Chief of Mods breaks it; a failed election starts the cooldown', async () => {
  await elect(M1, { post: 'mod', member: CAND2 });
  const e = openE().at(-1);
  await press(M1, e.id, 'yes');
  await press(M2, e.id, 'no');
  await press(M3, e.id, 'no');
  await press(CHIEF, e.id, 'yes');
  await el.close(core.state.elections.open[e.id], NOW + 24 * H);
  const d = decisions().find((x) => x.election === e.id);
  assert.equal(d.result.passed, true);
  assert.match(d.result.why, /broken by the Chief of Mods/);
  await elect(M1, { post: 'mod', member: CAND3 });
  const f = openE().at(-1);
  for (const v of [M1, M2, M3, CHIEF]) await press(v, f.id, 'no'); // 6 mods now (CAND2 was elected): 4 No locks it
  assert.equal(core.state.elections.open[f.id], undefined, 'locked No');
  assert.match(await elect(M2, { post: 'mod', member: CAND3 }), /can't be started again/);
});

test('fewer than 3 voters: the council decides by poll', async () => {
  members.get(SL).set.add(R['lead-server']);
  // the Team body has 4; recalling one leaves 3: fine. A lead election in a group with nobody active and no Team would fail:
  const saved = [...members.values()].filter((m) => m.set.has(R.team));
  for (const m of saved) m.set.delete(R.team);
  assert.match(await elect(KACPER, { post: 'lead', group: 'ui', member: G1 }), /Fewer than 3 people can vote/);
  for (const m of saved) m.set.add(R.team);
});

test('a group lead: active members and the Team vote, sockpuppets do not', async () => {
  core.state.elections.roleSince[`ui:${G2}`] = NOW - 2 * kit.DAY; // picked the role 2 days ago
  const reply = await elect(T1, { post: 'lead', group: 'ui', member: G1 });
  assert.match(reply, /started/);
  const e = openE().at(-1);
  assert.equal(e.body, 'group:ui');
  assert.deepEqual(e.voters.sort(), [G3, T1, T2, T3, T4].sort(), 'G4: no contribution; G2: role too new; G1: the candidate');
  assert.ok(dms.some(([u, c]) => u === G3 && /An election you can vote in/.test(c)), 'group voters get a DM, not a ping');
  assert.doesNotMatch(lastSent(UI).content, /<@&/);
});

test('one seat, several candidates: the second joins within 12 hours, approval ballot, then a run-off', async () => {
  members.get(CHIEF).set.delete(R.chiefmod); // the seat is open
  await elect(M1, { post: 'chiefmod', member: M2 });
  const e = openE().at(-1);
  await press(M3, e.id, 'yes');
  assert.match(await elect(M4, { post: 'chiefmod', member: M3 }), /join E\d+'s ballot/);
  assert.deepEqual(e.candidates, [M2, M3]);
  assert.deepEqual(e.ballots, {}, 'M3 is a candidate now: their ballot is gone');
  assert.equal(e.voters.includes(M3), false);
  await press(M1, e.id, `approve:${M2}`);
  await press(M4, e.id, `approve:${M3}`);
  await press(CHIEF, e.id, 'abstain');
  await el.close(e, NOW + 24 * H);
  assert.equal(e.stage, 'runoff');
  assert.ok(core.state.elections.open[e.id], 'still open for the run-off');
  await press(M1, e.id, `pick:${M2}`);
  await press(M4, e.id, `pick:${M2}`);
  await press(CHIEF, e.id, `pick:${M3}`);
  await el.close(e, NOW + 48 * H);
  const d = decisions().find((x) => x.election === e.id);
  assert.equal(d.result.winner, M2);
  assert.ok(members.get(M2).set.has(R.chiefmod));
  NOW += 13 * H;
  members.get(M2).set.delete(R.chiefmod);
  await elect(M1, { post: 'chiefmod', member: M4 });
  assert.match(await elect(M1, { post: 'chiefmod', member: M1 === M4 ? M3 : CHIEF }, NOW + 13 * H), /12 hours for more candidates are over|started|join/);
});

test('at most 3 elections open in one body', async () => {
  const before = openE().filter((x) => x.body === 'mods').length;
  for (const c of [T1, T2, T3].slice(0, Math.max(0, 3 - before))) await elect(M1, { post: 'mod', member: c });
  assert.match(await elect(M1, { post: 'mod', member: T4 }), /already has 3 elections running/);
});

test('a Team election: 2/3; without a token, the GitHub click goes to a named person; with one, Kira does it', async () => {
  await elect(T1, { post: 'team', member: CAND });
  const e = openE().at(-1);
  assert.equal(e.threshold, 'two-thirds');
  for (const v of [T1, T2, T3]) await press(v, e.id, 'yes');
  const result = lastSent(TEAMCH).content;
  assert.match(result, new RegExp(`To do, <@${ELECTIONS.clicks.github}>: add \`cand-gh\` to \`horizon-team\``));
  const calls = [];
  el.setOrgGitHub({ write: async (m, path) => { calls.push([m, path]); } });
  await elect(T1, { post: 'team', member: G1, action: 'add' });
  const f = openE().at(-1);
  for (const v of [T1, T2, T3, T4]) await press(v, f.id, 'yes'); // 5 in the Team now: 4 Yes locks two thirds
    assert.deepEqual(calls, [['PUT', '/orgs/horizon-rust/teams/horizon-team/memberships/g1']]);
});

test('a server operator: the Server lead votes by DM, the op itself is a click for the panel holder', async () => {
  await elect(SL, { post: 'op', member: CAND2 });
  const e = openE().at(-1);
  assert.ok(e.voters.includes(SL));
  const dm = dms.find(([u, c]) => u === SL && /An election you can vote in/.test(c));
  assert.ok(dm?.[2]?.length, 'the ballot comes with buttons');
  for (const v of [SL, M1, M2, M3]) await press(v, e.id, 'yes');
  assert.match(sent.filter(([c]) => c === MODS).map(([, m]) => m.content).join('\n'), new RegExp(`To do, <@${ELECTIONS.clicks.server}>: op <@${CAND2}>`));
});

test('/vote body:mods runs a mods\' decision; private keeps the question out of the public log', async () => {
  let out;
  const ask = (by, o) => poll.handlers.vote({ user: { id: by }, options: { getString: (k) => o[k] ?? null, getBoolean: (k) => o[k] ?? null }, reply: async (m) => { out = m; }, deferReply: async () => {}, editReply: async (m) => { out = m; } });
  await ask(T1, { body: 'mods', question: 'Unban the member from case 12 after the appeal?' });
  assert.match(out.content, /Only members of that body/);
  await ask(M1, { body: 'mods', question: 'Unban the member from case 12 after the appeal?', private: true });
  assert.match(out.content, /Vote V1 started/);
  const v = core.state.elections.open.V1;
  assert.match(await press(M2, 'V1', 'recuse'), /recused/);
  for (const x of [M1, M3, M4]) await press(x, 'V1', 'yes');
  const d = decisions().find((x) => x.type === 'bodyvote');
  assert.equal(d.result.passed, true);
  assert.equal(v.voters.includes(M2), false);
  const pub = publicView(decisions()).find((x) => x.type === 'bodyvote');
  assert.equal(pub.question, null);
  assert.equal(pub.ballots, null);
  assert.doesNotMatch(lastSent(GOVERNANCE.channels.polls).content, /Unban/);
});

test('council polls: money lasts 48 hours, a rule only when asked; veto is never a /poll kind', async () => {
  const t0 = NOW;
  const money = await poll.start(KACPER, { kind: 'money', question: 'Pay 10 dollars a month for the server backups?' }, { now: t0 });
  assert.equal(money.poll.endsAt - money.poll.startedAt, 48 * H);
  const rule = await poll.start(KACPER, { kind: 'rule', question: 'Adopt the MIT licence for the code, as the poll said?', twoDays: true }, { now: t0 });
  assert.equal(rule.poll.endsAt - rule.poll.startedAt, 48 * H);
  const plain = await poll.start(KACPER, { kind: 'rule', question: 'Change rule 3 of the server rules to allow memes?' }, { now: t0 });
  assert.equal(plain.poll.endsAt - plain.poll.startedAt, 24 * H);
  assert.match((await poll.start(KACPER, { kind: 'decision', question: 'Ship the thing this week, all agreed?', twoDays: true }, { now: t0 })).why, /48 hours is only/);
  assert.match((await poll.start(KACPER, { kind: 'veto', question: 'Overturn something without a button?' }, { now: t0 })).why, /Veto button/);
  const choices = poll.commands[0].toJSON().options[0].options[0].choices.map((c) => c.value);
  assert.ok(!choices.includes('veto'));
});

test('the timer closes votes at 24 hours and takes the veto button away after 24 more', async () => {
  // Its own vote at NOW: /elect and /vote above start on the real clock, so which of theirs is still open depends on the day.
  const { election: e } = await el.startVote(M1, { body: 'mods', question: 'Does the timer close this vote on time?' }, { now: NOW });
  for (const [x, v] of [[M1, 'yes'], [M3, 'yes'], [M4, 'no']]) await press(x, e.id, v);
  assert.ok(core.state.elections.open[e.id], 'two Yes and one No of five settle nothing early');
  await el.tick(e.endsAt + 1);
  assert.equal(core.state.elections.open[e.id], undefined);
  const left = Object.values(core.state.elections.closed).filter((c) => !c.vetoPoll);
  assert.ok(left.length);
  await el.tick(e.endsAt + 100 * H); // past every result's 24 hours
  assert.equal(Object.values(core.state.elections.closed).filter((c) => !c.vetoPoll).length, 0);
});
