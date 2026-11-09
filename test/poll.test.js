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
    const msg = { id: `M${sent.length}`, channelId: id, content: m.content, components: m.components, edit: async (e) => { Object.assign(msg, e); }, delete: async () => { msg.deleted = true; }, startThread: async (t) => { msg.thread = t.name; const th = makeChannel(`T${msg.id}`); core.client.channels.cache.set(th.id, th); return th; } };
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
  assert.deepEqual(poll.commands.map((c) => c.toJSON().name), ['poll', 'vote']);
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

test("the council cancelled P1-P20, the polls Kira opened from applications; a member's poll is never cancelled", async () => {
  for (const p of Object.values(core.state.polls)) delete core.state.polls[p.id]; // the earlier tests' leftovers
  const old = (id, extra) => ({ id, kind: 'mod', where: 'council', key: id, question: 'Accept them as Mod?', threshold: 'simple', subject: CAND, outcome: null, ballots: { [KACPER]: 'yes' }, recused: [], reminded: [], openedBy: 'kira', startedAt: Date.UTC(2026, 10, 9, 21, 57), endsAt: Date.UTC(2026, 10, 10, 21, 57), ...extra });
  const ch = core.client.channels.cache.get(GOVERNANCE.channels.council);
  const m = await ch.send({ content: 'P4' });
  core.state.polls.P4 = old('P4', { channelId: ch.id, messageId: m.id });
  core.state.polls.P20 = old('P20', { channelId: ch.id, messageId: 'gone' }); // its message was deleted by hand already
  core.state.polls.P21 = old('P21', { openedBy: KACPER, startedAt: Date.UTC(2026, 10, 9, 22, 10) }); // a member's, same evening: kept
  core.state.polls.P3 = old('P3', { openedBy: KACPER }); // a member's poll with a low id: kept
  const logged = poll.log.all().length;
  assert.deepEqual((await poll.cancelStale(Date.UTC(2026, 10, 9, 23))).sort(), ['P20', 'P4']);
  assert.deepEqual(Object.keys(core.state.polls).sort(), ['P21', 'P3']);
  assert.equal(msgs.get(m.id).deleted, true);
  assert.equal(core.state.pollsCancelled.P4.why, 'cancelled by the council on 2026-11-09');
  const dmsBefore = dms.length;
  await poll.tick(Date.UTC(2026, 10, 11)); // past their end and every reminder
  assert.deepEqual(poll.log.all().slice(logged).map((d) => d.poll).sort(), ['P21', 'P3'], 'no decision logged for P4 or P20');
  assert.ok(!dms.slice(dmsBefore).some(([, t]) => /P(4|20)\b/.test(t)), 'no reminder');
  assert.equal(poll.log.all().length, logged + 2, 'only the members\' polls closed and were logged');
  assert.deepEqual(await poll.cancelStale(Date.UTC(2027, 0, 1)), [], 'nothing later, whatever the date');
});

test('the MCP path (poll.start): council only, the same rules, the opener is the member, an agent mark and the thread text', async () => {
  const refused = await poll.start(CAND, { kind: 'decision', question: 'Agents may open polls for members?' }, { via: 'agent' });
  assert.deepEqual(refused, { ok: false, why: 'Only council members start a poll. Ask one of them.' });
  assert.match((await poll.start(KACPER, { kind: 'mod', question: 'Make the candidate a moderator now?' })).why, /give the member and the role/);
  const before = sent.length;
  const r = await poll.start(KACPER, { kind: 'decision', question: 'Do we move the weekly call to Sunday?', thread: 'Context <@123>: the doodle says Sunday. @everyone' }, { via: 'agent' });
  assert.equal(r.ok, true);
  const p = r.poll;
  assert.equal(p.openedBy, KACPER);
  assert.equal(p.where, 'public');
  const [ch, post] = sent[before];
  assert.equal(ch, GOVERNANCE.channels.polls);
  assert.match(post.content, new RegExp(`Started by <@${KACPER}> \\(through their AI agent\\)`));
  const [thCh, thread] = sent[before + 1];
  assert.equal(thCh, p.threadId);
  assert.match(thread.content, new RegExp(`^🤖 From <@${KACPER}>'s AI agent:\\n`));
  assert.deepEqual(thread.allowedMentions, { parse: [] }, 'nobody pinged from the thread text');
  const again = await poll.start(KACPER, { kind: 'member-add', question: 'Add the candidate to the Horizon Team?', member: CAND, role: 'team' });
  assert.equal(again.ok, true, 'role polls work the same way');
});

