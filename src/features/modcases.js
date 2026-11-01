// Mod cases, quarantine, appeals and mod-mail statuses: the Discord side (the rules are src/modcase-kit.js).
//
// - Cases: every timeout, timeout removal, quarantine (the 🔒 Quarantined role), ban, unban and kick reaches Kira
//   through Discord's audit log (GUILD_AUDIT_LOG_ENTRY_CREATE, the GuildModeration intent), whoever did it. Each one is
//   a numbered case posted in #mod-actions in one format. When Kira acts (a mod's command, an automatic action, an
//   appeal's decision) she says beforehand who really acted and with what evidence (`expect`), so the audit entry,
//   whose executor is Kira, becomes one case and never two lines.
// - Quarantine: the role hides every channel but #appeal (Kira adds one deny overwrite for it to each channel, and to
//   each new one); a quarantine takes the member's other roles away and gives them back when it is lifted.
// - Appeals: a form (a Discord modal with fixed questions; the website's /hub/appeal for banned users), one thread per
//   appeal in #mod-mail, decided with buttons by a mod who didn't act. The person hears the outcome by DM (or in
//   #appeal, or on the website).
// - Mod-mail statuses: 🟢 Open / 🟡 Waiting / ⚪ Closed in each thread's name; a daily list in #mod-chat of the
//   threads Open for more than 12 hours.
import {
  SlashCommandBuilder, PermissionFlagsBits as P, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, ThreadAutoArchiveDuration, ChannelType,
} from 'discord.js';
import { randomBytes } from 'node:crypto';
import { GUILD_ID, OWNER_ID, LAYOUT, LINKS } from '../config.js';
import { client, state, save, channel, isStaff, clip, modlog, parseDuration } from '../core.js';
import { findChannel } from '../layout-diff.js';
import { overwrites } from '../permissions.js';
import { failures } from '../staff-http.js';
import * as kit from '../modcase-kit.js';

state.modcases = kit.blank(state.modcases ?? {});
state.ownChannels ??= {};
state.ownRoles ??= {};
const mc = state.modcases;
const SITE = (process.env.STAFF_SITE_URL || LINKS.horizonSite).replace(/\/+$/, '');
const APP_ID = '1559239271271891004';
const exp = kit.expectations();
const ephemeral = (content, extra = {}) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }, ...extra });
const guild = () => client.guilds.cache.get(GUILD_ID);
export const quarantineRole = () => state.roles.quarantined || state.ownRoles.quarantined || null;
const kiraId = () => client.user?.id;
const tagOf = (u) => u?.tag ?? u?.username ?? null;

// What Kira is about to do to a member, for the audit entry that follows. meta: { by (a Discord id or kit.KIRA),
// reason, evidence: { url?, label?, text? }, components(case) → rows, until, about (an appeal's case), noDm, skip }.
export const expect = (userId, action, meta = {}) => exp.add(userId, action, meta);

// ── Cases in #mod-actions ────────────────────────────────────────────────────

function caseEmbed(c) {
  const v = kit.caseView(c);
  return new EmbedBuilder().setColor(v.color).setTitle(v.title).setDescription(v.description).addFields(v.fields).setTimestamp(c.at);
}
function caseRows(c, extra = []) {
  const rows = [...extra];
  if ((c.by && c.by !== kit.KIRA) || c.action === 'mcban') {
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`case:evidence:${c.n}`).setStyle(ButtonStyle.Secondary).setEmoji('📎').setLabel('Add evidence')));
  }
  return rows;
}

async function postCase(c, extra = []) {
  const ch = channel('modactions') ?? channel('modlog');
  const msg = await ch?.send({ embeds: [caseEmbed(c)], components: caseRows(c, extra), allowedMentions: { parse: [] } }).catch((e) => { console.error('case post', e.message); return null; });
  if (msg) { c.url = msg.url; c.messageId = msg.id; c.channelId = msg.channelId; save(); }
  return msg;
}

async function refreshCase(c) {
  if (!c.messageId) return;
  const msg = await client.channels.cache.get(c.channelId)?.messages.fetch(c.messageId).catch(() => null);
  await msg?.edit({ embeds: [caseEmbed(c)] }).catch((e) => console.error('case edit', e.message));
}

const cleanReason = (r) => (r ? r.replace(/^Kira:\s*/, '').replace(/ \(strike \d+\)$/, '') : null);

async function onAudit(entry, g) {
  if (g.id !== GUILD_ID) return;
  const act = kit.auditAction(entry, { quarantineRole: quarantineRole() });
  if (!act) return;
  const byKira = act.by === kiraId();
  const meta = byKira ? exp.take(act.userId, act.action) : null;
  if (meta?.skip) return;
  if (byKira && !meta && (act.action === 'quarantine' || act.action === 'unquarantine')) return; // a rejoin's role put back, a restore
  const user = await client.users.fetch(act.userId).catch(() => null);
  const by = byKira ? (meta?.by ?? kit.KIRA) : act.by;
  const reason = meta?.reason ?? cleanReason(act.reason);
  const until = meta?.until ?? act.until ?? null;
  const c = kit.openCase(mc, { action: act.action, userId: act.userId, tag: tagOf(user), by, reason, ms: act.ms ?? null, until, evidence: meta?.evidence ?? null, about: meta?.about ?? null });
  if (act.action === 'quarantine') kit.quarantineSet(mc, act.userId, { until, caseNo: c.n });
  save();
  await postCase(c, meta?.components?.(c) ?? []);
  if (act.action === 'quarantine' && !meta) await stripRoles(act.userId).catch((e) => console.error('quarantine strip', e.message)); // a mod gave the role by hand
  if (act.action === 'unquarantine' && !meta) await restoreRoles(act.userId).catch((e) => console.error('quarantine restore', e.message));
  if (!meta?.noDm && ['timeout', 'quarantine', 'ban'].includes(act.action)) await tellCase(c, user);
}

