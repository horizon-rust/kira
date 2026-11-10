// Elections and body votes on Discord (GOVERNANCE.md 2.1, 5.3 and 7; rules in src/elections-kit.js), only when
// KIRA_GOVERNANCE and KIRA_ELECTIONS are both on: otherwise no command, listener or timer.
// - `/elect post: member: [group:] [action:]` opens a 24-hour election in the body that votes for that post. Kira
//   checks who may start it, the cooldown, the seat and the floor; a candidate who falls short gets a private DM with
//   what is missing, and the person starting only a neutral "not now". Nothing is posted then.
// - Ballots are buttons (Yes / No / Abstain; one button per candidate on an approval ballot; A or B in a run-off). The
//   message shows how many voted, never who. It closes at 24 hours, or earlier once the result is locked.
// - A passed result is applied at once (Discord roles; GitHub team membership with a token, else a click list for a
//   named person) and carries a Veto button for 24 hours: a council member's press opens a council poll (simple
//   majority); if it passes, Kira undoes what she applied.
// - `/vote body:mods|team|group` (src/features/poll.js hands it here) runs a body's own decision the same way.
// - Upkeep: a seat that becomes empty (the Chief of Mods, a group lead) opens 24 hours of nominations, then the vote
//   with everyone nominated (Kira never picks a candidate); `/grant` gives the free-action roles (🤝 Support by a mod,
//   a group's helper role by its lead); role changes and bans made by hand go to #staff-log; once a month a group
//   with no lead (or with someone at the lead floor) gets a reminder, and #council a private list of suggestions.
import { SlashCommandBuilder, MessageFlags, AuditLogEvent } from 'discord.js';
import { GUILD_ID, GOVERNANCE, ELECTIONS, WORK } from '../config.js';
import { client, state, save } from '../core.js';
import * as kit from '../elections-kit.js';
import * as gk from '../governance-kit.js';
import * as poll from './poll.js';
import * as age from './age.js';
import { levelOf } from './levels.js';
import { makeEvidence } from '../election-evidence.js';
import { makeGitHub } from '../github.js';
import { githubToken } from '../github-app.js';

export const enabled = () => GOVERNANCE.on && ELECTIONS.on;
const E = () => (state.elections ??= { seq: 0, vseq: 0, open: {}, closed: {}, seats: {}, roleSince: {}, monthlyDone: null });
const guild = () => client.guilds.cache.get(GUILD_ID);
const roleId = (key) => state.roles?.[key] || GOVERNANCE.roles[key];
const isCouncil = (id) => gk.isCouncil(id, { state, gov: GOVERNANCE });
const ephemeral = (content, extra = {}) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }, ...extra });
const ts = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const getChannel = async (id) => (id ? client.channels.cache.get(id) ?? await client.channels.fetch(id).catch(() => null) : null);
const groupKeys = () => Object.keys(ELECTIONS.groups);
const VERBS = { yes: 'Yes', no: 'No', abstain: 'Abstain' };

// Where a body votes, and where results go public.
export const channelOf = (body) => (body.startsWith('group:') ? ELECTIONS.groups[body.slice(6)]?.channel : state.channels?.[`elections-${body}`] || ELECTIONS.channels[body]);
const publicChannel = () => state.channels?.polls || GOVERNANCE.channels.polls;
export const bodyName = (body) => (body === 'mods' ? 'the mods' : body === 'team' ? 'the Horizon Team' : body === 'op' ? 'the mods and the Server lead' : `the ${ELECTIONS.groups[body.slice(6)]?.name ?? body.slice(6)} group's active members and the Team`);
const postLabel = (post, group) => (post === 'lead' ? `🧭 ${ELECTIONS.groups[group]?.name ?? group} lead` : kit.POSTS[post].label);

// ── Evidence (replaceable in tests) ──────────────────────────────────────────

let evidence = null;
const realEvidence = () => makeEvidence({
  gh: makeGitHub({ token: githubToken() }), org: ELECTIONS.github.org, state, work: (state.work ??= {}), fixed: WORK.github,
  groups: ELECTIONS.groups, levelOf, isDeclared: (id) => age.isDeclared(id) || !age.enabled(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)), paceMs: ELECTIONS.searchPaceMs,
});
export const setEvidence = (ev) => { evidence = ev; };
const ev = () => (evidence ??= realEvidence());

// ── The guild's members, as the kit sees them ────────────────────────────────

const leadIds = () => Object.fromEntries(Object.keys(GOVERNANCE.roles).filter((k) => k.startsWith('lead-') || ['mod', 'chiefmod', 'team'].includes(k)).map((k) => [k, roleId(k)]));
const rolesOf = (m) => new Set(m?.roles?.cache?.keys?.() ?? []);
export const kindsOfMember = (m) => kit.kindsOf(rolesOf(m), leadIds(), { council: isCouncil(m?.id) });

async function allMembers() {
  const g = guild();
  if (!g) return [];
  const all = await g.members.fetch();
  return [...all.values()].filter((m) => !m.user?.bot);
}
const holdersOf = (members, key) => (roleId(key) ? members.filter((m) => rolesOf(m).has(roleId(key))).map((m) => String(m.id)) : []);
const sinceKey = (what, id) => `${what}:${id}`;

// The kit's member list for a body: kinds, and for a group, whether each holder of its role is active.
async function bodyMembers(body, members) {
  const group = body.startsWith('group:') ? body.slice(6) : null;
  const out = [];
  for (const m of members) {
    const entry = { id: String(m.id), kinds: kindsOfMember(m) };
    if (group && rolesOf(m).has(ELECTIONS.groups[group]?.role) && ev().loginOf(m.id)) {
      const since = E().roleSince[sinceKey(group, m.id)] ?? null;
      const recent = since != null && Date.now() - since < kit.RULES.groupRoleDays * kit.DAY ? 0 : await ev().recent(m.id, group).catch(() => 0);
      entry.active = { [group]: kit.isActive({ since, recent }, Date.now()) };
    }
    out.push(entry);
  }
  return out;
}
const chiefOf = (members) => holdersOf(members, 'chiefmod')[0] ?? null;

// ── Rendering ────────────────────────────────────────────────────────────────

const button = (id, verb, label, style, disabled) => ({ type: 2, style, label: label.slice(0, 80), custom_id: `elect:${id}:${verb}`, disabled });
const names = new Map(); // candidate id → display name for buttons (Discord labels can't mention)

