// Texts shared by setup and the bot.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { COLOR, LAYOUT, ROLES, HOWTO, FAQ, FAQ_MORE, LINKS, WELCOME, RULES, RULES_FOOTER, OFFICIAL_SERVER } from './config.js';

// The names a channel is written with in texts: its name, the name without its decoration ("💬│horizon-chat" is
// #horizon-chat) and the old names it went by (`aka`). Only text and forum channels are mentioned.
export const plain = (name) => name.split('│').pop();
export const handles = (spec) => [...new Set([spec.name, plain(spec.name), ...(spec.aka ?? [])])];
const byName = new Map(LAYOUT.flatMap((g) => g.channels).filter((c) => c.type !== 'voice').flatMap((c) => handles(c).map((h) => [h, c.key])));

// The topic setup writes on a channel (its #mentions turned into links); null: none. Forums add the post guide and template.
export function channelTopic(spec, state) {
  if (spec.type === 'voice') return null;
  if (spec.type === 'forum') return linkify(`${spec.topic}\n\n${spec.guide ?? ''}${spec.template ? `\n\n**Template:**\n${spec.template}` : ''}`, state).slice(0, 4096);
  return spec.topic ? linkify(spec.topic, state) : null;
}

// "#horizon-bugs" (or "#русский", "#中文": scripts without case are \p{Lo}) in a text becomes a clickable channel mention.
export function linkify(text, state) {
  return text.replace(/#([\p{Ll}\p{Lo}\p{N}-]+)/gu, (m, name) => {
    const id = state.channels[byName.get(name)];
    return id ? `<#${id}>` : m;
  });
}

// The FAQ in #faq: one message per list (FAQ, FAQ_MORE), one embed each, under Discord's 4096 characters a description
// and 6000 a message.
export const faqMessages = (state) => [[FAQ, '❓ FAQ'], [FAQ_MORE, '❓ More questions']].map(([list, title]) => ({
  embeds: [new EmbedBuilder().setColor(COLOR).setTitle(title).setDescription(linkify(list.map(([q, a]) => `**${q}**\n${a}`).join('\n\n'), state))],
}));

const ROWS = [['horizon', 'releases', 'newvideos'], ['modder']];

