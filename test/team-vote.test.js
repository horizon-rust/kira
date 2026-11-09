// /team-vote: who may start one, on whom, the poll and its one ping, and the result (rules, then a fake Discord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collection } from 'discord.js';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-team-vote-')), 'state.json');
process.env.GITHUB_TOKEN = 'test-token-not-used';
const { GUILD_ID, OWNER_ID, TEAM_VOTE } = await import('../src/config.js');
const kit = await import('../src/team-vote-kit.js');
const core = await import('../src/core.js');
const contributors = await import('../src/features/contributors.js');
const tv = await import('../src/features/teamvote.js');

// ── The rules ────────────────────────────────────────────────────────────────

const team = { id: 't1', isOwner: false, isTeam: true };
const base = { kind: 'propose', actor: team, channelId: 'HT', teamChannel: 'HT' };
const cand = (o = {}) => ({ id: 'c', bot: false, isTeam: false, rankOk: true, ...o });

test('who may start a vote, where, and on whom', () => {
  assert.equal(kit.check({ ...base, target: cand() }).ok, true);
  assert.match(kit.check({ ...base, actor: { id: 'x', isOwner: false, isTeam: false }, target: cand() }).why, /Only the Horizon Team and Ludovic/);
  assert.match(kit.check({ ...base, channelId: 'other', target: cand() }).why, /#horizon-team/);
  assert.match(kit.check({ ...base, target: cand({ rankOk: false }) }).why, /Gold/);
  assert.equal(kit.check({ ...base, actor: { id: OWNER_ID, isOwner: true, isTeam: false }, target: cand({ rankOk: false }) }).ok, true, 'Ludovic skips the rank');
  assert.match(kit.check({ ...base, target: cand({ isTeam: true }) }).why, /already on/);
  assert.match(kit.check({ ...base, target: cand(), open: { c: {} } }).why, /already an open vote/);
  assert.match(kit.check({ ...base, target: cand({ bot: true }) }).why, /Bots/);
  assert.match(kit.check({ ...base, kind: 'remove', target: cand() }).why, /not on the Horizon Team/);
  assert.equal(kit.check({ ...base, kind: 'remove', target: cand({ isTeam: true, rankOk: false }) }).ok, true, 'no rank needed to remove');
});

test('the result: 2/3 Yes of the votes cast, at least half of the Team voting; only the Team counts', () => {
  const eligible = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.equal(kit.outcome({ yes: ['a', 'b'], no: ['c'], eligible }).passed, true, '2 of 3 is 2/3, and 3 of 6 is half');
  assert.equal(kit.outcome({ yes: ['a', 'b'], no: [], eligible }).passed, false, 'only 2 of 6 voted');
  assert.equal(kit.outcome({ yes: ['a', 'b', 'c'], no: ['d', 'e'], eligible }).passed, false, '3 of 5 is under 2/3');
  const r = kit.outcome({ yes: ['a', 'b', 'x', 'y', 'z'], no: ['c'], eligible });
  assert.deepEqual([r.yes, r.no, r.voted, r.size, r.needed], [2, 1, 3, 6, 3], 'votes from outside the Team are left out');
  assert.equal(kit.outcome({ yes: [], no: [], eligible: [] }).passed, false);
  assert.match(kit.resultLine({ kind: 'propose', subject: 'c', result: r }), /Passed.*Chief of Mods or Ludovic gives <@c> the 🌌 Horizon Team role; Kira does not change roles/);
  assert.match(kit.resultLine({ kind: 'remove', subject: 'c', result: kit.outcome({ yes: ['a'], no: [], eligible }) }), /Not passed\*\* \(fewer than half of the Team voted\).*stays on/);
});

// ── Against a fake Discord ───────────────────────────────────────────────────

const TEAM = '1564768999655481485';
const GOLD = 'R-GOLD';
contributors._test.work.rankRoles = { iron: 'R-IRON', gold: GOLD, diamond: 'R-DIA', netherite: 'R-NETH' };
core.state.roles.contributor = 'R-CONTRIB';
const members = new Collection();
const member = (id, roles = [], bot = false) => { const m = { id, displayName: `name-${id}`, user: { bot, username: id }, roles: { cache: new Set(roles) } }; members.set(id, m); return m; };
member('t1', [TEAM]); member('t2', [TEAM]); member('t3', [TEAM]); member('t4', [TEAM]);
member('gold', ['R-CONTRIB', GOLD]); member('iron', ['R-CONTRIB', 'R-IRON']); member('dia', ['R-CONTRIB', 'R-DIA']);
member(OWNER_ID, []);
const g = { members: { cache: members, fetch: async (id) => (id ? members.get(id) ?? Promise.reject(new Error('gone')) : members) } };
core.client.guilds.cache.set(GUILD_ID, g);

const posted = [];
let poll = null; // the poll of the last message, as the fake answers it
const messages = new Map();
const channel = {
  id: TEAM_VOTE.channelId,
  send: async (m) => {
    posted.push(m);
    const id = `M${posted.length}`;
    if (m.poll) messages.set(id, { id, poll: null });
    return { id, channelId: TEAM_VOTE.channelId, poll: null };
  },
  messages: { fetch: async (id) => messages.get(id) ?? Promise.reject(new Error('Unknown Message')) },
};
core.client.channels.cache.set(TEAM_VOTE.channelId, channel);

const run = async (by, kind, target, channelId = TEAM_VOTE.channelId) => {
  let out;
  await tv.handlers['team-vote']({
    user: { id: by }, member: members.get(by), guild: g, channelId, channel,
    options: { getSubcommand: () => kind, getUser: () => ({ id: target }) },
    deferReply: async () => {}, editReply: async (m) => { out = m; },
  });
  return out;
};
const fakePoll = (yes, no, finalized = true) => {
  const answer = (text, ids) => ({ text, voters: { fetch: async () => new Collection(ids.map((id) => [id, {}])) } });
  return { resultsFinalized: finalized, answers: new Collection([[1, answer('Yes', yes)], [2, answer('No', no)]]) };
};

test('propose: a Gold candidate gets a 48-hour Yes/No poll with one ping, of the Team role only', async () => {
  const reply = await run('t1', 'propose', 'gold');
  assert.match(reply.content, /Vote started/);
  assert.deepEqual(reply.allowedMentions, { parse: [] });
  const m = posted.at(-1);
  assert.deepEqual(m.allowedMentions, { parse: [], roles: [TEAM] });
  assert.match(m.content, new RegExp(`^<@&${TEAM}> Team vote: should <@gold> \\*\\*join\\*\\*`));
  assert.equal(m.poll.duration, 48);
  assert.deepEqual(m.poll.answers.map((a) => a.text), ['Yes', 'No']);
  assert.equal(m.poll.allowMultiselect, false);
  assert.match(m.poll.question.text, /name-gold join the Horizon Team/);
  assert.ok(core.state.teamVotes.gold.messageId);
});

test('refused: a second vote on the same member, an Iron candidate, outside #horizon-team, not on the Team', async () => {
  const before = posted.length;
  assert.match((await run('t2', 'propose', 'gold')).content, /already an open vote/);
  assert.match((await run('t1', 'propose', 'iron')).content, /Gold/);
  assert.match((await run('t1', 'propose', 'dia', 'elsewhere')).content, /#horizon-team/);
  assert.match((await run('gold', 'remove', 't2')).content, /Only the Horizon Team and Ludovic/);
  assert.equal(posted.length, before, 'nothing posted');
  assert.match((await run(OWNER_ID, 'propose', 'iron')).content, /Vote started/, 'Ludovic may skip the rank');
});

test('the result: waits for the end, then replies to the poll without a ping; Kira changes no role', async () => {
  const v = core.state.teamVotes.gold;
  messages.get(v.messageId).poll = fakePoll(['t1', 't2', 'gold', 'outsider'], ['t3']);
  const before = posted.length;
  await tv.closeDue(v.endsAt - 1000);
  assert.equal(posted.length, before, 'not before the end');
  await tv.closeDue(v.endsAt + 2 * 60_000);
  const line = posted.find((m, n) => n >= before && m.content.includes('<@gold>'));
  assert.ok(line);
  // Team: t1..t4 and Ludovic = 5, half → 3 needed; t1, t2 Yes, t3 No: 2/3 Yes → passed. gold and outsider don't count.
  assert.match(line.content, /✅ \*\*Passed\*\*.*2 Yes, 1 No; 3 of 5 Team members voted, 3 needed/);
  assert.deepEqual(line.allowedMentions, { parse: [] });
  assert.equal(line.reply.messageReference, v.messageId);
  assert.equal(core.state.teamVotes.gold, undefined, 'a new vote on them may start');
  assert.equal(members.get('gold').roles.cache.has(TEAM), false, 'the role is applied by a person');
});

test('remove: the member voted on does not count in the Team; a poll Discord has not finalised waits', async () => {
  assert.match((await run('t1', 'remove', 't4')).content, /Vote started/);
  const v = core.state.teamVotes.t4;
  messages.get(v.messageId).poll = fakePoll(['t1'], ['t4'], false);
  const before = posted.length;
  await tv.closeDue(v.endsAt + 2 * 60_000);
  assert.equal(posted.length, before, 'waits for Discord to finalise');
  await tv.closeDue(v.endsAt + 31 * 60_000);
  assert.match(posted.at(-1).content, /Not passed\*\* \(fewer than half of the Team voted\).*1 Yes, 0 No; 1 of 4/);
});
