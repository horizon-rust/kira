// /poll against a fake Discord, with KIRA_GOVERNANCE on: starting, buttons, early close, the result, the decisions
// log, role changes applied with the decision id, person polls in #council, reminders, the timer and reopen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collection } from 'discord.js';

const dir = mkdtempSync(join(tmpdir(), 'kira-poll-'));
process.env.KIRA_STATE = join(dir, 'state.json');
process.env.KIRA_DECISIONS = join(dir, 'decisions.json');
process.env.GITHUB_TOKEN = 'test-token-not-used';
process.env.KIRA_GOVERNANCE = 'on';
const { GUILD_ID, GOVERNANCE } = await import('../src/config.js');
const core = await import('../src/core.js');
const kit = await import('../src/poll-kit.js');
const poll = await import('../src/features/poll.js');

const [LUDO, KACPER, LEVZZZ, RDBT, ONLINE, DEZER] = Object.keys(GOVERNANCE.founding);
const CAND = '2000000000000000001';
const R = GOVERNANCE.roles;

// ── The fake Discord ─────────────────────────────────────────────────────────
const members = new Collection();
const member = (id, roles = []) => {
  const set = new Set(roles);
  const m = { id, user: { id, bot: false }, roles: { cache: set, add: async (r, why) => { set.add(r); m.log.push(['add', r, why]); }, remove: async (r, why) => { set.delete(r); m.log.push(['remove', r, why]); } }, log: [] };
  members.set(id, m);
  return m;
};
for (const id of [LUDO, KACPER, LEVZZZ, RDBT, ONLINE, DEZER]) member(id, [R.council]);
member(CAND, []);
core.client.guilds.cache.set(GUILD_ID, { members: { cache: members, fetch: async (id) => members.get(id) ?? Promise.reject(new Error('Unknown Member')) } });

const sent = []; // [channel id, payload]
const msgs = new Map();
const makeChannel = (id) => ({
  id,
  send: async (m) => {
    sent.push([id, m]);
    const msg = { id: `M${sent.length}`, channelId: id, content: m.content, components: m.components, edit: async (e) => { Object.assign(msg, e); }, startThread: async (t) => { msg.thread = t.name; } };
    msgs.set(msg.id, msg);
    return msg;
  },
  messages: { fetch: async (mid) => msgs.get(mid) ?? Promise.reject(new Error('Unknown Message')) },
});
for (const id of [GOVERNANCE.channels.polls, GOVERNANCE.channels.council]) core.client.channels.cache.set(id, makeChannel(id));
const dms = [];
core.client.users.fetch = async (id) => ({ send: async (m) => { dms.push([id, m.content]); } });

const start = async (by, o) => {
  let out;
  await poll.handlers.poll({
    user: { id: by },
    options: { getSubcommand: () => o.sub ?? 'start', getString: (k) => o[k] ?? null, getUser: (k) => (k === 'member' && o.member ? { id: o.member } : null) },
    deferReply: async () => {}, editReply: async (m) => { out = m; },
  });
  return out.content;
};
const press = async (by, id, verb) => {
  let out;
  const p = core.state.polls[id];
  await poll.onButton({ customId: `poll:${id}:${verb}`, user: { id: by }, message: p && msgs.get(p.messageId), reply: async (m) => { out = m; } });
  return out.content;
};
const lastPoll = () => Object.values(core.state.polls).at(-1);

test('on: the command is registered and /decisions.json is served', () => {
  assert.equal(poll.commands.length, 1);
  assert.equal(poll.commands[0].toJSON().name, 'poll');
  assert.ok(poll.routes()['/decisions.json']);
});

