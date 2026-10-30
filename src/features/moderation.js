// Moderation: automatic filters (on top of Discord's AutoMod), the AI check in every language, logs, raid mode, invite
// tracking, member reports, and the mods' commands.
import {
  SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits as P,
  MessageFlags, GuildVerificationLevel, EmbedBuilder,
} from 'discord.js';
import { GUILD_ID, MOD, LAYOUT, AI, RULES } from '../config.js';
import { client, state, save, channel, isStaff, clip, ago, modlog, parseDuration, human, quietDeletes } from '../core.js';
import { linkify } from '../texts.js';
import * as kiraAi from './ai.js';

const URL_RE = /(https?:\/\/|www\.|discord\.gg\/)\S+/i;
const URLS = new RegExp(URL_RE.source, 'gi');
const recent = new Map(); // userId → [{ id, channelId, at, content }]
const youngJoins = [];    // timestamps of recent joins by young accounts, for raid detection
const traffic = new Map(); // channelId → messages in the current minute
const joinQueue = [];      // join / leave lines waiting to be logged together
state.spamStrikes ??= {};  // userId → timestamps of automatic spam timeouts
state.aiRemovals ??= {};   // userId → timestamps of messages the AI check removed
const invites = new Map(); // code → uses

// ── Commands ────────────────────────────────────────────────────────────────

const member = (o) => o.setName('member').setDescription('Who').setRequired(true);
const reason = (o, required = false) => o.setName('reason').setDescription('Why (they get it in a DM)').setRequired(required).setMaxLength(500);

