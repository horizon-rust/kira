// Kira answers on her own (src/ai.js asks the model): a message that mentions Kira or replies to her gets one answer,
// from Horizon's FAQ, docs and release notes only. Off unless KIRA_AI is set and ANTHROPIC_API_KEY exists; `/kira-ai off`
// stops it at once. Limits: AI.perMemberHour questions per member, AI.dailyUsd dollars a day (UTC), counted from each
// response's usage. Every answer is logged in #mod-log (the question, the model, tokens, cost). A question Kira can't
// answer is passed to the team: she says so, and it is kept in state.kiraAi.handoffs for the orchestrator.
// The same client and budget read messages for moderation in every language (moderateBatch, used by moderation.js).
import { createHash, timingSafeEqual } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { SlashCommandBuilder, PermissionFlagsBits as P, MessageFlags } from 'discord.js';
import { AI, GUILD_ID, OWNER_ID } from '../config.js';
import { client, state, save, isStaff, modlog, clip } from '../core.js';
import { makePublicGitHub } from '../github.js';
import { appToken } from '../github-app.js';
import { dataFile } from '../store.js';
import { rateLimiter, clientIp, untrusted } from '../agents.js';
import { parseVerb } from '../hub.js';
import * as ai from '../ai.js';
import * as kit from '../ai-kit.js';
import * as game from '../game-kit.js';

const KEY = !!process.env.ANTHROPIC_API_KEY?.trim();
export const enabled = !!AI.mode && KEY;
const store = (state.kiraAi ??= {});
store.on ??= true; // /kira-ai on|off: everything below
store.modOn ??= true; // /kira-ai mod on|off: moderation only
store.days ??= {}; // 'YYYY-MM-DD' → { cost_usd, answers, passed_to_team, bug_reviews, moderated, models: { model: calls } }
store.handoffs ??= []; // [{ id, url, channel, author, question, reason, at, done }]

// The sources read public content through the GitHub App (else without a token), never Ludovic's token, and keep their
// last good copy in data/ai-sources.json (KIRA_AI_SOURCES).
let sources = ai.makeSources({ gh: makePublicGitHub({ appToken: appToken() }), file: process.env.KIRA_AI_SOURCES || dataFile('ai-sources.json') });
const anthropic = KEY ? new Anthropic({ maxRetries: 2, timeout: 60_000 }) : null;
let answer = enabled ? ai.makeAnswerer({ client: anthropic, sources }) : null;
let gameAnswer = enabled ? ai.makeAnswerer({ client: anthropic, sources, rules: game.GAME_RULES }) : null;
export const bugsEnabled = AI.bugs && KEY;
let reviewer = bugsEnabled ? ai.makeBugReviewer({ client: anthropic }) : null;
export const modEnabled = !!AI.mode && AI.mod && KEY;
let moderator = modEnabled ? ai.makeModerator({ client: anthropic }) : null;
let modPausedUntil = 0; // after an API error
const limits = rateLimiter({ ask: [AI.perMemberHour, 3_600_000], notice: [1, 3_600_000] });
const seen = new Set(); // messages answered or being answered: one answer each

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export const spentToday = (now) => store.days[today(now)]?.cost_usd ?? 0;

// One answer's usage, in the day's totals (GET /ai-usage reads them).
export function record(r, now = Date.now()) {
  const d = (store.days[today(now)] ??= { cost_usd: 0, answers: 0, passed_to_team: 0, models: {} });
  d.cost_usd += r.cost ?? 0;
  if (r.kind === 'bug') d.bug_reviews = (d.bug_reviews ?? 0) + 1;
  else if (r.kind === 'mod') d.moderated = (d.moderated ?? 0) + (r.count ?? 0);
  else if (r.status === 'ignore') d.ignored = (d.ignored ?? 0) + 1;
  else if (r.status === 'answer') d.answers++;
  else d.passed_to_team++;
  for (const m of r.models ?? []) d.models[m] = (d.models[m] ?? 0) + 1;
  for (const k of Object.keys(store.days).sort().slice(0, -AI.daysKept)) delete store.days[k];
}