export function render(e) {
  const done = !!e.closedAt;
  const voted = Object.keys(e.ballots).filter((id) => e.voters.includes(id)).length;
  const what = e.kind === 'vote' ? `🗳️ **${e.id}** · a decision of ${bodyName(e.body)}` : `🗳️ **Election ${e.id}** · ${postLabel(e.post, e.group)}${e.action === 'remove' ? ' (recall)' : ''}`;
  const lines = [what];
  if (e.kind === 'vote') lines.push(`> ${e.question}`);
  else if (e.stage === 'nominating') lines.push(`The seat is open. ${e.candidates.length ? `Nominated: ${e.candidates.map((c) => `<@${c}>`).join(', ')}.` : 'Nobody nominated yet.'} Nominate with \`/elect\` until ${ts(e.nominateUntil)}; the vote then runs 24 hours with everyone nominated.`);
  else if (e.stage === 'runoff') lines.push(`Run-off: <@${e.candidates[0]}> or <@${e.candidates[1]}>. More votes wins; a tie fails.`);
  else if (e.candidates.length > 1) lines.push(`Candidates: ${e.candidates.map((c) => `<@${c}>`).join(', ')}. Approve as many as you like; the seat goes to the most approvals if at least half of the voters approve them, otherwise a run-off of the top two.`);
  else lines.push(`${e.action === 'remove' ? 'Recall' : 'Candidate'}: <@${e.candidates[0]}>.${e.action === 'add' ? ' They can decline with the button.' : ''}`);
  if (e.stage !== 'nominating') {
    const t = e.candidates.length > 1 || e.stage === 'runoff' ? 'the rules above' : kit.thresholdText(e.threshold, e.body);
    lines.push(`Who votes: ${bodyName(e.body)} (${e.voters.length}). Passes with ${t}, if at least ${kit.quorumOf(e.voters.length)} vote. ${done ? 'Closed.' : `Ends ${ts(e.endsAt)}, or earlier once the result can't change.`}`);
    lines.push(`Voted: ${voted} of ${e.voters.length}. Started by ${e.startedBy === 'kira' ? 'Kira (vacancy)' : `<@${e.startedBy}>`}. Discuss in the thread.`);
  }
  const rows = [];
  if (e.stage === 'nominating') rows.push({ type: 1, components: [button(e.id, 'decline', 'Decline (candidate)', 2, done || !e.candidates.length)] });
  else if (e.stage === 'runoff') rows.push({ type: 1, components: [...e.candidates.map((c, n) => button(e.id, `pick:${c}`, `${n ? 'B' : 'A'}: ${names.get(c) ?? c}`, 1, done)), button(e.id, 'abstain', 'Abstain', 2, done)] });
  else if (e.candidates.length > 1) {
    rows.push({ type: 1, components: e.candidates.map((c) => button(e.id, `approve:${c}`, `Approve ${names.get(c) ?? c}`, 1, done)) });
    rows.push({ type: 1, components: [button(e.id, 'abstain', 'Abstain', 2, done), button(e.id, 'decline', 'Decline (candidate)', 2, done)] });
  } else {
    const extra = e.kind === 'vote' ? [button(e.id, 'recuse', 'Recuse', 2, done)] : e.action === 'add' ? [button(e.id, 'decline', 'Decline (candidate)', 2, done)] : [];
    rows.push({ type: 1, components: [button(e.id, 'yes', 'Yes', 3, done), button(e.id, 'no', 'No', 4, done), button(e.id, 'abstain', 'Abstain', 2, done), ...extra] });
  }
  return { content: lines.join('\n').slice(0, 2000), allowedMentions: { parse: [] }, components: rows };
}

async function rememberName(id) {
  const m = await guild()?.members.fetch(id).catch(() => null);
  names.set(String(id), m?.displayName ?? m?.user?.username ?? String(id));
}

// Posts an election or vote message in its body's channel, with a thread; pings the body (mods, Team) or DMs its
// voters (a group: its role is too big to ping; the Server lead can't see #mod-chat).
async function publish(e, members) {
  const ch = await getChannel(channelOf(e.body));
  if (!ch) return false;
  for (const c of e.candidates) await rememberName(c);
  const pings = e.body === 'mods' || e.body === 'op' ? [roleId('mod'), roleId('chiefmod')] : e.body === 'team' ? [roleId('team')] : [];
  const body = render(e);
  const msg = await ch.send({ ...body, content: `${pings.map((r) => `<@&${r}>`).join(' ')} ${body.content}`.trim().slice(0, 2000), allowedMentions: { parse: [], roles: pings } }).catch((err) => { console.error('elections post', err.message); return null; });
  if (!msg) return false;
  Object.assign(e, { channelId: msg.channelId ?? ch.id, messageId: msg.id });
  const th = await msg.startThread?.({ name: `${e.id}: discussion` }).catch(() => null);
  if (th?.id) e.threadId = th.id;
  save();
  await notifyVoters(e, members);
  return true;
}

// DMs the voters who get no ping: a group's (its role is too big), and the Server lead (can't see #mod-chat).
async function notifyVoters(e, members) {
  const link = `https://discord.com/channels/${GUILD_ID}/${e.channelId}/${e.messageId}`;
  const dm = e.body.startsWith('group:') ? e.voters : e.body === 'op' ? e.voters.filter((id) => !members.find((m) => String(m.id) === id && kindsOfMember(m).has('mods'))) : [];
  for (const id of dm) {
    const withButtons = e.body === 'op'; // they can't see #mod-chat: the ballot comes to them
    await client.users.fetch(id).then((u) => u.send({ content: `🗳️ ${e.kind === 'vote' ? 'A vote' : 'An election'} you can vote in: ${link}`, ...(withButtons ? { components: render(e).components } : {}), allowedMentions: { parse: [] } })).catch(() => {});
  }
}

async function refresh(e) {
  const ch = await getChannel(e.channelId);
  const msg = await ch?.messages?.fetch(e.messageId).catch(() => null);
  await msg?.edit?.(render(e)).catch(() => {});
}

// ── Starting ─────────────────────────────────────────────────────────────────

const openList = () => Object.values(E().open);
const nextId = (kind) => (kind === 'vote' ? `V${(E().vseq = (E().vseq ?? 0) + 1)}` : `E${(E().seq = (E().seq ?? 0) + 1)}`);

// Opens (or joins) an election for `starter`. args: { post, member, group?, action? }. → { ok, election, joined? } or
// { ok: false, why } (why is shown to the starter only, privately).
export async function startElection(starter, args, { now = Date.now() } = {}) {
  if (!enabled()) return { ok: false, why: 'Elections are not on yet.' };
  const { post, group = null } = args;
  const action = args.action ?? 'add';
  const member = String(args.member ?? '');
  if (!kit.POSTS[post]) return { ok: false, why: 'Unknown post.' };
  if (kit.POSTS[post].group && !ELECTIONS.groups[group]) return { ok: false, why: 'A lead election needs the group.' };
  if (!kit.POSTS[post].group && group) return { ok: false, why: 'Only a lead election takes a group.' };
  const members = await allMembers();
  const starterM = members.find((m) => String(m.id) === String(starter));
  const kinds = starterM ? kindsOfMember(starterM) : new Set(isCouncil(starter) ? ['council'] : []);
  const may = kit.mayStart(post, group, kinds);
  if (may) return { ok: false, why: may };
  const roleKey = kit.roleKeyOf(post, group);
  const holders = roleKey ? holdersOf(members, roleKey) : [];
  const body = kit.bodyOf(post, group);
  let bm = null;
  let seats = kit.POSTS[post].seats;
  if (post === 'lead') {
    bm = await bodyMembers(body, members);
    seats = kit.seatsFor('lead', bm.filter((m) => m.active?.[group]).length);
  }
  const verdict = kit.startCheck({ post, group, member, action, starter }, { open: openList(), holders, polls: Object.values(state.polls ?? {}), log: poll.log.all(), seats, now });
  if (!verdict.ok) return verdict;
  const candM = members.find((m) => String(m.id) === member) ?? null;
  if (action === 'add') {
    const card = await ev().candidate(candM, { post, group, kinds: candM ? kindsOfMember(candM) : new Set(), modSince: E().roleSince[sinceKey('mod', member)] ?? null });
    const short = kit.shortOf(post, group, card, now);
    if (short.length) {
      await client.users.fetch(member).then((u) => u.send({ content: kit.shortDm(postLabel(post, group), short), allowedMentions: { parse: [] } })).catch(() => {});
      return { ok: false, why: kit.notNow(`<@${member}>`) };
    }
  } else if (!candM && post !== 'op') return { ok: false, why: "They aren't in the server." };
  if (verdict.join) return join(verdict.join, member, now);
  bm ??= await bodyMembers(body, members);
  const voters = kit.electorate(body, bm, { exclude: [member] });
  if (voters.length < kit.RULES.minVoters) return { ok: false, why: `Fewer than ${kit.RULES.minVoters} people can vote on this: the council decides it by poll (\`/poll start\`).` };
  const e = {
    id: nextId('election'), kind: 'election', post, group, action, body, threshold: kit.POSTS[post].threshold, candidates: [member],
    startedBy: String(starter), startedAt: now, endsAt: now + kit.RULES.hours * kit.HOUR, joinUntil: seats != null && action === 'add' ? now + kit.RULES.joinHours * kit.HOUR : 0,
    stage: 'vote', voters, ballots: {}, tieBreaker: body === 'mods' ? chiefOf(members) : null,
  };
  E().open[e.id] = e;
  save();
  if (!(await publish(e, members))) { delete E().open[e.id]; save(); return { ok: false, why: "The election couldn't be posted: try again in a minute." }; }
  return { ok: true, election: e };
}

// A further nominee for the same seat: an approval ballot from now on (Yes ballots approve the first candidate).
async function join(e, member, now) {
  e.candidates.push(member);
  e.voters = e.voters.filter((id) => !e.candidates.includes(id));
  if (e.stage === 'vote' && e.candidates.length === 2) {
    for (const [id, b] of Object.entries(e.ballots)) e.ballots[id] = b === 'yes' ? [e.candidates[0]] : [];
  }
  for (const id of Object.keys(e.ballots)) if (!e.voters.includes(id)) delete e.ballots[id];
  await rememberName(member);
  save();
  await refresh(e);
  const th = await getChannel(e.threadId);
  await th?.send({ content: `<@${member}> joins the ballot for this seat.`, allowedMentions: { parse: [] } }).catch(() => {});
  return { ok: true, election: e, joined: true };
}

// A body's own decision: `/vote body:` from poll.js. args: { body, group?, question, private? }.
export async function startVote(starter, args, { now = Date.now() } = {}) {
  if (!enabled()) return { ok: false, why: 'Body votes are not on yet.' };
  const body = args.body === 'group' ? (ELECTIONS.groups[args.group] ? `group:${args.group}` : null) : args.body;
  if (!body || !['mods', 'team'].includes(body) && !body.startsWith('group:')) return { ok: false, why: 'Pick the body (and the group for a group vote).' };
  const question = String(args.question ?? '').replace(/\s+/g, ' ').trim();
  if (question.length < 10) return { ok: false, why: 'Write the question in a full sentence (10 characters or more).' };
  const members = await allMembers();
  const starterM = members.find((m) => String(m.id) === String(starter));
  const may = kit.mayStartVote(body, starterM ? kindsOfMember(starterM) : new Set(isCouncil(starter) ? ['council'] : []));
  if (may) return { ok: false, why: may };
  const voters = kit.electorate(body, await bodyMembers(body, members));
  if (voters.length < kit.RULES.minVoters) return { ok: false, why: `Fewer than ${kit.RULES.minVoters} people can vote in this body: the council decides it by poll.` };
  const e = {
    id: nextId('vote'), kind: 'vote', body, question, private: !!args.private, threshold: 'simple', candidates: [],
    startedBy: String(starter), startedAt: now, endsAt: now + kit.RULES.hours * kit.HOUR, stage: 'vote', voters, ballots: {}, recused: [],
    tieBreaker: body === 'mods' ? chiefOf(members) : null,
  };
  E().open[e.id] = e;
  save();
  if (!(await publish(e, members))) { delete E().open[e.id]; save(); return { ok: false, why: "The vote couldn't be posted: try again in a minute." }; }
  return { ok: true, election: e };
}

// ── Ballots ──────────────────────────────────────────────────────────────────

const countOf = (e) => (e.stage === 'runoff' ? kit.countRunoff({ ballots: e.ballots, voters: e.voters, pair: e.candidates })
  : e.candidates.length > 1 ? kit.countApproval({ ballots: e.ballots, voters: e.voters, candidates: e.candidates })
    : kit.countYesNo({ ballots: e.ballots, voters: e.voters, threshold: e.threshold, tieBreaker: e.tieBreaker }));
const lockOf = (e) => (e.stage === 'runoff' ? kit.lockedRunoff({ ballots: e.ballots, voters: e.voters, pair: e.candidates })
  : e.candidates.length > 1 ? kit.lockedApproval({ ballots: e.ballots, voters: e.voters, candidates: e.candidates })
    : kit.lockedYesNo({ ballots: e.ballots, voters: e.voters, threshold: e.threshold, tieBreaker: e.tieBreaker }));

export async function onButton(i, now = Date.now()) {
  const [, id, verb, arg] = i.customId.split(':');
  if (verb === 'veto') return onVeto(i, id, now);
  const e = E().open[id];
  if (!e) return i.reply(ephemeral('This vote is closed.'));
  const me = String(i.user.id);
  if (verb === 'decline') return decline(i, e, me, now);
  if (e.candidates.includes(me)) return i.reply(ephemeral("This election is about you: you don't vote on it."));
  if (e.stage === 'nominating') return i.reply(ephemeral('The vote starts when the nominations end.'));
  if (verb === 'recuse' && e.kind === 'vote') {
    e.voters = e.voters.filter((v) => v !== me);
    delete e.ballots[me];
    (e.recused ??= []).push(me);
    save();
    await i.reply(ephemeral('You recused yourself: you are left out of the count. Say why in the thread.'));
    return settle(e, now, i);
  }
  if (!e.voters.includes(me)) return i.reply(ephemeral(`Only ${bodyName(e.body)} vote here. Anyone who can see it may comment in the thread.`));
  let text;
  if (e.stage === 'runoff') {
    if (verb === 'pick' && e.candidates.includes(arg)) { e.ballots[me] = arg; text = `Your vote: <@${arg}>.`; } else if (verb === 'abstain') { e.ballots[me] = 'abstain'; text = 'Your vote: Abstain.'; } else return i.reply(ephemeral('Unknown button.'));
  } else if (e.candidates.length > 1) {
    if (verb === 'approve' && e.candidates.includes(arg)) {
      const list = new Set(Array.isArray(e.ballots[me]) ? e.ballots[me] : []);
      if (list.has(arg)) list.delete(arg); else list.add(arg);
      e.ballots[me] = [...list];
      text = list.size ? `You approve: ${[...list].map((c) => `<@${c}>`).join(', ')}. Press a name again to take it back.` : 'You approve nobody (counted as Abstain).';
    } else if (verb === 'abstain') { e.ballots[me] = []; text = 'Your vote: Abstain.'; } else return i.reply(ephemeral('Unknown button.'));
  } else if (VERBS[verb]) {
    e.ballots[me] = verb;
    text = `Your vote: **${VERBS[verb]}**. You can change it until the vote closes.`;
  } else return i.reply(ephemeral('Unknown button.'));
  save();
  await i.reply(ephemeral(text, { allowedMentions: { parse: [] } }));
  return settle(e, now, i);
}

async function settle(e, now, i) {
  if (lockOf(e).locked) return close(e, now);
  if (i?.message?.id === e.messageId) await i.message.edit?.(render(e)).catch(() => {});
  else await refresh(e);
  return null;
}

async function decline(i, e, me, now) {
  if (e.kind !== 'election' || e.action !== 'add' || !e.candidates.includes(me)) return i.reply(ephemeral('Only a candidate can decline.'));
  e.candidates = e.candidates.filter((c) => c !== me);
  for (const [v, b] of Object.entries(e.ballots)) if (Array.isArray(b)) e.ballots[v] = b.filter((c) => c !== me);
  save();
  await i.reply(ephemeral('You declined: you are off this ballot. Nothing is recorded against you.'));
  const th = await getChannel(e.threadId);
  await th?.send({ content: `<@${me}> declined.`, allowedMentions: { parse: [] } }).catch(() => {});
  if (e.stage === 'nominating') return refresh(e);
  if (!e.candidates.length || e.stage === 'runoff') return end(e, now, 'the candidate declined');
  if (e.candidates.length === 1) for (const [v, b] of Object.entries(e.ballots)) e.ballots[v] = Array.isArray(b) ? (b.length ? 'yes' : 'abstain') : b;
  save();
  return refresh(e);
}

// Ends an election with nothing decided and nothing logged against anyone (declined, nobody nominated).
async function end(e, now, why) {
  delete E().open[e.id];
  e.closedAt = now;
  save();
  await refresh(e);
  const ch = await getChannel(e.channelId);
  await ch?.send({ content: `${e.id} ended: ${why}. Nothing changes.`, allowedMentions: { parse: [] }, reply: { messageReference: e.messageId, failIfNotExists: false } }).catch(() => {});
  return null;
}

// ── Closing, applying, vetoes ────────────────────────────────────────────────

export async function close(e, now = Date.now()) {
  if (!E().open[e.id]) return null;
  if (e.stage === 'nominating') return endNominations(e, now);
  const r = countOf(e);
  if (e.kind === 'election' && e.stage === 'vote' && e.candidates.length > 1 && r.runoff) return startRunoff(e, r, now);
  delete E().open[e.id];
  e.closedAt = now;
  const ballots = Object.fromEntries(Object.entries(e.ballots).filter(([id]) => e.voters.includes(id)));
  const winner = e.kind === 'vote' ? null : r.winner ?? (r.passed ? e.candidates[0] : null);
  const result = { passed: r.passed, why: r.why, voted: r.voted, size: r.size, needed: r.needed, winner, ...(r.counts ? { counts: r.counts } : { yes: r.yes, no: r.no, abstain: r.abstain }) };
  const d = e.kind === 'vote'
    ? poll.log.append({ type: 'bodyvote', vote: e.id, body: e.body, question: e.question, private: e.private, startedBy: e.startedBy, startedAt: e.startedAt, closedAt: now, result, ballots }, now)
    : poll.log.append({ type: 'election', election: e.id, post: e.post, group: e.group, action: e.action, body: e.body, candidates: e.candidates, startedBy: e.startedBy, startedAt: e.startedAt, closedAt: now, vacancy: !!e.vacancy, result, ballots }, now);
  save();
  const applied = e.kind === 'election' && r.passed ? await apply(e, winner, d, e.action, now) : [];
  await refresh(e);
  const counts = r.counts ? Object.entries(r.counts).map(([c, n]) => `<@${c}> ${n}`).join(', ') : `${r.yes} Yes, ${r.no} No, ${r.abstain} Abstain`;
  const head = r.passed ? '✅ **Passed**' : `❌ **Not passed** (${r.why})`;
  const veto = r.passed ? `\nAny council member can call a veto with the button until ${ts(now + kit.RULES.vetoHours * kit.HOUR)}.` : '';
  const line = `${head}: ${e.id} (${counts}; ${r.voted} of ${r.size} voted, ${r.needed} needed). Decision **${d.id}**.${winner && e.candidates.length > 1 ? ` Elected: <@${winner}>.` : ''}${applied.length ? `\n${applied.join('\n')}` : ''}${veto}`;
  const ch = await getChannel(e.channelId);
  const components = r.passed ? [{ type: 1, components: [button(e.id, 'veto', 'Veto (council)', 4, false)] }] : [];
  const msg = await ch?.send({ content: line.slice(0, 2000), components, allowedMentions: { parse: [] }, reply: { messageReference: e.messageId, failIfNotExists: false } }).catch((err) => { console.error('elections result', err.message); return null; });
  if (r.passed) {
    E().closed[e.id] = { id: e.id, kind: e.kind, decision: d.id, closedAt: now, channelId: e.channelId, resultId: msg?.id ?? null, body: e.body, post: e.post ?? null, group: e.group ?? null, action: e.action ?? null, member: winner, private: !!e.private, question: e.question ?? null };
    save();
  }
  await announce(e, r, d, winner);
  return d;
}

// The public line in #polls-and-decisions. Elections: who was elected, or that it didn't pass (no name, no reason).
// Body votes: the question unless it is about a person.
async function announce(e, r, d, winner) {
  const ch = await getChannel(publicChannel());
  let text;
  if (e.kind === 'vote') text = `${r.passed ? '✅' : '❌'} Decision of ${bodyName(e.body)} **${d.id}** (${e.id}): ${r.passed ? 'passed' : 'not passed'}.${e.private ? '' : `\n> ${e.question}`}`;
  else if (r.passed) text = `✅ Election **${d.id}** (${e.id}): ${e.action === 'remove' ? `<@${winner}> recalled from` : `<@${winner}> elected`} ${postLabel(e.post, e.group)} by ${bodyName(e.body)}.`;
  else text = `❌ Election **${d.id}** (${e.id}) for ${postLabel(e.post, e.group)} did not pass.`;
  await ch?.send({ content: text.slice(0, 2000), allowedMentions: { parse: [] } }).catch(() => {});
}

async function startRunoff(e, r, now) {
  const old = { channelId: e.channelId, messageId: e.messageId };
  Object.assign(e, { stage: 'runoff', candidates: r.runoff, ballots: {}, startedAt: now, endsAt: now + kit.RULES.hours * kit.HOUR });
  save();
  const ch = await getChannel(old.channelId);
  const msg = await ch?.messages?.fetch(old.messageId).catch(() => null);
  await msg?.edit?.({ ...render({ ...e, stage: 'vote', candidates: [], closedAt: now }), content: `${e.id}: no candidate had half of the voters. A run-off follows.` }).catch(() => {});
  const body = render(e);
  const sent = await ch?.send({ ...body, allowedMentions: { parse: [] } }).catch(() => null);
  if (sent) Object.assign(e, { messageId: sent.id });
  save();
  return null;
}

// Gives or takes the post. → result lines (what Kira did, and the clicks left for a named person).
async function apply(e, member, d, action, now) {
  const lines = [];
  const key = kit.roleKeyOf(e.post, e.group);
  const give = action === 'add';
  if (key) {
    const m = await guild()?.members.fetch(member).catch(() => null);
    let error = m ? null : 'not in the server';
    if (!error && give && age.required(key) && !age.isDeclared(member)) error = 'no 18+ declaration yet';
    if (!error) {
      try {
        mine(member, roleId(key));
        if (give) await m.roles.add(roleId(key), `Election ${d.id}`); else await m.roles.remove(roleId(key), `Election ${d.id}`);
      } catch (err) { error = String(err.message).slice(0, 200); }
    }
    poll.log.append({ type: 'applied', of: d.id, member, role: key, action, ok: !error, error }, now);
    lines.push(error ? `⚠️ Kira could not ${give ? 'give' : 'take'} ${gk_roleName(key)} (${error}): a council member does it by hand, citing ${d.id}.` : `Kira ${give ? 'gave' : 'took'} ${gk_roleName(key)} ${give ? 'to' : 'from'} <@${member}> (${d.id}).`);
  }
  if (e.post === 'team') lines.push(await githubTeam(member, give, d));
  if (e.post === 'op') lines.push(`To do, <@${ELECTIONS.clicks.server}>: ${give ? 'op' : 'deop'} <@${member}> on the official server (their Minecraft name: ask in the thread), citing ${d.id}.`);
  return lines;
}
const gk_roleName = (key) => (key.startsWith('lead-') ? `🧭 ${ELECTIONS.groups[key.slice(5)]?.name ?? key.slice(5)} lead` : ({ mod: '🛡️ Mod', chiefmod: '🛡️ Chief of Mods', team: '🌌 Horizon Team' })[key] ?? key);

// GitHub team membership with KIRA_GITHUB_ORG_TOKEN; without it (or when it fails) a click for a named person.
let orgGh = null;
export const setOrgGitHub = (gh) => { orgGh = gh; };
async function githubTeam(member, give, d) {
  const login = ev().loginOf(member);
  const click = `To do, <@${ELECTIONS.clicks.github}>: ${give ? 'add' : 'remove'} ${login ? `\`${login}\`` : `<@${member}> (no verified GitHub yet)`} ${give ? 'to' : 'from'} \`${ELECTIONS.github.team}\` on GitHub, citing ${d.id}.`;
  if (!login || (!ELECTIONS.github.token && !orgGh)) return click;
  orgGh ??= makeGitHub({ token: ELECTIONS.github.token });
  const path = `/orgs/${ELECTIONS.github.org}/teams/${ELECTIONS.github.team}/memberships/${login}`;
  try {
    await orgGh.write(give ? 'PUT' : 'DELETE', path, give ? { role: 'member' } : undefined);
    return `Kira ${give ? 'added' : 'removed'} \`${login}\` ${give ? 'to' : 'from'} \`${ELECTIONS.github.team}\` on GitHub (${d.id}).`;
  } catch (err) {
    return `${click} (Kira's try failed: ${String(err.message).slice(0, 120)})`;
  }
}

