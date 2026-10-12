// Moderation: automatic filters (on top of Discord's AutoMod), logs, raid mode, invite tracking,
// member reports, and the mods' commands.
import {
  SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits as P,
  MessageFlags, GuildVerificationLevel, EmbedBuilder,
} from 'discord.js';
import { GUILD_ID, MOD } from '../config.js';
import { client, state, save, channel, isStaff, clip, ago, modlog, parseDuration, human } from '../core.js';

const URL_RE = /(https?:\/\/|www\.|discord\.gg\/)\S+/i;
const recent = new Map(); // userId → [{ id, channelId, at, content }]
const joins = [];         // timestamps of recent joins, for raid detection
const invites = new Map(); // code → uses

// ── Commands ────────────────────────────────────────────────────────────────

const member = (o) => o.setName('member').setDescription('Who').setRequired(true);
const reason = (o, required = false) => o.setName('reason').setDescription('Why (they get it in a DM)').setRequired(required).setMaxLength(500);

export const commands = [
  new SlashCommandBuilder().setName('report').setDescription('Report a member to the mods (only the mods see it)')
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
  report: (i) => report(i, i.options.getUser('member'), i.options.getString('reason')),
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
    return i.reply(ephemeral(on ? 'Raid mode on: newcomers need a verified phone number.' : 'Raid mode off.'));
  },
};

async function setRaidMode(guild, on, why) {
  await guild.setVerificationLevel(on ? GuildVerificationLevel.VeryHigh : GuildVerificationLevel.Medium, `raid mode ${on ? 'on' : 'off'} (${why})`);
  state.raidmode = on; save();
  await modlog(on ? '🚨 Raid mode ON' : 'Raid mode off', `${why}. Verification level: ${on ? 'very high (verified phone)' : 'medium'}. ${on ? 'Turn it off with `/raidmode on:false`.' : ''}`, on ? 0xff0000 : 0x2ecc71);
}

// ── Automatic filters ──────────────────────────────────────────────────────

async function moderate(msg) {
  const m = msg.member;
  if (!m || isStaff(m)) return;

  // Brand-new accounts can't post links: that's how most scams arrive.
  if (URL_RE.test(msg.content) && Date.now() - msg.author.createdTimestamp < MOD.newAccountDays * 86_400_000) {
    await msg.delete().catch(() => {});
    const note = await msg.channel.send({ content: `<@${msg.author.id}> accounts younger than ${MOD.newAccountDays} days can't post links yet (rule 4).`, allowedMentions: { users: [msg.author.id] } });
    setTimeout(() => note.delete().catch(() => {}), 15_000);
    await modlog('🔗 Link from a new account', `<@${msg.author.id}> (${msg.author.tag}, account ${ago(msg.author.createdTimestamp)} old) in <#${msg.channel.id}>:\n${clip(msg.content)}`, 0xffb020);
    return true;
  }

  // Shouting: a long message almost all in capitals.
  const letters = msg.content.replace(/[^a-zA-Z]/g, '');
  if (letters.length >= MOD.capsMin && letters.replace(/[^A-Z]/g, '').length / letters.length >= MOD.capsRatio) {
    await msg.delete().catch(() => {});
    const note = await msg.channel.send({ content: `<@${msg.author.id}> no need to shout 🙂 (all-caps messages are removed).`, allowedMentions: { users: [msg.author.id] } });
    setTimeout(() => note.delete().catch(() => {}), 10_000);
    return true;
  }

  // Floods and copy-pasted messages.
  const now = Date.now();
  const list = (recent.get(msg.author.id) ?? []).filter((x) => now - x.at < Math.max(MOD.floodWindowMs, MOD.repeatWindowMs));
  list.push({ id: msg.id, channelId: msg.channel.id, at: now, content: msg.content.trim().toLowerCase() });
  recent.set(msg.author.id, list);
  const burst = list.filter((x) => now - x.at < MOD.floodWindowMs);
  const same = msg.content.trim() ? list.filter((x) => x.content === list.at(-1).content) : [];
  const why = burst.length >= MOD.floodMessages ? `${burst.length} messages in ${MOD.floodWindowMs / 1000} s`
    : same.length >= MOD.repeatCount ? `the same message ${same.length} times` : null;
  if (!why) return false;
  recent.delete(msg.author.id);
  const offending = burst.length >= MOD.floodMessages ? burst : same;
  for (const x of offending) await client.channels.cache.get(x.channelId)?.messages.delete(x.id).catch(() => {});
  await m.timeout(MOD.floodTimeoutMs, `Kira: spam (${why})`).catch(console.error);
  await msg.channel.send({ content: `<@${msg.author.id}> timed out for ${MOD.floodTimeoutMs / 60_000} minutes: spam (${why}).`, allowedMentions: { parse: [] } });
  await modlog('🔇 Spam timeout', `<@${msg.author.id}> (${msg.author.tag}) in <#${msg.channel.id}>: ${why}, ${offending.length} messages deleted.\n> ${clip(msg.content, 300)}`, 0xff4d4d);
  return true;
}

// ── Events ──────────────────────────────────────────────────────────────────

async function cacheInvites(guild) {
  const all = await guild.invites.fetch().catch(() => null);
  if (all) { invites.clear(); for (const inv of all.values()) invites.set(inv.code, inv.uses); }
}

export function setup() {
  client.once('clientReady', async () => cacheInvites(await client.guilds.fetch(GUILD_ID)));
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
    await modlog('📥 Joined', `<@${m.id}> (${m.user.tag}), account ${ago(m.user.createdTimestamp)} old${young ? ' ⚠️' : ''}${via}`, 0x2ecc71);
    // Raid: too many joins in a minute.
    joins.push(Date.now());
    while (joins.length && Date.now() - joins[0] > MOD.raidWindowMs) joins.shift();
    if (joins.length >= MOD.raidJoins && !state.raidmode) await setRaidMode(m.guild, true, `${joins.length} joins in ${MOD.raidWindowMs / 1000} s`);
  });

  client.on('guildMemberRemove', async (m) => {
    if (m.guild.id !== GUILD_ID) return;
    await modlog('📤 Left', `<@${m.id}> (${m.user?.tag ?? 'unknown'})${m.joinedTimestamp ? `, joined <t:${Math.floor(m.joinedTimestamp / 1000)}:R>` : ''}`);
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