const name = (m) => m.member?.displayName ?? m.author?.globalName ?? m.author?.username ?? 'someone';
const channelName = (msg) => msg.channel?.name ?? 'unknown';
const forumThread = (msg) => ['horizonbugs', 'horizonsupport', 'horizonideas'].some((k) => state.channels[k] && msg.channel?.parentId === state.channels[k]);
const helpChannel = (msg) => AI.helpChannels.some((k) => state.channels[k] && [msg.channelId, msg.channel?.parentId].includes(state.channels[k]));

// Why Kira answers this message: 'mention', 'reply', 'help', or null. A reply in a #horizon-bugs or #horizon-ideas post
// answers Kira's own template notices there, so only a mention counts in those.
export function trigger(msg, me) {
  if (!me || msg.author?.bot || msg.guildId !== GUILD_ID) return null;
  if (new RegExp(`<@!?${me}>`).test(msg.content ?? '')) return 'mention';
  if (msg.reference?.messageId && msg.mentions?.repliedUser?.id === me && !forumThread(msg)) return 'reply';
  if (AI.mode === 'all' && helpChannel(msg) && /\?/.test(msg.content ?? '')) return 'help';
  return null;
}
export const question = (text, me) => String(text ?? '').replace(new RegExp(`<@!?${me}>`, 'g'), '').trim();

// What the message replies to, oldest first, Kira's own messages marked as hers.
async function contextOf(msg) {
  const out = [];
  let ref = msg.reference?.messageId ? await msg.fetchReference().catch(() => null) : null;
  while (ref && out.length < AI.contextMessages) {
    out.unshift({ author: ref.author?.id === client.user?.id ? 'Kira (you)' : name(ref), text: String(ref.content ?? '').slice(0, 1500) });
    ref = ref.reference?.messageId ? await ref.fetchReference().catch(() => null) : null;
  }
  return out;
}

// A Horizon Team member or a mod: "passed to the team" would point them at themselves.
export const isTeam = (member) => !!member && (isStaff(member) || (!!state.roles.team && !!member.roles?.cache?.has(state.roles.team)));

function handoff(msg, text, reason) {
  store.handoffs.push({ id: msg.id, url: msg.url, channel: channelName(msg), author: name(msg), question: text.slice(0, 1000), reason, at: Date.now(), done: false });
  store.handoffs = store.handoffs.slice(-AI.handoffsKept);
}
export const openHandoffs = () => store.handoffs.filter((h) => !h.done);
// Marks hand-offs read by the team (by message id); returns how many.
export function closeHandoffs(ids) {
  let n = 0;
  for (const h of store.handoffs) if (!h.done && ids.includes(h.id)) { h.done = true; n++; }
  if (n) save();
  return n;
}

function logAnswer(msg, text, r) {
  const passed = r.status !== 'answer';
  return modlog(passed ? '🤖 Kira passed a question to the team' : '🤖 Kira answered', `[The question](${msg.url}) by <@${msg.author.id}> in <#${msg.channelId}>`, passed ? 0xf0932b : 0x4cc38a, [
    { name: 'Question', value: clip(text, 500) },
    { name: 'Reply', value: clip(r.reply, 900) },
    ...(r.reason ? [{ name: 'Why passed', value: clip(r.reason, 200) }] : []),
    { name: 'Model', value: r.models?.length ? r.models.join(' → ') : 'none', inline: true },
    { name: 'Tokens', value: `in ${r.input ?? 0} · out ${r.output ?? 0} · cache read ${r.cacheRead ?? 0} · cache write ${r.cacheWrite ?? 0}`, inline: true },
    { name: 'Cost', value: `$${(r.cost ?? 0).toFixed(4)} (today $${spentToday().toFixed(2)} of $${AI.dailyUsd})`, inline: true },
    ...(r.lookups?.length ? [{ name: 'Docs read', value: clip(r.lookups.join(', '), 300) }] : []),
  ]);
}

