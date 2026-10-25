// Texts shared by setup and the bot.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { COLOR, LAYOUT, ROLES, HOWTO } from './config.js';

const byName = new Map(LAYOUT.flatMap((g) => g.channels).filter((c) => c.type !== 'voice').map((c) => [c.name, c.key]));

// "#horizon-bugs" in a text becomes a clickable channel mention.
export function linkify(text, state) {
  return text.replace(/#([a-z0-9-]+)/g, (m, name) => {
    const id = state.channels[byName.get(name)];
    return id ? `<#${id}>` : m;
  });
}

const ROWS = [['horizon', 'releases', 'newvideos'], ['contributor', 'modder']];

// The "pick your roles" message in #welcome: one toggle button per self role.
export function rolesMessage(state = { channels: {} }) {
  const spec = (key) => ROLES.find((r) => r.key === key);
  return {
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle('🎭 Pick your roles').setDescription(linkify([
      'Click a button to add the role, click it again to remove it. Only you see the answer.',
      '',
      '**Pings**: 📣 big Horizon news · 📦 every new version and launcher · 🎬 every new video from Ludovic',
      '**What you do**: 🛠️ you contribute code (see #updates and the hub) · 🧩 you mod, or want to once modding lands',
      '',
      'Level roles (lvl 5, 10, 20, 30, 50) come by themselves: talk, and hang out in voice. `/rank` shows yours.',
    ].join('\n'), state))],
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

// The "How to post here" post of a forum as a link (plain words until setup has made it).
export const howToLink = (spec, state) => {
  const id = state.messages?.['howto:' + spec.key];
  return id ? `the <#${id}> post` : HOWTO.mention;
};

// What Kira says in a post that doesn't follow the template.
export function missingMessage(spec, missing, userId, state = {}) {
  return {
    content: `<@${userId}>`,
    embeds: [new EmbedBuilder().setColor(0xffb020).setTitle('📝 Your post is missing something')
      .setDescription([
        `To keep #${spec.name} easy to read, every post follows the template. Missing: **${missing.join('**, **')}**.`,
        '',
        `Edit your first message (⋯ → **Edit**) and add it. It is all in ${howToLink(spec, state)} at the top of the forum; here is the template:`,
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
  const guide = `Start with <#${c.welcome}> (roles), <#${c.rules}> and <#${c.faq}>. Get Horizon in <#${c.horizoninfo}>, then say hi in <#${c.introductions}>. Found a bug? <#${c.horizonbugs}>. What changed lately? <#${c.updates}>.`;
  const few = people.length <= 5;
  const count = memberCount ?? '?';
  return {
    content: few ? people.map((id) => `<@${id}>`).join(' ') : undefined,
    embeds: [new EmbedBuilder().setColor(COLOR)
      .setDescription(few
        ? `👋 Welcome to **Horizon**${people.length > 1 ? ', all of you' : ''}! We're **${count}** now.\n\n${guide}`
        : `👋 Welcome to the **${people.length}** people who just joined! We're **${count}** now.\n\n${guide}`)],
    allowedMentions: { users: few ? people : [] },
  };
}