// The Veto button under a passed result: a council member opens a council poll (simple majority).
async function onVeto(i, id, now) {
  const c = E().closed[id];
  if (!isCouncil(i.user.id)) return i.reply(ephemeral('Only council members can call a veto.'));
  if (!c) return i.reply(ephemeral('Nothing to veto here any more.'));
  if (c.vetoPoll) return i.reply(ephemeral(`A veto poll is already running: ${c.vetoPoll}.`));
  if (!kit.vetoOpen(c.closedAt, now)) return i.reply(ephemeral('The 24 hours for a veto are over. The council can still decide by its own poll.'));
  if (c.member && String(i.user.id) === c.member) return i.reply(ephemeral('This is about you: another council member can call the veto.'));
  const what = c.kind === 'vote' ? `the decision of ${bodyName(c.body)} ${c.decision}${c.private ? '' : ` ("${String(c.question).slice(0, 300)}")`}` : `election ${c.decision} (${c.action === 'remove' ? 'recall of' : ''} <@${c.member}>, ${postLabel(c.post, c.group)})`;
  const person = c.kind === 'election' || c.private;
  const p = await poll.open({ kind: 'veto', question: `Veto: overturn ${what}?`, threshold: 'simple', where: person ? 'council' : 'public', subject: c.member ?? null, outcome: null, key: `veto:${id}`, ref: { veto: id } }, { openedBy: String(i.user.id), now });
  if (!p) return i.reply(ephemeral('The veto poll could not be posted: try again in a minute.'));
  c.vetoPoll = p.id;
  save();
  return i.reply(ephemeral(`Veto poll ${p.id} started in <#${p.channelId}>: a simple majority overturns ${c.decision}.`));
}