// The member hears about the case, with the way to appeal it.
async function tellCase(c, user) {
  if (!user) return;
  const why = c.reason || 'none given';
  let payload;
  if (c.action === 'timeout') {
    payload = { content: `⏳ You were timed out in **Horizon** for ${kit.human(c.ms)} (case #${c.n}). Reason: ${why}\nThink it's wrong? Press **Open appeal**: a short form, read and decided by a mod who didn't act.`, components: [openRow(c.n)] };
  } else if (c.action === 'quarantine') {
    payload = { content: `🔒 You were quarantined in **Horizon** (case #${c.n}): you only see #appeal until it's decided${c.until ? ` or until <t:${Math.floor(c.until / 1000)}:f>` : ''}. Reason: ${why}\nPress **Open appeal** (here or in #appeal): a short form, read and decided by a mod who didn't act.`, components: [openRow(c.n)] };
  } else {
    payload = { content: banText(c.userId, why, c.n) };
  }
  c.dm = await user.send({ ...payload, allowedMentions: { parse: [] } }).then(() => true, () => false);
  save();
}

const openRow = (n) => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`appeal:open${n ? `:${n}` : ''}`).setStyle(ButtonStyle.Primary).setEmoji('⚖️').setLabel('Open appeal'));

// A banned person can't see the server: the website's form, with a link that proves who they are.
function banText(userId, why, n = null) {
  const { token } = kit.issueToken(mc, userId);
  save();
  return `🔨 You were banned from **Horizon**${n ? ` (case #${n})` : ''}. Reason: ${why}\nThink it's wrong? Appeal here (a short form; the link works for 30 days, keep it to read the answer): ${SITE}/hub/appeal#${token}`;
}

// /ban: the DM goes first (afterwards Kira can't reach them), with the appeal link.
export async function banNotice(user, why) {
  return user.send({ content: banText(user.id, why), allowedMentions: { parse: [] } }).then(() => true, () => false);
}

// ── Quarantine ──────────────────────────────────────────────────────────────

async function stripRoles(userId) {
  const m = await guild()?.members.fetch(userId).catch(() => null);
  const qid = quarantineRole();
  if (!m || !qid) return;
  const strip = kit.rolesToStrip([...m.roles.cache.values()], { everyone: m.guild.id, quarantineRole: qid });
  kit.quarantineSet(mc, userId, { roles: strip, until: mc.quarantined[userId]?.until ?? null });
  save();
  if (strip.length) await m.roles.remove(strip, 'quarantine: the other roles are kept by Kira until it is lifted');
  await m.voice?.disconnect('quarantine').catch(() => {});
}

async function restoreRoles(userId) {
  const q = mc.quarantined[userId];
  delete mc.quarantined[userId];
  save();
  const m = await guild()?.members.fetch(userId).catch(() => null);
  const give = (q?.roles ?? []).filter((id) => m?.guild.roles.cache.has(id) && !m.roles.cache.has(id));
  if (m && give.length) await m.roles.add(give, 'quarantine lifted: roles given back');
}

// Quarantines a member: their roles kept aside, the Quarantined role given (one role change, one audit entry).
export async function quarantine(m, { by, reason, ms = null, evidence = null, components = null }) {
  const qid = quarantineRole();
  if (!qid) throw Object.assign(new Error('The 🔒 Quarantined role is not there yet (Kira makes it at start).'), { expose: true });
  const strip = kit.rolesToStrip([...m.roles.cache.values()], { everyone: m.guild.id, quarantineRole: qid });
  const keep = [...m.roles.cache.values()].filter((r) => r.managed).map((r) => r.id);
  const until = ms ? Date.now() + ms : null;
  kit.quarantineSet(mc, m.id, { roles: strip, until });
  save();
  const e = expect(m.id, 'quarantine', { by, reason, until, evidence, components });
  try {
    await m.roles.set([...keep, qid], `${by === kit.KIRA ? 'Kira' : `by ${by}`}: ${reason}`);
  } catch (err) {
    exp.drop(e);
    delete mc.quarantined[m.id];
    save();
    throw err;
  }
  await m.voice?.disconnect('quarantine').catch(() => {});
}

// Lifts a quarantine: the role goes, the roles Kira kept come back.
export async function unquarantine(userId, { by, reason, about = null }) {
  const qid = quarantineRole();
  const q = mc.quarantined[userId];
  const m = await guild()?.members.fetch(userId).catch(() => null);
  delete mc.quarantined[userId];
  save();
  if (!m) return { ok: false, error: 'not on the server any more (the quarantine is forgotten: no role when they come back)' };
  const roles = new Set([...m.roles.cache.keys()].filter((id) => id !== qid && id !== m.guild.id));
  for (const id of q?.roles ?? []) if (m.guild.roles.cache.has(id)) roles.add(id);
  if (!m.roles.cache.has(qid)) return { ok: true };
  expect(userId, 'unquarantine', { by, reason, about });
  await m.roles.set([...roles], `${by === kit.KIRA ? 'Kira' : `by ${by}`}: ${reason}`);
  return { ok: true };
}

const DENY = { ViewChannel: false, SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false, CreatePrivateThreads: false, AddReactions: false, Connect: false, Speak: false };
// The one overwrite the Quarantined role needs on each channel; added where it's missing, nothing else touched.
async function hide(ch, qid) {
  if (!ch?.permissionOverwrites || ch.isThread?.() || ch.id === channel('appeal')?.id) return false;
  if (ch.permissionOverwrites.cache.has(qid)) return false;
  await ch.permissionOverwrites.create(qid, DENY, { reason: 'the 🔒 Quarantined role sees only #appeal' });
  return true;
}

// ── At start: the role, the channels, the overwrites, the form in #appeal ──────

const OWN = ['appeal', 'modactions', 'joinleave', 'kirahandoffs'];
async function ensure() {
  const g = await client.guilds.fetch(GUILD_ID);
  await g.channels.fetch();
  // The role (setup makes it too: ROLES in config.js; whichever comes first, the other finds it by name).
  let qid = quarantineRole();
  if (!qid || !g.roles.cache.has(qid)) {
    const spec = { name: '🔒 Quarantined', color: 0x4f545c };
    const found = g.roles.cache.find((r) => r.name === spec.name) ?? await g.roles.create({ name: spec.name, colors: { primaryColor: spec.color }, permissions: [], reason: 'mod cases: quarantine instead of most bans' });
    state.ownRoles.quarantined = found.id;
    qid = found.id;
    save();
  }
  // The channels (in LAYOUT, so setup knows them): found like setup finds them, made only when missing.
  for (const key of OWN) {
    const group = LAYOUT.find((x) => x.channels.some((c) => c.key === key));
    const spec = group.channels.find((c) => c.key === key);
    if (channel(key)) continue;
    let ch;
    try { ch = findChannel(spec, g.channels.cache.values(), state); } catch (e) { console.error('mod cases:', e.message); continue; }
    if (!ch) {
      ch = await g.channels.create({
        name: spec.name, type: ChannelType.GuildText, parent: state.channels['cat:' + group.key] ?? null, topic: spec.topic ?? null,
        permissionOverwrites: overwrites({ everyone: g.roles.everyone.id, mod: state.roles.mod, kira: g.members.me.id, owner: OWNER_ID, roles: { ...state.roles, quarantined: qid } }, spec, group.staff),
        reason: 'mod cases (additive: made because it was missing)',
      });
      console.log(`mod cases: #${spec.name} made`);
    }
    state.ownChannels[key] = ch.id;
    save();
  }
  // The overwrite on every channel (categories first, so synced channels stay synced).
  const all = [...g.channels.cache.values()].sort((a, b) => (b.type === ChannelType.GuildCategory) - (a.type === ChannelType.GuildCategory));
  let added = 0;
  for (const ch of all) if (await hide(ch, qid).catch((e) => { console.error('quarantine overwrite', ch.name, e.message); return false; })) added++;
  if (added) await modlog('🔒 Quarantine role ready', `Kira added the 🔒 Quarantined deny overwrite to ${added} channels (only #appeal shows for it). Nothing else changed.`, 0x4f545c);
  // The form in #appeal: one pinned message of Kira's with the button.
  const box = channel('appeal');
  if (box) {
    const old = mc.formMessage && await box.messages.fetch(mc.formMessage).catch(() => null);
    if (!old) {
      const msg = await box.send({ embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle('⚖️ Appeal').setDescription('You were quarantined: only this channel shows until a mod decides.\n\nPress **Open appeal** for a short form: what happened, why it should be lifted, anything else. A mod who did not act reads it and decides; Kira tells you the answer by DM (here if your DMs are closed). One appeal per action; another one 7 days after a decision.')], components: [openRow()] });
      await msg.pin().catch(() => {});
      mc.formMessage = msg.id;
      save();
    }
  }
}