async function respond(msg, text) {
  const send = (content) => msg.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
  if (!limits.take(msg.author.id, 'ask')) {
    if (limits.take(msg.author.id, 'notice')) await send(`I answer ${AI.perMemberHour} questions an hour per member: ask again a bit later.`);
    return;
  }
  let r;
  if (spentToday() >= AI.dailyUsd) r = { status: 'pass', reply: kit.BUDGET_SPENT, reason: 'daily budget spent', models: [], cost: 0 };
  else if (!(await sources.refresh()) && !(await sources.refresh(Date.now(), { force: true }))) r = { status: 'pass', reply: kit.PASSED, reason: 'sources not loaded', models: [], cost: 0 };
  else {
    msg.channel?.sendTyping?.().catch(() => {});
    r = await answer({ author: name(msg), channel: channelName(msg), text, context: await contextOf(msg) });
  }
  record(r);
  if (r.status === 'pass' && isTeam(msg.member)) r.reply = kit.PASSED_TEAM;
  if (r.status === 'ignore') return save(); // chatter or a jailbreak: no reply, nothing for the team
  if (r.status !== 'answer') handoff(msg, text, r.reason ?? 'not in the sources');
  save();
  await send(r.reply).catch((e) => console.error('kira ai reply', e.message));
  await logAnswer(msg, text, r);
}

// A question from a Minecraft server's chat (POST /game/ask, src/features/game.js): the same sources, budget, off switch
// and moderation as on Discord, in game chat's rules. → { status, reply }: reply is what goes to chat ('' for nothing).
export async function askInGame({ server, player, question }) {
  const asked = { author: player, channel: `minecraft ${server}`, text: question };
  if (!enabled || !store.on) return { status: 'off', reply: game.OFF_REPLY };
  const hit = game.blockedBy(question);
  let r;
  if (hit) r = { status: 'blocked', reply: game.BLOCKED_REPLY, reason: `AutoMod: ${hit}`, models: [], cost: 0 };
  else if (spentToday() >= AI.dailyUsd) r = { status: 'pass', reply: game.OFF_REPLY, reason: 'daily budget spent', models: [], cost: 0 };
  else if (!(await sources.refresh()) && !(await sources.refresh(Date.now(), { force: true }))) r = { status: 'pass', reply: game.PASS_REPLY, reason: 'sources not loaded', models: [], cost: 0 };
  else {
    const [mod, a] = await Promise.all([moderateBatch([asked]).catch(() => null), gameAnswer(asked)]);
    record(a);
    const removed = mod?.results?.[0]?.verdict === 'remove';
    const reply = a.status === 'ignore' ? '' : a.reply === kit.PASSED ? game.PASS_REPLY : (game.gameReply(a.reply) ?? game.PASS_REPLY);
    r = removed ? { ...a, status: 'blocked', reply: game.BLOCKED_REPLY, reason: `moderation: ${mod.results[0].reason}` } : { ...a, reply };
  }
  save();
  await logGame(server, player, question, r).catch((e) => console.error('kira game log', e.message));
  return { status: r.status, reply: r.reply };
}

function logGame(server, player, text, r) {
  const answered = r.status === 'answer';
  return modlog(answered ? '🎮 Kira answered in game' : `🎮 Kira in game: ${r.status}`, `**${clip(player, 16)}** on **${clip(server, 60)}**`, answered ? 0x4cc38a : 0xf0932b, [
    { name: 'Question', value: clip(text, 500) },
    { name: 'Reply', value: clip(r.reply || '(nothing)', 300) },
    ...(r.reason ? [{ name: 'Why', value: clip(r.reason, 200) }] : []),
    { name: 'Model', value: r.models?.length ? r.models.join(' → ') : 'none', inline: true },
    { name: 'Cost', value: `$${(r.cost ?? 0).toFixed(4)} (today $${spentToday().toFixed(2)} of $${AI.dailyUsd})`, inline: true },
  ]);
}

