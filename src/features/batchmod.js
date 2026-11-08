// Batch moderation, the Discord side (the rules are src/batch-kit.js, the model call src/ai.js makeBatchModerator).
// pointofpressure's proposal of 2026-11-08; Ludovic's decision the same day: two steps.
//
// Step 1 (KIRA_BATCH=on): every public channel is read in windows (its new messages, ~50 earlier ones for context, and
// a per-user summary of the other channels), one model call per window. Each incident is a flag in #mod-chat with
// Confirm / Dismiss / Change action, and a numbered case (action "flag") holding its evidence: the messages' text
// saved when the case opened, jump links, context, attachment names and hashes. A mod's Confirm does the action as
// that mod (a case of its own in #mod-actions, pointing back). Below BATCH.flagFrom an incident is only a note in the
// member's history. A CSAM suspicion alerts the mods and the Team with ids and times only (nothing stored or
// reposted). Kira acts on nothing herself. While this is on, the per-message check (moderation.js) no longer flags:
// it only removes its clear cases, as before.
//
// Step 2 (KIRA_BATCH_AUTO=1, off): at ≥ BATCH.autoFrom, for spam, scams and raids only, Kira deletes the messages and
// times out (the ladder) or quarantines. Never a ban, never staff or the Team, never messages older than 24 h.
// `undo case #N` reverses it; a category with too many overturns in a week falls back to flags (/kira-batch restore).
//
// The image lane (with the batch lane; KIRA_BATCH_IMAGES=off stops it): each image posted where the lane reads gets one
// Haiku vision call as it arrives, downscaled by Discord's media proxy (src/image-kit.js). CSAM at high confidence: the
// message deleted at once, the author quarantined, an alert with ids, times and a jump link only (the one thing Kira
// does by herself now). Sexual/gore and scam images are flags with the same buttons. Nothing of a CSAM image is kept.
import { createHash } from 'node:crypto';
import {
  SlashCommandBuilder, PermissionFlagsBits as P, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelType,
} from 'discord.js';
import { BATCH, GUILD_ID, LAYOUT, OWNER_ID } from '../config.js';
import { client, state, save, channel, isStaff, clip, human, parseDuration, quietDeletes } from '../core.js';
import * as kit from '../batch-kit.js';
import * as imageKit from '../image-kit.js';
import * as mk from '../modcase-kit.js';
import * as kiraAi from './ai.js';
import { expect, quarantine, unquarantine } from './modcases.js';

const store = (state.batchMod ??= {});
store.lastRead ??= {}; // channelId → the last message id read (to catch up after a restart)
store.notes ??= {}; // userId → times of incidents below the flag line (their history, no ping)
store.fallback ??= {}; // category → when it fell back to flags (step 2), until a mod restores it
const mc = () => (state.modcases = mk.blank(state.modcases ?? {}));
const DAY = 86_400_000;
const PREFIX = 'bmod:';
const book = kit.windows(BATCH);
const acts = kit.activity(BATCH);
const closing = new Set();
const toppedUp = new Set();
const deciding = new Set();
const ephemeral = (content, extra = {}) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }, ...extra });
const guild = () => client.guilds.cache.get(GUILD_ID);

// While the batch lane flags, the per-message check doesn't (src/features/moderation.js aiAct).
export const flagsByBatch = () => BATCH.mode === 'on' && kiraAi.batchEnabled;

// ── Which channels ──────────────────────────────────────────────────────────

const EXCLUDED = new Set([
  ...BATCH.excluded,
  ...LAYOUT.filter((g) => g.staff).flatMap((g) => [g.key, ...g.channels.map((c) => c.key)]),
  ...LAYOUT.flatMap((g) => g.channels).filter((c) => c.staff || c.members).map((c) => c.key),
]);
const eligibleCache = new Map(); // channelId → { ok, at }
export function eligible(ch, now = Date.now()) {
  if (!ch || (ch.guildId && ch.guildId !== GUILD_ID)) return false;
  const hit = eligibleCache.get(ch.id);
  if (hit && now - hit.at < 10 * 60_000) return hit.ok;
  let ok = true;
  const base = ch.isThread?.() ? ch.parent : ch;
  if (ch.type === ChannelType.PrivateThread || !base) ok = false;
  else {
    const ids = [base.id, base.parentId].filter(Boolean);
    for (const k of EXCLUDED) { const id = state.channels[k] ?? state.ownChannels?.[k]; if (id && ids.includes(id)) ok = false; }
    const everyone = base.guild?.roles?.everyone;
    const perms = everyone && base.permissionsFor?.(everyone);
    if (ok && perms && !perms.has(P.ViewChannel)) ok = false; // staff channels, tickets, team rooms
  }
  eligibleCache.set(ch.id, { ok, at: now });
  return ok;
}

