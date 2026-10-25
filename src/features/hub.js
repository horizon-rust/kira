// Kira as the hub's front desk on Discord: the verbs the site has (report, suggest, roadmap, claim, status), as
// slash commands and as "@Kira <verb>"; the suggestion queue (#roadmap-suggestions, private, its ID in
// ROADMAP_SUGGESTIONS_CHANNEL_ID); and #horizon-ideas, whose posts go to that queue instead of GitHub.
// Bugs: /report makes a post in #horizon-bugs in the member's name and sends it to GitHub like any other post,
// so the answer comes back in that post.
import {
  SlashCommandBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { HUB, GITHUB, GUILD_ID, WORK } from '../config.js';
import { client, state, save, channel } from '../core.js';
import { rateLimiter } from '../agents.js';
import * as hub from '../hub.js';
import * as board from '../board.js';
import { cardLine } from '../workkit.js';
import { isOwnPost } from '../adopt.js';
import * as wb from './workboard.js';
import * as github from './github.js';
import { onTemplateOk } from './forums.js';

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const nameOf = (member, user) => member?.displayName ?? user.globalName ?? user.username;
const limits = rateLimiter({ suggest: [HUB.suggestPerHour, 3_600_000], report: [HUB.reportPerHour, 3_600_000] });
state.suggestions ??= {}; // #horizon-ideas posts already in the queue: thread id → the queue message id

// ── The roadmap, as the website publishes it ────────────────────────────────

let cached = { at: 0, data: null };
let fetchJson = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'Kira (Horizon Discord bot)' }, signal: AbortSignal.timeout(10_000) });
  return res.ok ? res.json() : null;
};
// The last good roadmap, fetched again at most every HUB.cacheMs (a failure keeps the old one).
export async function roadmap(now = Date.now()) {
  if (now - cached.at < HUB.cacheMs) return cached.data;
  cached.at = now;
  try {
    const data = await fetchJson(HUB.roadmapJson);
    if (hub.isRoadmap(data)) cached.data = data;
  } catch (e) {
    console.error('roadmap', e.message);
  }
  return cached.data;
}

// ── The suggestion queue ─────────────────────────────────────────────────────

// Posts a suggestion in #roadmap-suggestions. null when the queue is off or unreachable.
export async function queue({ text, userId, who, source, link }) {
  if (!HUB.suggestionsChannel) return null;
  const ch = await client.channels.fetch(HUB.suggestionsChannel).catch(() => null);
  if (!ch?.isTextBased?.()) { console.error('suggestions: no channel', HUB.suggestionsChannel); return null; }
  return ch.send(hub.suggestionPost({ text, who, whoId: userId, source, link }));
}

export async function suggest(user, member, text, source, link) {
  const idea = String(text ?? '').trim();
  if (idea.length < 10) return 'Tell me the idea in a sentence or two: `/suggest` or `@Kira suggest <your idea>`.';
  if (!HUB.suggestionsChannel) return `The suggestion queue is closed for now. What's planned is on the roadmap: <${HUB.url}>`;
  if (!limits.take(user.id, 'suggest')) return `That's ${HUB.suggestPerHour} suggestions this hour: send the next one later.`;
  const msg = await queue({ text: idea, userId: user.id, who: nameOf(member, user), source, link }).catch((e) => { console.error('suggest', e.message); return null; });
  if (!msg) return 'I could not reach the suggestion queue: try again in a while.';
  return `💡 Thanks! Your suggestion is in the queue the maintainers read. Good ones become items on the roadmap (<${HUB.url}>); nothing is published by itself.`;
}

// A #horizon-ideas post that follows the template: into the queue (once), and Kira says so in the post.
async function ideaPost(thread, starter) {
  if (thread.guildId !== GUILD_ID || thread.parentId !== state.channels.horizonideas || isOwnPost(thread, client.user?.id)) return;
  if (!HUB.suggestionsChannel || state.suggestions[thread.id]) return;
  const link = `https://discord.com/channels/${GUILD_ID}/${thread.id}`;
  const msg = await queue({ text: `**${thread.name}**\n${starter.content}`, userId: starter.author.id, who: nameOf(starter.member, starter.author), source: '#horizon-ideas', link });
  if (!msg) return;
  state.suggestions[thread.id] = msg.id;
  save();
  await thread.send({ content: `💡 In the suggestion queue the maintainers read. If it's picked, it becomes an item on the roadmap: <${HUB.url}>. Keep voting 👍 here.`, allowedMentions: { parse: [] } }).catch(() => {});
}