export const commands = [
  new SlashCommandBuilder().setName('report-member').setDescription('Report a member to the mods (only the mods see it)')
    .addUserOption(member).addStringOption((o) => o.setName('reason').setDescription('What happened').setRequired(true).setMaxLength(1000)),
  new ContextMenuCommandBuilder().setName('Report to mods').setType(ApplicationCommandType.Message),
  new SlashCommandBuilder().setName('warn').setDescription(`Warn a member (${MOD.warnLimit} warnings in ${MOD.warnWindowDays} days = 1 h timeout)`)
    .setDefaultMemberPermissions(P.ModerateMembers).addUserOption(member).addStringOption((o) => reason(o, true)),
  new SlashCommandBuilder().setName('warnings').setDescription("A member's warnings").setDefaultMemberPermissions(P.ModerateMembers).addUserOption(member),
  new SlashCommandBuilder().setName('clearwarnings').setDescription("Clear a member's warnings").setDefaultMemberPermissions(P.ModerateMembers).addUserOption(member),
  new SlashCommandBuilder().setName('timeout').setDescription('Time a member out')
    .setDefaultMemberPermissions(P.ModerateMembers).addUserOption(member)
    .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 2h, 1d (max 28d)').setRequired(true)).addStringOption(reason),
  new SlashCommandBuilder().setName('untimeout').setDescription('End a timeout').setDefaultMemberPermissions(P.ModerateMembers).addUserOption(member),
  new SlashCommandBuilder().setName('kick').setDescription('Kick a member').setDefaultMemberPermissions(P.KickMembers).addUserOption(member).addStringOption(reason),
  new SlashCommandBuilder().setName('ban').setDescription('Ban a member').setDefaultMemberPermissions(P.BanMembers).addUserOption(member).addStringOption(reason)
    .addIntegerOption((o) => o.setName('delete_days').setDescription('Delete their messages from the last N days (0-7)').setMinValue(0).setMaxValue(7)),
  new SlashCommandBuilder().setName('unban').setDescription('Unban a user by ID').setDefaultMemberPermissions(P.BanMembers)
    .addStringOption((o) => o.setName('user_id').setDescription('Their user ID').setRequired(true)),
  new SlashCommandBuilder().setName('purge').setDescription('Delete recent messages in this channel').setDefaultMemberPermissions(P.ManageMessages)
    .addIntegerOption((o) => o.setName('count').setDescription('How many (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((o) => o.setName('member').setDescription("Only this member's messages")),
  new SlashCommandBuilder().setName('slowmode').setDescription('Set slowmode in this channel').setDefaultMemberPermissions(P.ManageChannels)
    .addIntegerOption((o) => o.setName('seconds').setDescription('0 to turn it off, up to 21600').setRequired(true).setMinValue(0).setMaxValue(21600)),
  new SlashCommandBuilder().setName('lock').setDescription('Stop everyone from writing in this channel').setDefaultMemberPermissions(P.ManageChannels).addStringOption(reason),
  new SlashCommandBuilder().setName('unlock').setDescription('Let everyone write in this channel again').setDefaultMemberPermissions(P.ManageChannels),
  new SlashCommandBuilder().setName('raidmode').setDescription('Raid mode: the highest verification level for newcomers').setDefaultMemberPermissions(P.ManageGuild)
    .addBooleanOption((o) => o.setName('on').setDescription('On or off').setRequired(true)),
];

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const activeWarnings = (id) => (state.warnings[id] ?? []).filter((w) => w.at >= Date.now() - MOD.warnWindowDays * 86_400_000);

async function target(i) {
  const user = i.options.getUser('member');
  const m = await i.guild.members.fetch(user.id).catch(() => null);
  if (!m) { await i.reply(ephemeral("They're not in the server.")); return null; }
  if (m.id === i.user.id) { await i.reply(ephemeral("That's you.")); return null; }
  if (isStaff(m) || user.bot || m.roles.highest.position >= i.member.roles.highest.position) { await i.reply(ephemeral("You can't do that to staff, bots, or someone above you.")); return null; }
  return m;
}
const dm = (user, text) => user.send(text).catch(() => {});

async function report(i, about, text, message) {
  const embed = new EmbedBuilder().setColor(0xff4d4d).setTitle('🚩 Report')
    .setDescription(`From <@${i.user.id}> about <@${about.id}> (${about.tag})\n\n${clip(text, 1500)}`)
    .setTimestamp();
  if (message) embed.addFields({ name: 'Message', value: `${clip(message.content, 900)}\n[jump](${message.url})` });
  await channel('reports')?.send({ content: state.roles.mod ? `<@&${state.roles.mod}>` : undefined, embeds: [embed], allowedMentions: { roles: [state.roles.mod] } });
  return i.reply(ephemeral('Sent to the mods. Thanks. Only they see it.'));
}

export const handlers = {
  'report-member': (i) => report(i, i.options.getUser('member'), i.options.getString('reason')),
  'Report to mods': (i) => report(i, i.targetMessage.author, 'Reported this message.', i.targetMessage),

  async warn(i) {
    const m = await target(i); if (!m) return;
    const why = i.options.getString('reason');
    (state.warnings[m.id] ??= []).push({ at: Date.now(), by: i.user.id, reason: why });
    save();
    const count = activeWarnings(m.id).length;
    await dm(m.user, `⚠️ You've been warned in **${i.guild.name}**: ${why}\nThat's ${count} in the last ${MOD.warnWindowDays} days; at ${MOD.warnLimit} you get a 1-hour timeout.`);
    let extra = '';
    if (count >= MOD.warnLimit) { await m.timeout(MOD.warnTimeoutMs, `${count} warnings`).catch(console.error); extra = ' → **1 h timeout**'; }
    await modlog('⚠️ Warning', `<@${m.id}> (${m.user.tag}) by <@${i.user.id}>: ${why}\n${count}/${MOD.warnLimit} in ${MOD.warnWindowDays} days${extra}`, 0xffb020);
    return i.reply(ephemeral(`Warned <@${m.id}> (${count}/${MOD.warnLimit})${extra}.`));
  },
  async warnings(i) {
    const user = i.options.getUser('member');
    const all = state.warnings[user.id] ?? [];
    const text = all.length ? all.map((w) => `<t:${Math.floor(w.at / 1000)}:d> by <@${w.by}>: ${w.reason}`).join('\n') : 'No warnings.';
    return i.reply(ephemeral(`**${user.tag}**: ${activeWarnings(user.id).length} active\n${clip(text, 1800)}`));
  },
  async clearwarnings(i) {
    const user = i.options.getUser('member');
    delete state.warnings[user.id]; save();
    await modlog('🧹 Warnings cleared', `<@${user.id}> by <@${i.user.id}>`);
    return i.reply(ephemeral(`Cleared ${user.tag}'s warnings.`));
  },
  async timeout(i) {
    const m = await target(i); if (!m) return;
    const ms = parseDuration(i.options.getString('duration'));
    if (!ms || ms > 28 * 864e5) return i.reply(ephemeral('Give a duration like 10m, 2h or 3d (28 days at most).'));
    const why = i.options.getString('reason') ?? 'no reason given';
    await m.timeout(ms, `${i.user.tag}: ${why}`);
    await dm(m.user, `⏳ You've been timed out in **${i.guild.name}** for ${human(ms)}: ${why}`);
    return i.reply(ephemeral(`Timed out <@${m.id}> for ${human(ms)}.`));
  },
  async untimeout(i) {
    const m = await i.guild.members.fetch(i.options.getUser('member').id).catch(() => null);
    if (!m) return i.reply(ephemeral("They're not in the server."));
    await m.timeout(null, `by ${i.user.tag}`);
    await modlog('Timeout ended', `<@${m.id}> by <@${i.user.id}>`);
    return i.reply(ephemeral(`Timeout ended for <@${m.id}>.`));
  },
  async kick(i) {
    const m = await target(i); if (!m) return;
    const why = i.options.getString('reason') ?? 'no reason given';
    await dm(m.user, `👢 You've been kicked from **${i.guild.name}**: ${why}`);
    await m.kick(`${i.user.tag}: ${why}`);
    await modlog('👢 Kicked', `<@${m.id}> (${m.user.tag}) by <@${i.user.id}>: ${why}`, 0xff4d4d);
    return i.reply(ephemeral(`Kicked ${m.user.tag}.`));
  },
  async ban(i) {
    const m = await target(i); if (!m) return;
    const why = i.options.getString('reason') ?? 'no reason given';
    await dm(m.user, `🔨 You've been banned from **${i.guild.name}**: ${why}`);
    await m.ban({ reason: `${i.user.tag}: ${why}`, deleteMessageSeconds: (i.options.getInteger('delete_days') ?? 0) * 86400 });
    return i.reply(ephemeral(`Banned ${m.user.tag}.`));
  },
  async unban(i) {
    const id = i.options.getString('user_id').replace(/\D/g, '');
    await i.guild.bans.remove(id, `by ${i.user.tag}`).catch(() => null);
    return i.reply(ephemeral(`Unbanned ${id} (if they were banned).`));
  },
  async purge(i) {
    const count = i.options.getInteger('count');
    const only = i.options.getUser('member');
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    let msgs = await i.channel.messages.fetch({ limit: only ? 100 : count });
    if (only) msgs = msgs.filter((m) => m.author.id === only.id).first(count);
    const deleted = await i.channel.bulkDelete(msgs, true);
    await modlog('🗑️ Purge', `${deleted.size} messages in <#${i.channel.id}> by <@${i.user.id}>${only ? ` (only <@${only.id}>)` : ''}`);
    return i.editReply(`Deleted ${deleted.size} messages (Discord can't bulk-delete messages older than 14 days).`);
  },
  async slowmode(i) {
    const s = i.options.getInteger('seconds');
    await i.channel.setRateLimitPerUser(s, `by ${i.user.tag}`);
    return i.reply(ephemeral(s ? `Slowmode: ${s} s.` : 'Slowmode off.'));
  },
  async lock(i) {
    await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: false, SendMessagesInThreads: false }, { reason: `lock by ${i.user.tag}` });
    await i.channel.send(`🔒 Channel locked by the mods${i.options.getString('reason') ? `: ${i.options.getString('reason')}` : '.'}`);
    await modlog('🔒 Locked', `<#${i.channel.id}> by <@${i.user.id}>`);
    return i.reply(ephemeral('Locked. `/unlock` to open it again.'));
  },
  async unlock(i) {
    await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: null, SendMessagesInThreads: null }, { reason: `unlock by ${i.user.tag}` });
    await i.channel.send('🔓 Channel unlocked.');
    await modlog('🔓 Unlocked', `<#${i.channel.id}> by <@${i.user.id}>`);
    return i.reply(ephemeral('Unlocked.'));
  },
  async raidmode(i) {
    const on = i.options.getBoolean('on');
    await setRaidMode(i.guild, on, `by ${i.user.tag}`);
    return i.reply(ephemeral(on ? 'Raid mode on for an hour: a verified phone number to talk, DMs between members paused.' : 'Raid mode off.'));
  },
};