test('poll.list: counts while open (never who or what), questions of #council polls for council members only, results once closed', async () => {
  const pub = Object.values(core.state.polls).find((p) => p.question.startsWith('Do we move'));
  await press(LEVZZZ, pub.id, 'yes');
  const priv = (await poll.start(KACPER, { kind: 'appeal', question: 'Second-level appeal of a quarantine: uphold it?' })).poll;
  assert.equal(priv.where, 'council');
  const mine = poll.list(KACPER);
  const o = mine.open.find((x) => x.id === pub.id);
  const n = kit.eligible(core.state.council ?? GOVERNANCE.founding, pub).length;
  assert.deepEqual([o.voted, o.eligible, o.quorum, o.youVoted, o.ballots], [1, n, Math.ceil(n / 2), false, undefined]);
  assert.match(o.link, /^https:\/\/discord\.com\/channels\//);
  assert.equal(mine.open.find((x) => x.id === priv.id).question, priv.question);
  const outsider = poll.list(CAND);
  const hidden = outsider.open.find((x) => x.id === priv.id);
  assert.deepEqual([hidden.question, hidden.kind, hidden.youVoted], [null, 'person', undefined]);
  await press(RDBT, priv.id, 'no');
  await poll.close(priv);
  const closedOut = poll.list(CAND).closed.find((x) => x.id === priv.id);
  assert.deepEqual([closedOut.question, closedOut.ballots, closedOut.result.passed], [null, null, false]);
  assert.equal(poll.list(KACPER).closed.find((x) => x.id === priv.id).question, priv.question);
  assert.equal(poll.list(CAND, { now: Date.now() + 30 * 24 * kit.HOUR }).closed.length, 0, 'only the last 14 days');
});

test('/vote: one question is enough (a project decision, simple majority); type and two thirds are optional; council only', async () => {
  const vote = async (by, o) => {
    let out;
    await poll.handlers.vote({ user: { id: by }, options: { getString: (k) => o[k] ?? null, getBoolean: (k) => o[k] ?? null }, deferReply: async () => {}, editReply: async (m) => { out = m; } });
    return out.content;
  };
  const json = poll.commands.find((c) => c.toJSON().name === 'vote').toJSON();
  assert.equal(json.default_member_permissions ?? null, null, 'shown to everyone, so to all six council members; Kira checks the council');
  assert.deepEqual(json.options.map((o) => [o.name, !!o.required]), [['question', true], ['type', false], ['two_thirds', false]]);
  assert.ok(json.options[1].choices.every((c) => !kit.KINDS[c.value].roles), 'no role-changing kinds: those need /poll start');
  assert.match(await vote(CAND, { question: 'Do we ship the new launcher on Friday?' }), /Only council members/);
  const before = Object.keys(core.state.polls).length;
  assert.match(await vote(LEVZZZ, { question: 'Do we ship the new launcher on Friday?' }), /passes with more Yes than No/);
  let p = lastPoll();
  assert.deepEqual([p.kind, p.threshold, p.where, p.openedBy], ['decision', 'simple', 'public', LEVZZZ]);
  assert.equal(Object.keys(core.state.polls).length, before + 1);
  await vote(LEVZZZ, { question: 'Do we spend 20 euros on a domain?', two_thirds: true });
  p = lastPoll();
  assert.deepEqual([p.kind, p.threshold], ['decision', 'two-thirds']);
  await vote(LEVZZZ, { question: 'Do we change the server rules on spam?', type: 'rule', two_thirds: false });
  assert.equal(lastPoll().threshold, 'two-thirds', 'a rule stays at two thirds');
  assert.match(await vote(LEVZZZ, { question: 'short' }), /full sentence/);
});
