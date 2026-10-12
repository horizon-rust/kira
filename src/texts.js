// Texts shared by setup and the bot.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { COLOR, LAYOUT, ROLES } from './config.js';

const byName = new Map(LAYOUT.flatMap((g) => g.channels).filter((c) => c.type !== 'voice').map((c) => [c.name, c.key]));

// "#horizon-bugs" in a text becomes a clickable channel mention.
export function linkify(text, state) {
  return text.replace(/#([a-z0-9-]+)/g, (m, name) => {
    const id = state.channels[byName.get(name)];
    return id ? `<#${id}>` : m;
  });
}

const ROWS = [['videos', 'releases'], ['ai', 'horizon', 'modder'], ['beatmaker', 'rapper', 'singer']];

// The "pick your roles" message in #welcome: one toggle button per self role.
export function rolesMessage() {
  const spec = (key) => ROLES.find((r) => r.key === key);
  return {
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle('Pick your roles').setDescription([
      'Click to add a role, click again to remove it.',
      '',
      '**Pings**: 🔔 New videos · 📦 New releases',
      '**What you\'re into**: 🤖 Vibe coder · 🌅 Horizon · 🧩 Modder',
      '**Music**: 🥁 Beatmaker · 🎤 Rapper · 🎶 Singer',
      '',
      'Level roles (lvl 5, 10, 20, 30, 50) come by themselves: talk, and hang out in voice. `/rank` shows yours.',
    ].join('\n'))],
    components: ROWS.map((row) => new ActionRowBuilder().addComponents(row.map((key) => {
      const r = spec(key);
      const [emoji, ...rest] = r.name.split(' ');
      return new ButtonBuilder().setCustomId(`role:${key}`).setStyle(ButtonStyle.Secondary).setEmoji(emoji).setLabel(r.label ?? rest.join(' '));
    }))),
  };
}