// Raid mode: a verified phone number to talk, and DMs between members paused, for an hour (renewed while it lasts).
async function setRaidMode(guild, on, why) {
  await guild.setVerificationLevel(on ? GuildVerificationLevel.VeryHigh : GuildVerificationLevel.High, `raid mode ${on ? 'on' : 'off'} (${why})`);
  const until = on ? new Date(Date.now() + MOD.raidHoldMs).toISOString() : null;
  await client.rest.put(`/guilds/${guild.id}/incident-actions`, { body: { dms_disabled_until: until, invites_disabled_until: null } }).catch((e) => console.error('incident actions', e.message));
  state.raidmode = on ? Date.now() + MOD.raidHoldMs : false; save();
  await modlog(on ? '🚨 Raid mode ON' : 'Raid mode off', `${why}. Verification: ${on ? 'very high (verified phone), DMs between members paused. Off by itself after an hour of calm, or `/raidmode on:false`.' : 'back to high.'}`, on ? 0xff0000 : 0x2ecc71);
}

// Automatic spam timeouts get longer when it happens again within a day.
async function spamTimeout(m, why) {
  const day = Date.now() - 864e5;
  const strikes = (state.spamStrikes[m.id] ?? []).filter((t) => t > day);
  strikes.push(Date.now());
  state.spamStrikes[m.id] = strikes; save();
  const ms = MOD.spamTimeoutsMs[Math.min(strikes.length, MOD.spamTimeoutsMs.length) - 1];
  await m.timeout(ms, `Kira: ${why} (strike ${strikes.length})`).catch(console.error);
  return { ms, strike: strikes.length };
}