// ── The appeal form ──────────────────────────────────────────────────────────

function formModal(id, { minecraft = false, ign = '' } = {}) {
  const input = (q) => new TextInputBuilder().setCustomId(q.id).setLabel(q.label).setStyle(TextInputStyle.Paragraph).setMaxLength(q.max).setRequired(!!q.required);
  const rows = kit.QUESTIONS.map((q) => new ActionRowBuilder().addComponents(input(q)));
  if (minecraft) {
    const name = new TextInputBuilder().setCustomId('ign').setLabel('Your in-game name').setStyle(TextInputStyle.Short).setMinLength(3).setMaxLength(16).setRequired(true);
    if (/^[A-Za-z0-9_]{3,16}$/.test(ign)) name.setValue(ign);
    rows.unshift(new ActionRowBuilder().addComponents(name));
    rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('banText').setLabel('What the ban message said (optional)').setStyle(TextInputStyle.Short).setMaxLength(kit.APPEAL.max.banText).setRequired(false)));
  }
  return new ModalBuilder().setCustomId(`appeal:form:${id}`).setTitle(minecraft ? 'Appeal a Minecraft server ban' : `Appeal case #${id}`).addComponents(rows);
}

function refusal(why, retryAt) {
  return `${kit.WHY[why] ?? 'You can\'t appeal that.'}${retryAt ? ` (from <t:${Math.floor(retryAt / 1000)}:f>)` : ''}`;
}

async function openForm(i, n = null, minecraft = null) {
  if (minecraft !== null) return i.showModal(formModal('mc', { minecraft: true, ign: minecraft }));
  let c;
  if (n) {
    c = mc.cases[n];
    const can = kit.canAppeal(mc, c, i.user.id);
    if (!can.ok) return i.reply(ephemeral(refusal(can.why, can.retryAt)));
  } else {
    const t = kit.appealTarget(mc, i.user.id);
    if (!t.case) return i.reply(ephemeral(`${refusal(t.why, t.retryAt)}${t.why === 'none' ? ' A ban of the official Minecraft server: `/appeal minecraft_name:<you>`.' : ''}`));
    c = t.case;
  }
  return i.showModal(formModal(c.n));
}