// A new #horizon-support post (src/features/support.js): one first answer from the sources, posted in the post, or
// nothing when they don't settle it (🤝 Support answers; no hand-off for the team). Logged in #mod-log like any answer.
// Off, budget spent or sources missing: nothing. Returns the reply posted, or null.
export async function supportAnswer(thread, starter) {
  if (!enabled || !store.on || spentToday() >= AI.dailyUsd) return null;
  if (!(await sources.refresh()) && !(await sources.refresh(Date.now(), { force: true }))) return null;
  const text = `${thread.name}\n${starter.content ?? ''}`.slice(0, 3000);
  thread.sendTyping?.().catch(() => {});
  const r = await answer({ author: name(starter), channel: thread.parent?.name ?? 'horizon-support', text });
  record(r);
  save();
  await logAnswer(starter, text, { ...r, reason: r.status === 'answer' ? r.reason : `${r.reason ?? 'not in the sources'} (left to 🤝 Support)` });
  if (r.status !== 'answer' || !r.reply) return null;
  await thread.send({ content: `${r.reply}\n-# 🤖 A first answer from Kira, from the FAQ and Horizon's docs. 🤝 Support can add more.`, allowedMentions: { parse: [] } });
  return r.reply;
}

// Set by src/features/github.js: (msg) → true when the mention in a bug post was dealt with (it replied itself).
let bugPostHook = null;
export const onBugPostMention = (fn) => { bugPostHook = fn; };

// true when Kira took the message (answered, passed it on, or hit a limit).
export async function onMessage(msg) {
  if (!enabled || !store.on) return false;
  const me = client.user?.id;
  if (!trigger(msg, me)) return false;
  const verb = parseVerb(msg.content, me);
  if (verb && verb.verb !== 'help') return false; // "@Kira roadmap" and the other verbs stay the hub's
  const text = question(msg.content, me);
  if (!text) return false; // a bare mention: the hub's help
  if (seen.has(msg.id)) return true;
  seen.add(msg.id);
  if (seen.size > 1000) seen.delete(seen.values().next().value);
  const inBugPost = !!bugPostHook && state.channels.horizonbugs && msg.channel?.parentId === state.channels.horizonbugs;
  // A mention inside a #horizon-bugs post is about that post: filed, or linked if it already is (src/features/github.js).
  const handled = inBugPost ? await bugPostHook(msg).catch((e) => { console.error('kira ai bug post', e.message); return null; }) : null;
  if (handled) return true;
  await respond(msg, text).catch((e) => console.error('kira ai', e));
  return true;
}

// What the orchestrator reads over MCP (ai_handoffs, maintainers): the open hand-offs, member text marked untrusted.
export const handoffsOut = () => openHandoffs().map((h) => ({
  id: h.id, url: h.url, channel: h.channel, at: new Date(h.at).toISOString(), reason: h.reason,
  author: untrusted(h.author, 'discord'), question: untrusted(h.question, 'discord'),
}));

// GET /ai-usage, for the LifeOS control center: the spending per UTC day, the month's totals and the daily budget.
// Counts and dollars only: no message text, no user ids.
export function usage(now = Date.now()) {
  const round = (x) => Math.round(x * 1e6) / 1e6;
  const days = Object.keys(store.days).sort().map((day) => ({ day, ...store.days[day], bug_reviews: store.days[day].bug_reviews ?? 0, moderated: store.days[day].moderated ?? 0, cost_usd: round(store.days[day].cost_usd) }));
  const month = today(now).slice(0, 7);
  const total = { month, cost_usd: 0, answers: 0, passed_to_team: 0, bug_reviews: 0, moderated: 0, models: {} };
  for (const d of days.filter((x) => x.day.startsWith(month))) {
    total.cost_usd += d.cost_usd;
    total.answers += d.answers;
    total.passed_to_team += d.passed_to_team;
    total.bug_reviews += d.bug_reviews ?? 0;
    total.moderated += d.moderated;
    for (const [m, n] of Object.entries(d.models)) total.models[m] = (total.models[m] ?? 0) + n;
  }
  total.cost_usd = round(total.cost_usd);
  return { daily_budget_usd: AI.dailyUsd, enabled, on: store.on, mode: AI.mode, bugs: bugsEnabled, moderation: modEnabled && store.modOn, today: today(now), days, month: total };
}

