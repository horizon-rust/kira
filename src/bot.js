// Kira at runtime: greets newcomers, moderates, logs, votes on suggestions, posts new videos and releases, answers commands.
import {
  Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionFlagsBits as P,
  SlashCommandBuilder, ChannelType, MessageFlags,
} from 'discord.js';
import { GUILD_ID, LINKS, COLOR, LAYOUT, MOD, HORIZON, PROJECTS, FEED_EVERY_MS } from './config.js';
import { load, save } from './store.js';
import { FEEDS, poll } from './feeds.js';

const state = load();
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Message, Partials.Channel],
});

const channel = (key) => client.channels.cache.get(state.channels[key]);
const ago = (date) => {
  const d = Math.floor((Date.now() - date) / 86_400_000);
  return d < 1 ? 'less than a day' : d === 1 ? '1 day' : `${d} days`;
};
const clip = (s, n = 1000) => (s.length > n ? s.slice(0, n - 1) + '…' : s) || '*(no text)*';
const isStaff = (member) => member?.permissions.has(P.ManageMessages);
const voteForums = new Set(LAYOUT.flatMap((g) => g.channels).filter((c) => c.vote).map((c) => c.key));

async function modlog(title, description, color = 0x888888, fields = []) {
  const ch = channel('modlog');
  if (!ch) return;
  await ch.send({ embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).addFields(fields).setTimestamp()], allowedMentions: { parse: [] } }).catch(console.error);
}

// ── Commands ────────────────────────────────────────────────────────────────

const COMMANDS = [
  new SlashCommandBuilder().setName('links').setDescription("Ludovic's links: YouTube, portfolio, GitHub, lsuite, Horizon"),
  new SlashCommandBuilder().setName('horizon').setDescription('What Horizon is, how to get it, and the disclaimer'),
  new SlashCommandBuilder().setName('roadmap').setDescription("Horizon's roadmap"),
  new SlashCommandBuilder().setName('projects').setDescription("Ludovic's other projects"),
  new SlashCommandBuilder().setName('warn').setDescription('Warn a member (3 warnings in 30 days = 1 h timeout)')
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why (they get it in a DM)').setRequired(true).setMaxLength(500)),
  new SlashCommandBuilder().setName('warnings').setDescription("A member's warnings")
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)),
  new SlashCommandBuilder().setName('clearwarnings').setDescription("Clear a member's warnings")
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)),
  new SlashCommandBuilder().setName('purge').setDescription('Delete recent messages in this channel')
    .setDefaultMemberPermissions(P.ManageMessages)
    .addIntegerOption((o) => o.setName('count').setDescription('How many (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((o) => o.setName('member').setDescription('Only this member\'s messages')),
  new SlashCommandBuilder().setName('slowmode').setDescription('Set slowmode in this channel')
    .setDefaultMemberPermissions(P.ManageChannels)
    .addIntegerOption((o) => o.setName('seconds').setDescription('0 to turn it off, up to 21600').setRequired(true).setMinValue(0).setMaxValue(21600)),
];

const linksEmbed = () => new EmbedBuilder().setColor(COLOR).setTitle('Ludovic').setDescription([
  `▶️ YouTube: ${LINKS.youtube}`, `🌐 Portfolio: ${LINKS.portfolio}`, `💻 GitHub: ${LINKS.github}`,
  `🎨 lsuite: ${LINKS.lsuite}`, `🌅 Horizon: ${LINKS.horizon}`, `𝕏 ${LINKS.x} · 📷 ${LINKS.instagram}`,
  `❤️ Sponsor: ${LINKS.sponsor}`,
].join('\n'));

function activeWarnings(userId) {
  const since = Date.now() - MOD.warnWindowDays * 86_400_000;
  return (state.warnings[userId] ?? []).filter((w) => w.at >= since);
}