// ── Reading ─────────────────────────────────────────────────────────────────

const exemptMember = (m, user) => !!user?.bot || user?.id === OWNER_ID || kiraAi.isTeam(m);
function snap(msg) {
  const text = String(msg.content ?? '').replace(/<@!?(\d+)>/g, (_, id) => `@${msg.mentions?.users?.get?.(id)?.username ?? 'someone'}`)
    + (msg.stickers?.size ? ` [sticker: ${[...msg.stickers.values()].map((s) => s.name).join(', ')}]` : '');
  return {
    id: msg.id, channelId: msg.channelId, userId: msg.author.id,
    name: msg.member?.displayName ?? msg.author.globalName ?? msg.author.username ?? 'someone',
    tag: msg.author.tag ?? msg.author.username ?? null,
    at: msg.createdTimestamp ?? Date.now(), text,
    files: [...(msg.attachments?.values?.() ?? [])].map((a) => ({
      name: a.name ?? 'file', url: a.url, size: a.size ?? 0, type: a.contentType ?? null,
      proxyUrl: a.proxyURL ?? null, width: a.width ?? null, height: a.height ?? null,
    })),
    reply: msg.reference?.messageId ?? null, url: msg.url,
    accountAt: msg.author.createdTimestamp ?? null, joinedAt: msg.member?.joinedTimestamp ?? null,
    exempt: exemptMember(msg.member, msg.author),
  };
}

// Every guild message the filters let through (src/bot.js). Returns true when it was an `undo case #N`.
export async function onMessage(msg) {
  if (BATCH.mode === 'off' || msg.guildId !== GUILD_ID) return false;
  const n = isStaff(msg.member) && staffChannel(msg.channelId) ? kit.parseUndo(msg.content) : null;
  if (n) { await msg.reply({ content: await undo(n, msg.author.id), allowedMentions: { parse: [] } }).catch(() => {}); return true; }
  observe(msg);
  return false;
}
const staffChannel = (id) => ['modchat', 'modlog', 'modactions'].some((k) => (state.channels[k] ?? state.ownChannels?.[k]) === id);

export function observe(msg, now = Date.now()) {
  if (BATCH.mode === 'off' || !eligible(msg.channel, now)) return;
  const s = snap(msg);
  acts.add(s, msg.channel?.name ?? 'unknown', now);
  queueImages(s);
  if (book.add(s, now)) closeWindow(msg.channelId).catch((e) => console.error('batch window', e));
}
export const drop = (id) => { // a filter removed it
  book.drop(id);
  const i = imageQueue.findIndex((x) => x.snap.id === id);
  if (i >= 0) imageQueue.splice(i, 1);
};
export const edit = (id, text) => book.edit(id, text);

const newer = (a, b) => BigInt(a) > BigInt(b);
// After a restart the ring is short: the earlier messages come from Discord once per channel, and those not read yet
// (newer than the last one read, under 2 hours old) join the new ones.
async function topUp(channelId, w, now = Date.now()) {
  if (toppedUp.has(channelId) || w.context.length >= BATCH.contextMessages) return;
  toppedUp.add(channelId);
  const ch = client.channels.cache.get(channelId);
  const got = await ch?.messages?.fetch({ before: (w.context[0] ?? w.fresh[0]).id, limit: Math.min(100, BATCH.contextMessages - w.context.length + 50) }).catch(() => null);
  if (!got?.size) return;
  const list = [...got.values()].filter((m) => !m.author?.bot).sort((a, b) => (newer(a.id, b.id) ? 1 : -1)).map(snap);
  const last = store.lastRead[channelId];
  const unread = last ? list.filter((s) => newer(s.id, last) && now - s.at < 2 * 3_600_000) : [];
  const earlier = list.filter((s) => !unread.includes(s)).slice(-(BATCH.contextMessages - w.context.length));
  w.context.unshift(...earlier);
  w.fresh.unshift(...unread);
}