async function remove(msg, note, log) {
  await msg.delete().catch(() => {});
  if (note) {
    const n = await msg.channel.send({ content: `<@${msg.author.id}> ${note}`, allowedMentions: { users: [msg.author.id] } }).catch(() => null);
    if (n) setTimeout(() => n.delete().catch(() => {}), 12_000).unref?.();
  }
  if (log) await modlog(log, `<@${msg.author.id}> (${msg.author.tag}) in <#${msg.channel.id}>:\n${clip(msg.content)}${msg.attachments.size ? `\n📎 ${msg.attachments.map((a) => a.name).join(', ')}` : ''}`, 0xffb020);
  return true;
}

// ── Automatic filters ──────────────────────────────────────────────────────

async function moderate(msg) {
  const m = msg.member;
  if (!m || isStaff(m)) return;

  traffic.set(msg.channelId, (traffic.get(msg.channelId) ?? 0) + 1);

  // Executables and scripts: the classic malware drop.
  if (msg.attachments.some((a) => MOD.dangerousFiles.test(a.name ?? ''))) {
    return remove(msg, "executables and scripts can't be posted here (rule 4). Share code as text or a repo link.", '☣️ Dangerous file removed');
  }
  // Brand-new accounts can't post links: that's how most scams arrive.
  if (URL_RE.test(msg.content) && Date.now() - msg.author.createdTimestamp < MOD.newAccountDays * 86_400_000) {
    return remove(msg, `accounts younger than ${MOD.newAccountDays} days can't post links yet (rule 4).`, '🔗 Link from a new account');
  }
  // A wall of links.
  const links = (msg.content.match(URLS) ?? []).length;
  if (links > MOD.linkMax) return remove(msg, `${MOD.linkMax} links per message at most (rule 2).`, '🔗 Too many links');
  // Shouting: a long message almost all in capitals.
  const letters = msg.content.replace(/[^a-zA-Z]/g, '');
  if (letters.length >= MOD.capsMin && letters.replace(/[^A-Z]/g, '').length / letters.length >= MOD.capsRatio) {
    return remove(msg, 'no need to shout 🙂 (all-caps messages are removed).');
  }
  // A wall of emojis.
  const emojis = (msg.content.match(/<a?:\w+:\d+>|\p{Extended_Pictographic}/gu) ?? []).length;
  if (emojis > MOD.emojiMax) return remove(msg, `too many emojis in one message (${MOD.emojiMax} at most).`);

  // Floods, copy-pasted messages and link floods.
  const now = Date.now();
  const list = (recent.get(msg.author.id) ?? []).filter((x) => now - x.at < Math.max(MOD.floodWindowMs, MOD.repeatWindowMs, MOD.linkWindowMs));
  list.push({ id: msg.id, channelId: msg.channel.id, at: now, content: msg.content.trim().toLowerCase(), links });
  recent.set(msg.author.id, list);
  const burst = list.filter((x) => now - x.at < MOD.floodWindowMs);
  const same = msg.content.trim() ? list.filter((x) => x.content === list.at(-1).content) : [];
  const linked = list.filter((x) => x.links && now - x.at < MOD.linkWindowMs);
  const [why, offending] = burst.length >= MOD.floodMessages ? [`${burst.length} messages in ${MOD.floodWindowMs / 1000} s`, burst]
    : same.length >= MOD.repeatCount ? [`the same message ${same.length} times`, same]
    : linked.length >= MOD.linkFloodMessages ? [`${linked.length} messages with links in ${MOD.linkWindowMs / 1000} s`, linked] : [];
  if (!why) { queueAi(msg); return false; }
  recent.delete(msg.author.id);
  for (const x of offending) dropAi(x.id); // deleted below: not worth reading
  for (const x of offending) await client.channels.cache.get(x.channelId)?.messages.delete(x.id).catch(() => {});
  const { ms, strike } = await spamTimeout(m, `spam (${why})`);
  await msg.channel.send({ content: `<@${msg.author.id}> timed out for ${human(ms)}: spam (${why}).`, allowedMentions: { parse: [] } });
  await modlog('🔇 Spam timeout', `<@${msg.author.id}> (${msg.author.tag}) in <#${msg.channel.id}>: ${why}, ${offending.length} messages deleted, ${human(ms)} (strike ${strike} today).\n> ${clip(msg.content, 300)}`, 0xff4d4d);
  return true;
}