// The route, behind a bearer token (KIRA_USAGE_TOKEN; 1Password "Kira usage token"). No token set, no route. Failed
// attempts count in the "auth" rate limit, like the admin routes.
export function usageRoutes({ token = process.env.KIRA_USAGE_TOKEN?.trim(), limiter, now = Date.now } = {}) {
  if (!token || token.length < 32) return {};
  const want = createHash('sha256').update(token).digest();
  const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  return {
    'GET /ai-usage': (req, res) => {
      const auth = String(req.headers.authorization ?? '');
      const got = createHash('sha256').update(auth.startsWith('Bearer ') ? auth.slice(7).trim() : '').digest();
      if (!timingSafeEqual(got, want)) {
        const limited = !limiter.take(clientIp(req), 'auth');
        return send(res, limited ? 429 : 401, { error: limited ? 'too many attempts' : 'unauthorized' });
      }
      return send(res, 200, usage(now()));
    },
  };
}

const statusText = () => {
  const d = store.days[today()] ?? { answers: 0, passed_to_team: 0 };
  return [
    `AI answers: **${!enabled ? 'unavailable' : store.on ? 'on' : 'off'}** (KIRA_AI=${AI.mode ?? 'unset'}${KEY ? '' : ', no ANTHROPIC_API_KEY'})`,
    `Today: $${spentToday().toFixed(2)} of $${AI.dailyUsd}, ${d.answers} answered, ${d.passed_to_team} passed to the team`,
    `Bug reports read before filing: ${bugsEnabled ? `on, ${d.bug_reviews ?? 0} today` : 'off (KIRA_AI_BUGS)'}`,
    `Moderation in every language: ${!modEnabled ? 'off (KIRA_AI_MOD)' : store.modOn ? `on, ${d.moderated ?? 0} messages read today` : 'off (/kira-ai mod on)'}`,
    `Waiting for the team: ${openHandoffs().length} · sources ${sources.ready() ? 'loaded' : 'not loaded yet'}`,
  ].join('\n');
};

export const commands = [
  new SlashCommandBuilder().setName('kira-ai').setDescription("Kira's AI answers: turn them off or on, or see today's use (Ludovic and the mods)")
    .setDefaultMemberPermissions(P.ManageMessages)
    .addStringOption((o) => o.setName('action').setDescription('status, off or on (all of it), mod off or mod on (moderation only)').setRequired(true)
      .addChoices({ name: 'status', value: 'status' }, { name: 'off', value: 'off' }, { name: 'on', value: 'on' }, { name: 'mod off', value: 'mod-off' }, { name: 'mod on', value: 'mod-on' })),
];

export const handlers = {
  async 'kira-ai'(i) {
    const reply = (content) => i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    if (i.user.id !== OWNER_ID && !isStaff(i.member)) return reply('Only Ludovic and the mods can do this.');
    const action = i.options.getString('action');
    if (action === 'mod-on' || action === 'mod-off') {
      store.modOn = action === 'mod-on';
      save();
      await modlog(`🤖 Kira's AI moderation turned ${store.modOn ? 'on' : 'off'}`, `by <@${i.user.id}>`);
    } else if (action !== 'status') {
      store.on = action === 'on';
      save();
      await modlog(`🤖 Kira's AI answers turned ${action}`, `by <@${i.user.id}>`);
    }
    return reply(statusText());
  },
};