async function onCommand(i) {
  const name = i.commandName;
  if (name === 'links') return i.reply({ embeds: [linksEmbed()] });
  if (name === 'horizon') {
    return i.reply({ embeds: [
      new EmbedBuilder().setColor(COLOR).setTitle('🌅 Horizon').setURL(LINKS.horizon).setDescription(`${HORIZON.description}\n\n${HORIZON.get}`),
      new EmbedBuilder().setColor(0x555555).setTitle('⚠️ Disclaimer').setDescription(HORIZON.disclaimer),
    ] });
  }
  if (name === 'roadmap') return i.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle("Horizon's roadmap").setDescription(HORIZON.roadmap)] });
  if (name === 'projects') {
    return i.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle("Ludovic's projects").setDescription(
      PROJECTS.map((p) => `**${p.name}**${p.sub ? ` · ${p.sub}` : ''}\n${p.links.map(([l, u]) => `[${l}](${u})`).join(' · ')}`).join('\n\n')
      + `\n\nMore in <#${state.channels.projects}>.`,
    )] });
  }

  // Moderation commands (Discord only shows them to members with the right permission).
  if (name === 'warn') {
    const user = i.options.getUser('member');
    const reason = i.options.getString('reason');
    const member = await i.guild.members.fetch(user.id).catch(() => null);
    if (!member) return i.reply({ content: "They're not in the server.", flags: MessageFlags.Ephemeral });
    if (isStaff(member) || user.bot) return i.reply({ content: "You can't warn staff or bots.", flags: MessageFlags.Ephemeral });
    (state.warnings[user.id] ??= []).push({ at: Date.now(), by: i.user.id, reason });
    save();
    const count = activeWarnings(user.id).length;
    await user.send(`You've been warned in **${i.guild.name}**: ${reason}\nThat's ${count} in the last ${MOD.warnWindowDays} days; at ${MOD.warnLimit} you get a 1-hour timeout. The rules: <#${state.channels.rules}>`).catch(() => {});
    let extra = '';
    if (count >= MOD.warnLimit) {
      await member.timeout(MOD.warnTimeoutMs, `${count} warnings in ${MOD.warnWindowDays} days`).catch(console.error);
      extra = ' → **1 h timeout**';
    }
    await modlog('⚠️ Warning', `<@${user.id}> (${user.tag}) by <@${i.user.id}>: ${reason}\n${count} in ${MOD.warnWindowDays} days${extra}`, 0xffb020);
    return i.reply({ content: `Warned <@${user.id}> (${count}/${MOD.warnLimit})${extra}.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }
  if (name === 'warnings') {
    const user = i.options.getUser('member');
    const all = state.warnings[user.id] ?? [];
    const text = all.length ? all.map((w) => `<t:${Math.floor(w.at / 1000)}:d> by <@${w.by}>: ${w.reason}`).join('\n') : 'No warnings.';
    return i.reply({ content: `**${user.tag}**, ${activeWarnings(user.id).length} active:\n${clip(text, 1800)}`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }
  if (name === 'clearwarnings') {
    const user = i.options.getUser('member');
    delete state.warnings[user.id];
    save();
    await modlog('🧹 Warnings cleared', `<@${user.id}> by <@${i.user.id}>`);
    return i.reply({ content: `Cleared ${user.tag}'s warnings.`, flags: MessageFlags.Ephemeral });
  }
  if (name === 'purge') {
    const count = i.options.getInteger('count');
    const only = i.options.getUser('member');
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    let msgs = await i.channel.messages.fetch({ limit: only ? 100 : count });
    if (only) msgs = msgs.filter((m) => m.author.id === only.id).first(count);
    const deleted = await i.channel.bulkDelete(msgs, true);
    await modlog('🗑️ Purge', `${deleted.size} messages in <#${i.channel.id}> by <@${i.user.id}>${only ? ` (only <@${only.id}>)` : ''}`);
    return i.editReply(`Deleted ${deleted.size} messages (Discord can't bulk-delete messages older than 14 days).`);
  }
  if (name === 'slowmode') {
    const s = i.options.getInteger('seconds');
    await i.channel.setRateLimitPerUser(s, `by ${i.user.tag}`);
    return i.reply({ content: s ? `Slowmode: ${s} s.` : 'Slowmode off.', flags: MessageFlags.Ephemeral });
  }
}

// ── Automatic moderation (on top of Discord's AutoMod rules set up by setup.js) ──

const recent = new Map(); // userId → [{ id, channelId, at, content }]
const URL_RE = /(https?:\/\/|www\.|discord\.gg\/)\S+/i;

async function moderate(msg) {
  const member = msg.member;
  if (!member || isStaff(member)) return;

  // Brand-new accounts can't post links: that's how most scams arrive.
  if (URL_RE.test(msg.content) && Date.now() - msg.author.createdTimestamp < MOD.newAccountDays * 86_400_000) {
    await msg.delete().catch(() => {});
    const note = await msg.channel.send({ content: `<@${msg.author.id}> accounts younger than ${MOD.newAccountDays} days can't post links yet (rule 4).`, allowedMentions: { users: [msg.author.id] } });
    setTimeout(() => note.delete().catch(() => {}), 15_000);
    await modlog('🔗 Link from a new account', `<@${msg.author.id}> (${msg.author.tag}, account ${ago(msg.author.createdTimestamp)} old) in <#${msg.channel.id}>:\n${clip(msg.content)}`, 0xffb020);
    return;
  }

  // Floods and copy-pasted messages.
  const now = Date.now();
  const list = (recent.get(msg.author.id) ?? []).filter((m) => now - m.at < Math.max(MOD.floodWindowMs, MOD.repeatWindowMs));
  list.push({ id: msg.id, channelId: msg.channel.id, at: now, content: msg.content.trim().toLowerCase() });
  recent.set(msg.author.id, list);
  const burst = list.filter((m) => now - m.at < MOD.floodWindowMs);
  const same = msg.content.trim() ? list.filter((m) => m.content === list.at(-1).content) : [];
  const why = burst.length >= MOD.floodMessages ? `${burst.length} messages in ${MOD.floodWindowMs / 1000} s`
    : same.length >= MOD.repeatCount ? `the same message ${same.length} times` : null;
  if (!why) return;
  recent.delete(msg.author.id);
  const offending = burst.length >= MOD.floodMessages ? burst : same;
  for (const m of offending) {
    const ch = client.channels.cache.get(m.channelId);
    await ch?.messages.delete(m.id).catch(() => {});
  }
  await member.timeout(MOD.floodTimeoutMs, `Kira: spam (${why})`).catch(console.error);
  await msg.channel.send({ content: `<@${msg.author.id}> timed out for ${MOD.floodTimeoutMs / 60_000} minutes: spam (${why}).`, allowedMentions: { parse: [] } });
  await modlog('🔇 Spam timeout', `<@${msg.author.id}> (${msg.author.tag}) in <#${msg.channel.id}>: ${why}, ${offending.length} messages deleted, ${MOD.floodTimeoutMs / 60_000} min timeout.\n> ${clip(msg.content, 300)}`, 0xff4d4d);
}

// ── Feeds ───────────────────────────────────────────────────────────────────

async function checkFeeds() {
  for (const feed of FEEDS) {
    try {
      const fresh = await poll(feed, state.seen);
      save();
      for (const item of fresh) {
        if (feed.kind === 'video') {
          const msg = await channel('announcements').send({ content: `<@&${state.roles.videos}> **New video: ${item.title}**\n${item.url}`, allowedMentions: { roles: [state.roles.videos] } });
          await msg.crosspost().catch(() => {});
        } else {
          await channel('releases').send({ content: `<@&${state.roles.releases}> **${feed.repo}** · ${item.title}\n${item.url}`, allowedMentions: { roles: [state.roles.releases] } });
        }
      }
    } catch (e) {
      console.error('feed', feed.key, e.message);
    }
  }
}

// ── Events ──────────────────────────────────────────────────────────────────

client.once('clientReady', async () => {
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();
  await guild.commands.set(COMMANDS.map((c) => c.toJSON()));
  client.user.setActivity('ludovic\'s server · /links');
  console.log(`Kira ready as ${client.user.tag}, ${COMMANDS.length} commands`);
  await checkFeeds();
  setInterval(checkFeeds, FEED_EVERY_MS);
});

client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand() || i.guildId !== GUILD_ID) return;
  try {
    await onCommand(i);
  } catch (e) {
    console.error('command', i.commandName, e);
    const reply = { content: 'Something went wrong.', flags: MessageFlags.Ephemeral };
    await (i.deferred || i.replied ? i.followUp(reply) : i.reply(reply)).catch(() => {});
  }
});