// ── The AI check, in every language ─────────────────────────────────────────
// What the filters let through in the 🌍 languages channels, in AI.modChannels (#horizon-chat, #general), and non-English messages
// anywhere is read by Haiku (src/features/ai.js moderateBatch: same client and daily budget as Kira's answers), in
// batches per channel. "remove" (only clear cases: slurs, hate, threats, sexual content, doxxing, scams, targeted
// harassment) deletes the message, posts the usual short note in the member's language and logs it; from the second
// removal in a day the spam timeout ladder applies. "flag" only logs it for a mod. Nothing else is ever done on the
// model's say. Off, budget spent or API down: nothing is read, the filters above still run.

const LANG_OF = { russian: 'ru', portuguese: 'pt', spanish: 'es', french: 'fr', german: 'de', polish: 'pl', turkish: 'tr', chinese: 'zh', japanese: 'ja' };
const LANG_KEYS = LAYOUT.find((g) => g.key === 'languages')?.channels.map((c) => c.key) ?? [];
// The note under a removed message, in the member's language.
export const AI_NOTES = {
  en: (n) => `your message was removed (rule ${n}, see #rules).`,
  ru: (n) => `ваше сообщение удалено (правило ${n}, см. #rules).`,
  es: (n) => `tu mensaje fue eliminado (regla ${n}, ver #rules).`,
  pt: (n) => `sua mensagem foi removida (regra ${n}, veja #rules).`,
  fr: (n) => `ton message a été supprimé (règle ${n}, voir #rules).`,
  de: (n) => `deine Nachricht wurde entfernt (Regel ${n}, siehe #rules).`,
  pl: (n) => `twoja wiadomość została usunięta (zasada ${n}, zobacz #rules).`,
  tr: (n) => `mesajın kaldırıldı (kural ${n}, bkz. #rules).`,
  zh: (n) => `你的消息已被删除（规则 ${n}，见 #rules）。`,
  ja: (n) => `メッセージを削除しました（ルール ${n}、#rules を参照）。`,
};