async function submitForm(i) {
  const id = i.customId.slice('appeal:form:'.length);
  const get = (k) => { try { return i.fields.getTextInputValue(k); } catch { return ''; } };
  const answers = Object.fromEntries(kit.QUESTIONS.map((q) => [q.id, get(q.id)]));
  try {
    const { appeal, case: c } = kit.submitAppeal(mc, { userId: i.user.id, tag: tagOf(i.user), caseNo: id === 'mc' ? null : Number(id), kind: id === 'mc' ? 'minecraft' : 'discord', answers, ign: get('ign'), banText: get('banText') });
    save();
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    if (c.action === 'mcban' && !c.url) await postCase(c);
    await postAppeal(appeal, c);
    return i.editReply(`Sent: appeal of case #${c.n}. A mod who didn't act decides; Kira tells you the answer by DM.`);
  } catch (e) {
    if (!e.expose) throw e;
    return i.deferred ? i.editReply(e.message) : i.reply(ephemeral(e.message));
  }
}

// ── Appeals in #mod-mail ─────────────────────────────────────────────────────

const LABELS = { uphold: ['Uphold', ButtonStyle.Secondary, '🛑'], ban: ['Uphold + ban', ButtonStyle.Danger, '🔨'], shorten: ['Shorten', ButtonStyle.Primary, '⏱️'], lift: ['Lift', ButtonStyle.Success, '✅'] };
const decisionRow = (c, a, disabled = false) => new ActionRowBuilder().addComponents(kit.decisionsFor(c).map((d) => new ButtonBuilder()
  .setCustomId(`appeal:d:${d}:${a.id}`).setLabel(LABELS[d][0]).setStyle(LABELS[d][1]).setEmoji(LABELS[d][2]).setDisabled(disabled)));
const pingFor = (c) => (c.action === 'mcban' ? kit.MC_OPS.map((id) => `<@${id}>`).join(' ') : state.roles.mod ? `<@&${state.roles.mod}>` : '');
const mentionsFor = (c) => (c.action === 'mcban' ? { users: kit.MC_OPS } : { roles: [state.roles.mod].filter(Boolean) });

function answersEmbed(a) {
  const e = new EmbedBuilder().setColor(0x5865f2).setTitle(`⚖️ Appeal (${a.via === 'web' ? 'the website, signed in with Discord' : 'the form on Discord'})`).setTimestamp(a.at);
  for (const q of kit.QUESTIONS) e.addFields({ name: q.label, value: clip(a.answers[q.id] || '—', 1000) });
  return e;
}

async function postAppeal(a, c) {
  const box = channel('modmail');
  if (!box) throw new Error('no #mod-mail channel');
  const user = await client.users.fetch(a.userId).catch(() => null);
  const thread = await box.threads.create({ name: kit.appealName(c, user?.username ?? a.userId, 'open'), autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek, reason: `appeal of case #${c.n}` });
  const deciders = c.action === 'mcban' ? 'An op decides' : `A mod other than ${kit.who(c.by)} decides`;
  const msg = await thread.send({
    content: `${pingFor(c)} appeal of case #${c.n} by <@${a.userId}>. ${deciders}: the buttons below. The form is all there is: no back-and-forth.${c.url ? ` [The case](${c.url})` : ''}`,
    embeds: [caseEmbed(c), answersEmbed(a)], components: [decisionRow(c, a)], allowedMentions: mentionsFor(c),
  });
  a.threadId = thread.id;
  a.messageId = msg.id;
  a.url = msg.url;
  c.appealNote = `open: [the appeal](${msg.url}) <t:${Math.floor(a.at / 1000)}:R>`;
  save();
  await refreshCase(c);
}