// The "pick your roles" message in #welcome: one toggle button per self role.
export function rolesMessage(state = { channels: {} }) {
  const spec = (key) => ROLES.find((r) => r.key === key);
  return {
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle('🎭 Pick your roles').setDescription(linkify([
      'Click a button to add the role, click it again to remove it. Only you see the answer.',
      '',
      '**Pings**: 📣 big Horizon news · 📦 every new version and launcher · 🎬 every new video from Ludovic',
      '**What you do**: 🧩 you make or use Horizon mods',
      '**🛠️ Contributor** is not a button: it comes by itself with a merged pull request in Horizon. `/link-github`, then `/verify-github`; it opens #contributors.',
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
  const guide = `Start with <#${c.welcome}> (roles), <#${c.rules}> and <#${c.faq}>. Get Horizon in <#${c.horizoninfo}>, then say hi in <#${c.introductions}>. Need help? <#${c.horizonsupport}>. Found a bug? <#${c.horizonbugs}>. What changed lately? <#${c.updates}>.`;
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

// /help (only the asker sees it): a short tour of the server, then what Kira does, by topic. Channels are written as
// #names; linkify() makes them mentions for Discord, the server guide keeps them as text.
export const HELP_TITLE = "👋 I'm Kira, Horizon's front desk";
const HELP = [
  '**The server in short**: #welcome (your roles) · #rules · #faq · #horizon-info (what Horizon is, the download) · #announcements\n'
    + '• need help (it won\'t start, it\'s slow, sign-in, multiplayer)? #horizon-support · a bug you can make happen again? #horizon-bugs · an idea? #horizon-ideas\n'
    + '• talk: #horizon-chat (Horizon), #general (anything else), your language in 🌍 languages · show what you made: #showcase\n'
    + '• what changed: #updates · new versions: #releases · questions: mention me anywhere · the mods: DM me',
  `**The hub**: ${LINKS.hub} has the roadmap, the kanban, the journal and how to help. I do the same things here, as commands or as \`@Kira <verb>\`:`,
  '• Need help? A post in #horizon-support: I give a first answer, 🤝 Support helps',
  '• `/report`: a bug, as a form; it becomes a post in #horizon-bugs and a GitHub issue, and you are pinged there when it is answered or fixed',
  '• an idea: a post in #horizon-ideas, with its template; it goes to the suggestion queue the maintainers read',
  '• `/roadmap` (`area:` for one area in full): the whole roadmap, what is being built, what is next',
  '• `/claim <issue>` before you start, `/unclaim` · `/status`: your claims and reports, an issue, a roadmap item, or set what you are on',
  '**Contributing**: `/goodfirst` · `/working` · `/board` · `/mytasks` · `/link-github` (`credit:True` lists you on the hub) · `/verify-github` proves the account is yours, and with a merged PR it gives you 🛠️ Contributor · `/notify dm:on` DMs you when your pull requests and issues change (reviews, comments, merged, CI failing, conflicts; needs `/verify-github`) · `/agent connect` gives your AI coding agent the board (setup in #horizon-info). Maintainers: `/move`.',
  '**Horizon**: `/horizon` what it is and where to get it · `/links` · `/sponsor github:<you>`: you sponsor Horizon on GitHub? Get 💚 Sponsor',
  '**You**: `/rank`, `/leaderboard`, `/remind`, `/userinfo`, `/avatar`, `/room` (your own voice channel: join ➕ create your room).',
  '**Help run the server**: `/apply` for 🤝 Support or 🛡️ Mod.',
  '**The mods**: DM me to reach them privately, `/report-member` or right-click a message → Apps → Report to mods. `/modmail`.',
].join('\n\n');
export const helpText = (state) => linkify(HELP, state);

// The server guide, one of the sources Kira's AI answers from (src/ai.js): what the server is, every channel and what
// it's for (forums with their how-to-post guide and template), the roles, the rules and /help. Built from this repo's
// config, so it is always there and never costs a GitHub call. Plain text: channels as #names.
export function serverGuideText() {
  const channel = (c) => {
    if (c.type === 'voice') return `- ${c.name} (voice)${c.lobby ? ': join it and Kira makes you your own voice room (`/room` to lock, invite, rename it)' : c.locked ? ': nobody joins by themselves; a mod moves people in' : ''}`;
    const who = c.readonly ? ' Only the staff and Kira post here.' : c.writers ? ' Everyone reads; only the roles that may write post.' : c.members ? ' Only its members see it.' : '';
    const topic = (c.topic ?? '').replace(/([^.!?])$/, '$1.');
    const lines = [`- #${c.name}${c.type === 'forum' ? ' (forum: one post per topic)' : ''}: ${topic}${who}`];
    if (c.guide) lines.push(`  How to post (${HOWTO.name}, pinned at the top): ${c.guide}`);
    if (c.template) lines.push(`  Template: ${c.template.replace(/\*\*/g, '').replace(/\n/g, ' | ')}`);
    return lines.join('\n');
  };
  const categories = LAYOUT.map((g) => (g.staff
    ? `### ${g.category}\nOnly the mods, the Horizon Team and Kira see these: ${g.channels.map((c) => `#${c.name}`).join(', ')}. Members reach the mods by DMing Kira.`
    : `### ${g.category}\n${g.channels.map(channel).join('\n')}`));
  const levels = ROLES.filter((r) => r.level);
  const roles = [
    ...ROLES.filter((r) => r.about).reverse().map((r) => `- ${r.name}: ${r.about}`),
    `- ${levels.map((r) => r.name).join(', ')}: come by themselves with levels (XP for talking, once a minute, and for time in voice with others; \`/rank\`).`,
  ];
  return [
    "# Horizon's Discord server",
    WELCOME.description,
    '## Channels, by category',
    ...categories,
    '## Roles, highest first',
    ...roles,
    '## Rules (#rules)',
    RULES.map(([title, text], i) => `${i + 1}. ${title}: ${text}`).join('\n'),
    RULES_FOOTER,
    "## Kira's /help",
    HELP,
    `## ${OFFICIAL_SERVER.name} (#official-server)`,
    [OFFICIAL_SERVER.description, `Address: ${OFFICIAL_SERVER.address}.`, OFFICIAL_SERVER.join, OFFICIAL_SERVER.problems].join(' '),
  ].join('\n\n');
}