function userInfo(s, channelId, now = Date.now()) {
  const cutoff = now - 30 * DAY;
  return {
    name: s.name, exempt: s.exempt,
    accountMs: s.accountAt ? now - s.accountAt : null, memberMs: s.joinedAt ? now - s.joinedAt : null,
    cases: Object.values(mc().cases).filter((c) => c.userId === s.userId && c.at >= cutoff && (c.action !== 'flag' || ['confirmed', 'changed'].includes(c.batch?.decision?.kind) || c.batch?.auto)).length,
    notes: (store.notes[s.userId] ?? []).filter((t) => t >= cutoff).length,
    elsewhere: s.exempt ? {} : acts.elsewhere(s.userId, channelId, now),
  };
}

export async function closeWindow(channelId) {
  if (closing.has(channelId)) return null;
  closing.add(channelId);
  try {
    const w = book.take(channelId);
    if (!w) return null;
    if (!w.fresh.some((s) => !s.exempt)) { store.lastRead[channelId] = w.fresh.at(-1).id; return null; } // staff only: nothing to judge
    await topUp(channelId, w);
    const ch = client.channels.cache.get(channelId);
    const users = new Map();
    for (const s of [...w.context, ...w.fresh]) {
      if (users.has(s.userId)) continue;
      const m = guild()?.members.cache.get(s.userId); // a message fetched after a restart may lack its member
      if (m && exemptMember(m, m.user)) s.exempt = true;
      users.set(s.userId, userInfo(s, channelId));
    }
    const name = ch?.name ?? 'unknown';
    const r = await kiraAi.moderateWindow({ channel: name, topic: ch?.topic ?? ch?.parent?.topic ?? '', context: w.context, fresh: w.fresh, users }, { exempt: (id) => !!users.get(id)?.exempt });
    store.lastRead[channelId] = w.fresh.at(-1).id;
    save();
    if (!r) return null;
    const meta = { channelId, window: { fresh: w.fresh.length, context: w.context.length }, model: r.model };
    const routes = r.incidents.map((inc) => kit.route(inc, BATCH, { fallback: store.fallback }));
    console.log(`batch${BATCH.mode === 'dry' ? ' (dry run)' : ''}: #${name} ${w.fresh.length} new + ${w.context.length} earlier → ${r.incidents.length ? r.incidents.map((inc, i) => `${routes[i]} ${inc.category} ${inc.confidence}`).join(', ') : 'nothing'}${r.dropped?.length ? ` (dropped: ${r.dropped.join(', ')})` : ''}, $${r.cost.toFixed(5)}`);
    for (const [i, inc] of r.incidents.entries()) await handle(inc, routes[i], meta).catch((e) => console.error('batch incident', e));
    return { ...r, routes };
  } finally {
    closing.delete(channelId);
  }
}

// ── Images ──────────────────────────────────────────────────────────────────

const imageQueue = []; // [{ snap, files }], one entry per message
let imageRunning = 0;
function queueImages(s) {
  if (!kiraAi.imagesEnabled || s.exempt) return;
  const files = imageKit.images(s.files, BATCH.imagesPerMessage);
  if (!files.length) return;
  imageQueue.push({ snap: s, files });
  if (imageQueue.length > BATCH.imageQueueMax) console.error(`image lane: ${imageQueue.splice(0, imageQueue.length - BATCH.imageQueueMax).length} messages dropped unread (queue full)`);
  pumpImages();
}
function pumpImages() {
  while (imageRunning < BATCH.imageConcurrency && imageQueue.length) {
    const item = imageQueue.shift();
    imageRunning++;
    readImages(item).catch((e) => console.error('image lane', clip(e.message, 200))).finally(() => { imageRunning--; pumpImages(); });
  }
}
const imagesIdle = async () => { while (imageRunning || imageQueue.length) await new Promise((r) => setTimeout(r, 2)); };