async function onDecisionButton(i) {
  const [, , decision, id] = i.customId.split(':');
  const a = mc.appeals[id];
  const c = a && mc.cases[a.case];
  if (!a || !c) return i.reply(ephemeral('That appeal is gone.'));
  if (a.status === 'decided') return i.reply(ephemeral('This appeal was decided already.'));
  const no = kit.decideRefusal(c, i.user.id, { isMod: isStaff(i.member) });
  if (no) return i.reply(ephemeral(no));
  if (decision === 'ban' && !i.member.permissions.has(P.BanMembers)) return i.reply(ephemeral('A ban goes through the Horizon Team: ask one of them to press it.'));
  const modal = new ModalBuilder().setCustomId(`appeal:dm:${decision}:${id}`).setTitle(`${LABELS[decision][0]}: case #${c.n}`);
  if (decision === 'shorten') modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('length').setLabel('New total length (e.g. 2h, 3d)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20)));
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('note').setLabel('A note for them (optional, they read it)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(kit.APPEAL.max.note)));
  return i.showModal(modal);
}

async function onDecisionModal(i) {
  const [, , decision, id] = i.customId.split(':');
  const a = mc.appeals[id];
  const c = a && mc.cases[a.case];
  if (!a || !c) return i.reply(ephemeral('That appeal is gone.'));
  const no = kit.decideRefusal(c, i.user.id, { isMod: isStaff(i.member) });
  if (no) return i.reply(ephemeral(no));
  const get = (k) => { try { return i.fields.getTextInputValue(k); } catch { return ''; } };
  const ms = decision === 'shorten' ? parseDuration(get('length')) : null;
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const out = await applyDecision(a, c, { decision, by: i.user.id, ms, note: get('note').trim() || null });
    return i.editReply(`Done: case #${c.n} ${kit.DECISIONS[decision]}.${out.error ? ` But: ${out.error}` : ''}${out.todo ? ` ${out.todo}` : ''}`);
  } catch (e) {
    if (!e.expose) throw e;
    return i.editReply(e.message);
  }
}

// Records the decision, does it on Discord, tells the person, logs it under the case, closes the thread.
export async function applyDecision(a, c, { decision, by, ms = null, note = null }) {
  const { until } = kit.decide(mc, a, { decision, by, ms, note });
  save();
  const g = guild();
  const why = `appeal of case #${c.n} ${kit.DECISIONS[decision]}`;
  let error = null, todo = null;
  try {
    if (c.action === 'mcban') {
      if (decision === 'lift') todo = `An op runs \`/pardon ${c.ign}\` on the server (Kira can't reach it).`;
      if (decision === 'shorten') todo = `An op unbans \`${c.ign}\` on <t:${Math.floor(until / 1000)}:f> (Kira can't reach the server).`;
    } else if (decision === 'lift') {
      if (c.action === 'timeout') {
        const m = await g.members.fetch(c.userId).catch(() => null);
        if (m?.communicationDisabledUntilTimestamp > Date.now()) { expect(c.userId, 'untimeout', { by, reason: why, about: c.n }); await m.timeout(null, why); }
      } else if (c.action === 'quarantine') {
        const r = await unquarantine(c.userId, { by, reason: why, about: c.n });
        if (!r.ok) error = r.error;
      } else if (c.action === 'ban') {
        expect(c.userId, 'unban', { by, reason: why, about: c.n });
        await g.bans.remove(c.userId, why);
      }
    } else if (decision === 'shorten') {
      if (c.action === 'timeout') {
        const m = await g.members.fetch(c.userId).catch(() => null);
        if (m) { expect(c.userId, 'timeout', { skip: true }); await m.timeout(until - Date.now(), why); } else error = 'not on the server any more';
      } else if (c.action === 'quarantine' && mc.quarantined[c.userId]) mc.quarantined[c.userId].until = until;
      // a ban's new end: the minute tick unbans (c.until)
    } else if (decision === 'ban') {
      const user = await client.users.fetch(c.userId).catch(() => null);
      if (user) await banNotice(user, why);
      expect(c.userId, 'ban', { by, reason: why, about: c.n, noDm: true });
      delete mc.quarantined[c.userId];
      await g.members.ban(c.userId, { reason: `by ${by}: ${why}` });
    }
  } catch (e) {
    error = e.message;
  }
  // Telling them: a DM, else #appeal (still quarantined), else the website shows it at their next sign-in.
  const user = await client.users.fetch(c.userId).catch(() => null);
  const said = kit.outcomeText(c, a);
  let told = await user?.send({ content: said, allowedMentions: { parse: [] } }).then(() => 'dm', () => null);
  if (!told && mc.quarantined[c.userId] && channel('appeal')) {
    told = await channel('appeal').send({ content: `<@${c.userId}> ${said}`, allowedMentions: { users: [c.userId] } }).then(() => '#appeal', () => null);
  }
  a.outcome.told = told ?? (a.via === 'web' ? 'the website' : null);
  a.outcome.error = error;
  save();
  // The log, under the case number.
  await refreshCase(c);
  await modlog(`⚖️ Case #${c.n} · appeal ${kit.DECISIONS[decision]}`, `<@${c.userId}> (${c.tag ?? c.userId}) · ${kit.ACTIONS[c.action].label}, by ${kit.who(c.by)}\nDecided by <@${by}>${a.url ? ` · [the appeal](${a.url})` : ''}${c.url ? ` · [the case](${c.url})` : ''}${until ? `\nNow until <t:${Math.floor(until / 1000)}:f>` : ''}${note ? `\nNote: ${clip(note, 400)}` : ''}\nTold: ${a.outcome.told ?? 'nobody (DMs closed)'}${error ? `\n⚠️ ${error}` : ''}${todo ? `\n${todo}` : ''}`, decision === 'lift' ? 0x2ecc71 : decision === 'shorten' ? 0x5aa9ff : 0xff4d4d, [], 'modactions');
  // The thread: buttons off, a last line, renamed, locked and archived.
  const thread = a.threadId && await client.channels.fetch(a.threadId).catch(() => null);
  if (thread) {
    const first = await thread.messages.fetch(a.messageId).catch(() => null);
    await first?.edit({ components: [decisionRow(c, a, true)] }).catch(() => {});
    await thread.send({ content: `${kit.DECISIONS[decision][0].toUpperCase()}${kit.DECISIONS[decision].slice(1)} by <@${by}>. Told: ${a.outcome.told ?? 'nobody (DMs closed)'}.${error ? ` ⚠️ ${error}` : ''}${todo ? ` ${todo}` : ''}`, allowedMentions: { parse: [] } }).catch(() => {});
    await thread.edit({ name: kit.appealName(c, user?.username ?? c.userId, 'decided'), locked: true, archived: true }).catch((e) => console.error('appeal thread', e.message));
  }
  return { error, todo };
}

// ── Evidence ─────────────────────────────────────────────────────────────────

async function onEvidenceButton(i) {
  const n = Number(i.customId.split(':')[2]);
  const no = kit.evidenceRefusal(mc.cases[n], i.user.id);
  if (no) return i.reply(ephemeral(no));
  return i.showModal(new ModalBuilder().setCustomId(`case:evform:${n}`).setTitle(`Evidence for case #${n}`).addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('value').setLabel('A link (message, screenshot) or a few words').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(kit.APPEAL.max.evidence))));
}
async function onEvidenceModal(i) {
  const n = Number(i.customId.split(':')[2]);
  const c = mc.cases[n];
  const no = kit.evidenceRefusal(c, i.user.id);
  if (no) return i.reply(ephemeral(no));
  try { kit.addEvidence(c, { value: i.fields.getTextInputValue('value'), by: i.user.id }); } catch (e) { if (e.expose) return i.reply(ephemeral(e.message)); throw e; }
  save();
  await refreshCase(c);
  return i.reply(ephemeral(`Evidence added to case #${n}.`));
}

