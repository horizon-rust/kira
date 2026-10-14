// Community: welcomes, role buttons, reactions on forum posts, comment threads, the hall of fame,
// mod-mail (DM Kira to reach the mods), reminders, and the info commands.
import { SlashCommandBuilder, EmbedBuilder, ChannelType, MessageFlags, ThreadAutoArchiveDuration } from 'discord.js';
import { GUILD_ID, LINKS, COLOR, LAYOUT, HORIZON, ROLES, STARBOARD } from '../config.js';
import { client, state, save, channel, clip, modlog, parseDuration, human } from '../core.js';
import { levelOf } from './levels.js';
import { WELCOME_CHANNEL, welcomeMessage } from '../texts.js';
import { isOwnPost } from '../adopt.js';

const specs = LAYOUT.flatMap((g) => g.channels);
const reactFor = (channelId) => specs.find((c) => state.channels[c.key] === channelId)?.react;
const threadsIn = () => new Set(specs.filter((c) => c.threads).map((c) => state.channels[c.key]));
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

// ── Commands ────────────────────────────────────────────────────────────────

export const commands = [
  new SlashCommandBuilder().setName('help').setDescription('What Kira does here, and its commands'),
  new SlashCommandBuilder().setName('links').setDescription("Horizon's links: website, launcher, GitHub"),
  new SlashCommandBuilder().setName('horizon').setDescription('What Horizon is, where to download it, and the disclaimer'),
  new SlashCommandBuilder().setName('roadmap').setDescription("Horizon's roadmap"),
  new SlashCommandBuilder().setName('userinfo').setDescription('About a member').addUserOption((o) => o.setName('member').setDescription('Who')),
  new SlashCommandBuilder().setName('serverinfo').setDescription('About this server'),
  new SlashCommandBuilder().setName('avatar').setDescription("Someone's avatar, full size").addUserOption((o) => o.setName('member').setDescription('Who')),
  new SlashCommandBuilder().setName('remind').setDescription('Kira reminds you of something')
    .addStringOption((o) => o.setName('in').setDescription('When: 10m, 2h, 1d, 1h30m…').setRequired(true))
    .addStringOption((o) => o.setName('what').setDescription('Of what').setRequired(true).setMaxLength(500)),
  new SlashCommandBuilder().setName('modmail').setDescription('How to reach the mods privately'),
];

const linksEmbed = () => new EmbedBuilder().setColor(COLOR).setTitle('🌅 Horizon').setDescription([
  `🌐 Website: ${LINKS.horizonSite}`, `⬇️ Launcher: ${LINKS.horizonLauncher}`, `💻 Code: ${LINKS.horizon}`,
  `🐛 Issues: ${LINKS.horizonIssues}`, `🔀 Pull requests: ${LINKS.horizonPulls}`,
  state.invite ? `💬 This server: https://discord.gg/${state.invite}` : null,
].filter(Boolean).join('\n'));

// /help: what Kira does, by topic (only the asker sees it).
const helpEmbed = () => new EmbedBuilder().setColor(COLOR).setTitle("👋 I'm Kira, Horizon's helper").setDescription([
  `**Horizon**: \`/horizon\` what it is and where to get it · \`/roadmap\` · \`/links\``,
  `**Bugs and ideas**: post in <#${state.channels.horizonbugs}> or <#${state.channels.horizonideas}> with the template; I send each post to GitHub and tell you here when it's answered or fixed.`,
  `**Contributing**: <#${state.channels.workboard}> is the board. \`/claim <issue>\` before you start, \`/unclaim\`, \`/working\`, \`/board\`, \`/link-github\`. Maintainers: \`/move\`.`,
  `**Releases**: every new Horizon version and launcher in <#${state.channels.releases}>.`,
  '**You**: `/rank`, `/leaderboard`, `/remind`, `/userinfo`, `/avatar`, `/room` (your own voice channel: join ➕ create your room).',
  '**The mods**: DM me to reach them privately, `/report` or right-click a message → Apps → Report to mods. `/modmail`.',
].join('\n\n'));