client.on('guildMemberAdd', async (m) => {
  if (m.guild.id !== GUILD_ID) return;
  const young = Date.now() - m.user.createdTimestamp < 86_400_000;
  await modlog('📥 Joined', `<@${m.id}> (${m.user.tag}), account ${ago(m.user.createdTimestamp)} old${young ? ' ⚠️' : ''}`, 0x2ecc71);
  if (m.user.bot) return;
  await channel('general')?.send({
    content: `Welcome <@${m.id}>! 👋 Start with <#${state.channels.welcome}> and <#${state.channels.rules}>, pick your roles in **Channels & Roles**, and say hi in <#${state.channels.introductions}>.`,
    allowedMentions: { users: [m.id] },
  });
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
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot || msg.guildId !== GUILD_ID) return;
  await moderate(msg).catch(console.error);
});

client.on('messageDelete', async (msg) => {
  if (msg.guildId !== GUILD_ID || msg.author?.bot || msg.channelId === state.channels.modlog || msg.partial) return;
  await modlog('🗑️ Message deleted', `<@${msg.author.id}> in <#${msg.channelId}>:\n${clip(msg.content)}`);
});

client.on('messageUpdate', async (before, after) => {
  if (after.guildId !== GUILD_ID || after.author?.bot || before.partial || before.content === after.content) return;
  await modlog('✏️ Message edited', `<@${after.author.id}> in <#${after.channelId}> · [jump](${after.url})`, 0x5aa9ff,
    [{ name: 'Before', value: clip(before.content) }, { name: 'After', value: clip(after.content) }]);
});

// 👍 / 👎 on every new post in the suggestion forums.
client.on('threadCreate', async (thread, newlyCreated) => {
  if (!newlyCreated || thread.guildId !== GUILD_ID || thread.parent?.type !== ChannelType.GuildForum) return;
  const key = Object.keys(state.channels).find((k) => state.channels[k] === thread.parentId);
  if (!voteForums.has(key)) return;
  for (let tries = 0; tries < 5; tries++) {
    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (starter) { await starter.react('👍'); await starter.react('👎'); return; }
    await new Promise((r) => setTimeout(r, 1000));
  }
});

process.on('unhandledRejection', (e) => console.error('unhandled', e));
client.login(process.env.DISCORD_TOKEN);