// ── Mod-mail statuses ────────────────────────────────────────────────────────

const rename = kit.renamer({
  rename: async (id, name) => {
    const t = await client.channels.fetch(id).catch(() => null);
    if (!t) return;
    const closed = name.startsWith(kit.MAIL.closed.mark);
    if (t.archived && !closed) await t.setArchived(false).catch(() => {});
    await t.edit({ name, ...(closed ? { archived: true } : {}) });
  },
});

// A mod-mail thread's status changed (community.js calls it: member wrote → open, a mod answered → waiting).
export function mailStatus(thread, status, userId = null) {
  const before = mc.modmail[thread.id]?.status;
  kit.mailSet(mc, thread.id, { status, userId });
  save();
  if (before !== status || !kit.MAIL_MARK.test(thread.name)) rename(thread.id, kit.mailName(thread.name, status));
}

export const mailRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('mail:waiting').setLabel('Waiting on them').setStyle(ButtonStyle.Secondary).setEmoji('🟡'),
  new ButtonBuilder().setCustomId('mail:open').setLabel('Open').setStyle(ButtonStyle.Secondary).setEmoji('🟢'),
  new ButtonBuilder().setCustomId('mail:close').setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji('⚪'),
);

const mailUser = (threadId) => Object.keys(state.modmail).find((k) => state.modmail[k] === threadId) ?? null;

// //close, /close and the Close button: the member is told, the thread closed.
export async function closeMail(thread, by) {
  const userId = mailUser(thread.id);
  if (!userId) return false;
  const user = await client.users.fetch(userId).catch(() => null);
  await user?.send('✅ The mods closed this conversation. DM me again anytime.').catch(() => {});
  delete state.modmail[userId];
  save();
  await thread.send({ content: `Closed by <@${by}>.`, allowedMentions: { parse: [] } }).catch(() => {});
  mailStatus(thread, 'closed', userId);
  return true;
}

async function onMailButton(i) {
  if (!isStaff(i.member)) return i.reply(ephemeral('Only the mods.'));
  const what = i.customId.slice('mail:'.length);
  if (!mailUser(i.channelId)) return i.reply(ephemeral('This conversation is closed already: they open a new one by DMing Kira.'));
  if (what === 'close') { await i.deferUpdate(); return closeMail(i.channel, i.user.id); }
  mailStatus(i.channel, what);
  return i.reply(ephemeral(`Marked ${kit.MAIL[what].label}.`));
}