export const handlers = {
  help: (i) => i.reply({ embeds: [helpEmbed()], flags: MessageFlags.Ephemeral }),
  links: (i) => i.reply({ embeds: [linksEmbed()] }),
  horizon: (i) => i.reply({ embeds: [
    new EmbedBuilder().setColor(COLOR).setTitle('🌅 Horizon').setURL(LINKS.horizon).setDescription(`${HORIZON.description}\n\n${HORIZON.get}`),
    new EmbedBuilder().setColor(0x555555).setTitle('⚠️ Disclaimer').setDescription(HORIZON.disclaimer),
  ] }),
  roadmap: (i) => i.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle("Horizon's roadmap").setDescription(HORIZON.roadmap)] }),
  async userinfo(i) {
    const user = i.options.getUser('member') ?? i.user;
    const m = await i.guild.members.fetch(user.id).catch(() => null);
    const lv = levelOf(state.levels[user.id]?.xp ?? 0).level;
    const e = new EmbedBuilder().setColor(m?.displayColor || COLOR).setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() }).setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'Account', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Joined', value: m?.joinedTimestamp ? `<t:${Math.floor(m.joinedTimestamp / 1000)}:R>` : '–', inline: true },
        { name: 'Level', value: String(lv), inline: true },
        { name: 'Roles', value: m ? clip(m.roles.cache.filter((r) => r.id !== i.guild.id).sort((a, b) => b.position - a.position).map((r) => `<@&${r.id}>`).join(' ') || 'none', 1000) : '–' },
      );
    return i.reply({ embeds: [e], allowedMentions: { parse: [] } });
  },
  async serverinfo(i) {
    const g = await i.guild.fetch();
    return i.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle(g.name).setThumbnail(g.iconURL()).setDescription(g.description ?? '')
      .addFields(
        { name: 'Members', value: String(g.approximateMemberCount ?? g.memberCount), inline: true },
        { name: 'Online', value: String(g.approximatePresenceCount ?? '–'), inline: true },
        { name: 'Boosts', value: `${g.premiumSubscriptionCount ?? 0} (level ${g.premiumTier})`, inline: true },
        { name: 'Created', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true },
        { name: 'Invite', value: state.invite ? `https://discord.gg/${state.invite}` : '–', inline: true },
      )] });
  },
  avatar: (i) => {
    const user = i.options.getUser('member') ?? i.user;
    return i.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle(user.username).setImage(user.displayAvatarURL({ size: 1024 }))] });
  },
  async remind(i) {
    const ms = parseDuration(i.options.getString('in'));
    if (!ms || ms > 365 * 864e5) return i.reply(ephemeral('Give a time like 10m, 2h, 3d or 1h30m (a year at most).'));
    state.reminders.push({ at: Date.now() + ms, user: i.user.id, channel: i.channelId, text: i.options.getString('what') });
    save();
    return i.reply(ephemeral(`⏰ I'll remind you in ${human(ms)} (<t:${Math.floor((Date.now() + ms) / 1000)}:f>).`));
  },
  modmail: (i) => i.reply(ephemeral('Send a direct message to **kira** (click its name → Message). Only the mods read it, and they answer through Kira.')),
};

// Role buttons in #welcome.
export async function onButton(i) {
  if (!i.customId.startsWith('role:')) return false;
  const spec = ROLES.find((r) => r.key === i.customId.slice(5) && r.self);
  const id = spec && state.roles[spec.key];
  if (!id) { await i.reply(ephemeral('That role is gone.')); return true; }
  const has = i.member.roles.cache.has(id);
  await (has ? i.member.roles.remove(id, 'role button') : i.member.roles.add(id, 'role button'));
  await i.reply(ephemeral(`${has ? 'Removed' : 'Added'} **${spec.name}**.`));
  return true;
}

// ── Mod-mail ─────────────────────────────────────────────────────────────────

async function fromMember(msg) {
  const guild = client.guilds.cache.get(GUILD_ID);
  const member = await guild?.members.fetch(msg.author.id).catch(() => null);
  if (!member) return msg.reply('I only take messages from members of the Horizon server.');
  const box = channel('modmail');
  let thread = state.modmail[msg.author.id] && await guild.channels.fetch(state.modmail[msg.author.id]).catch(() => null);
  const first = !thread;
  if (!thread) {
    thread = await box.threads.create({ name: `${msg.author.username}`.slice(0, 90), autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek, reason: 'mod-mail' });
    state.modmail[msg.author.id] = thread.id;
    save();
    await thread.send({ content: `<@&${state.roles.mod}> new mod-mail from <@${msg.author.id}> (${msg.author.tag}). Write here to answer; start with \`//\` for a note they don't see; \`//close\` to close.`, allowedMentions: { roles: [state.roles.mod] } });
  }
  if (thread.archived) await thread.setArchived(false).catch(() => {});
  const files = msg.attachments.map((a) => a.url);
  await thread.send({ embeds: [new EmbedBuilder().setColor(0x5aa9ff).setAuthor({ name: msg.author.tag, iconURL: msg.author.displayAvatarURL() }).setDescription(clip(msg.content, 3900)).setTimestamp()], files: files.slice(0, 10) });
  await msg.react('📨').catch(() => {});
  if (first) await msg.reply('📨 Sent to the mods of the Horizon server. They answer here, through me.').catch(() => {});
}

async function fromMods(msg) {
  const userId = Object.keys(state.modmail).find((k) => state.modmail[k] === msg.channelId);
  if (!userId || msg.content.startsWith('//') && msg.content.trim() !== '//close') return;
  const user = await client.users.fetch(userId);
  if (msg.content.trim() === '//close') {
    await user.send('✅ The mods closed this conversation. DM me again anytime.').catch(() => {});
    delete state.modmail[userId]; save();
    await msg.channel.send('Closed.');
    return msg.channel.setArchived(true).catch(() => {});
  }
  const ok = await user.send({ content: `**🛡️ Horizon mods:** ${msg.content}`.slice(0, 2000), files: msg.attachments.map((a) => a.url).slice(0, 10) }).then(() => true).catch(() => false);
  await msg.react(ok ? '✅' : '❌').catch(() => {});
}

