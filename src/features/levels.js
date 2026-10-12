// Levels: XP for talking (once a minute) and for time in voice with other people; level roles.
import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits as P, MessageFlags } from 'discord.js';
import { GUILD_ID, LEVELS, ROLES, COLOR } from '../config.js';
import { client, state, saveSoon, save, channel } from '../core.js';

const LEVEL_ROLES = ROLES.filter((r) => r.level).sort((a, b) => a.level - b.level);
// XP to go from level n to n+1 (the curve most servers know).
const need = (n) => 5 * n * n + 50 * n + 100;
export function levelOf(xp) {
  let level = 0;
  while (xp >= need(level)) { xp -= need(level); level++; }
  return { level, into: xp, next: need(level) };
}
const noXp = new Set(LEVELS.noXp.map((k) => state.channels[k]));

async function grant(member, amount, where) {
  const me = (state.levels[member.id] ??= { xp: 0, messages: 0, voiceMin: 0 });
  const before = levelOf(me.xp).level;
  me.xp += amount;
  const after = levelOf(me.xp).level;
  saveSoon();
  if (after <= before) return;
  // Level up: the roles of every level reached, and a message.
  const earned = LEVEL_ROLES.filter((r) => r.level <= after).at(-1);
  if (earned && state.roles[earned.key]) {
    const others = LEVEL_ROLES.filter((r) => r !== earned).map((r) => state.roles[r.key]).filter((id) => member.roles.cache.has(id));
    if (!member.roles.cache.has(state.roles[earned.key])) await member.roles.add(state.roles[earned.key], `level ${after}`).catch(console.error);
    if (others.length) await member.roles.remove(others, 'new level role').catch(console.error);
  }
  const reward = earned && earned.level === after ? ` and the **${earned.name}** role` : '';
  await (channel('botcommands') ?? where)?.send({ content: `🎉 <@${member.id}> reached **level ${after}**${reward}!`, allowedMentions: { users: [member.id] } }).catch(() => {});
}

export const commands = [
  new SlashCommandBuilder().setName('rank').setDescription('Your level and XP (or someone else\'s)')
    .addUserOption((o) => o.setName('member').setDescription('Who')),
  new SlashCommandBuilder().setName('leaderboard').setDescription('The top 10 by XP'),
  new SlashCommandBuilder().setName('givexp').setDescription('Give or take XP').setDefaultMemberPermissions(P.ManageGuild)
    .addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('XP (negative to take)').setRequired(true)),
];

const bar = (into, next) => {
  const full = Math.round((into / next) * 14);
  return '▰'.repeat(full) + '▱'.repeat(14 - full);
};
const rankOf = (id) => Object.entries(state.levels).sort((a, b) => b[1].xp - a[1].xp).findIndex(([k]) => k === id) + 1;

export const handlers = {
  async rank(i) {
    const user = i.options.getUser('member') ?? i.user;
    const me = state.levels[user.id] ?? { xp: 0, messages: 0, voiceMin: 0 };
    const { level, into, next } = levelOf(me.xp);
    return i.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
      .setDescription(`**Level ${level}** · rank #${rankOf(user.id) || '–'}\n${bar(into, next)}  ${into} / ${next} XP\n\n💬 ${me.messages} messages · 🔊 ${Math.round(me.voiceMin / 60 * 10) / 10} h in voice · ${me.xp} XP in all`)] });
  },
  async leaderboard(i) {
    const top = Object.entries(state.levels).sort((a, b) => b[1].xp - a[1].xp).slice(0, 10);
    const medal = ['🥇', '🥈', '🥉'];
    const lines = top.map(([id, d], n) => `${medal[n] ?? `**${n + 1}.**`} <@${id}> · level ${levelOf(d.xp).level} · ${d.xp} XP`);
    return i.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle('🏆 Leaderboard').setDescription(lines.join('\n') || 'Nobody yet. Start talking!')], allowedMentions: { parse: [] } });
  },
  async givexp(i) {
    const user = i.options.getUser('member');
    const m = await i.guild.members.fetch(user.id).catch(() => null);
    if (!m) return i.reply({ content: "They're not in the server.", flags: MessageFlags.Ephemeral });
    const amount = i.options.getInteger('amount');
    if (amount > 0) await grant(m, amount, i.channel);
    else { const d = (state.levels[user.id] ??= { xp: 0, messages: 0, voiceMin: 0 }); d.xp = Math.max(0, d.xp + amount); save(); }
    return i.reply({ content: `${amount > 0 ? 'Gave' : 'Took'} ${Math.abs(amount)} XP ${amount > 0 ? 'to' : 'from'} ${user.username}.`, flags: MessageFlags.Ephemeral });
  },
};

// Called for every message that wasn't removed by moderation.
export async function onMessage(msg) {
  if (!msg.member || noXp.has(msg.channelId) || noXp.has(msg.channel.parentId)) return;
  const me = (state.levels[msg.author.id] ??= { xp: 0, messages: 0, voiceMin: 0 });
  me.messages++;
  if (Date.now() - (me.last ?? 0) < LEVELS.messageCooldownMs) { saveSoon(); return; }
  me.last = Date.now();
  const [lo, hi] = LEVELS.messageXp;
  await grant(msg.member, lo + Math.floor(Math.random() * (hi - lo + 1)), msg.channel);
}

export function setup() {
  // Every minute, XP for people in voice with at least one other person, not muted or deafened.
  setInterval(async () => {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;
    for (const ch of guild.channels.cache.filter((c) => c.isVoiceBased()).values()) {
      if (ch.id === guild.afkChannelId) continue;
      const people = ch.members.filter((m) => !m.user.bot);
      if (people.size < 2) continue;
      for (const m of people.values()) {
        if (m.voice.selfMute || m.voice.selfDeaf || m.voice.serverMute || m.voice.serverDeaf) continue;
        (state.levels[m.id] ??= { xp: 0, messages: 0, voiceMin: 0 }).voiceMin++;
        await grant(m, LEVELS.voiceXpPerMinute, null);
      }
    }
  }, 60_000);
}