// The hub's own suggestions (its form on playhorizon.dev/hub), kept by the telemetry server: every HUB.relayEveryMs
// Kira reads the new ones (GET /hub/suggestions, bearer HUB_TOKEN) and posts them in the queue, oldest first. The last
// id is saved after each post (state.hubRelay.after), so a failed post is tried again next round. Off without the
// token or the queue; while the endpoint is missing or failing, one log line per change of error, then retries.
const relayState = (state.hubRelay ??= { after: 0 });
let relayProblem = null;
let fetchQueue = async (url, token) => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Kira (Horizon Discord bot)' }, signal: AbortSignal.timeout(15_000) });
  return { status: res.status, body: res.ok ? await res.json() : null };
};

export async function relay() {
  if (!HUB.suggestionsChannel || !HUB.token) return 0;
  const url = `${HUB.intakeUrl}/hub/suggestions?after=${relayState.after}&limit=100`;
  const { status, body } = await fetchQueue(url, HUB.token).catch((e) => ({ status: e.message, body: null }));
  const list = Array.isArray(body?.suggestions) ? body.suggestions : null;
  if (!list) {
    if (relayProblem !== status) console.error(`hub suggestions: ${status}, trying again every ${HUB.relayEveryMs / 60_000} min`);
    relayProblem = status;
    return 0;
  }
  relayProblem = null;
  let n = 0;
  for (const s of list) {
    const id = Number(s?.id);
    if (!Number.isSafeInteger(id) || id <= relayState.after) continue;
    const item = typeof s.item === 'string' && /^[a-z0-9-]{1,60}$/.test(s.item) ? s.item : null;
    const msg = await queue({
      text: String(s.text ?? ''),
      who: typeof s.name === 'string' && s.name.trim() ? s.name : 'someone on the hub',
      source: item ? `the hub, about \`${item}\`` : 'the hub',
      link: item ? hub.itemUrl(HUB.url, item) : null,
    }).catch((e) => { console.error('hub suggestions', e.message); return null; });
    if (!msg) break;
    relayState.after = id;
    save();
    n++;
  }
  if (n) console.log(`hub suggestions: ${n} relayed`);
  return n;
}

// ── Bug reports ──────────────────────────────────────────────────────────────

export function reportModal() {
  return new ModalBuilder().setCustomId('hub:report').setTitle('Report a Horizon bug').addComponents(hub.REPORT_FIELDS.map((f) => new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setStyle(f.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph).setMaxLength(f.max).setRequired(f.required),
  )));
}
const reportButton = () => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('hub:report').setStyle(ButtonStyle.Primary).setEmoji('🐛').setLabel('Report a bug'));