test('only council members start a poll; the poll pings the council once and shows counts, not names', async () => {
  assert.match(await start(CAND, { kind: 'decision', question: 'Should Horizon do the thing?' }), /Only council members/);
  assert.match(await start(KACPER, { kind: 'decision', question: 'yes?' }), /full sentence/);
  assert.equal(sent.length, 0, 'refusals post nothing');
  assert.match(await start(KACPER, { kind: 'decision', question: 'Should Horizon ship the thing this week?' }), /Poll P1 started/);
  const [ch, m] = sent.at(-1);
  assert.equal(ch, GOVERNANCE.channels.polls);
  assert.deepEqual(m.allowedMentions, { parse: [], roles: [R.council] });
  assert.match(m.content, /^<@&\d+> 🗳️ \*\*Council poll P1\*\* · Project decision/);
  assert.match(m.content, /more Yes than No, if at least 3 of 6 vote/);
  assert.deepEqual(m.components[0].components.map((b) => b.custom_id), ['poll:P1:yes', 'poll:P1:no', 'poll:P1:abstain', 'poll:P1:two-thirds', 'poll:P1:recuse']);
  assert.equal(msgs.get(lastPoll().messageId).thread, 'P1: discussion');
});

test('ballots change until the close; outsiders cannot vote; everyone voting closes it early', async () => {
  const p = lastPoll();
  assert.match(await press(CAND, p.id, 'yes'), /Only council members/);
  assert.match(await press(KACPER, p.id, 'no'), /Your vote: \*\*No\*\*/);
  assert.match(await press(KACPER, p.id, 'yes'), /Your vote: \*\*Yes\*\*/);
  assert.match(msgs.get(p.messageId).content, /Voted: 1 of 6/);
  for (const id of [LUDO, LEVZZZ, RDBT, ONLINE]) await press(id, p.id, 'yes');
  assert.ok(core.state.polls[p.id], 'still open with one vote missing');
  await press(DEZER, p.id, 'abstain');
  assert.equal(core.state.polls[p.id], undefined, 'closed early');
  const [, result] = sent.at(-1);
  assert.match(result.content, /✅ \*\*Passed\*\*: P1 · Project decision \(5 Yes, 0 No, 1 Abstain; 6 of 6 voted, 3 needed/);
  assert.match(result.content, /Decision \*\*D1\*\*/);
  assert.deepEqual(result.allowedMentions, { parse: [] });
  assert.equal(msgs.get(p.messageId).components[0].components[0].disabled, true, 'buttons locked');
  const d = poll.log.all()[0];
  assert.deepEqual([d.id, d.type, d.kind, d.result.passed, d.ballots[KACPER]], ['D1', 'poll', 'decision', true, 'yes']);
  assert.match(await press(KACPER, p.id, 'no'), /closed/);
});

test('a passed member-add gives the role, citing the decision; the GitHub side is said', async () => {
  await start(LUDO, { kind: 'member-add', question: 'Should the candidate join the Horizon Team?', member: CAND, role: 'team' });
  const p = lastPoll();
  assert.equal(p.threshold, 'two-thirds');
  for (const id of [LUDO, KACPER, LEVZZZ]) await press(id, p.id, 'yes');
  await press(RDBT, p.id, 'no');
  assert.match(await press(CAND, p.id, 'yes'), /Only council members/);
  const d = await poll.close(core.state.polls[p.id], p.endsAt);
  assert.equal(d.result.passed, true, '3 Yes to 1 No, 4 of 6 voted');
  assert.deepEqual(members.get(CAND).log.at(-1), ['add', R.team, `Council decision ${d.id}`]);
  const applied = poll.log.all().find((e) => e.type === 'applied' && e.of === d.id);
  assert.deepEqual([applied.ok, applied.role, applied.action], [true, 'team', 'add']);
  assert.match(sent.at(-1)[1].content, /Kira gave 🌌 Horizon Team to <@\d+> \(D\d+\)\. On GitHub, an organisation owner adds them to `horizon-team`/);
});

test('two thirds with only 2 Yes fails and changes nothing; it then blocks the same poll for 7 days', async () => {
  const q = { kind: 'member-add', question: 'Should the candidate join the council?', member: CAND, role: 'council' };
  await start(KACPER, q);
  const p = lastPoll();
  await press(KACPER, p.id, 'yes'); await press(LEVZZZ, p.id, 'yes'); await press(RDBT, p.id, 'no');
  const before = members.get(CAND).log.length;
  const d = await poll.close(core.state.polls[p.id], p.endsAt);
  assert.equal(d.result.why, 'fewer than 3 Yes');
  assert.equal(members.get(CAND).log.length, before, 'no role change');
  assert.match(await start(KACPER, q), /failed on .*reopen/);
  assert.match(await start(KACPER, { sub: 'reopen', decision: d.id.toLowerCase() }), /Signed \(1 of 2\)/);
  assert.match(await start(KACPER, { sub: 'reopen', decision: d.id }), /already signed/);
  assert.match(await start(DEZER, { sub: 'reopen', decision: d.id }), /can be asked again/);
  assert.match(await start(KACPER, q), /Poll P\d+ started/);
  await poll.close(lastPoll(), Date.now()); // out of the way of the next tests
});

test('a council removal runs in #council: the subject neither votes nor counts; the registry changes; only the role change goes public', async () => {
  await start(KACPER, { kind: 'member-remove', question: 'Should this member leave the council?', member: DEZER, role: 'council' });
  const p = lastPoll();
  assert.equal(sent.at(-1)[0], GOVERNANCE.channels.council);
  assert.match(sent.at(-1)[1].content, /if at least 3 of 5 vote/, 'the subject is left out of the size');
  assert.match(await press(DEZER, p.id, 'no'), /about you/);
  assert.match(await press(RDBT, p.id, 'recuse'), /recused/);
  for (const id of [LUDO, KACPER, LEVZZZ]) await press(id, p.id, 'yes');
  await press(ONLINE, p.id, 'no');
  assert.equal(core.state.polls[p.id], undefined, 'everyone eligible voted: closed early');
  assert.equal(members.get(DEZER).roles.cache.has(R.council), false);
  assert.equal(Object.hasOwn(core.state.council, DEZER), false, 'off the registry');
  const pub = sent.filter(([ch]) => ch === GOVERNANCE.channels.polls).at(-1)[1].content;
  assert.match(pub, /^Council decision \*\*D\d+\*\*: Kira took 🏛️ Council from <@\d+>/);
  assert.doesNotMatch(pub, /leave the council\?/, 'the question stays in #council');
  assert.match(await start(DEZER, { kind: 'decision', question: 'Can I still start a poll today?' }), /Only council members/);
});

test('reminders by DM to non-voters at 12 h and 2 h; the timer closes a poll with no quorum', async () => {
  await start(LUDO, { kind: 'rule', question: 'Should the server rules get a new line about spam?' });
  const p = lastPoll();
  await press(LUDO, p.id, 'yes');
  dms.length = 0;
  await poll.tick(p.endsAt - 12 * kit.HOUR);
  assert.deepEqual(dms.map(([id]) => id).sort(), [KACPER, LEVZZZ, RDBT, ONLINE].sort(), 'the four who have not voted');
  assert.match(dms[0][1], /Council poll P\d+ ends .* you haven't voted yet: https:\/\/discord\.com\/channels\//);
  await poll.tick(p.endsAt - 11 * kit.HOUR);
  assert.equal(dms.length, 4, 'once per mark');
  await poll.tick(p.endsAt - 2 * kit.HOUR);
  assert.equal(dms.length, 8);
  await poll.tick(p.endsAt);
  assert.equal(core.state.polls[p.id], undefined);
  assert.match(sent.at(-1)[1].content, /❌ \*\*Not passed\*\* \(no quorum\)/);
});

test('needs 2/3: any council member raises the threshold', async () => {
  await start(KACPER, { kind: 'decision', question: 'Should we pick a new logo colour?' });
  const p = lastPoll();
  assert.match(await press(LEVZZZ, p.id, 'two-thirds'), /now needs two thirds/);
  assert.equal(core.state.polls[p.id].threshold, 'two-thirds');
  assert.match(msgs.get(p.messageId).content, /two thirds of Yes \+ No, and at least 3 Yes/);
});
