// Kira answers on her own (src/ai.js asks the model): a message that mentions Kira or replies to her gets one answer,
// from Horizon's FAQ, docs and release notes only. Off unless KIRA_AI is set and ANTHROPIC_API_KEY exists; `/kira-ai off`
// stops it at once. Limits: AI.perMemberHour questions per member, AI.dailyUsd dollars a day (UTC), counted from each
// response's usage. Every answer is logged in #mod-log (the question, the model, tokens, cost). A question Kira can't
// answer is passed to the team: she says so, and it is kept in state.kiraAi.handoffs for the orchestrator.
import Anthropic from '@anthropic-ai/sdk';
import { SlashCommandBuilder, PermissionFlagsBits as P, MessageFlags } from 'discord.js';
import { AI, GUILD_ID, OWNER_ID } from '../config.js';
import { client, state, save, isStaff, modlog, clip } from '../core.js';
import { makeGitHub } from '../github.js';
import { rateLimiter } from '../agents.js';
import { parseVerb } from '../hub.js';
import * as ai from '../ai.js';
import * as kit from '../ai-kit.js';

const KEY = !!process.env.ANTHROPIC_API_KEY?.trim();
export const enabled = !!AI.mode && KEY;
const store = (state.kiraAi ??= {});
store.on ??= true; // /kira-ai on|off
store.days ??= {}; // 'YYYY-MM-DD' → { cost_usd, answers, passed_to_team, models: { model: calls } }
store.handoffs ??= []; // [{ id, url, channel, author, question, reason, at, done }]

let sources = ai.makeSources({ gh: makeGitHub({ token: process.env.GITHUB_TOKEN?.trim() }) });
let answer = enabled ? ai.makeAnswerer({ client: new Anthropic({ maxRetries: 2, timeout: 60_000 }), sources }) : null;
const limits = rateLimiter({ ask: [AI.perMemberHour, 3_600_000], notice: [1, 3_600_000] });
const seen = new Set(); // messages answered or being answered: one answer each

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export const spentToday = (now) => store.days[today(now)]?.cost_usd ?? 0;

// One answer's usage, in the day's totals (GET /ai-usage reads them).
export function record(r, now = Date.now()) {
  const d = (store.days[today(now)] ??= { cost_usd: 0, answers: 0, passed_to_team: 0, models: {} });
  d.cost_usd += r.cost ?? 0;
  if (r.status === 'answer') d.answers++;
  else d.passed_to_team++;
  for (const m of r.models ?? []) d.models[m] = (d.models[m] ?? 0) + 1;
  for (const k of Object.keys(store.days).sort().slice(0, -AI.daysKept)) delete store.days[k];
}

const name = (m) => m.member?.displayName ?? m.author?.globalName ?? m.author?.username ?? 'someone';
const channelName = (msg) => msg.channel?.name ?? 'unknown';
const forumThread = (msg) => ['horizonbugs', 'horizonideas'].some((k) => state.channels[k] && msg.channel?.parentId === state.channels[k]);
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
  else if (!(await sources.refresh())) r = { status: 'pass', reply: kit.PASSED, reason: 'sources not loaded', models: [], cost: 0 };
  else {
    msg.channel?.sendTyping?.().catch(() => {});
    r = await answer({ author: name(msg), channel: channelName(msg), text, context: await contextOf(msg) });
  }
  record(r);
  if (r.status !== 'answer') handoff(msg, text, r.reason ?? 'not in the sources');
  save();
  await send(r.reply).catch((e) => console.error('kira ai reply', e.message));
  await logAnswer(msg, text, r);
}

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
  await respond(msg, text).catch((e) => console.error('kira ai', e));
  return true;
}

const statusText = () => {
  const d = store.days[today()] ?? { answers: 0, passed_to_team: 0 };
  return [
    `AI answers: **${!enabled ? 'unavailable' : store.on ? 'on' : 'off'}** (KIRA_AI=${AI.mode ?? 'unset'}${KEY ? '' : ', no ANTHROPIC_API_KEY'})`,
    `Today: $${spentToday().toFixed(2)} of $${AI.dailyUsd}, ${d.answers} answered, ${d.passed_to_team} passed to the team`,
    `Waiting for the team: ${openHandoffs().length} · sources ${sources.ready() ? 'loaded' : 'not loaded yet'}`,
  ].join('\n');
};

export const commands = [
  new SlashCommandBuilder().setName('kira-ai').setDescription("Kira's AI answers: turn them off or on, or see today's use (Ludovic and the mods)")
    .setDefaultMemberPermissions(P.ManageMessages)
    .addStringOption((o) => o.setName('action').setDescription('status, off or on').setRequired(true)
      .addChoices({ name: 'status', value: 'status' }, { name: 'off', value: 'off' }, { name: 'on', value: 'on' })),
];

export const handlers = {
  async 'kira-ai'(i) {
    const reply = (content) => i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    if (i.user.id !== OWNER_ID && !isStaff(i.member)) return reply('Only Ludovic and the mods can do this.');
    const action = i.options.getString('action');
    if (action !== 'status') {
      store.on = action === 'on';
      save();
      await modlog(`🤖 Kira's AI answers turned ${action}`, `by <@${i.user.id}>`);
    }
    return reply(statusText());
  },
};

export function setup() {
  console.log(`kira ai: ${enabled ? `${store.on ? 'on' : 'off (/kira-ai)'}, ${AI.mode}, $${AI.dailyUsd} a day` : `off (${AI.mode ? 'no ANTHROPIC_API_KEY' : 'KIRA_AI is not set'})`}`);
  if (enabled) client.once('clientReady', () => sources.refresh().catch((e) => console.error('kira ai sources', e.message)));
}

export const _test = { store, limits, seen, set: (o) => { if (o.sources) sources = o.sources; if (o.answer) answer = o.answer; } };