// The form's answers → a post in #horizon-bugs (Kira's, in the member's name) → a GitHub issue they own.
async function submitReport(i) {
  if (!limits.take(i.user.id, 'report')) return i.reply(ephemeral(`That's ${HUB.reportPerHour} reports this hour: add more details in your earlier posts, or report again later.`));
  const forum = channel('horizonbugs');
  if (!forum) return i.reply(ephemeral('The bugs forum is not set up yet.'));
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const fields = Object.fromEntries(hub.REPORT_FIELDS.map((f) => [f.id, i.fields.getTextInputValue(f.id) ?? '']));
  const text = hub.reportBody(fields);
  const tag = forum.availableTags?.find((t) => t.name === 'via /report');
  const title = fields.title.replace(/\s+/g, ' ').trim().slice(0, 100) || 'Bug report';
  const thread = await forum.threads.create({
    name: title,
    message: { content: `Reported by <@${i.user.id}> with /report.\n\n${text}`, allowedMentions: { parse: [] } },
    appliedTags: tag ? [tag.id] : [],
  });
  const entry = github.enabled ? await github.reportIssue(thread, { authorId: i.user.id, author: nameOf(i.member, i.user), text }).catch((e) => { console.error('report', e.message); return null; }) : null;
  return i.editReply(ephemeral(`🐛 Thanks! Your report is ${thread.url}${entry ? ` and GitHub issue #${entry.number}` : ''}. Add a screenshot, a video or the log file in the post; you'll be pinged there when it's answered.`));
}

// ── Status ───────────────────────────────────────────────────────────────────

const issueUrl = (n) => `https://github.com/${GITHUB.owner}/${WORK.repo}/issues/${n}`;
const columnName = (key) => board.COLUMNS.find((c) => c.key === key)?.name ?? key;

// `of`: an issue or pull request ("#123"), or a roadmap item's id. Without it: the member's own status, claims
// and reports.
export async function statusText(userId, of) {
  const what = String(of ?? '').trim();
  if (what) {
    const ref = board.parseRef(what);
    if (ref) {
      const card = wb.current() && board.find(wb.current(), ref);
      return card ? `**${columnName(card.column)}**: ${cardLine(card)}` : `#${ref.number} isn't on the board (open issues and pull requests, and what closed this week): <${issueUrl(ref.number)}>`;
    }
    return hub.itemText(await roadmap(), HUB.url, what) ?? `No issue, pull request or roadmap item called "${hub.plainText(what, 40)}". The roadmap: <${HUB.url}>`;
  }
  const work = wb.workState();
  const mine = work.statuses?.[userId];
  const claims = Object.entries(work.claims).filter(([, c]) => c.user === userId);
  const reports = github.reportsOf(userId).slice(0, 8);
  const lines = [
    mine ? `📍 You're on: ${hub.plainText(mine.text, 200)} (\`/status text:\` changes it, \`/status clear:True\` clears it)` : '📍 No status set: `/status text:<what you are on>`.',
    claims.length ? `🔨 Your claims: ${claims.map(([n, c]) => `[#${n}](<${c.url ?? issueUrl(n)}>)`).join(', ')}` : '🔨 No claimed issues.',
    reports.length ? `🐛 Your reports:\n${reports.map((r) => `• <#${r.thread}> → #${r.number} · ${r.state === 'closed' ? 'closed' : 'open'}`).join('\n')}` : '🐛 No reports sent to GitHub.',
  ];
  return lines.join('\n').slice(0, 1990);
}

// ── "@Kira <verb>" ───────────────────────────────────────────────────────────

const reply = (msg, payload) => msg.reply({ allowedMentions: { parse: [], repliedUser: false }, ...(typeof payload === 'string' ? { content: payload } : payload) }).catch(() => {});

// The roadmap is several messages: the first is the reply, the others follow it in the same channel.
async function replyAll(msg, payloads) {
  const [first, ...rest] = payloads;
  await reply(msg, { ...first, allowedMentions: { parse: [], repliedUser: false } });
  for (const p of rest) await msg.channel.send({ ...p, allowedMentions: { parse: [] } }).catch((e) => console.error('roadmap', e.message));
}

export async function onMessage(msg) {
  const parsed = client.user && hub.parseVerb(msg.content, client.user.id);
  if (!parsed) return false;
  const { verb, rest } = parsed;
  if (verb === 'roadmap') await replyAll(msg, hub.roadmapMessages(await roadmap(), HUB.url, rest));
  else if (verb === 'suggest') await reply(msg, await suggest(msg.author, msg.member, rest, 'Discord, @Kira suggest', msg.url));
  else if (verb === 'report') await reply(msg, { content: 'Click to fill in the bug form (it becomes a post in #horizon-bugs and a GitHub issue):', components: [reportButton()] });
  else if (verb === 'claim') {
    const n = board.parseRef(rest);
    if (!wb.enabled) await reply(msg, 'Claims are off right now.');
    else if (!n || n.kind === 'card') await reply(msg, 'Which issue? `@Kira claim 123`.');
    else await reply(msg, await wb.claim(msg.author, msg.member, n.number));
  } else if (verb === 'status') await reply(msg, await statusText(msg.author.id, rest));
  else await reply(msg, hub.helpText(HUB.url));
  return true;
}

// ── Commands ─────────────────────────────────────────────────────────────────

export const commands = [
  new SlashCommandBuilder().setName('roadmap').setDescription('The whole roadmap, or one area in full: what is being built, what is next, how to help')
    .addStringOption((o) => o.setName('area').setDescription('One area in full: performance, modpacks, servers, mods…').setMaxLength(40)),
  new SlashCommandBuilder().setName('suggest').setDescription('Suggest something for Horizon: it goes to the queue the maintainers read')
    .addStringOption((o) => o.setName('idea').setDescription('Your idea, and why').setRequired(true).setMinLength(10).setMaxLength(1000)),
  new SlashCommandBuilder().setName('report').setDescription('Report a Horizon bug: a form, then a post in #horizon-bugs and a GitHub issue'),
  new SlashCommandBuilder().setName('status').setDescription('Your claims and reports, an issue or roadmap item, or say what you are on')
    .addStringOption((o) => o.setName('of').setDescription('An issue or pull request (#123) or a roadmap item').setMaxLength(60))
    .addStringOption((o) => o.setName('text').setDescription('Set what you are on right now (agents and /working show it)').setMaxLength(200))
    .addBooleanOption((o) => o.setName('clear').setDescription('Clear what you are on')),
];

export const handlers = {
  async roadmap(i) {
    await i.deferReply();
    const [first, ...rest] = hub.roadmapMessages(await roadmap(), HUB.url, i.options.getString('area') ?? '');
    await i.editReply(first);
    for (const p of rest) await i.followUp({ ...p, allowedMentions: { parse: [] } }).catch((e) => console.error('roadmap', e.message));
  },
  async suggest(i) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const link = `https://discord.com/channels/${GUILD_ID}/${i.channelId}`;
    return i.editReply(ephemeral(await suggest(i.user, i.member, i.options.getString('idea'), 'Discord, /suggest', link)));
  },
  report: (i) => i.showModal(reportModal()),
  async status(i) {
    const text = i.options.getString('text')?.trim();
    const work = wb.workState();
    if (text || i.options.getBoolean('clear')) {
      work.statuses ??= {};
      if (text) work.statuses[i.user.id] = { text, at: Date.now() };
      else delete work.statuses[i.user.id];
      save();
      return i.reply(ephemeral(text ? `📍 Status set: ${hub.plainText(text, 200)}` : 'Status cleared.'));
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    return i.editReply(ephemeral(await statusText(i.user.id, i.options.getString('of'))));
  },
};

export const _test = { setFetch: (fn) => { fetchJson = fn; cached = { at: 0, data: null }; }, setQueueFetch: (fn) => { fetchQueue = fn; }, relayState, ideaPost, submitReport, limits };

export function setup() {
  console.log(`hub: ${HUB.url}, suggestion queue ${HUB.suggestionsChannel ? 'on' : 'off (ROADMAP_SUGGESTIONS_CHANNEL_ID is not set)'}`);
  const relaying = HUB.suggestionsChannel && HUB.token;
  console.log(`hub suggestions from the site: ${relaying ? `on (${HUB.intakeUrl})` : 'off (needs HUB_TOKEN and the queue)'}`);
  if (relaying) {
    client.once('clientReady', () => {
      const run = () => relay().catch((e) => console.error('hub suggestions', e.message));
      setTimeout(run, 30_000).unref?.();
      setInterval(run, HUB.relayEveryMs).unref?.();
    });
  }
  onTemplateOk((thread, starter) => ideaPost(thread, starter));
  client.on('interactionCreate', async (i) => {
    if (i.guildId !== GUILD_ID) return;
    try {
      if (i.isButton() && i.customId === 'hub:report') await i.showModal(reportModal());
      else if (i.isModalSubmit() && i.customId === 'hub:report') await submitReport(i);
    } catch (e) {
      console.error('report', e);
      const answer = ephemeral(`Something went wrong: ${e.message}`.slice(0, 300));
      await (i.deferred || i.replied ? i.editReply(answer) : i.reply(answer)).catch(() => {});
    }
  });
}