// Once a day (from 09:00 UTC), #mod-chat gets the threads Open for more than 12 hours.
async function mailReminder(now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (mc.mailReminderDay === day || new Date(now).getUTCHours() < 9) return;
  mc.mailReminderDay = day;
  save();
  const stale = kit.staleMail(mc, now).filter((t) => mailUser(t.threadId));
  if (!stale.length) return;
  await channel('modchat')?.send({ content: `📬 Mod-mail open for more than 12 h (the member wrote last, nobody answered):\n${stale.slice(0, 25).map((t) => `- <#${t.threadId}> (<@${t.userId}>), open since <t:${Math.floor(t.since / 1000)}:R>`).join('\n')}`, allowedMentions: { parse: [] } });
}

// ── Every minute: lengths that ran out; every hour: reminders on open appeals ──

async function tick(now = Date.now()) {
  for (const userId of kit.quarantinesDue(mc, now)) {
    const q = mc.quarantined[userId];
    await unquarantine(userId, { by: kit.KIRA, reason: `the quarantine${q.case ? ` of case #${q.case}` : ''} ran out`, about: q.case }).catch((e) => console.error('quarantine end', e.message));
  }
  for (const c of Object.values(mc.cases)) {
    if (c.action !== 'ban' || !c.until || c.until > now || c.liftedAt || c.ended) continue;
    c.ended = now;
    save();
    expect(c.userId, 'unban', { by: kit.KIRA, reason: `the shortened ban of case #${c.n} ran out`, about: c.n });
    await guild()?.bans.remove(c.userId, `case #${c.n} ran out`).catch((e) => console.error('ban end', e.message));
  }
  await mailReminder(now).catch((e) => console.error('mail reminder', e.message));
}

async function remind(now = Date.now()) {
  for (const a of kit.dueReminders(mc, now)) {
    const c = mc.cases[a.case];
    const thread = a.threadId && await client.channels.fetch(a.threadId).catch(() => null);
    a.remindedAt = now;
    save();
    if (!thread) continue;
    if (thread.archived) await thread.setArchived(false).catch(() => {});
    await thread.send({ content: `${pingFor(c)} this appeal has been open for ${Math.floor((now - a.at) / kit.HOUR)} h: ${c.action === 'mcban' ? 'an op' : `a mod other than ${kit.who(c.by)}`}, please decide.`, allowedMentions: mentionsFor(c) }).catch(() => {});
  }
  kit.prune(mc, now);
}

// ── Commands ────────────────────────────────────────────────────────────────

export const commands = [
  new SlashCommandBuilder().setName('quarantine').setDescription('Quarantine a member: only #appeal stays visible (instead of a ban)')
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why (they read it)').setRequired(true).setMaxLength(500))
    .addStringOption((o) => o.setName('length').setDescription('How long, e.g. 1d, 7d (empty: until a mod lifts it)')),
  new SlashCommandBuilder().setName('unquarantine').setDescription('Lift a quarantine: their roles come back')
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(500)),
  new SlashCommandBuilder().setName('appeal').setDescription('Appeal your timeout or quarantine (a short form), or a ban of the official Minecraft server')
    .addStringOption((o) => o.setName('minecraft_name').setDescription('Banned from the official Minecraft server? Your in-game name').setMaxLength(16)),
  new SlashCommandBuilder().setName('close').setDescription('Close this mod-mail conversation (they are told)').setDefaultMemberPermissions(P.ManageMessages),
  new SlashCommandBuilder().setName('case').setDescription('Show a mod case').setDefaultMemberPermissions(P.ModerateMembers)
    .addIntegerOption((o) => o.setName('number').setDescription('The case number').setRequired(true).setMinValue(1)),
];

export const handlers = {
  async quarantine(i) {
    const user = i.options.getUser('member');
    const m = await i.guild.members.fetch(user.id).catch(() => null);
    if (!m) return i.reply(ephemeral("They're not in the server."));
    if (m.id === i.user.id || user.bot || isStaff(m) || m.roles.highest.position >= i.member.roles.highest.position) return i.reply(ephemeral("You can't do that to yourself, staff, bots, or someone above you."));
    if (mc.quarantined[m.id] && m.roles.cache.has(quarantineRole())) return i.reply(ephemeral('They are quarantined already.'));
    const len = i.options.getString('length');
    const ms = len ? parseDuration(len) : null;
    if (len && !ms) return i.reply(ephemeral('Give a length like 1d or 7d, or leave it empty.'));
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await quarantine(m, { by: i.user.id, reason: i.options.getString('reason'), ms });
    return i.editReply(`Quarantined <@${m.id}>${ms ? ` for ${kit.human(ms)}` : ''}: the case is in #mod-actions; add evidence there.`);
  },
  async unquarantine(i) {
    const user = i.options.getUser('member');
    if (!mc.quarantined[user.id]) return i.reply(ephemeral("They're not quarantined."));
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const r = await unquarantine(user.id, { by: i.user.id, reason: i.options.getString('reason') ?? 'lifted by a mod' });
    return i.editReply(r.ok ? `Lifted: <@${user.id}> has their roles back.` : `Forgotten: ${r.error}.`);
  },
  appeal: (i) => openForm(i, null, i.options.getString('minecraft_name') ?? null),
  async close(i) {
    if (!i.channel?.isThread() || i.channel.parentId !== channel('modmail')?.id || !mailUser(i.channelId)) return i.reply(ephemeral('Use it in an open mod-mail thread.'));
    await i.reply(ephemeral('Closing.'));
    return closeMail(i.channel, i.user.id);
  },
  async case(i) {
    const c = mc.cases[i.options.getInteger('number')];
    if (!c) return i.reply(ephemeral('No such case.'));
    return i.reply(ephemeral(c.url ? `[Case #${c.n}](${c.url})` : `Case #${c.n}`, { embeds: [caseEmbed(c)] }));
  },
};

// ── The website's appeal page (banned users) and the Moderation dashboard ─────
// Routes of the staff API (src/staff-http.js, behind playhorizon.dev's /staff/api proxy). 'public' ones: the appeal
// link (or the Discord sign-in, when DISCORD_OAUTH_CLIENT_SECRET is set and the redirect is registered) is the proof.

const OAUTH = {
  secret: () => process.env.DISCORD_OAUTH_CLIENT_SECRET || '',
  redirect: () => `${SITE}/staff/api/appeal/callback`,
};
const STATE_COOKIE = '__Host-appeal-state';
const stateOf = (req) => String(req.headers.cookie ?? '').split(';').map((p) => p.trim().split('=')).find(([k]) => k === STATE_COOKIE)?.[1] ?? null;

export function routes({ fetchImpl = fetch } = {}) {
  const limits = failures({ staffIp: [20, kit.MIN] });
  const slow = { status: 429, body: { error: 'Too many failed attempts. Try again later.' } };
  const who = (ctx) => {
    if (limits.blocked('staffIp', ctx.ip)) return { error: slow };
    const user = kit.tokenUser(mc, ctx.body.token, ctx.now);
    if (!user) { limits.fail('staffIp', ctx.ip); return { error: { status: 404, body: { error: 'This link is unknown or expired. Sign in with Discord, or use the link Kira sent you.' } } }; }
    return { user };
  };
  const names = (ids) => Object.fromEntries([...new Set(ids)].filter((id) => id && id !== kit.KIRA).map((id) => [id, client.users.cache.get(id)?.username ?? null]).filter(([, n]) => n));
  const redirect = (res, to, cookie) => { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) }); res.end(); };
  return [
    { method: 'POST', path: 'appeal/config', role: 'public', handler: () => ({ body: { signIn: !!OAUTH.secret(), questions: kit.QUESTIONS } }) },
    { method: 'POST', path: 'appeal/peek', role: 'public', handler: async (ctx) => {
      const { user, error } = who(ctx);
      if (error) return error;
      const u = await client.users.fetch(user).catch(() => null);
      return { body: { name: u?.username ?? null, ...kit.personView(mc, user, ctx.now) } };
    } },
    { method: 'POST', path: 'appeal/submit', role: 'public', handler: async (ctx) => {
      const { user, error } = who(ctx);
      if (error) return error;
      const kind = ctx.body.kind === 'minecraft' ? 'minecraft' : 'discord';
      const c0 = kind === 'discord' ? mc.cases[Number(ctx.body.case)] : null;
      if (kind === 'discord' && c0?.action !== 'ban') return { status: 400, body: { error: 'This page is for bans: a timeout or quarantine is appealed on Discord.' } };
      const u = await client.users.fetch(user).catch(() => null);
      const { appeal, case: c } = kit.submitAppeal(mc, { userId: user, tag: tagOf(u), caseNo: ctx.body.case, kind, answers: ctx.body.answers ?? {}, ign: ctx.body.ign, banText: ctx.body.banText, via: 'web' }, ctx.now);
      save();
      if (c.action === 'mcban' && !c.url) await postCase(c);
      await postAppeal(appeal, c);
      return { body: { ok: true, case: c.n } };
    } },
    { method: 'GET', path: 'appeal/login', role: 'public', raw: (ctx, req, res) => {
      if (!OAUTH.secret()) return redirect(res, '/hub/appeal#signin-off');
      const st = randomBytes(24).toString('base64url');
      const q = new URLSearchParams({ client_id: APP_ID, response_type: 'code', redirect_uri: OAUTH.redirect(), scope: 'identify', state: st, prompt: 'none' });
      return redirect(res, `https://discord.com/oauth2/authorize?${q}`, `${STATE_COOKIE}=${st}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    } },
    { method: 'GET', path: 'appeal/callback', role: 'public', raw: async (ctx, req, res) => {
      const clear = `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
      const st = stateOf(req);
      if (!OAUTH.secret() || !ctx.query.code || !st || st !== ctx.query.state) { limits.fail('staffIp', ctx.ip); return redirect(res, '/hub/appeal#signin-failed', clear); }
      try {
        const tok = await fetchImpl('https://discord.com/api/v10/oauth2/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10_000),
          body: new URLSearchParams({ client_id: APP_ID, client_secret: OAUTH.secret(), grant_type: 'authorization_code', code: String(ctx.query.code), redirect_uri: OAUTH.redirect() }),
        }).then((r) => (r.ok ? r.json() : null));
        const me = tok?.access_token && await fetchImpl('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json() : null));
        if (!me?.id) return redirect(res, '/hub/appeal#signin-failed', clear);
        const { token } = kit.issueToken(mc, me.id, ctx.now);
        save();
        return redirect(res, `/hub/appeal#${token}`, clear);
      } catch (e) {
        console.error('appeal sign-in', e.message);
        return redirect(res, '/hub/appeal#signin-failed', clear);
      }
    } },
    { method: 'GET', path: 'mod/cases', role: 'mod', handler: () => {
      const view = kit.staffView(mc);
      return { body: { ...view, people: names([...view.cases.flatMap((c) => [c.userId, c.by]), ...view.appeals.flatMap((a) => [a.userId, a.decidedBy])]) } };
    } },
  ];
}

// ── Wiring ──────────────────────────────────────────────────────────────────

export function setup() {
  client.on('guildAuditLogEntryCreate', (entry, g) => onAudit(entry, g).catch((e) => console.error('mod case', e)));
  client.once('clientReady', () => ensure().catch((e) => console.error('mod cases setup', e)));
  client.on('channelCreate', (ch) => { const qid = quarantineRole(); if (ch.guildId === GUILD_ID && qid) hide(ch, qid).catch(() => {}); });
  // Leaving and coming back doesn't end a quarantine.
  client.on('guildMemberAdd', (m) => {
    const qid = quarantineRole();
    if (m.guild.id !== GUILD_ID || !qid || !mc.quarantined[m.id]) return;
    expect(m.id, 'quarantine', { skip: true });
    m.roles.add(qid, 'still quarantined (left and came back)').catch((e) => console.error('quarantine rejoin', e.message));
  });
  client.on('interactionCreate', (i) => {
    const id = i.customId ?? '';
    const run = i.isButton?.() ? (id.startsWith('appeal:open') ? () => openForm(i, Number(id.split(':')[2]) || null)
      : id.startsWith('appeal:d:') ? () => onDecisionButton(i) : id.startsWith('case:evidence:') ? () => onEvidenceButton(i)
      : id.startsWith('mail:') && i.guildId === GUILD_ID ? () => onMailButton(i) : null)
      : i.isModalSubmit?.() ? (id.startsWith('appeal:form:') ? () => submitForm(i) : id.startsWith('appeal:dm:') ? () => onDecisionModal(i)
      : id.startsWith('case:evform:') ? () => onEvidenceModal(i) : null) : null;
    if (run) run().catch((e) => { console.error('mod cases', id, e); (i.deferred || i.replied ? i.editReply('Something went wrong.') : i.reply(ephemeral('Something went wrong.'))).catch(() => {}); });
  });
  setInterval(() => tick().catch((e) => console.error('mod cases tick', e.message)), kit.MIN).unref?.();
  setInterval(() => remind().catch((e) => console.error('appeal reminders', e.message)), 15 * kit.MIN).unref?.();
}

export const _test = { mc, exp, onAudit, applyDecision, routes };
// Exported for the counters in staff.js (appeal threads in #mod-mail are not mod-mail conversations).
export const isAppealThread = (thread) => /^⚖️/u.test(thread?.name ?? '');