// Non-English, cheaply: mostly another script (Cyrillic, CJK, Arabic…), or Latin text with more common words of the
// server's other languages than English ones. Short messages ("ok", "lol") never count.
const OTHER_SCRIPT = /[\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Greek}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Georgian}\p{Script=Armenian}]/gu;
const OTHER_WORDS = new Set(('je tu il nous vous est sont pas mais avec pour dans les des une que qui quoi oui merci bonjour salut ça '
  + 'und ich nicht ist das der ein eine mit auch aber wie danke hallo bitte '
  + 'el los las una por para pero como está estoy qué gracias hola sí también '
  + 'não você obrigado olá com uma isso muito '
  + 'jest nie się tak dzięki cześć jak czy '
  + 'bu bir ve için değil merhaba teşekkürler evet ama '
  + 'het een niet ik maar ciao grazie sono che della perché').split(' '));
const ENGLISH_WORDS = new Set('the and you is are it this that what how why to of in for not but with have do does can my your we they be was on just so'.split(' '));
export function looksNonEnglish(text) {
  const s = String(text ?? '').replace(/<a?:\w+:\d+>|<[@#][!&]?\d+>|https?:\/\/\S+|`[^`]*`/g, ' ');
  const letters = (s.match(/\p{L}/gu) ?? []).length;
  if (letters < 6) return false;
  if ((s.match(OTHER_SCRIPT) ?? []).length / letters >= 0.3) return true;
  const words = s.toLowerCase().match(/\p{L}+/gu) ?? [];
  const other = words.filter((w) => OTHER_WORDS.has(w)).length;
  return other >= 2 && other > words.filter((w) => ENGLISH_WORDS.has(w)).length;
}

// Why the AI check reads this message: a LAYOUT key (a language channel, #general), 'non-english', or null. Staff,
// bots and messages without letters are never read.
export function aiScope(msg, st = state) {
  if (!msg.member || isStaff(msg.member) || msg.author?.bot || msg.guildId !== GUILD_ID) return null;
  if (!/\p{L}/u.test(msg.content ?? '')) return null;
  const ids = [msg.channelId, msg.channel?.parentId].filter(Boolean);
  const key = [...LANG_KEYS, ...AI.modChannels].find((k) => st.channels[k] && ids.includes(st.channels[k]));
  if (key) return key;
  return looksNonEnglish(msg.content) ? 'non-english' : null;
}

const pending = new Map(); // channelId → { items: [{ msg, scope }], timer }

function queueAi(msg) {
  if (!kiraAi.modActive()) return;
  const scope = aiScope(msg);
  if (!scope) return;
  let q = pending.get(msg.channelId);
  if (!q) {
    q = { items: [], timer: setTimeout(() => flushAi(msg.channelId).catch(console.error), AI.modBatchMs) };
    q.timer.unref?.();
    pending.set(msg.channelId, q);
  }
  q.items.push({ msg, scope });
  if (q.items.length >= AI.modBatchMax) flushAi(msg.channelId).catch(console.error);
}
function dropAi(id) {
  for (const q of pending.values()) q.items = q.items.filter((x) => x.msg.id !== id);
}

async function flushAi(channelId) {
  const q = pending.get(channelId);
  if (!q) return;
  pending.delete(channelId);
  clearTimeout(q.timer);
  if (!q.items.length) return;
  const r = await kiraAi.moderateBatch(q.items.map(({ msg }) => ({
    author: msg.member?.displayName ?? msg.author?.username ?? 'someone', channel: msg.channel?.name ?? 'unknown', text: msg.content,
  })));
  if (!r) return;
  for (const [i, v] of r.results.entries()) await aiAct(q.items[i], v, r).catch(console.error);
}

const ruleName = (n) => (n ? `${n}. ${RULES[n - 1]?.[0] ?? '?'}` : 'none named');

async function aiAct({ msg, scope }, v, call) {
  if (v.verdict === 'ok') return;
  const who = `<@${msg.author.id}> (${msg.author.tag ?? msg.author.username}) in <#${msg.channelId}>`;
  const fields = [
    { name: 'Original', value: clip(msg.content, 1000) },
    ...(v.language !== 'en' ? [{ name: 'English', value: clip(v.english, 1000) }] : []),
    { name: 'Rule', value: ruleName(v.rule), inline: true },
    { name: 'Category', value: v.category, inline: true },
    { name: 'Why (the model)', value: clip(v.reason, 300) },
    { name: 'Model', value: `${call.model}, $${call.cost.toFixed(5)} for ${call.results.length} message${call.results.length > 1 ? 's' : ''}`, inline: true },
  ];
  if (v.verdict === 'flag') {
    return modlog('🤖 Flagged for a mod (Kira\'s AI)', `${who} · [jump](${msg.url})\nNot deleted: a mod decides.`, 0xf0932b, fields);
  }
  const lang = AI_NOTES[v.language] ? v.language : LANG_OF[scope] ?? 'en';
  await remove(msg, linkify(AI_NOTES[lang](v.rule), state));
  // Repeat offenders: from the second removal in a day, the spam timeout ladder.
  const day = Date.now() - 864e5;
  const removals = [...(state.aiRemovals[msg.author.id] ?? []).filter((t) => t > day), Date.now()];
  state.aiRemovals[msg.author.id] = removals; save();
  let extra = '';
  if (removals.length >= 2 && msg.member) {
    const { ms, strike } = await spamTimeout(msg.member, `rule ${v.rule} (${v.category}), ${removals.length} removals today`);
    extra = `\n${removals.length} removals today → timeout ${human(ms)} (strike ${strike}).`;
  }
  return modlog('🤖 Removed by Kira\'s AI', `${who}${extra}`, 0xff4d4d, fields);
}

// ── Events ──────────────────────────────────────────────────────────────────

async function cacheInvites(guild) {
  const all = await guild.invites.fetch().catch(() => null);
  if (all) { invites.clear(); for (const inv of all.values()) invites.set(inv.code, inv.uses); }
}

const baseSlowmode = new Map(LAYOUT.flatMap((g) => g.channels).filter((c) => c.type === 'text').map((c) => [c.key, c.slowmode ?? 0]));
const calm = new Map(); // channelId → minutes in a row under the threshold

async function everyMinute() {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;
  // Join and leave logs, grouped (with 10,000 people arriving, one message per join would bury the log).
  while (joinQueue.length) {
    const batch = joinQueue.splice(0, 30);
    await modlog(`👥 ${batch.length} joins / leaves`, batch.join('\n').slice(0, 4000), 0x2ecc71);
  }
  // Raid mode ends by itself after an hour of calm.
  if (state.raidmode && Date.now() > state.raidmode) await setRaidMode(guild, false, 'an hour without a raid');
  // Automatic slowmode on channels too fast to read (off while MOD.autoSlowmode is empty).
  for (const [key, base] of MOD.autoSlowmode.length ? baseSlowmode : []) {
    const ch = guild.channels.cache.get(state.channels[key]);
    if (!ch) continue;
    const rate = traffic.get(ch.id) ?? 0;
    const want = MOD.autoSlowmode.find(([perMin]) => rate >= perMin)?.[1] ?? 0;
    if (want > Math.max(base, ch.rateLimitPerUser)) {
      await ch.setRateLimitPerUser(want, `Kira: ${rate} messages a minute`).catch(() => {});
      calm.set(ch.id, 0);
      await modlog('🐢 Auto slowmode', `<#${ch.id}>: ${rate} messages a minute → ${want} s`, 0x5aa9ff);
    } else if (ch.rateLimitPerUser > base && rate < MOD.autoSlowmode.at(-1)[0] / 2) {
      calm.set(ch.id, (calm.get(ch.id) ?? 0) + 1);
      if (calm.get(ch.id) >= 5) { await ch.setRateLimitPerUser(base, 'Kira: calm again').catch(() => {}); calm.delete(ch.id); }
    }
  }
  traffic.clear();
}

export function setup() {
  client.once('clientReady', async () => cacheInvites(await client.guilds.fetch(GUILD_ID)));
  setInterval(() => everyMinute().catch(console.error), MOD.joinBatchMs);
  client.on('inviteCreate', (inv) => invites.set(inv.code, inv.uses ?? 0));
  client.on('inviteDelete', (inv) => invites.delete(inv.code));

  client.on('guildMemberAdd', async (m) => {
    if (m.guild.id !== GUILD_ID) return;
    // Which invite did they use?
    let via = '';
    const now = await m.guild.invites.fetch().catch(() => null);
    if (now) {
      const used = now.find((inv) => (invites.get(inv.code) ?? 0) < inv.uses);
      if (used) via = `, via discord.gg/${used.code}${used.inviter ? ` (by ${used.inviter.tag})` : ''}`;
      for (const inv of now.values()) invites.set(inv.code, inv.uses);
    }
    const young = Date.now() - m.user.createdTimestamp < 86_400_000;
    joinQueue.push(`📥 <@${m.id}> (${m.user.tag}), account ${ago(m.user.createdTimestamp)} old${young ? ' ⚠️' : ''}${via}`);
    // Raid: a burst of brand-new accounts (a busy evening of real people doesn't trigger it).
    if (Date.now() - m.user.createdTimestamp < MOD.raidYoungDays * 864e5) {
      youngJoins.push(Date.now());
      while (youngJoins.length && Date.now() - youngJoins[0] > MOD.raidWindowMs) youngJoins.shift();
      if (youngJoins.length >= MOD.raidJoins) {
        if (!state.raidmode) await setRaidMode(m.guild, true, `${youngJoins.length} accounts younger than ${MOD.raidYoungDays} days joined in ${MOD.raidWindowMs / 60_000} minutes`);
        else state.raidmode = Date.now() + MOD.raidHoldMs; // still going: keep it on
      }
    }
  });

  client.on('guildMemberRemove', async (m) => {
    if (m.guild.id !== GUILD_ID) return;
    joinQueue.push(`📤 <@${m.id}> (${m.user?.tag ?? 'unknown'}) left${m.joinedTimestamp ? `, joined <t:${Math.floor(m.joinedTimestamp / 1000)}:R>` : ''}`);
  });
  client.on('guildBanAdd', (ban) => ban.guild.id === GUILD_ID && modlog('🔨 Banned', `<@${ban.user.id}> (${ban.user.tag})${ban.reason ? `: ${ban.reason}` : ''}`, 0xff4d4d));
  client.on('guildBanRemove', (ban) => ban.guild.id === GUILD_ID && modlog('Unbanned', `<@${ban.user.id}> (${ban.user.tag})`));
  client.on('guildMemberUpdate', (before, after) => {
    if (after.guild.id !== GUILD_ID) return;
    const was = before.communicationDisabledUntilTimestamp ?? 0, is = after.communicationDisabledUntilTimestamp ?? 0;
    if (is > Date.now() && is !== was) modlog('⏳ Timed out', `<@${after.id}> (${after.user.tag}) until <t:${Math.floor(is / 1000)}:f>`, 0xffb020);
    if (before.nickname !== after.nickname && !before.partial) modlog('🏷️ Nickname', `<@${after.id}>: ${before.nickname ?? '(none)'} → ${after.nickname ?? '(none)'}`);
  });
  client.on('messageDelete', async (msg) => {
    if (quietDeletes.delete(msg.id)) return; // a chat clear
    if (msg.guildId !== GUILD_ID || msg.author?.bot || msg.partial || [state.channels.modlog, state.channels.reports].includes(msg.channelId)) return;
    const files = msg.attachments.map((a) => a.name).join(', ');
    await modlog('🗑️ Message deleted', `<@${msg.author.id}> in <#${msg.channelId}>:\n${clip(msg.content)}${files ? `\n📎 ${files}` : ''}`);
  });
  client.on('messageUpdate', async (before, after) => {
    if (after.guildId !== GUILD_ID || after.author?.bot || before.partial || before.content === after.content) return;
    await modlog('✏️ Message edited', `<@${after.author.id}> in <#${after.channelId}> · [jump](${after.url})`, 0x5aa9ff,
      [{ name: 'Before', value: clip(before.content) }, { name: 'After', value: clip(after.content) }]);
  });
}

export { moderate };
export const _test = { pending, flushAll: () => Promise.all([...pending.keys()].map((id) => flushAi(id))) };