// A veto poll closed: overturn when it passed (undo the role change), and log either way.
export async function onPollClosed(p, d, now = Date.now()) {
  const id = p.ref?.veto;
  if (!id) return;
  const c = E().closed[id];
  if (!c) return;
  delete E().closed[id];
  save();
  poll.log.append({ type: 'veto', of: c.decision, poll: p.id, post: c.post, group: c.group, action: c.action, member: c.member, passed: !!d.result?.passed }, now);
  const ch = await getChannel(channelOf(c.body));
  if (!d.result?.passed) {
    await ch?.send({ content: `The council's veto poll ${p.id} on ${c.decision} did not pass: ${c.decision} stands.`, allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }
  let lines = [];
  if (c.kind === 'election') lines = await apply({ post: c.post, group: c.group }, c.member, d, c.action === 'add' ? 'remove' : 'add', now);
  else lines = ['Whoever carried the decision out reverses it.'];
  await ch?.send({ content: `⛔ Council decision **${d.id}** (${p.id}) overturned ${c.decision}.\n${lines.join('\n')}`.slice(0, 2000), allowedMentions: { parse: [] } }).catch(() => {});
}

// ── Commands, timer, setup ───────────────────────────────────────────────────

const postChoices = Object.entries(kit.POSTS).map(([value, p]) => ({ name: p.label, value }));
const groupChoices = () => groupKeys().map((g) => ({ name: ELECTIONS.groups[g].name, value: g }));

export const commands = enabled() ? [
  new SlashCommandBuilder().setName('elect').setDescription('Start an election (or a recall) in the body that votes for this post')
    .addStringOption((o) => o.setName('post').setDescription('The post').setRequired(true).addChoices(...postChoices))
    .addUserOption((o) => o.setName('member').setDescription('The candidate (or the holder, for a recall)').setRequired(true))
    .addStringOption((o) => o.setName('group').setDescription('For a group lead: which group').addChoices(...groupChoices()))
    .addStringOption((o) => o.setName('action').setDescription('Elect (default) or recall').addChoices({ name: 'elect', value: 'add' }, { name: 'recall', value: 'remove' })),
  new SlashCommandBuilder().setName('grant').setDescription('A free action: give or take 🤝 Support (mods) or a group\'s helper role (its lead)')
    .addStringOption((o) => o.setName('role').setDescription('Which role').setRequired(true).addChoices(...Object.entries(ELECTIONS.grants).map(([value, g]) => ({ name: g.label, value }))))
    .addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true))
    .addStringOption((o) => o.setName('action').setDescription('Give (default) or take').addChoices({ name: 'give', value: 'add' }, { name: 'take', value: 'remove' })),
] : [];