// ── Hall of fame ─────────────────────────────────────────────────────────────

async function star(reaction) {
  if (reaction.partial) await reaction.fetch().catch(() => null);
  if (reaction.emoji.name !== STARBOARD.emoji) return;
  const msg = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!msg || msg.guildId !== GUILD_ID || msg.author.bot || msg.channelId === state.channels.halloffame) return;
  const base = msg.channel.isThread() ? msg.channel.parent : msg.channel;
  if (base?.parentId === state.channels['cat:staff']) return; // nothing from the staff channels
  const users = await reaction.users.fetch();
  const count = users.filter((u) => u.id !== msg.author.id && !u.bot).size;
  const board = channel('halloffame');
  const posted = state.starboard[msg.id];
  const content = `${STARBOARD.emoji} **${count}** · <#${msg.channelId}>`;
  if (count < STARBOARD.threshold) {
    if (posted) { await board.messages.delete(posted).catch(() => {}); delete state.starboard[msg.id]; save(); }
    return;
  }
  const embed = new EmbedBuilder().setColor(0xffd166).setAuthor({ name: msg.member?.displayName ?? msg.author.username, iconURL: msg.author.displayAvatarURL() })
    .setDescription(`${clip(msg.content, 3500)}\n\n[jump to the message](${msg.url})`).setTimestamp(msg.createdAt);
  const image = msg.attachments.find((a) => a.contentType?.startsWith('image/'));
  if (image) embed.setImage(image.url);
  if (posted) {
    const m = await board.messages.fetch(posted).catch(() => null);
    if (m) return m.edit({ content, embeds: [embed] });
  }
  const m = await board.send({ content, embeds: [embed], allowedMentions: { parse: [] } });
  state.starboard[msg.id] = m.id;
  save();
}

// ── Events ──────────────────────────────────────────────────────────────────

export async function onMessage(msg) {
  // A comment thread on every post in #showcase and #tracks.
  if (threadsIn().has(msg.channelId) && !msg.hasThread) {
    const name = `${msg.member?.displayName ?? msg.author.username} · ${msg.content.replace(/https?:\/\/\S+/g, '').trim().slice(0, 50) || (msg.attachments.first()?.name ?? 'comments')}`;
    await msg.startThread({ name: name.slice(0, 100), autoArchiveDuration: ThreadAutoArchiveDuration.ThreeDays }).catch(() => {});
  }
}

export function setup() {
  // Welcomes in #new-members, grouped: one message for up to 5 people, a single "welcome everyone" beyond that.
  const arrivals = [];
  let flushTimer = null;
  async function flush() {
    flushTimer = null;
    const people = arrivals.splice(0);
    if (!people.length) return;
    await channel(WELCOME_CHANNEL)?.send(welcomeMessage(people, client.guilds.cache.get(GUILD_ID)?.memberCount, state)).catch(console.error);
  }
  client.on('guildMemberAdd', (m) => {
    if (m.guild.id !== GUILD_ID || m.user.bot) return;
    arrivals.push(m.id);
    flushTimer ??= setTimeout(() => flush().catch(console.error), 15_000);
  });

  client.on('interactionCreate', async (i) => { if (i.isButton() && i.guildId === GUILD_ID) await onButton(i).catch(console.error); });

  // Reactions on every new post in the forums that have them (👍/👎 on ideas, 🔥 in #showcase).
  client.on('threadCreate', async (thread, newlyCreated) => {
    if (!newlyCreated || thread.guildId !== GUILD_ID || thread.parent?.type !== ChannelType.GuildForum) return;
    const emojis = reactFor(thread.parentId);
    if (!emojis || isOwnPost(thread, client.user.id)) return;
    for (let tries = 0; tries < 5; tries++) {
      const starter = await thread.fetchStarterMessage().catch(() => null);
      if (starter) { for (const e of emojis) await starter.react(e).catch(() => {}); return; }
      await new Promise((r) => setTimeout(r, 1000));
    }
  });

  client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;
    if (!msg.guild) return fromMember(msg).catch(console.error);
    if (msg.channel.isThread() && msg.channel.parentId === state.channels.modmail) return fromMods(msg).catch(console.error);
  });

  client.on('messageReactionAdd', (r) => star(r).catch(console.error));
  client.on('messageReactionRemove', (r) => star(r).catch(console.error));

  // Reminders.
  setInterval(async () => {
    const due = state.reminders.filter((r) => r.at <= Date.now());
    if (!due.length) return;
    state.reminders = state.reminders.filter((r) => r.at > Date.now());
    save();
    for (const r of due) {
      const text = `⏰ <@${r.user}> reminder: ${r.text}`;
      const ch = client.channels.cache.get(r.channel);
      const sent = ch ? await ch.send({ content: text, allowedMentions: { users: [r.user] } }).then(() => true).catch(() => false) : false;
      if (!sent) await client.users.fetch(r.user).then((u) => u.send(text)).catch(() => modlog('Reminder lost', text));
    }
  }, 20_000);
}
