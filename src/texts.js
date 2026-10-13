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

const ROWS = [['videos', 'releases'], ['horizon', 'ai', 'modder'], ['youtuber', 'editor', 'designer'], ['beatmaker', 'rapper', 'singer']];

// The "pick your roles" message in #welcome: one toggle button per self role.
export function rolesMessage() {
  const spec = (key) => ROLES.find((r) => r.key === key);
  return {
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle('🎭 Pick your roles').setDescription([
      'Click a button to add the role, click it again to remove it. Only you see the answer.',
      '',
      '**Pings**: 🔔 a new video · 📦 a new release',
      "**What you're into**: 🌅 Horizon · 🤖 vibe coding · 🧩 mods and rewrites",
      '**Videos**: 🎬 YouTuber · ✂️ Editor · 🖼️ Thumbnail artist',
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


// What Kira says in a post that doesn't follow the template.
export function missingMessage(spec, missing, userId) {
  return {
    content: `<@${userId}>`,
    embeds: [new EmbedBuilder().setColor(0xffb020).setTitle('📝 Your post is missing something')
      .setDescription([
        `To keep #${spec.name} easy to read, every post follows the template. Missing: **${missing.join('**, **')}**.`,
        '',
        'Edit your first message (⋯ → **Edit**) and add it. Here is the template:',
        '```',
        spec.template.replace(/\*\*/g, ''),
        '```',
        'If it\'s still missing in an hour, the post is closed (you can post again with the template).',
      ].join('\n'))],
    allowedMentions: { users: [userId] },
  };
}

// Where Kira welcomes whoever joins (a key of LAYOUT).
export const WELCOME_CHANNEL = 'newmembers';

// The welcome for the people who just joined: up to 5 are named, beyond that a single "welcome everyone".
export function welcomeMessage(people, memberCount, state) {
  const c = state.channels;
  const guide = `Start with <#${c.welcome}> (roles), <#${c.rules}> and <#${c.faq}>, then say hi in <#${c.introductions}>. Building something? <#${c.communityprojects}>. Making videos? <#${c.creatorschat}>. Beats or raps? <#${c.beats}>.`;
  const few = people.length <= 5;
  const count = memberCount ?? '?';
  return {
    content: few ? people.map((id) => `<@${id}>`).join(' ') : undefined,
    embeds: [new EmbedBuilder().setColor(COLOR)
      .setDescription(few
        ? `👋 Welcome to **ludovic's server**${people.length > 1 ? ', all of you' : ''}! We're **${count}** now.\n\n${guide}`
        : `👋 Welcome to the **${people.length}** people who just joined! We're **${count}** now.\n\n${guide}`)],
    allowedMentions: { users: few ? people : [] },
  };
}