export const handlers = {
  async elect(i) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const r = await startElection(i.user.id, { post: i.options.getString('post'), member: i.options.getUser('member')?.id, group: i.options.getString('group'), action: i.options.getString('action') ?? 'add' });
    if (!r.ok) return i.editReply(ephemeral(r.why));
    const e = r.election;
    return i.editReply(ephemeral(r.joined ? `They join ${e.id}'s ballot in <#${e.channelId}>.` : `Election ${e.id} started in <#${e.channelId}>: it ends ${ts(e.endsAt)}.`));
  },
  async grant(i) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    return i.editReply(ephemeral(await grant(i.user.id, { role: i.options.getString('role'), member: i.options.getUser('member')?.id, action: i.options.getString('action') ?? 'add' })));
  },
};

// `/vote body:` (poll.js calls this for any body but the council).
export async function voteCommand(i) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const r = await startVote(i.user.id, { body: i.options.getString('body'), group: i.options.getString('group'), question: i.options.getString('question'), private: !!i.options.getBoolean('private') });
  if (!r.ok) return i.editReply(ephemeral(r.why));
  return i.editReply(ephemeral(`Vote ${r.election.id} started in <#${r.election.channelId}>: it ends ${ts(r.election.endsAt)}.`));
}
if (enabled()) poll.hooks.bodyVote = voteCommand;

