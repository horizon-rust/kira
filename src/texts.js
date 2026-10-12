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

const ago = (s) => (s >= 3600 ? `${s / 3600} hour${s === 3600 ? '' : 's'}` : `${s / 60} minutes`);

// The pinned, locked "how to post here" post of a forum.
export function howToPost(spec, state) {
  const rules = [
    spec.guide,
    '',
    '**Copy this into your post and fill it in:**',
    '```',
    spec.template.replace(/\*\*/g, ''),
    '```',
    '**Before you post**',
    `• Pick ${spec.tags.some(([, , staff]) => staff) ? 'the tags that fit (some are set by the mods)' : 'the tags that fit'}.`,
    spec.every ? `• One new post every ${ago(spec.every)} at most.` : null,
    spec.check?.media ? `• A file or a link is required.` : null,
    spec.check?.files ? '• A screenshot or a video is required.' : null,
    '• Kira checks each new post. If something is missing, it tells you in the post: edit your first message within an hour, or the post is closed.',
    spec.done ? `• When you're done, type \`/done\` in your post: it gets the **${spec.done}** tag and closes.` : null,
  ].filter((l) => l !== null).join('\n');
  return { embeds: [new EmbedBuilder().setColor(COLOR).setTitle(`How to post in #${spec.name}`).setDescription(linkify(rules, state).slice(0, 4096))] };
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