// The downscaled picture as base64, in memory only for the call.
const MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
let fetchImpl = (...a) => fetch(...a);
async function fetchImage(f) {
  const res = await fetchImpl(imageKit.downscaledUrl(f, BATCH.imageMaxSide), { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = String(res.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!MEDIA.has(type)) throw new Error(`type ${type || 'none'}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > BATCH.imageMaxBytes) throw new Error(`${buf.length} bytes`);
  return { data: buf.toString('base64'), mediaType: type };
}

// One message's images, one call each, in order; the first that opens a case ends it (one case per message).
async function readImages({ snap: s, files }) {
  const name = client.channels.cache.get(s.channelId)?.name ?? 'unknown';
  for (const f of files) {
    if (!kiraAi.imageActive()) return;
    let img;
    try {
      img = await fetchImage(f);
    } catch (e) {
      console.error(`image lane: ${s.id} not fetched (${clip(e.message, 80)})`);
      continue;
    }
    const r = await kiraAi.classifyImage({ ...img, name: f.name, text: s.text, channel: name });
    img = null;
    if (!r) continue;
    const v = r.verdict;
    const kind = imageKit.route(v, BATCH);
    // The log names the message, never the file or what the model saw.
    console.log(`image${BATCH.mode === 'dry' ? ' (dry run)' : ''}: #${name} ${s.id} → ${v.category} ${v.confidence}${kind ? ` (${kind})` : ''}, $${r.cost.toFixed(5)}`);
    if (!kind) continue;
    await handle(imageKit.incident(v, s, f), kind, { channelId: s.channelId, window: null, model: r.model });
    if (kind !== 'note') return;
  }
}

async function handle(inc, kind, meta) {
  if (BATCH.mode === 'dry') return console.log(`batch (dry run): would ${kind} ${inc.category} ${inc.confidence} on ${inc.userId}${inc.category === 'csam' ? '' : `: ${clip(inc.reason, 200)}`}`);
  if (kind === 'note') {
    const list = (store.notes[inc.userId] ?? []).filter((t) => Date.now() - t < 30 * DAY);
    list.push(Date.now());
    store.notes[inc.userId] = list;
    save();
    return;
  }
  if (kind === 'csam-auto') return csamImage(inc, meta);
  if (kind === 'csam') return csam(inc, meta);
  if (kind === 'auto') return autoAct(inc, meta);
  return post(await openIncident(inc, meta));
}

// ── Cases ───────────────────────────────────────────────────────────────────

const HASH_MAX = 10 * 1024 * 1024;
async function hashFile(f, get = fetchImpl) {
  if (!f.url) return { hashError: 'no link' };
  if (f.size > HASH_MAX) return { hashError: 'over 10 MB' };
  try {
    const res = await get(f.url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { hashError: `HTTP ${res.status}` };
    return { sha256: createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex') };
  } catch (e) {
    return { hashError: clip(e.message, 60) };
  }
}

// The case and its evidence, saved now (so it survives the messages' deletion). A CSAM case keeps ids and times only.
async function openIncident(inc, meta, { csam = false, auto = false } = {}) {
  const tag = inc.messages[0]?.tag ?? null;
  const keep = async (s, withText, files) => ({
    id: s.id, channelId: s.channelId, url: s.url, at: s.at,
    ...(withText ? { name: s.name, text: clip(s.text, 1000) } : {}),
    ...(files ? { files: await Promise.all((s.files ?? []).slice(0, 5).map(async (f) => ({ name: f.name, size: f.size, ...(await hashFile(f)) }))) } : {}),
  });
  const batch = {
    category: inc.category, rule: inc.rule, confidence: inc.confidence, proposed: inc.proposed,
    reason: csam ? '' : inc.reason, quotes: csam ? [] : inc.quotes, channelId: meta.channelId,
    messages: await Promise.all(inc.messages.map((s) => keep(s, !csam, !csam))),
    context: csam ? [] : await Promise.all(inc.context.map((s) => keep({ ...s, text: clip(s.text, 200) }, true, false))),
    window: meta.window, model: meta.model, auto, decision: null, lane: inc.lane ?? 'text',
  };
  const c = mk.openCase(mc(), { action: 'flag', userId: inc.userId, tag, by: mk.KIRA, reason: csam ? 'possible CSAM (only ids and times are kept)' : `${inc.rule}: ${inc.reason}` });
  c.batch = batch;
  save();
  return c;
}

function view(c) {
  const v = kit.flagView(c);
  const embed = new EmbedBuilder().setColor(v.color).setTitle(v.title).setDescription(v.description).addFields(v.fields).setFooter({ text: v.footer }).setTimestamp(c.at);
  return { embeds: [embed], components: rows(c) };
}

function choiceLabel(choice, userId) {
  if (choice === 'timeout') return `delete + timeout ${human(ladder(userId))}`;
  return kit.ACTION_LABEL[choice] ?? choice;
}
function rows(c) {
  const b = c.batch;
  if (b.auto) return b.undone ? [] : [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}undo:${c.n}`).setStyle(ButtonStyle.Secondary).setEmoji('↩️').setLabel('Undo'))];
  if (b.decision) return [];
  const confirm = b.category === 'csam' ? 'Confirm: delete + quarantine' : `Confirm: ${choiceLabel(kit.asChoice(b.proposed), c.userId)}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}ok:${c.n}`).setStyle(ButtonStyle.Danger).setEmoji('✅').setLabel(clip(confirm, 80)),
    new ButtonBuilder().setCustomId(`${PREFIX}no:${c.n}`).setStyle(ButtonStyle.Secondary).setEmoji('✖️').setLabel('Dismiss'),
  );
  if (b.category !== 'csam') row.addComponents(new ButtonBuilder().setCustomId(`${PREFIX}set:${c.n}`).setStyle(ButtonStyle.Primary).setEmoji('🔧').setLabel('Change action'));
  return [row];
}

async function post(c, { ping = false } = {}) {
  const ch = channel('modchat') ?? channel('modlog');
  const roles = ping ? [state.roles.mod, state.roles.team].filter(Boolean) : [];
  const msg = await ch?.send({ content: roles.length ? roles.map((r) => `<@&${r}>`).join(' ') : undefined, ...view(c), allowedMentions: { parse: [], roles } }).catch((e) => { console.error('batch flag post', e.message); return null; });
  if (msg) { c.url = msg.url; c.messageId = msg.id; c.channelId = msg.channelId; c.evidence = { url: msg.url, label: 'the flag in #mod-chat, with the messages saved' }; save(); }
  return msg;
}
async function refresh(c) {
  if (!c.messageId) return;
  const msg = await client.channels.cache.get(c.channelId)?.messages.fetch(c.messageId).catch(() => null);
  await msg?.edit(view(c)).catch((e) => console.error('batch flag edit', e.message));
}

const ladder = (userId) => kit.ladderMs(BATCH, kit.priorTimeouts(mc().cases, userId, BATCH), parseDuration);

async function deleteMessages(list) {
  let n = 0;
  for (const s of list) {
    const ch = client.channels.cache.get(s.channelId) ?? await client.channels.fetch(s.channelId).catch(() => null);
    quietDeletes.add(s.id); // the case holds them: no "message deleted" line
    if (await ch?.messages?.delete(s.id).then(() => true, () => false)) n++;
    else quietDeletes.delete(s.id);
  }
  return n;
}

// Does `action` ('note', 'delete', 'timeout', 'quarantine') for case c, as `by` (a mod's id, or mk.KIRA). Returns
// { done, error }. Staff and the Horizon Team are never acted on.
async function act(c, action, by) {
  const b = c.batch;
  const done = [];
  let error = null;
  if (action === 'note') return { done: 'noted, nothing done', error };
  const m = await guild()?.members.fetch(c.userId).catch(() => null);
  if (m && exemptMember(m, m.user)) return { done: 'nothing done', error: 'staff or the Horizon Team: Kira never acts on them; handle it by hand' };
  const reason = `case #${c.n} (${b.category}): ${b.rule}`;
  const evidence = { url: c.url, label: `flag case #${c.n}` };
  const link = (ac) => { b.actionCase = ac.n; save(); return []; };
  try {
    const n = await deleteMessages(b.messages);
    done.push(`${n} of ${b.messages.length} message${b.messages.length > 1 ? 's' : ''} deleted`);
    if (action === 'timeout') {
      if (!m) throw new Error('not on the server any more');
      const ms = ladder(c.userId);
      expect(c.userId, 'timeout', { by, reason, evidence, components: link });
      await m.timeout(ms, `${by === mk.KIRA ? 'Kira' : `by ${by}`}: ${reason}`);
      done.push(`timeout ${human(ms)}`);
    } else if (action === 'quarantine') {
      if (!m) throw new Error('not on the server any more');
      await quarantine(m, { by, reason, evidence, components: link });
      done.push('quarantine (until a mod lifts it)');
    }
  } catch (e) {
    error = e.message;
  }
  return { done: done.join(', '), error };
}

async function decide(c, kind, action, by) {
  const { done, error } = kind === 'dismissed' ? { done: null, error: null } : await act(c, action, by);
  c.batch.decision = { kind, action, by, at: Date.now(), done, error };
  save();
}

async function csam(inc, meta) {
  const c = await openIncident(inc, meta, { csam: true, auto: BATCH.csamAuto });
  if (BATCH.csamAuto) {
    const r = await act(c, 'quarantine', mk.KIRA);
    c.batch.autoDone = `${r.done}${r.error ? ` · ⚠️ ${r.error}` : ''}`;
    save();
  }
  return post(c, { ping: true });
}

// A CSAM suspicion in an image, at high confidence: the message goes first, then the alert (pinging the mods and the
// Team), then the quarantine, which points to the alert. Only ids, times and the jump link are kept.
async function csamImage(inc, meta) {
  const c = await openIncident(inc, meta, { csam: true, auto: true });
  for (const s of inc.messages) book.drop(s.id); // the text lane won't read it either
  const n = await deleteMessages(c.batch.messages);
  const done = [`${n} of ${c.batch.messages.length} message${c.batch.messages.length > 1 ? 's' : ''} deleted`];
  await post(c, { ping: true });
  let error = null;
  const m = await guild()?.members.fetch(c.userId).catch(() => null);
  if (!m) error = 'not on the server any more: a mod bans by hand if needed';
  else if (exemptMember(m, m.user)) error = 'staff or the Horizon Team: not quarantined, handle it by hand';
  else {
    try {
      await quarantine(m, {
        by: mk.KIRA, reason: `case #${c.n}: an image removed under "Keep it SFW"`, evidence: { url: c.url, label: `alert case #${c.n}` },
        components: (ac) => { c.batch.actionCase = ac.n; save(); return []; },
      });
      done.push('quarantine (until a mod lifts it)');
    } catch (e) {
      error = e.message;
    }
  }
  c.batch.autoDone = `${done.join(', ')}${error ? ` · ⚠️ ${error}` : ''}`;
  save();
  await refresh(c);
  return c;
}

// Step 2 only (BATCH.auto): Kira acts, then posts the case with its Undo.
async function autoAct(inc, meta) {
  const c = await openIncident(inc, meta, { auto: true });
  const r = await act(c, kit.autoAction(inc), mk.KIRA);
  if (r.error && /staff|not on the server/.test(r.error)) c.batch.auto = false; // nothing done: a flag for the mods
  else c.batch.autoDone = `${r.done}${r.error ? ` · ⚠️ ${r.error}` : ''}`;
  save();
  return post(c);
}

// `undo case #N` (or the Undo button): N is the flag's case or the action's own case.
export async function undo(n, by) {
  const cases = mc().cases;
  const c = cases[n]?.batch ? cases[n] : Object.values(cases).find((x) => x.batch?.actionCase === n);
  if (!c?.batch?.auto) return `Case #${n} is not one of Kira's automatic actions.`;
  if (c.batch.undone) return `Case #${c.n} was undone already.`;
  const ac = cases[c.batch.actionCase];
  let error = null;
  try {
    if (ac?.action === 'timeout') {
      const m = await guild()?.members.fetch(c.userId).catch(() => null);
      if (m?.communicationDisabledUntilTimestamp > Date.now()) { expect(c.userId, 'untimeout', { by, reason: `undo case #${c.n}`, about: c.n }); await m.timeout(null, `undo case #${c.n}`); }
    } else if (ac?.action === 'quarantine') {
      const r = await unquarantine(c.userId, { by, reason: `undo case #${c.n}`, about: c.n });
      if (!r.ok) error = r.error;
    }
  } catch (e) {
    error = e.message;
  }
  c.batch.undone = { by, at: Date.now() };
  c.batch.decision = { kind: 'undone', by, at: Date.now(), error };
  save();
  await refresh(c);
  const fell = BATCH.autoCategories.includes(c.batch.category) && checkFallback(c.batch.category);
  return `↩️ Case #${c.n} undone${ac ? ` (case #${ac.n}, ${mk.ACTIONS[ac.action]?.label.toLowerCase()}, lifted)` : ''}. Deleted messages can't come back${c.batch.category === 'csam' ? '' : '; their text is in the case'}.${error ? ` ⚠️ ${error}` : ''}${fell ? `\n**${c.batch.category}** now falls back to flags only (more than ${BATCH.overturnLimit * 100}% overturned this week); \`/kira-batch restore\` switches it back.` : ''}`;
}

function checkFallback(category, now = Date.now()) {
  if (store.fallback[category] || !kit.shouldFallBack(mc().cases, category, BATCH, now)) return false;
  store.fallback[category] = now;
  save();
  return true;
}

// ── Buttons ─────────────────────────────────────────────────────────────────

async function onInteraction(i) {
  const [, verb, num] = i.customId.split(':');
  const c = mc().cases[Number(num)];
  if (!isStaff(i.member)) return i.reply(ephemeral("Only the mods decide on Kira's flags."));
  if (!c?.batch) return i.reply(ephemeral('No such case.'));
  if (verb === 'undo') return i.reply(ephemeral(await undo(c.n, i.user.id)));
  if (c.batch.decision || deciding.has(c.n)) return i.reply(ephemeral(c.batch.decision ? `Already decided: ${kit.decisionText(c.batch.decision)}` : 'Another mod is deciding it right now.'));
  if (verb === 'set') {
    const options = ['note', 'delete', 'timeout', 'quarantine'].map((v) => ({ label: clip(choiceLabel(v, c.userId), 100), value: v }));
    return i.reply(ephemeral(`Case #${c.n}: what should happen?`, { components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`${PREFIX}pick:${c.n}`).setPlaceholder('Pick the action').addOptions(options))] }));
  }
  const kind = verb === 'no' ? 'dismissed' : verb === 'pick' ? 'changed' : 'confirmed';
  const action = verb === 'pick' ? i.values?.[0] : c.batch.category === 'csam' ? 'quarantine' : kit.asChoice(c.batch.proposed);
  if (!['note', 'delete', 'timeout', 'quarantine'].includes(action)) return i.reply(ephemeral('Pick one of the actions.'));
  deciding.add(c.n);
  try {
    if (verb === 'pick') await i.update({ content: `Case #${c.n}: ${choiceLabel(action, c.userId)}…`, components: [] });
    else await i.deferUpdate();
    await decide(c, kind, action, i.user.id);
  } finally {
    deciding.delete(c.n);
  }
  if (verb === 'pick') { await refresh(c); return i.editReply({ content: kit.decisionText(c.batch.decision), components: [] }); }
  return i.editReply(view(c));
}

// ── The week's numbers, upkeep ──────────────────────────────────────────────

async function hourly(now = Date.now()) {
  const d = new Date(now);
  const key = d.toISOString().slice(0, 10);
  if (BATCH.mode === 'on' && d.getUTCDay() === 1 && d.getUTCHours() >= 9 && store.weekly !== key) {
    store.weekly = key;
    save();
    await channel('modchat')?.send({ content: kit.weeklyLine(kit.accuracy(mc().cases, now - 7 * DAY, now), { auto: BATCH.auto }), allowedMentions: { parse: [] } }).catch(() => {});
  }
  for (const cat of BATCH.auto ? BATCH.autoCategories : []) if (checkFallback(cat, now)) {
    await channel('modchat')?.send({ content: `↩️ **${cat}**: more than ${BATCH.overturnLimit * 100}% of Kira's auto actions were overturned this week, so it falls back to flags only. \`/kira-batch restore\` switches it back.`, allowedMentions: { parse: [] } }).catch(() => {});
  }
  // Evidence is kept 90 days; then a flag keeps its ids and the decision only.
  for (const c of Object.values(mc().cases)) {
    if (c.action !== 'flag' || !c.batch || c.batch.pruned || now - c.at < 90 * DAY) continue;
    for (const m of [...c.batch.messages, ...c.batch.context]) { delete m.text; delete m.name; }
    c.batch.quotes = [];
    c.batch.pruned = true;
  }
  for (const [id, list] of Object.entries(store.notes)) { const keep = list.filter((t) => now - t < 30 * DAY); if (keep.length) store.notes[id] = keep; else delete store.notes[id]; }
  save();
}

// ── Commands ────────────────────────────────────────────────────────────────

export const commands = [
  new SlashCommandBuilder().setName('kira-batch').setDescription("Kira's batch moderation: status, or switch a category back to auto actions (mods)")
    .setDefaultMemberPermissions(P.ManageMessages)
    .addStringOption((o) => o.setName('action').setDescription('status, or restore a category that fell back to flags').setRequired(true)
      .addChoices({ name: 'status', value: 'status' }, { name: 'restore', value: 'restore' }))
    .addStringOption((o) => o.setName('category').setDescription('restore: the category').addChoices(...BATCH.autoCategories.map((c) => ({ name: c, value: c })))),
];

export const handlers = {
  async 'kira-batch'(i) {
    if (!isStaff(i.member)) return i.reply(ephemeral('Only the mods can do this.'));
    if (i.options.getString('action') === 'restore') {
      const cat = i.options.getString('category');
      if (!cat || !store.fallback[cat]) return i.reply(ephemeral(cat ? `${cat} hasn't fallen back.` : 'Give the category.'));
      delete store.fallback[cat];
      save();
      return i.reply(ephemeral(`${cat}: auto actions again${BATCH.auto ? '' : ' (once step 2 is on)'}.`));
    }
    const fell = Object.keys(store.fallback);
    return i.reply(ephemeral([
      `Batch moderation: **${BATCH.mode === 'on' ? 'on (step 1: flags only)' : BATCH.mode}**${kiraAi.batchEnabled ? '' : ' (needs KIRA_AI and the key)'}${BATCH.mode === 'on' && !kiraAi.batchActive() ? ', paused now (/kira-ai, budget, or an API error)' : ''}`,
      `Auto actions (step 2): **${BATCH.auto ? `on for ${BATCH.autoCategories.join(', ')} at ≥ ${BATCH.autoFrom}` : 'off'}** · ladder ${BATCH.ladder.join(' / ')}${fell.length ? ` · back to flags: ${fell.join(', ')}` : ''}`,
      `Windows open now: ${book.size}`,
      `Image lane: **${!kiraAi.imagesEnabled ? 'off' : `on, CSAM ${BATCH.imageCsamAuto ? `acted on at ≥ ${BATCH.imageCsamAutoFrom}` : 'flagged only'}, the rest flagged`}**${kiraAi.imagesEnabled && BATCH.mode === 'on' && !kiraAi.imageActive() ? ', paused now (/kira-ai, budget, or an API error)' : ''}${kiraAi.imagesEnabled ? ` · ${imageQueue.length} waiting` : ''}`,
      kit.weeklyLine(kit.accuracy(mc().cases, Date.now() - 7 * DAY), { auto: BATCH.auto }),
    ].join('\n')));
  },
};

export function setup() {
  console.log(`kira batch moderation: ${BATCH.mode === 'off' ? 'off' : kiraAi.batchEnabled ? `${BATCH.mode}${BATCH.auto ? ', auto actions on' : ', flags only'}${kiraAi.imagesEnabled ? `, image lane on (CSAM ${BATCH.imageCsamAuto ? 'acted on' : 'flagged'})` : ', image lane off'}` :`${BATCH.mode}, but the AI is off (KIRA_AI, ANTHROPIC_API_KEY)`}`);
  if (BATCH.mode === 'off') return;
  client.on('interactionCreate', (i) => {
    if (i.guildId !== GUILD_ID || !(i.isButton?.() || i.isStringSelectMenu?.()) || !i.customId.startsWith(PREFIX)) return;
    onInteraction(i).catch(async (e) => {
      console.error('batch button', e);
      await (i.deferred || i.replied ? i.followUp(ephemeral(`Something went wrong: ${clip(e.message, 200)}`)) : i.reply(ephemeral(`Something went wrong: ${clip(e.message, 200)}`))).catch(() => {});
    });
  });
  client.on('messageUpdate', (before, after) => { if (after.guildId === GUILD_ID && after.content != null) edit(after.id, after.content); });
  client.on('channelUpdate', () => eligibleCache.clear()); // a category's permissions change its channels too
  setInterval(() => { for (const id of book.due()) closeWindow(id).catch((e) => console.error('batch window', e)); }, 30_000).unref?.();
  setInterval(() => hourly().catch((e) => console.error('batch hourly', e)), 3_600_000).unref?.();
}

export const _test = {
  book, store, closeWindow, onInteraction, undo, hourly, eligibleCache, toppedUp, hashFile, imageQueue, imagesIdle, readImages, fetchImage,
  setFetch: (fn) => { fetchImpl = fn; },
};