// Every minute: votes whose time is up; veto buttons whose 24 hours are over.
export async function tick(now = Date.now()) {
  for (const e of openList()) {
    try {
      if (e.stage === 'nominating' ? now >= e.nominateUntil : now >= e.endsAt) await close(e, now);
    } catch (err) { console.error('elections', e.id, err.message); }
  }
  for (const c of Object.values(E().closed)) {
    if (kit.vetoOpen(c.closedAt, now) || c.vetoPoll) continue;
    delete E().closed[c.id];
    save();
    const ch = await getChannel(c.channelId);
    const msg = c.resultId ? await ch?.messages?.fetch(c.resultId).catch(() => null) : null;
    await msg?.edit?.({ components: [] }).catch(() => {});
  }
}

// ── Vacancies ────────────────────────────────────────────────────────────────

const seatHolders = (members) => Object.fromEntries([['chiefmod', holdersOf(members, 'chiefmod')], ...groupKeys().map((g) => [`lead:${g}`, holdersOf(members, `lead-${g}`)])]);

// Compares the seats' holders with the last look; a seat that was held and is empty now opens its nominations. The
// first look only records (seats never filled are the monthly reminder's job). → the seats that became vacant.
export async function sweepSeats(now = Date.now()) {
  const members = await allMembers();
  if (!members.length) return [];
  const after = seatHolders(members);
  const gone = kit.vacated(E().seats, after);
  E().seats = after;
  save();
  for (const seat of gone) await openVacancy(seat, members, now).catch((err) => console.error('vacancy', seat, err.message));
  return gone;
}