export function setup() {
  console.log(`kira ai bug reports: ${bugsEnabled ? 'read before filing' : 'off'}`);
  console.log(`kira ai moderation: ${modEnabled ? (store.modOn ? 'on' : 'off (/kira-ai mod on)') : 'off'}`);
  console.log(`kira ai: ${enabled ? `${store.on ? 'on' : 'off (/kira-ai)'}, ${AI.mode}, $${AI.dailyUsd} a day` : `off (${AI.mode ? 'no ANTHROPIC_API_KEY' : 'KIRA_AI is not set'})`}`);
  if (enabled) client.once('clientReady', () => sources.refresh().catch((e) => console.error('kira ai sources', e.message)));
}

// A bug report before it's filed (src/features/github.js): the checked draft (ai-kit's checkBugDraft), or null when
// the model isn't used (KIRA_AI_BUGS unset, /kira-ai off, the day's budget spent, an API error): the report is then
// filed as it is, as before. `report`: { title, text, files, candidates, url }.
export async function reviewBug(report) {
  if (!reviewer || !store.on || spentToday() >= AI.dailyUsd) return null;
  let r;
  try {
    r = await reviewer(report);
  } catch (e) {
    console.error('kira ai bug review', e.status ?? '', e.message);
    return null;
  }
  record({ kind: 'bug', cost: r.cost, models: [r.model] });
  save();
  const d = r.draft;
  const outcome = !d ? `filed as it is (${r.reason ?? 'no draft'})` : d.match?.same ? `same as #${d.match.number}` : d.match ? `maybe #${d.match.number}: asking the reporter` : 'new issue';
  await modlog('🤖 Kira read a bug report', `[The post](${report.url}) · ${outcome}`, 0x5865f2, [
    ...(d ? [{ name: 'Title', value: clip(d.title, 200) }] : []),
    ...(d?.missing.length ? [{ name: 'Asked for', value: d.missing.join(', ') }] : []),
    { name: 'Candidates', value: report.candidates?.length ? report.candidates.map((c) => `#${c.number}`).join(' ') : 'none' },
    { name: 'Model', value: r.model, inline: true },
    { name: 'Tokens', value: `in ${r.input} · out ${r.output}`, inline: true },
    { name: 'Cost', value: `$${r.cost.toFixed(4)} (today $${spentToday().toFixed(2)} of $${AI.dailyUsd})`, inline: true },
  ]).catch(() => {});
  return d;
}

// Moderation in every language: true when a batch would be read now (on, budget left, no recent API error).
export const modActive = (now = Date.now()) => !!moderator && store.on && store.modOn && now >= modPausedUntil && spentToday(now) < AI.dailyUsd;

// A batch of messages read for moderation (src/features/moderation.js): [{ author, channel, text }] → the model's
// checked results in batch order, with what the call cost; null when the check doesn't run or can't be trusted (off,
// budget spent, an API error, output that fails checkModeration): then nothing happens and the filters alone apply.
export async function moderateBatch(batch) {
  if (!batch.length || !modActive()) return null;
  let r;
  try {
    r = await moderator(batch);
  } catch (e) {
    modPausedUntil = Date.now() + AI.modPauseMs;
    console.error('kira ai moderation', e.status ?? '', e.message);
    return null;
  }
  record({ kind: 'mod', count: batch.length, cost: r.cost, models: [r.model] });
  save();
  if (!r.results) { console.error('kira ai moderation: output not used,', r.reason); return null; }
  return r;
}

export const _test = {
  store, limits, seen,
  set: (o) => {
    if (o.sources) sources = o.sources; if (o.answer) answer = o.answer; if (o.gameAnswer) gameAnswer = o.gameAnswer; if (o.reviewer !== undefined) reviewer = o.reviewer;
    if (o.moderator !== undefined) moderator = o.moderator; if (o.modPausedUntil !== undefined) modPausedUntil = o.modPausedUntil;
  },
};