async function openVacancy(seat, members, now) {
  const [post, group = null] = seat.split(':');
  if (openList().some((x) => x.kind === 'election' && x.post === post && (x.group ?? null) === group && x.action === 'add')) return null;
  const e = {
    id: nextId('election'), kind: 'election', post, group, action: 'add', body: kit.bodyOf(post, group), threshold: kit.POSTS[post].threshold, candidates: [],
    startedBy: 'kira', startedAt: now, nominateUntil: now + kit.RULES.nominateHours * kit.HOUR, endsAt: 0, joinUntil: 0, stage: 'nominating', voters: [], ballots: {}, vacancy: true, tieBreaker: null,
  };
  E().open[e.id] = e;
  save();
  if (!(await publish(e, members))) { delete E().open[e.id]; save(); return null; }
  return e;
}

// The nominations of a vacancy are over: nobody → the seat stays open; otherwise the 24-hour vote with all of them.
async function endNominations(e, now) {
  if (!e.candidates.length) return end(e, now, 'nobody was nominated, so the seat stays open; the tier above acts meanwhile');
  const members = await allMembers();
  const voters = kit.electorate(e.body, await bodyMembers(e.body, members), { exclude: e.candidates });
  if (voters.length < kit.RULES.minVoters) return end(e, now, `fewer than ${kit.RULES.minVoters} can vote, so the council decides by poll`);
  Object.assign(e, { stage: 'vote', voters, ballots: {}, startedAt: now, endsAt: now + kit.RULES.hours * kit.HOUR, tieBreaker: e.body === 'mods' ? chiefOf(members) : null });
  save();
  await refresh(e);
  const th = await getChannel(e.threadId);
  await th?.send({ content: `The nominations are over: the vote is open until ${ts(e.endsAt)}.`, allowedMentions: { parse: [] } }).catch(() => {});
  await notifyVoters(e, members);
  return null;
}

// ── Free actions: /grant, the #staff-log lines, role tracking ────────────────

const staffLog = () => getChannel(state.channels?.stafflog || ELECTIONS.channels.stafflog);
const own = new Map(); // `${member}:${role}` → until: role changes Kira makes herself (not free actions by people)
const mine = (member, role, now = Date.now()) => own.set(`${member}:${role}`, now + 60_000);
const isMine = (member, role, now = Date.now()) => (own.get(`${member}:${role}`) ?? 0) > now;

// Gives or takes a free-action role (ELECTIONS.grants) for `by`. → the reply.
export async function grant(by, { role: key, member, action = 'add' }, now = Date.now()) {
  if (!enabled()) return 'Not on yet.';
  const spec = ELECTIONS.grants[key];
  if (!spec) return 'Unknown role.';
  const members = await allMembers();
  const byM = members.find((m) => String(m.id) === String(by));
  const kinds = byM ? kindsOfMember(byM) : new Set(isCouncil(by) ? ['council'] : []);
  if (!kinds.has(spec.by) && !kinds.has('council')) return `Only ${spec.by === 'mods' ? 'a moderator' : `the ${spec.by.replace('lead-', '')} lead`} (or a council member) gives ${spec.label}.`;
  const m = await guild()?.members.fetch(member).catch(() => null);
  if (!m || m.user?.bot) return "They aren't in the server.";
  const has = rolesOf(m).has(spec.role);
  if (action === 'add' && has) return `They already have ${spec.label}.`;
  if (action === 'remove' && !has) return `They don't have ${spec.label}.`;
  mine(m.id, spec.role, now);
  try {
    if (action === 'add') await m.roles.add(spec.role, `/grant by ${by}`); else await m.roles.remove(spec.role, `/grant by ${by}`);
  } catch (err) { return `Discord refused: ${String(err.message).slice(0, 150)}`; }
  await logFree(`<@${by}> ${action === 'add' ? 'gave' : 'took'} ${spec.label} ${action === 'add' ? 'to' : 'from'} <@${m.id}> (\`/grant\`).`);
  return `Done: ${action === 'add' ? 'gave' : 'took'} ${spec.label} ${action === 'add' ? 'to' : 'from'} <@${m.id}>. It is logged in #staff-log.`;
}

async function logFree(text) {
  const ch = await staffLog();
  await ch?.send({ content: `🔧 ${text}`.slice(0, 2000), allowedMentions: { parse: [] } }).catch(() => {});
}

// The roles whose hand-made changes go to #staff-log: the posts, Support and the helper roles.
const watched = () => {
  const out = new Map();
  for (const k of ['council', 'team', 'chiefmod', 'mod', ...groupKeys().map((g) => `lead-${g}`)]) if (roleId(k)) out.set(roleId(k), k);
  for (const g of Object.values(ELECTIONS.grants)) out.set(g.role, g.label);
  return out;
};
const nameOf = (key) => (Object.values(ELECTIONS.grants).find((g) => g.label === key)?.label ?? gk_roleName(key) ?? key);

async function actorOf(memberId, roleIdChanged) {
  const logs = await guild()?.fetchAuditLogs?.({ type: AuditLogEvent.MemberRoleUpdate, limit: 10 }).catch(() => null);
  const entry = [...(logs?.entries?.values?.() ?? [])].find((x) => x.targetId === String(memberId) && (x.changes ?? []).some((c) => (c.new ?? []).some((r) => r.id === roleIdChanged)));
  return entry?.executorId ?? null;
}

// A member's roles changed: track when group roles and 🛡️ Mod were picked up, log hand-made changes of the watched
// roles, and look at the seats when one of them lost its holder.
export async function onMemberUpdate(before, after, now = Date.now()) {
  if (!enabled() || before?.partial || after?.user?.bot) return [];
  const was = rolesOf(before);
  const is = rolesOf(after);
  const id = String(after.id);
  for (const g of groupKeys()) {
    const r = ELECTIONS.groups[g].role;
    if (!was.has(r) && is.has(r)) E().roleSince[sinceKey(g, id)] = now;
    if (was.has(r) && !is.has(r)) delete E().roleSince[sinceKey(g, id)];
  }
  if (!was.has(roleId('mod')) && is.has(roleId('mod'))) E().roleSince[sinceKey('mod', id)] = now;
  if (was.has(roleId('mod')) && !is.has(roleId('mod'))) delete E().roleSince[sinceKey('mod', id)];
  save();
  const lines = [];
  for (const [r, key] of watched()) {
    const added = !was.has(r) && is.has(r);
    const removed = was.has(r) && !is.has(r);
    if ((!added && !removed) || isMine(id, r, now)) continue;
    const by = await actorOf(id, r);
    if (by && String(by) === String(client.user?.id)) continue;
    lines.push(`${by ? `<@${by}>` : 'Someone'} ${added ? 'gave' : 'took'} ${nameOf(key)} ${added ? 'to' : 'from'} <@${id}> by hand.`);
  }
  for (const l of lines) await logFree(l);
  if ([...watched().entries()].some(([r, k]) => (k === 'chiefmod' || String(k).startsWith('lead-')) && was.has(r) && !is.has(r))) await sweepSeats(now);
  return lines;
}

// ── Monthly reminders (suggestions only) ─────────────────────────────────────

export const reminderText = (g, hasLead) => [
  `🧭 **${ELECTIONS.groups[g].name}: who leads this group?** ${hasLead ? '' : 'This group has no lead yet. '}`
    + `A Horizon Team member, a council member${hasLead ? ' or the current lead' : ''} can propose someone who meets the floor (GOVERNANCE.md 5.2) with \`/elect post:lead group:${g} member:\`. Anyone can suggest a name to them.`,
  "The group's active members and the Team vote for 24 hours. Kira posts this once a month, only when the group has no lead or someone in it meets the floor.",
].join('\n');

// Once a month: the group reminders, and the private list in #council. Never a word about anyone's age: the
// declaration is left out of these checks. → { groups: [keys posted], suggestions: n }.
export async function monthly(now = Date.now()) {
  if (!enabled() || !kit.monthlyDue(E().monthlyDone, now)) return null;
  // Fetch first: a rate-limited member fetch (gateway opcode 8, common right after a boot) throws here, before the
  // month is marked, so the next hourly run tries again. `lastMonthly` (11-10) was marked before a fetch that failed.
  const members = await allMembers();
  E().monthlyDone = kit.monthOf(now); // before posting, so a crash half-way never posts twice
  save();
  const byId = new Map(members.map((m) => [String(m.id), m]));
  const meets = async (m, post, group) => {
    const card = await ev().candidate(m, { post, group, kinds: kindsOfMember(m), modSince: E().roleSince[sinceKey('mod', m.id)] ?? null });
    return { ok: !kit.shortOf(post, group, { ...card, declared: true }, now).length, card };
  };
  const posted = [];
  const suggestions = [];
  for (const g of groupKeys()) {
    const leads = holdersOf(members, `lead-${g}`);
    const bm = await bodyMembers(`group:${g}`, members);
    let at = 0;
    for (const x of bm.filter((y) => y.active?.[g] && !leads.includes(y.id))) {
      const r = await meets(byId.get(x.id), 'lead', g);
      if (!r.ok) continue;
      at++;
      suggestions.push(`<@${x.id}>: ${postLabel('lead', g)} (${r.card.areaMerged ?? 0} merged, ${r.card.areaReviews ?? 0} reviews in the area)`);
    }
    if (!kit.groupReminderDue({ leads: leads.length, meetsFloor: at })) continue;
    const ch = await getChannel(ELECTIONS.groups[g].channel);
    if (await ch?.send({ content: reminderText(g, leads.length > 0), allowedMentions: { parse: [] } }).catch(() => null)) posted.push(g);
  }
  for (const [id, r] of Object.entries(state.work?.ranks ?? {})) {
    const m = byId.get(String(id));
    if (!m || (Number(r?.count) || 0) < kit.FLOORS.team.merged || kindsOfMember(m).has('team')) continue;
    const x = await meets(m, 'team', null);
    if (x.ok) suggestions.push(`<@${id}>: 🌌 Horizon Team (${x.card.merged} merged, ${x.card.reviews} reviews)`);
  }
  const modCands = members.filter((m) => !kindsOfMember(m).has('mods') && levelOf(state.levels?.[m.id]?.xp ?? 0).level >= kit.FLOORS.mod.level)
    .sort((a, b) => (state.levels?.[b.id]?.xp ?? 0) - (state.levels?.[a.id]?.xp ?? 0)).slice(0, 10);
  for (const m of modCands) if ((await meets(m, 'mod', null)).ok) suggestions.push(`<@${m.id}>: 🛡️ Mod (Kira level ${levelOf(state.levels?.[m.id]?.xp ?? 0).level})`);
  if (suggestions.length) {
    const ch = await getChannel(state.channels?.council || GOVERNANCE.channels.council);
    const text = ['🗳️ **Monthly suggestions** (private). They meet a post\'s floor; these are only suggestions: Kira never starts an election.', ...suggestions.slice(0, 25).map((l) => `• ${l}`)].join('\n');
    await ch?.send({ content: text.slice(0, 2000), allowedMentions: { parse: [] } }).catch(() => {});
  }
  return { groups: posted, suggestions: suggestions.length };
}

// Bans and unbans in #staff-log, only once it is its own channel (until then #mod-actions has them already).
async function banLine(ban, added) {
  if (ban.guild?.id !== GUILD_ID || !(state.channels?.stafflog || process.env.KIRA_STAFF_LOG_CHANNEL)) return;
  const logs = await ban.guild.fetchAuditLogs?.({ type: added ? AuditLogEvent.MemberBanAdd : AuditLogEvent.MemberBanRemove, limit: 5 }).catch(() => null);
  const by = [...(logs?.entries?.values?.() ?? [])].find((x) => x.targetId === ban.user?.id)?.executorId;
  await logFree(`${by ? `<@${by}>` : 'Someone'} ${added ? 'banned' : 'unbanned'} <@${ban.user?.id}>.`).catch(() => {});
}

export function setup() {
  if (!enabled()) return;
  poll.onClosed((p, d) => onPollClosed(p, d));
  client.on('interactionCreate', (i) => {
    if (i.isButton?.() && (!i.guildId || i.guildId === GUILD_ID) && i.customId.startsWith('elect:')) onButton(i).catch((err) => console.error('elections button', err));
  });
  client.on('guildMemberUpdate', (a, b) => { if (b.guild?.id === GUILD_ID) onMemberUpdate(a, b).catch((err) => console.error('elections member', err.message)); });
  client.on('guildBanAdd', (ban) => banLine(ban, true));
  client.on('guildBanRemove', (ban) => banLine(ban, false));
  client.once('clientReady', () => {
    setInterval(() => tick().catch((err) => console.error('elections', err.message)), 60_000).unref?.();
    const hourly = () => sweepSeats().then(() => monthly()).catch((err) => console.error('elections hourly', err.message));
    setTimeout(hourly, 120_000).unref?.();
    setInterval(hourly, 3_600_000).unref?.();
  });
}
