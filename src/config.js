// Everything Kira knows about the server: its layout, its texts and its feeds.
// `npm run setup` creates what this file lists and the server lacks, and changes nothing that exists (README: Setup is
// additive); `--apply-layout --yes` makes the server match it. The bot reads the same file at runtime.
// Since 2026-10-14 the server is Horizon's alone: the channels about Ludovic's other projects, videos and
// music were deleted (their messages were exported first), and the roles of the old scope are gone (RETIRED_ROLES).

export const GUILD_ID = '1559227979002028052'; // "Horizon" (was "ludovic's server"), created 2026-10-12
export const OWNER_ID = '622720516779802630'; // Ludovic
export const SERVER = {
  name: 'Horizon',
  description: 'Minecraft Java Edition rewritten in Rust. Bugs, ideas, releases. playhorizon.dev · Not affiliated with Mojang/Microsoft.', // 120 max
  // Kira's About me (the application's description, 400 max).
  about: "Kira, Horizon's front desk 🌅 /report a bug (it becomes a GitHub issue), ask /roadmap what's being built, /claim a task, /apply to help. I post every release and what changed in #updates, and help the mods keep things friendly. /help for the rest, or DM me to reach the mods. playhorizon.dev/hub",
  // Horizon's mark (horizon repo, docs/media/brand/social): the server icon and Kira's own avatar, on violet so
  // Kira reads apart from the project. src/brand.js applies them when they change.
  icon: 'assets/horizon-icon.png', // Horizon's avatar.svg at 512 px (README: Discord brand assets)
  avatar: 'assets/kira-avatar.png', // from assets/kira-avatar.svg
};

export const LINKS = {
  github: 'https://github.com/ludovic111',
  horizon: 'https://github.com/horizon-rust/horizon',
  horizonSite: 'https://playhorizon.dev',
  hub: 'https://playhorizon.dev/hub', // the roadmap, the kanban, the journal and how to help
  horizonLauncher: 'https://github.com/horizon-rust/horizon/releases?q=launcher&expanded=true',
  horizonIssues: 'https://github.com/horizon-rust/horizon/issues',
  horizonPulls: 'https://github.com/horizon-rust/horizon/pulls',
  youtube: 'https://youtube.com/@lu4ovic',
};

export const COLOR = 0xf2a33a; // sunrise orange, for Horizon

// Kira's MCP endpoint, for contributors' agents: one value (Railway variable KIRA_MCP_URL) used by /agent
// connect, /help and the announcements, which Kira edits in place when it changes. Railway's generated
// domain keeps working after the custom one is added, so configs made with it never break.
export const MCP_URL = process.env.KIRA_MCP_URL || 'https://kira-production-500e.up.railway.app/mcp';

// How to add Kira to an agent. `token`: the real one (in /agent connect's private answer) or a placeholder.
export const agentSnippets = (url, token) => [
  '**Claude Code**',
  '```',
  `claude mcp add --transport http kira ${url} --header "Authorization: Bearer ${token}"`,
  '```',
  '**Codex** (`~/.codex/config.toml`), with the token in the `KIRA_TOKEN` environment variable:',
  '```toml',
  '[mcp_servers.kira]',
  `url = "${url}"`,
  'bearer_token_env_var = "KIRA_TOKEN"',
  '```',
  '**Cursor** (`.cursor/mcp.json` or `~/.cursor/mcp.json`), with `KIRA_TOKEN` set too:',
  '```json',
  `{ "mcpServers": { "kira": { "url": "${url}", "headers": { "Authorization": "Bearer \${env:KIRA_TOKEN}" } } } }`,
  '```',
].join('\n');

// Roles, from lowest to highest. `self`: members can pick it (Onboarding and the buttons in #welcome).
// `was`: the key it had before, so setup renames the role instead of making a new one. `about`: what it is and how
// you get it, for Kira's AI answers (the server guide, src/texts.js); level roles share one line there.
export const ROLES = [
  // Mods' /quarantine (2026-11-01, instead of most bans): it hides every channel but #appeal, where the member fills in
  // the appeal form. Kira adds the one deny overwrite it needs to each channel (src/features/modcases.js).
  { key: 'quarantined', name: '🔒 Quarantined', color: 0x4f545c, about: 'given by the mods instead of a ban: only #appeal is visible until the appeal is decided.' },
  { key: 'releases', name: '📦 Releases', color: 0x5aa9ff, self: true, label: 'Every release', about: 'pinged for every new Horizon version and launcher in #releases. A button in #welcome.' },
  { key: 'horizon', name: '📣 Big news', color: COLOR, self: true, label: 'Big news', about: 'pinged for big Horizon news in #announcements. A button in #welcome.' },
  // Not key 'videos': that is the old role of the all-projects server (🔔 Videos), in RETIRED_ROLES, which setup
  // deletes by key when nobody holds it. Pinged by every post of src/videos.js.
  { key: 'newvideos', name: '🎬 Videos', color: 0xff4d4d, self: true, label: 'New videos', about: "pinged for Ludovic's new videos in #ludovic-videos. A button in #welcome." },
  // Not a role to pick: a merged PR in Horizon, verified with /verify-github (src/features/contributors.js). It opens #contributors.
  { key: 'contributor', was: 'ai', name: '🛠️ Contributor', color: 0x9b7bff, self: false, label: 'Contributor', about: 'for a merged pull request in Horizon, not a button: `/link-github`, then `/verify-github`. It lets you write in #contributors.' },
  { key: 'modder', name: '🧩 Modder', color: 0x4cc38a, self: true, label: 'Modder', about: 'you make or use Horizon mods. A button in #welcome.' },
  { key: 'lvl5', name: 'lvl 5', color: 0x95a5a6, level: 5 },
  { key: 'lvl10', name: 'lvl 10', color: 0x7ed6df, level: 10 },
  { key: 'lvl20', name: 'lvl 20', color: 0x22a6b3, level: 20 },
  { key: 'lvl30', name: 'lvl 30', color: 0xf0932b, level: 30 },
  { key: 'lvl50', name: 'lvl 50', color: 0xeb4d4b, level: 50, hoist: true },
  { key: 'booster', managed: 'premium_subscriber', name: '💎 Booster', color: 0xf47fff, hoist: true, about: 'given by Discord to members who boost the server.' },
  { key: 'tester', name: '🧪 Horizon Tester', color: 0xffd166, hoist: true, about: 'given by the staff by hand.' },
  // Given by Ludovic by hand. 💚 Sponsor: who sponsors Horizon (Sculk Hosting's owner, 2026-10-27).
  { key: 'sponsor', name: '💚 Sponsor', color: 0x2ecc40, hoist: true, about: 'for sponsors of Horizon on GitHub: `/sponsor github:<you>`. Every way to support Horizon is in #support-horizon.' },
  // Ludovic, 2026-10-30: members who help players in #horizon-support. No permission of its own: it answers anywhere in
  // that forum and manages its posts (the solved tag, closing) there only (`helpers` in LAYOUT). Given through /apply.
  { key: 'support', name: '🤝 Support', color: 0x1abc9c, hoist: true, label: 'Support', about: 'members who help players in #horizon-support: they answer every post there and mark it solved. `/apply` for it.' },
  {
    // No kick or ban (dezer-x in #horizon-team, 2026-10-29: a rogue mod could ban people for no reason): mods time
    // out and delete; a ban goes through the Team.
    key: 'mod', name: '🛡️ Mod', color: 0x2ecc71, hoist: true,
    about: 'the moderators: they time out members and delete messages (bans go through the Horizon Team). `/apply` for it.',
    permissions: ['ModerateMembers', 'ManageMessages', 'ManageThreads', 'ManageNicknames', 'ViewAuditLog', 'MuteMembers', 'DeafenMembers', 'MoveMembers', 'BypassSlowmode', 'UseEmbeddedActivities', 'UseExternalApps'],
  },
  // Ludovic, 2026-11-02: pointofpressure leads the mods. The mods' permissions, shown above them, below the Team.
  {
    key: 'chiefmod', name: '🛡️ Chief of Mods', color: 0x1f8b4c, hoist: true,
    about: 'leads the moderators: the same permissions as a mod, and the first person to reach for moderation questions.',
    permissions: ['ModerateMembers', 'ManageMessages', 'ManageThreads', 'ManageNicknames', 'ViewAuditLog', 'MuteMembers', 'DeafenMembers', 'MoveMembers', 'BypassSlowmode', 'UseEmbeddedActivities', 'UseExternalApps'],
  },
  // The core contributors who review and merge (GitHub team horizon-team). Ludovic, 2026-10-28: they moderate too, with
  // the mods' permissions and the staff channels, and show above the mods. Writes in #contributors; the only role in
  // #horizon-team.
  {
    key: 'team', name: '🌌 Horizon Team', color: 0x9b59b6, hoist: true,
    about: "Horizon's maintainers and core contributors: they review and merge, and moderate too.",
    permissions: ['KickMembers', 'BanMembers', 'ModerateMembers', 'ManageMessages', 'ManageThreads', 'ManageNicknames', 'ViewAuditLog', 'MuteMembers', 'DeafenMembers', 'MoveMembers', 'BypassSlowmode', 'MentionEveryone', 'UseEmbeddedActivities', 'UseExternalApps'],
  },
  { key: 'owner', name: '👑 ludovic', color: 0xf2a33a, hoist: true, owner: true, about: "Ludovic, who started Horizon and owns the server." },
];

// Roles of the old, all-projects server. Setup deletes each one nobody holds; one a member holds stays
// (renamed by nobody) until it can go without taking something away from someone.
export const RETIRED_ROLES = ['videos', 'beatmaker', 'rapper', 'singer', 'youtuber', 'editor', 'designer'];

// Channel types: text, voice, forum, announcement. slowmode: seconds between two messages of a member (setup sets it).
// readonly: everyone reads, only Kira, Ludovic and the Horizon Team post (staffPost: the mods too). writers: everyone reads, only staff, Kira and these roles post. staff: only mods see it. posts: 'staff' → only staff open forum posts.
// locked: a voice channel nobody joins by themselves (Ludovic or a mod moves people in). lobby: join it to get your own room.
// Forums: `guide` is the post guidelines Discord shows above the forum (with the template) and the text of the
// locked, pinned HOWTO post (one per forum that has a template);
// `template` is what a post must look like; `check` is what Kira verifies on each new post (missing → it asks,
// still missing after an hour → the post is closed); `tags` are [emoji, name, staffOnly]; `done` is the tag
// /done puts on a post (solved, taken, found…); `react` the reactions Kira adds; `every` the minimum time
// between two posts by the same member (seconds); `gallery` for media forums.
// `was` on a category: the name it had, so setup moves it instead of making a new one.
// LAYOUT follows the live server (2026-11-01): `name` is the channel's exact name there, decoration included
// ("💬│horizon-chat"); texts still write #horizon-chat. `aka`: names the channel or category went by, found by setup
// and by texts' #mentions. `id`: pins a channel that exists (setup never makes a second one). `bitrate`: a voice channel's.

const LINK_OR_FILE = 'a file or a link';

// Regular chat clears (Ludovic, 2026-10-28: "fais un clear du chat souvent"): #horizon-chat and #general get thousands
// of messages a day, so every 6 hours Kira deletes their messages older than a day (src/features/chatclear.js). Pinned
// messages and messages that started a thread stay; nothing else is touched. /clear-chat (mods) runs it now.
export const CLEAR = {
  channels: ['horizonchat', 'general'], // LAYOUT keys
  olderThanHours: 24,
  everyMs: 6 * 60 * 60_000,
  checkEveryMs: 10 * 60_000, // how often Kira looks whether a clear is due (the last one is state.chatClear.lastRun)
  singlePaceMs: 300,         // between two single deletes (messages over 14 days old can't be bulk-deleted)
};
const CLEARED = ' Messages older than a day are cleared every 6 hours; pins stay.';

export const LAYOUT = [
  {
    key: 'start', category: 'PLAYHORIZON.DEV', aka: ['👋 start here'],
    channels: [
      { key: 'welcome', name: 'ping-roles', aka: ['welcome'], type: 'announcement', readonly: true, topic: 'Start here: what Horizon is, where everything is, and your roles (buttons below).' },
      { key: 'newmembers', name: 'new-members', type: 'text', readonly: true, topic: 'Everyone who joins, welcomed here.' },
      { key: 'horizoninfo', name: 'horizon-info', type: 'text', readonly: true, topic: 'Horizon: Minecraft Java Edition rewritten in Rust. What it is, the download, the disclaimer.' },
      // Ludovic, 2026-10-29: Horizon's official survival server; the game and the launcher list it. Hosted by Sculk since 2026-10-31.
      { key: 'officialserver', name: '🗝️│join-server', aka: ['official-server'], type: 'text', readonly: true, staffPost: true, topic: 'Official Horizon SMP, hosted by https://sculkhosting.com : play.playhorizon.dev' },
      { key: 'faq', name: 'faq', type: 'text', readonly: true, topic: 'Every question you might have, answered: downloading Horizon, posting a bug, contributing, roles, the mods.' },
      { key: 'rules', name: 'rules', type: 'text', readonly: true, topic: 'The rules. Kira enforces them, day and night.' },
      // Kacper (kacpherek, Horizon Team) in #horizon-team, 2026-11-01: scam bots post in every channel, so one channel catches
      // them. Everyone sees it and can post in it (no flags: that is the trap). Whoever posts there is soft-banned (banned
      // with the last day of their messages deleted, then unbanned at once), src/features/moderation.js, MOD.honeypot.
      { key: 'honeypot', name: '🚫│no-text', aka: ['do-not-post', '⚠️│do-not-post'], type: 'text', pin: 'honeypot', topic: '⚠️ DO NOT POST HERE. Anyone who posts in this channel is removed from the server instantly (banned, their last day of messages deleted, then unbanned). It exists to catch scam bots. You can rejoin, but please do not post.' },
      { key: 'announcements', name: '📢│announcements', type: 'announcement', readonly: true, topic: 'Big Horizon news. Pick the 📣 Big news role to get pinged.' },
      { key: 'ludovicvideos', name: 'ludovic-videos', type: 'announcement', readonly: true, topic: 'Ludovic\'s new YouTube videos, posted by Kira as they come out.' },
      // In 👋 start here (Team, 2026-10-28). Ludovic, 2026-10-28: one channel for every way to support him: the Sculk affiliate link, his GitHub Sponsors (also the
      // org-wide Sponsor button) and, later, a crypto address.
      { key: 'sponsors', name: 'sponsors', aka: ['support-horizon'], type: 'text', readonly: true, topic: 'Every way to support Horizon: Sculk server hosting (affiliate link), GitHub Sponsors, and crypto (Bitcoin, Solana, Ethereum and EVM chains).' },
    ],
  },
  {
    key: 'horizon', was: 'mine', category: 'HORIZON-GENERAL', aka: ['🌅 horizon'],
    channels: [
      {
        key: 'horizonbugs', name: 'horizon-bugs', type: 'forum',
        // Ludovic, 2026-10-30: confirmed, reproducible bugs only; "I can't start or play" goes to #horizon-support.
        topic: 'Reproducible bugs in the game or the launcher: something that goes wrong every time you do the same thing. One bug per post, with the template. Can\'t start or play, or need help? #horizon-support. Search first: if it\'s already reported, add your details in that post.',
        tags: [['💥', 'crash'], ['🖼️', 'rendering'], ['🎮', 'gameplay'], ['🌍', 'world gen'], ['⚡', 'performance'], ['🔊', 'sound'], ['🖥️', 'install / launch'], ['🔍', 'confirmed', true], ['🔁', 'duplicate', true], ['✅', 'fixed', true], ['📝', 'via /report', true]],
        guide: 'For **bugs you can make happen again** in the game or the launcher, with the steps. Horizon won\'t start, runs slowly, sign-in fails, or you\'re not sure it\'s a bug? Ask in #horizon-support: posts here that are requests for help are pointed there. One bug per post. **Search first**: if someone already reported it, reply in their post instead. Update first: the launcher installs the newest Nightly by itself, and many bugs are already fixed there. Title: what\'s broken, in a few words ("Water renders black on AMD"). Pick a tag. Kira checks that the template is filled in; posts without it are closed after an hour. Each post becomes a GitHub issue, and you are pinged here when it is answered or fixed. `/report` (anywhere) opens a form that makes the post for you.',
        template: '**What I did:** the steps that make it happen, one per line\n**What happened:**\n**What I expected:**\n**Does it happen every time?**\n**Horizon version:** as the game shows it (Nightly <date> · <commit>)\n**OS, CPU, GPU:**\n+ a screenshot, a video or the log file if you have one',
        check: { min: 80, needs: [['What I did', /what i did|steps/i], ['What happened', /what happened|happen/i], ['What I expected', /expect/i], ['OS, CPU, GPU', /\b(os|windows|linux|mac|macos|gpu|nvidia|amd|intel|radeon|geforce)\b/i]] },
      },
      {
        // Ludovic, 2026-10-30: help with Horizon, apart from the bugs. Everyone opens posts and writes in their own;
        // 🤝 Support (and the staff) answer in every post, tag them solved and close them (`helpers`, src/permissions.js;
        // `replies: 'helpers'`: Kira removes other members' replies, src/features/support.js). Never GitHub issues.
        key: 'horizonsupport', name: 'horizon-support', type: 'forum', helpers: ['support'], replies: 'helpers', done: '✅ solved',
        topic: 'Help with Horizon: it won\'t start, it runs slowly, the launcher, sign-in, multiplayer. One post per problem, with the template. Kira gives a first answer, 🤝 Support helps.',
        tags: [['🚀', 'launcher'], ['⛔', "can't start"], ['⚡', 'performance'], ['👤', 'account'], ['🌐', 'multiplayer'], ['❓', 'other'], ['✅', 'solved', true]],
        guide: 'Something not working? Ask here: Horizon or the launcher won\'t start or install, it runs slowly, sign-in fails, you can\'t join a server. **One problem per post**, and **search first**: someone may have had the same one. Title: the problem in a few words ("Black screen after Play on Windows 11"). Pick a tag. Kira may give a first answer from the FAQ and Horizon\'s docs; then a 🤝 Support member or a mod helps you. Only you and 🤝 Support write in your post. Solved? Type `/done` in it. A bug you can make happen again, with the steps, goes in #horizon-bugs instead. Want to help people here? `/apply` for 🤝 Support.',
        template: '**What\'s wrong:**\n**What I tried:**\n**Horizon or launcher version:** if you know it\n**OS, CPU, GPU:**\n+ a screenshot or the log file if you have one',
        check: { min: 40, needs: [["What's wrong", /what'?s wrong|wrong|problem|issue/i], ['OS, CPU, GPU', /\b(os|windows|linux|mac|macos|gpu|nvidia|amd|intel|radeon|geforce)\b/i]] },
      },
      {
        key: 'horizonideas', name: 'horizon-ideas', type: 'forum', react: ['👍', '👎'],
        topic: 'One idea per post, with the template. Vote with 👍 and 👎. Kira sends each idea to the suggestion queue; picked ones become roadmap items (playhorizon.dev/hub).',
        tags: [['⚡', 'performance'], ['🧩', 'modding'], ['🌐', 'multiplayer'], ['🤖', 'mcp / agents'], ['🎬', 'video studio'], ['🎮', 'gameplay'], ['🚀', 'launcher'], ['💡', 'other'], ['📌', 'planned', true], ['✅', 'done', true], ['❌', "won't do", true]],
        guide: 'One idea per post. **Search first** and vote 👍 on the existing post rather than making a new one. Title: the idea in a few words. Horizon aims at 100% vanilla behaviour first: ideas that change gameplay come after that. Kira closes posts without the template after an hour. Each post goes to the suggestion queue the maintainers read: this forum is the only way in from Discord. The ones they pick become items on the roadmap at playhorizon.dev/hub. Ideas are not GitHub issues.',
        template: '**The idea:**\n**Why:** what it makes better\n**How it could work:** (optional)',
        check: { min: 40, needs: [['The idea', /the idea|idea/i], ['Why', /why/i]] },
      },
      { key: 'horizonchat', name: '💬│horizon-chat', type: 'text', topic: 'Talk about Horizon. Need help (it won\'t start, it\'s slow, sign-in)? #horizon-support. Bugs go in #horizon-bugs and ideas in #horizon-ideas, so they don\'t get lost here.' + CLEARED },
      {
        key: 'showcase', was: 'videofeedback', name: 'showcase', type: 'forum', gallery: true, reaction: '🔥', react: ['🔥'],
        topic: 'Your Horizon creations: YouTube videos, clips, screenshots, builds, worlds, redstone, benchmarks. One post each, with the template.',
        tags: [['🎬', 'video'], ['📸', 'screenshot'], ['🏰', 'build'], ['🎞️', 'clip'], ['🔴', 'redstone'], ['🌍', 'world'], ['⚡', 'benchmark'], ['🧩', 'mod'], ['⭐', 'featured', true]],
        guide: 'Show what you made **in Horizon**: a video, a clip, screenshots, a build, a benchmark. One post per creation (updates go in your own post), one new post every hour at most. Your own YouTube videos about Horizon are welcome here: this is the place for them. A screenshot, a video or a link is required. Content that isn\'t about Horizon goes in #general.',
        template: '**What it is:**\n**Horizon version:** release or commit (optional)\n+ a screenshot, a video or a link',
        // The title and a line of text say what it is; matching the words "what"/"this" closed complete posts.
        check: { media: true, min: 20 },
      },
      { key: 'modding', name: '🧩│modding', type: 'text', topic: 'Making Horizon mods: content mods (.hmod), native mods, porting Java mods, the registry. Ask for help, share work in progress, compare notes. Finished mods go in #showcase; published ones on playhorizon.dev/mods. Guides: docs/mods.md and docs/native-mods.md.' },
      { key: 'releases', name: '📰│releases', type: 'text', readonly: true, topic: 'Every new Horizon version and launcher, posted by Kira. Pick the 📦 Releases role to get pinged.' },
      { key: 'updates', name: '📰│updates', type: 'text', readonly: true, topic: 'What changed in Horizon: merged work grouped by roadmap item, releases, the weekly summary, and the board at a glance. The full kanban and roadmap: playhorizon.dev/hub. Talk about it in #horizon-chat.' },
    ],
  },
  {
    // The official server's chat bridge (Anthony S. via Ludovic, 2026-10-31): posted by its horizon-server through a webhook
    // ([discord] in server.toml). `id` pins the channel that exists, so setup never makes a second one.
    key: 'smp', category: 'HORIZONSMP',
    channels: [
      { key: 'serverchat', id: '1566146381931094148', name: '🌐│server-chat', aka: ['server-chat'], type: 'text', readonly: true, staffPost: true, topic: 'Live chat of the official server (play.playhorizon.dev), drawn as in game. Read-only: talk in game.' },
    ],
  },
  {
    // Ludovic, 2026-10-28 ("rethink the architecture"): the contributors and the Team get a place of their own, apart
    // from the players' channels (horizon-parity agent-state/discord-arch-1.md).
    key: 'contributing', category: '🛠️ CONTRIBUTORS', aka: ['🛠️ contributing'],
    channels: [
      // writers: everyone reads; only the mods and these roles write, open threads and write in them (src/permissions.js).
      { key: 'contributors', name: 'contributors', type: 'text', writers: ['contributor', 'team'], topic: "Where Horizon's contributors talk. Everyone can read. To write: have a merged PR, then `/link-github` + `/verify-github`." },
      // members: only these roles (and Kira, Ludovic) see it, write and open threads (src/permissions.js).
      { key: 'horizonteam', name: 'horizon-team', type: 'text', members: ['team'], topic: 'Horizon Team only: the maintainers and the core contributors.' },
    ],
  },
  {
    key: 'general', category: 'GENERAL', aka: ['💬 general'],
    channels: [
      // Ludovic, 2026-10-30: #off-topic merged into #general (REPLACED): one chat for anything.
      { key: 'general', name: 'general-chat', aka: ['general'], type: 'text', topic: 'Talk about anything: other games, music, AI coding, life. Horizon talk is welcome too, though #horizon-chat is its home; problems with Horizon go in #horizon-support. English please, so everyone can follow; other languages have their own channels in 🌍 languages.' + CLEARED },
      { key: 'introductions', name: 'introductions', type: 'text', pin: 'intro', topic: 'Say hi once, with the template in the pinned message. One introduction per person.' },
      { key: 'halloffame', name: 'hall-of-fame', type: 'text', readonly: true, topic: 'Messages that got 5 ⭐. React ⭐ to a message you love to send it here.' },
      { key: 'memes', name: 'memes', type: 'text', topic: 'Memes and funny stuff (Minecraft ones welcome). SFW only. No XP here.' },
      { key: 'botcommands', name: 'bot-commands', type: 'text', topic: 'Use Kira here: /rank, /leaderboard, /working, /remind, /userinfo… Level-ups are announced here. No XP here.' },
    ],
  },
  {
    // Ludovic, 2026-10-28: players asked for their language (Russian speakers say they are ~40 %); then "add more
    // different language channels". Everyone sees all of them (default channels; Ludovic, 2026-10-28). Re-measured on
    // 2026-11-11: a channel with fewer than ~5 people writing is proposed for removal.
    key: 'languages', category: '🌍 languages',
    channels: [
      { key: 'russian', name: 'русский', type: 'text', topic: 'Общение на русском: Horizon и всё остальное. Баги — в #horizon-bugs, проблемы (не запускается, тормозит, вход в аккаунт) — в #horizon-support, идеи — в #horizon-ideas.' },
      { key: 'portuguese', name: 'português', type: 'text', topic: 'Conversa em português: o Horizon e tudo mais. Bugs vão em #horizon-bugs, problemas (não abre, lento, login) em #horizon-support e ideias em #horizon-ideas.' },
      { key: 'spanish', name: 'español', type: 'text', topic: 'Charla en español: Horizon y todo lo demás. Los bugs van en #horizon-bugs, los problemas (no arranca, va lento, inicio de sesión) en #horizon-support y las ideas en #horizon-ideas.' },
      { key: 'french', name: 'français', type: 'text', topic: 'On parle français : Horizon et tout le reste. Les bugs vont dans #horizon-bugs, les problèmes (ne démarre pas, lent, connexion) dans #horizon-support et les idées dans #horizon-ideas (en anglais).' },
      { key: 'german', name: 'deutsch', type: 'text', topic: 'Auf Deutsch: Horizon und alles andere. Bugs gehören in #horizon-bugs, Probleme (startet nicht, langsam, Anmeldung) in #horizon-support, Ideen in #horizon-ideas (auf Englisch).' },
      { key: 'italian', name: 'italiano', type: 'text', topic: 'Si parla italiano: Horizon e tutto il resto. I bug vanno in #horizon-bugs, i problemi (non si avvia, è lento, accesso) in #horizon-support e le idee in #horizon-ideas (in inglese).' },
      { key: 'dutch', name: 'nederlands', type: 'text', topic: 'Nederlands gesprek: Horizon en al het andere. Bugs gaan in #horizon-bugs, problemen (start niet, traag, inloggen) in #horizon-support en ideeën in #horizon-ideas (in het Engels). Moderator: yn4p.' },
      { key: 'polish', name: 'polski', type: 'text', topic: 'Rozmowy po polsku: Horizon i wszystko inne. Błędy zgłaszaj w #horizon-bugs, problemy (nie uruchamia się, działa wolno, logowanie) w #horizon-support, pomysły w #horizon-ideas (po angielsku).' },
      { key: 'turkish', name: 'türkçe', type: 'text', topic: 'Türkçe sohbet: Horizon ve diğer her şey. Hatalar #horizon-bugs kanalına, sorunlar (açılmıyor, yavaş, giriş) #horizon-support kanalına, fikirler #horizon-ideas kanalına (İngilizce).' },
      { key: 'chinese', name: '中文', type: 'text', topic: '用中文聊天：Horizon 和其他一切。Bug 请发到 #horizon-bugs，问题（无法启动、卡顿、登录）请发到 #horizon-support，想法请发到 #horizon-ideas（用英文）。' },
      { key: 'japanese', name: '日本語', type: 'text', topic: '日本語で話そう：Horizon のことも、それ以外も。バグは #horizon-bugs へ、困りごと（起動しない、重い、ログイン）は #horizon-support へ、アイデアは #horizon-ideas へ（英語で）。' },
    ],
  },
  {
    key: 'voice', category: '🔊 voice',
    channels: [
      { key: 'lounge', name: 'Lounge', type: 'voice', bitrate: 256000 },
      { key: 'gaming', name: 'Gaming', type: 'voice', bitrate: 256000 },
      { key: 'waiting', name: '⏳ waiting room', type: 'voice', bitrate: 256000 },
      { key: 'ludovic', name: '🎙️ ludovic', type: 'voice', bitrate: 256000, locked: true },
      { key: 'lobby', name: '➕ create your room', type: 'voice', bitrate: 256000, lobby: true },
    ],
  },
  {
    key: 'staff', category: '🛡️ staff', staff: true,
    channels: [
      { key: 'modchat', name: 'mod-chat', type: 'text', staff: true },
      { key: 'modlog', name: 'mod-log', type: 'text', staff: true, topic: 'Kira logs here: joins (and the invite they used), leaves, deleted and edited messages, warnings, timeouts, bans, raids, AutoMod.' },
      // mod-log split (pointofpressure, 2026-11-01): the numbered cases, joins and leaves, and Kira's AI lines each get their own.
      { key: 'modactions', name: 'mod-actions', type: 'text', staff: true, topic: 'The numbered cases: every timeout, quarantine, ban, unban and kick, by a mod or by Kira, and the appeals\' outcomes. The one channel to watch.' },
      { key: 'joinleave', name: 'join-leave', type: 'text', staff: true, topic: 'Joins (account age, the invite they used) and leaves, grouped every minute.' },
      { key: 'kirahandoffs', name: 'kira-handoffs', type: 'text', staff: true, topic: "Kira's AI: the questions she passes to the team, her answers and their cost." },
      // Only 🔒 Quarantined members (and the staff) see it, in the staff category; read and press the button only: Kira's pinned "Open appeal" form (src/features/modcases.js).
      { key: 'appeal', name: 'appeal', type: 'text', quarantine: true, topic: 'Quarantined? Press "Open appeal" below: a short form the mods read and decide on.' },
      { key: 'reports', name: 'reports', type: 'text', staff: true, topic: 'Reports from members: /report-member and "Report to mods" on a message.' },
      { key: 'modmail', name: 'mod-mail', type: 'text', staff: true, topic: "Members DM Kira; each conversation is a thread here. Write in the thread to answer (start with // for a note they don't see, //close to close)." },
      { key: 'discordupdates', name: 'discord-updates', type: 'text', staff: true, topic: 'Messages from Discord to community servers.' },
      { key: 'roadmapsuggestions', name: 'roadmap-suggestions', type: 'text', staff: true, topic: 'The suggestion queue: #horizon-ideas posts. A good one becomes a roadmap item (a pull request to roadmap.toml), never an issue. Kira posts here once ROADMAP_SUGGESTIONS_CHANNEL_ID is this channel\'s ID.' },
      { key: 'agentlog', name: 'agent-log', type: 'text', staff: true, topic: "Every call contributors' AI agents make through Kira's MCP server: who (the token's owner), which tool, the outcome. Tokens: /agent tokens member:." },
    ],
  },
];

// The locked, pinned post at the top of each forum that has a template. Setup finds it again by this name.
// `tag` is the staff-only tag it carries (forums require a tag); `mention` is how texts name it.
export const HOWTO = { name: '📌 How to post here: read me first', tag: ['📌', 'read me', true], mention: 'the 📌 **How to post here** post' };

// What everyone sees in the channel list from the start; the Onboarding answers add the rest.
export const DEFAULT_CHANNELS = ['welcome', 'newmembers', 'rules', 'honeypot', 'faq', 'announcements', 'ludovicvideos', 'horizoninfo', 'officialserver', 'horizonchat', 'contributors', 'horizonbugs', 'horizonsupport', 'horizonideas', 'showcase', 'releases', 'updates', 'general', 'introductions', 'halloffame', 'memes', 'botcommands', 'russian', 'spanish', 'portuguese', 'french', 'german', 'italian', 'dutch', 'polish', 'turkish', 'chinese', 'japanese'];

// A channel's own moderators, by Discord user id: setup gives each one Manage Messages, Manage Threads and Pin
// Messages in that channel only (src/permissions.js). yn4p moderates #nederlands (Ludovic, 2026-10-30).
export const CHANNEL_MODS = { dutch: ['1308764088444260455'] };

// Replaced by another channel (2026-10-25: #updates replaces #work-board and #dev-log; 2026-10-30: #general replaces
// #off-topic). Setup exports every message of each one, with its attachments, to scratch/ (not committed), then deletes
// it; if the export fails, the channel stays.
export const REPLACED = [{ key: 'workboard', name: 'work-board', by: 'updates' }, { key: 'devlog', name: 'dev-log', by: 'updates' }, { key: 'offtopic', name: 'off-topic', by: 'general' }];

// Deleted by setup when no member ever wrote in them (empty channels of the old scope).
export const RETIRED = ['tracks', 'chill', 'aicoding', 'rewrites', 'coding', 'creatorschat', 'editing', 'musicchat', 'studio'];

// Pinned messages in text channels.
export const PINS = {
  honeypot: '⚠️ **Do not post in this channel.** Anyone who posts here is removed from the server instantly: banned, their messages from the last day deleted, and unbanned right away so a real person can rejoin.\n\nThis channel is a trap for scam bots (fake giveaways, "free Nitro", crypto and MrBeast scams), which post in every channel they can write in. Nothing is ever discussed here. The mods and the Horizon Team are not affected. Chat in #general or #horizon-chat; need help? #horizon-support.',
  intro: '👋 **Introduce yourself** (once), like this:\n\n**Name:** what we call you\n**How I play:** survival, creative, redstone, servers, speedruns…\n**My setup:** OS and GPU (optional, it helps with bugs)\n**Here to:** play, test, report bugs, contribute code, mod…\n**GitHub:** (optional, if you contribute: then run `/link-github`)\n\nOne message, one introduction. To chat, go to #general or #horizon-chat.',
};

// Releases announced in #releases: Horizon's game (`v…` tags) and launcher (`launcher-v…` tags) only.
export const RELEASE_REPOS = ['horizon'];
export const RELEASE_EVERY_MS = 3 * 60 * 1000; // one GitHub API request each time
export const RELEASE_SLOW_MS = 30 * 60 * 1000; // while GitHub's webhook delivers (src/webhook.js): its release events say it at once

// Ludovic's YouTube videos → #ludovic-videos (src/videos.js): the channel's public Atom feed, polled every 10 minutes.
// His channel is @lu4ovic (LINKS.youtube).
export const VIDEOS = {
  channelId: 'UCNpwCgIK6O6oct9ra9ohZ7w',
  feedUrl: 'https://www.youtube.com/feeds/videos.xml',
  everyMs: 10 * 60 * 1000,
};

// One-off announcements Kira posts once (the key is remembered in state.oneOffs), for big releases.
// `role`: the only role pinged (none if absent). Posted when Kira starts; written by hand.
const V2026_10_13_1 = 'https://github.com/horizon-rust/horizon/releases/tag/v2026.10.13.1';
const AGENT_GUIDE = {
  title: '🤖 Connect your AI coding agent to the work board',
  description: [
    "Coding on Horizon with an AI agent (Claude Code, Codex, Cursor…)? Give it Kira's work board.",
    '',
    "**What it can do:** see the board and what Ludovic is working on, claim issues and move your own cards, post progress notes on them, and ask in #horizon-chat.",
    '',
    '**Start:** run `/agent connect` in any channel (scope `read`, or `write` to claim and update cards). Kira answers privately with your token and the setup for your tool:',
    '',
    agentSnippets(MCP_URL, '<your token>'),
    '',
    '**Your key** is personal: shown once, everything your agent does is in your name and logged, it expires in 90 days. `/agent tokens` lists yours, `/agent revoke` stops one at once.',
    '**Limits:** 8 claimed issues at a time, 6 claims an hour, 10 open cards of your own, 20 changes a minute.',
  ].join('\n'),
  footer: { text: `Endpoint: ${MCP_URL}` },
};

export const ONE_OFFS = [
  {
    key: 'horizon-v2026.10.13.1', channel: 'announcements', role: 'horizon',
    content: 'Horizon 2026.10.13.1 is out.',
    embed: {
      title: 'Horizon 2026.10.13.1: its own menus, graphics settings, much faster', url: V2026_10_13_1,
      description: [
        "A big update. Horizon now has menus of its own, real graphics settings, and it renders much faster.",
        '',
        "**Horizon's own menus.** A new title screen, world list, options and pause menu in the launcher's style, over a live landscape. Prefer the vanilla look? Options → Interface → Menu style → Classic.",
        '',
        '**Graphics settings, Simple or Advanced.** Pick a preset (Performance, Balanced, Quality, Ultra), or set every rendering, quality, display and performance option yourself, each with a short description and what it costs. There is a performance overlay too.',
        '',
        '**Much faster rendering.** Over a village at render distance 8, an RTX 4080 went from 363 to 2,409 FPS. Render distance 32 still stutters in places.',
      ].join('\n'),
      fields: [
        {
          name: 'Fixed',
          value: [
            '• No sound on Linux',
            '• Linux builds now run on ordinary distros (Arch, Ubuntu, …)',
            '• Windows no longer asks for a missing DLL: the launcher no longer needs the Visual C++ runtime',
            '• Memory growing near villages, and the frame rate dropping and staying low there',
            '• Preparing resources failing on Linux ("Missing … java-objc-bridge")',
            '• The hand and held item at high FOV, and the missing swing animations',
          ].join('\n'),
        },
        { name: 'New website', value: `${LINKS.horizonSite}: what Horizon is, and the download.` },
        {
          name: 'Get it with the launcher',
          value: `Already have the Horizon launcher? It installs this version by itself. New here? [Download the launcher](${LINKS.horizonLauncher}). You need your own copy of Minecraft: Java Edition 26.3.\n[Full release notes](${V2026_10_13_1}), known issues included.`,
        },
      ],
    },
  },
  {
    key: 'horizon-only', channel: 'announcements',
    content: 'This server is now all about Horizon.',
    embed: {
      title: 'This server is now all about Horizon', url: LINKS.horizonSite,
      description: [
        'From today this Discord is the home of **Horizon**, Minecraft Java Edition rewritten in Rust: playing it, bugs, ideas, releases, and who is building what.',
        '',
        'The channels about my other projects, music and AI coding are gone: those topics are welcome in #general.',
        '',
        `**Get Horizon:** ${LINKS.horizonSite} · [the launcher](${LINKS.horizonLauncher}) · [GitHub](${LINKS.horizon})`,
        '**Found a bug?** #horizon-bugs · **An idea?** #horizon-ideas · **Made something in it?** #showcase',
        '**Want to help build it?** #work-board shows who is on what: `/claim` an issue before you start.',
      ].join('\n'),
      footer: { text: 'Horizon is an unofficial fan project, not affiliated with Mojang or Microsoft.' },
    },
  },
  // /notify (src/features/notify.js), announced once in #contributors (2026-11-01).
  {
    key: 'notify-dms', channel: 'contributors', when: 'notify',
    content: '🔔 New: Kira can DM you when your Horizon pull requests and issues change.',
    embed: {
      title: '🔔 /notify: hear about your pull requests and issues at once',
      description: [
        'Run `/notify dm:on` and Kira DMs you when something happens on **your own** pull requests and issues in horizon and horizon-mods:',
        '• a review (approved, changes requested, comments) and new comments by others, agents included',
        '• merged, closed or reopened',
        '• a required check failing on your head (verify, parity), merge conflicts appearing',
        '• labels like needs-proof',
        '',
        'Several things at once come as one DM, at most one every 5 minutes, and nothing for what you did yourself. It needs your GitHub account linked and verified (`/link-github`, then `/verify-github`) and your DMs open for this server. `/notify` alone shows where you stand, `/notify dm:off` stops it.',
      ].join('\n'),
    },
  },
  // Posted once /agent connect is open (KIRA_AGENT_ISSUANCE=on); `editable`: edited in place at each start,
  // so a new endpoint (KIRA_MCP_URL) or text reaches the existing messages. `pin`: pinned where it's posted.
  { key: 'agents-live', channel: 'announcements', when: 'agents', editable: true, content: 'Contributors: your AI coding agent can now work with Horizon\'s board.', embed: AGENT_GUIDE },
  { key: 'agents-info', channel: 'horizoninfo', when: 'agents', editable: true, pin: true, content: '', embed: AGENT_GUIDE },
];

// The official server's market and economy (src/features/smp.js): the pages the SMP mod POSTs once a minute with
// KIRA_SMP_INGEST_TOKEN, served to the hub, and the market's day posted once.
export const SMP = {
  summaryChannel: 'serverchat',
};

// The hub (playhorizon.dev/hub): the one public place for the roadmap, the kanban, the journal and how to help.
// Kira is its front desk on Discord, with the same verbs (src/hub.js, src/features/hub.js). The website publishes
// the roadmap and the journal as JSON (the horizon repo's roadmap/README.md). Suggestions come only from #horizon-ideas
// posts and go to one private queue: #roadmap-suggestions, whose ID is ROADMAP_SUGGESTIONS_CHANNEL_ID (unset: off).
export const HUB = {
  url: process.env.HUB_URL || LINKS.hub,
  roadmapJson: process.env.HUB_ROADMAP_URL || 'https://playhorizon.dev/data/roadmap.json',
  journalJson: process.env.HUB_JOURNAL_URL || 'https://playhorizon.dev/data/journal.json',
  suggestionsChannel: process.env.ROADMAP_SUGGESTIONS_CHANNEL_ID?.trim() || null,
  cacheMs: 5 * 60_000, // the roadmap is fetched again at most every 5 minutes
  journalEveryMs: 10 * 60_000, // the journal, for #updates
  reportPerHour: 3, // bugs per member an hour (/report); the GitHub limits of GITHUB.rate apply too
};

// Forum posts → GitHub issues (src/features/github.js). Off until GITHUB_TOKEN is set (see the README).
// Per forum: the repo and kind. `fixed` / `notPlanned` / `duplicate`: the forum tags Kira applies when
// the issue is closed that way.
export const GITHUB = {
  owner: 'horizon-rust', // the GitHub org that owns Horizon's repos (moved from ludovic111, 2026-10-27)
  maintainer: 'ludovic111', // login whose comments on issues count as the maintainer's
  forums: {
    horizonbugs: { repo: 'horizon', kind: 'bug', fixed: 'fixed', duplicate: 'duplicate' },
    // queue: ideas go to the suggestion queue (HUB), not to GitHub; ideas sent before that keep their issue and answers.
    horizonideas: { repo: 'horizon', kind: 'idea', fixed: 'done', notPlanned: "won't do", queue: true },
  },
  private: [], // repos whose issues get no link in Discord (players can't open them)
  labels: { bug: 'bug', idea: 'enhancement', from: 'from-discord' },
  pollEveryMs: 5 * 60 * 1000,
  pollSlowMs: 30 * 60 * 1000, // while GitHub's webhook delivers: its issue and comment events trigger the poll
  rate: { perUser: 3, global: 20, windowMs: 60 * 60 * 1000 }, // issues opened per hour
  notifyByDm: false, // also DM the poster when their post gets an answer (the thread mention is the main channel)
};

// The work board (src/board.js, src/features/workboard.js): the board's summary at the top of #updates (the kanban
// itself is on the hub), /claim, /unclaim, /working, /board, /move (maintainers), /link-github.
// `github`: Discord user → GitHub login known from the start; /link-github adds and overrides.
export const WORK = {
  repo: 'horizon',
  label: 'in progress', labelColor: 'fbca04',
  refreshMs: 10 * 60 * 1000,
  slowRefreshMs: 60 * 60 * 1000, // while GitHub's webhook delivers: its events trigger the refresh instead
  webhookGapMs: 60_000, // at most one refresh a minute from webhook events
  claimCooldownMs: 10 * 60 * 1000, // between a claim and an unclaim of the same issue (each writes to GitHub)
  maxClaims: 8, // issues a member may hold at once (maintainers: no limit)
  memberCooldownMs: 2 * 60 * 1000, // between two claims or unclaims by the same member, any issues
  expireDays: 14, remindDays: 3,  // a claim lapses after 14 days without activity; a DM 3 days before
  mergedDays: 7,                  // "merged in the last 7 days"
  github: {
    '622720516779802630': 'ludovic111', // Ludovic
    '1531466016054444261': 'Online5277', // Cosmic
  },
};

// The hub's org chart (src/org-chart.js, GET /staff.json). `roles`: the tiers' role ids as of 2026-11-02 (setup's ids
// win). `github`: Discord id → GitHub login for staff whose accounts are confirmed but who haven't run `/link-github
// credit:True` (Ludovic, 2026-11-02; levzzz5154 and pointofpressure: the same handle on both, and the same name).
// `jobs`: a short, factual job beside the role, when there is one.
export const ORG = {
  roles: { owner: '1559251767860920370', team: '1564768999655481485', chiefmod: '1566825954792181864', mod: '1559242168864997537', support: '1565697648269205699' },
  github: {
    '663689837483655188': 'dezer-x', // Anthony S.
    '777346923232886784': 'rdbtCVS', // rdbt
    '821858512975953993': 'levzzz5154', // levzzz
    '1130639426033295370': 'PointOfPressure', // pressure
  },
  jobs: {
    '663689837483655188': 'Design',
    '777346923232886784': 'Official server economy',
  },
};

// /apply (src/features/apply.js): Discord's way into the application form on the website (docs/staff-api.md). The
// staff side (the dashboards) owns the form, who may apply and the decisions; Kira DMs the form's link, and when a
// decision comes back she gives the role and DMs the member. `intro`: where a newly accepted member starts.
export const APPLY = {
  perHour: 3, // links asked for per member an hour (each one voids the one before)
  roles: {
    support: { label: '🤝 Support', intro: 'Start in #horizon-support: you can answer in every post there, tag posts ✅ solved and close them (`/done` works on any post). Kira gives a first answer on new posts; yours is the one that counts.' },
    mod: { label: '🛡️ Mod', intro: 'Start in #mod-chat: you can time out members, delete messages and manage threads, and #mod-log, #reports and #mod-mail are open to you. Bans go through the Horizon Team.' },
    team: { label: '🌌 Horizon Team', intro: 'Start in #horizon-team. Only the Discord role was given: access to the GitHub organisation or its teams is set up by Ludovic by hand, and he has been told.' },
  },
};

// #horizon-support (src/features/support.js): a new post that follows its template gets Kira's first answer (when her AI
// is on) and a note for 🤝 Support, pinging the role at most once every `pingEveryMs` (later posts are named in the next
// ping). Replies from members other than the poster, 🤝 Support and the staff are removed with a short note, at most one
// note per member every `noteEveryMs`.
export const SUPPORT = {
  role: 'support', forum: 'horizonsupport',
  pingEveryMs: 15 * 60_000,
  noteEveryMs: 10 * 60_000,
  noteMs: 20_000, // the note under a removed reply goes after this long
};

// Contributors (src/features/contributors.js): 🛠️ Contributor = a member whose GitHub account is verified
// (/verify-github) and has at least one merged pull request in GITHUB.owner/WORK.repo. It opens #contributors.
export const CONTRIBUTORS = {
  role: 'contributor', channel: 'contributors',
  codeTtlMs: 30 * 60_000,       // a /verify-github code is valid this long
  graceDays: 7,                 // holders with a merged PR but no verification keep the role this long
  sweepEveryMs: 24 * 60 * 60_000, // the daily look for members who qualify and were missed
  verifyPerHour: 6,             // /verify-github answers per member an hour (each check reads GitHub)
  searchPaceMs: 2_200,          // between two searches (the search API allows 30 a minute)
  // Ludovic's trusted reviewers: the clean-up never removes their role without a DM and 7 days (kacpherek, rdbtCVS, Online5277).
  protectedLogins: ['kacpherek', 'rdbtCVS', 'Online5277'],
  // Discord id → login of Ludovic's trusted reviewers (found by hand). Nothing automatic ever takes the role from
  // them: the clean-up gives an unlinked one the DM and 7 days, and the sweep and a changed link leave them the role.
  protectedMembers: { '437262688930889730': 'kacpherek', '777346923232886784': 'rdbtCVS', '1531466016054444261': 'Online5277' },
};

// /notify (src/features/notify.js): DMs to a verified contributor who opted in, about their own pull requests and
// issues in GITHUB.owner's repos (asked by Isloka, 2026-11-01): 'public' = every public repository of the org (levzzz,
// 2026-11-01), or a list of names. `checks`: per repo, the check runs whose failure is worth a DM (horizon's required
// one is verify), '*' for the other repos ('*' in a list: any check); `labels`: worth a DM when someone else adds them.
export const NOTIFY = {
  repos: 'public',
  checks: { horizon: ['verify', 'parity', 'launcher'], 'horizon-mods': ['check'], '*': ['*'] },
  labels: ['needs-proof', 'parity-regression', 'release-blocker', 'duplicate', 'invalid', 'wontfix', 'question'],
  windowMs: 3 * 60_000, // a member's events wait this long after the first one, then go as one DM
  gapMs: 5 * 60_000, // never two DMs to a member closer than this
  conflictDelayMs: 3 * 60_000, // after main moves, GitHub needs a moment to work out mergeability
};

// The website (horizon-rust/horizon-site, playhorizon.dev; src/features/site.js): when GitHub's webhook says something
// it shows changed, Kira calls its POST /api/revalidate with the matching cache tags (KIRA_SITE_REVALIDATE_SECRET, the
// site's REVALIDATE_SECRET), then loads the pages that show it once, so visitors get the new data within a minute.
export const SITE = {
  url: process.env.KIRA_SITE_URL || 'https://playhorizon.dev',
  gapMs: 30_000, // at most one call every 30 s per tag
  modsDelayMs: 3 * 60_000, // horizon-mods' registry index is published by a Pages build after the push
  warm: { // what to load after a tag expires
    'github:horizon:main': ['/', '/hub', '/docs', '/data/roadmap.json', '/data/journal.json'],
    'github:horizon:issues': ['/hub', '/data/journal.json'],
    'github:horizon:releases': ['/', '/releases', '/data/journal.json'],
    'github:horizon-mods:main': ['/mods', '/mods/policy'],
  },
};

// 💚 Sponsor for GitHub sponsors of GITHUB.maintainer (src/features/sponsors.js, src/sponsor-kit.js). Ludovic,
// 2026-10-28: any sponsor gets it, one-time ones included. /sponsor proves the account is the member's (a code in its
// bio or a public gist, like /verify-github) and asks GitHub's isSponsoredBy; a daily check takes the role back from
// the members Kira gave it to once GitHub stops reporting them. Private sponsorships read false: the mods use
// /sponsor-grant. A role given by hand (or held before /sponsor) is never taken away by Kira.
export const SPONSORS = {
  role: 'sponsor',
  codeTtlMs: 30 * 60_000,
  perHour: 6,                     // /sponsor and Verify presses per member an hour (each reads GitHub)
  recheckEveryMs: 24 * 60 * 60_000,
  paceMs: 1_000,                  // between two GitHub checks in the daily recheck
};

// Team roles (src/features/teamroles.js, src/team-roles-kit.js): a team's leader gives and takes back their team's
// role with `/team add|remove member:`, and only that role. Ludovic, 2026-11-03: Discord's Manage Roles would also
// let them edit every channel's overwrites, so it goes through Kira. `managers`: member ids. The mods, the Chief of
// Mods and 👑 ludovic run it on any team role. A role that carries a permission (`DANGEROUS` in the kit) is refused.
export const TEAMS = {
  list: [
    { key: 'hexforge', name: 'hexforge-horizons', role: '1567230973094002818', managers: ['1308764088444260455'] }, // azetech
  ],
  staffRoles: [ORG.roles.mod, ORG.roles.chiefmod, ORG.roles.owner],
  quarantinedRole: '1566489487654002763', // 🔒 Quarantined, when state.roles doesn't have it
  perHour: 30,                            // changes per member an hour
};

// Triage through Kira (src/features/triage.js): GitHub has no Triage role on a personal account's repo, and write
// access would let a branch push run workflows with the repo's secrets. So Ludovic's trusted reviewers label, close,
// reopen and mark duplicates in GITHUB.owner/WORK.repo with `/gh`, using Kira's token. Ludovic edits this list: a
// reviewer needs a GitHub login here and a verified link to it (/verify-github). `/gh pause` stops everyone.
export const TRIAGE = {
  reviewers: ['kacpherek', 'rdbtCVS', 'Online5277'], // the top three contributors by merged PRs (Ludovic, 2026-10-27)
  perDay: 60,                          // actions per reviewer in any 24 hours
  noLabels: /release/i,                // release-now, release-blocker, skip-release…: only Ludovic's side touches those
  keepLabels: ['in progress'],         // Kira's own claim label (WORK.label)
  ownPullsOf: 'ludovic111',            // pull requests by this login (Ludovic's own and his agents') are never touched
};

// Moderation knobs.
export const MOD = {
  // 8 messages in 10 s: 6 in 8 s caught people typing one sentence over several lines (cases #44, #51, 2026-11-04/05).
  floodMessages: 8, floodWindowMs: 10_000,
  repeatCount: 3, repeatWindowMs: 60_000,        // the same message 3 times in a minute in ONE channel…
  // …but an announcement cross-posted to several channels is sharing, not spam: only at 5 distinct channels
  // (cases #61 and #63, 2026-11-05: one Fabric beta announcement in 3 channels timed out twice; the mods lifted both).
  // Below that the copies are left alone. The link flood below still catches scam bots that spray every channel.
  crossPostChannels: 5,
  // …but short talk ("no", "omfg", a ping: under 20 characters, no link, no heading) only at 5 (src/spam-kit.js).
  shortRepeatCount: 5, shortChars: 20,
  // Spam timeouts get longer each time within a day: 10 min, 1 h, 1 day.
  spamTimeoutsMs: [10 * 60_000, 60 * 60_000, 24 * 60 * 60_000],
  newAccountDays: 3,                             // accounts younger than this can't post links
  warnLimit: 3, warnWindowDays: 30, warnTimeoutMs: 60 * 60_000, // 3 warnings in 30 days → 1 h timeout
  capsMin: 25, capsRatio: 0.8,                   // a long message almost all in capitals is removed
  emojiMax: 15,                                  // more emojis than this in one message is removed
  dangerousFiles: /\.(exe|scr|bat|cmd|com|msi|ps1|vbs|jar|apk|dll|lnk|reg|hta|iso|img)$/i,
  // Raids are bursts of brand-new accounts, not a busy evening: 15 accounts younger than 7 days
  // joining within 2 minutes → raid mode (verified phone needed, DMs between members paused) for an hour.
  raidYoungDays: 7, raidJoins: 15, raidWindowMs: 120_000, raidHoldMs: 60 * 60_000,
  // Links: more than 5 in one message is removed; 5 messages with links in 30 s is a flood (deleted, spam timeout).
  linkMax: 5, linkFloodMessages: 5, linkWindowMs: 30_000,
  // No slowmode (Ludovic, 2026-10-28): none set (`slowmode` in LAYOUT would set one), none added when busy.
  // [[messages per minute, seconds of slowmode], …] turns the automatic one on.
  autoSlowmode: [],
  // Piracy (rule 3): a Discord AutoMod rule blocks these and alerts #mod-log; mods and the Horizon Team are exempt
  // (src/automod.js). `keywords` use Discord's wildcards (`word`: the whole word, `word*`: a word that starts with it,
  // `*word*`: anywhere). `patterns` are the Rust regexes Discord runs (10 at most, no lookaround), written so JavaScript
  // reads them the same: test/automod.test.js checks what they catch and what they must not. "crack" and "cracked"
  // alone are not here: they hit crackers and cracked deepslate.
  piracy: {
    keywords: ['tlauncher*', 't-launcher*', 'sklauncher*', 'sk-launcher*', 'tl legacy', 'ultimmc', 'pollymc', 'warez', 'тлаунчер*', 'пиратк*'],
    patterns: [
      // cracked minecraft, crack for mc, cracked version / launcher / account
      '(?i)\\bcrack(?:ed|ing|s)?\\s+(?:for\\s+|of\\s+|an?\\s+)?(?:minecraft|mc|horizon|launchers?|java|versions?|accounts?|clients?|copy)\\b',
      // minecraft cracked (at the end, or followed by version, launcher…)
      '(?i)\\b(?:minecraft|mc)\\s+(?:java\\s+)?crack(?:ed)?\\s*(?:$|[?!.,]|versions?\\b|launchers?\\b|download|accounts?\\b|clients?\\b|free\\b)',
      // offline mode + a way around buying the game
      '(?i)\\boffline[\\s-]*mode\\b.{0,40}\\b(?:bypass|crack|without\\s+(?:buying|paying|owning|an?\\s+account|an?\\s+licen[cs]e)|no\\s+(?:account|licen[cs]e)|for\\s+free)',
      // bypass the licence / premium / authentication / offline mode
      '(?i)\\b(?:bypass(?:ing)?|get\\s+around)\\b.{0,30}\\b(?:licen[cs]e|premium|ownership|account\\s+check|drm|authenticat|online[\\s-]*mode|offline[\\s-]*mode)',
      // shared or generated accounts
      '(?i)\\bfree\\s+(?:minecraft|mc|premium|java)\\s+accounts?\\b|\\b(?:minecraft|mc)\\s+(?:alts?|accounts?)\\s+gen(?:erator)?\\b',
      // Spanish and Portuguese: minecraft pirata, versión crackeada, no premium
      '(?i)\\b(?:minecraft|mc|launcher)\\s+(?:pirata|pirateado|crackeado|non?[\\s-]*premium)\\b|\\b(?:versi[oó]n|vers[aã]o|launcher)\\s+(?:pirata|crackead[oa])\\b',
    ],
    message: 'Piracy is not allowed here (rule 3): Horizon needs your own copy of Minecraft: Java Edition.',
  },
  // Honeypot channel (LAYOUT key `honeypot`): whoever posts in it is soft-banned (banned with `honeypotDeleteSeconds` of
  // their messages deleted, then unbanned at once). Bots, mods, the Horizon Team and Ludovic are exempt (their messages
  // there are only deleted). On unless KIRA_HONEYPOT=off; one soft-ban per user per `honeypotWindowMs`, however many messages.
  honeypot: !['0', 'off', 'false', 'no'].includes((process.env.KIRA_HONEYPOT ?? '').trim().toLowerCase()),
  honeypotDeleteSeconds: 24 * 60 * 60, honeypotWindowMs: 10 * 60_000,
  // Greetings and join logs are grouped when many people arrive at once.
  joinBatchMs: 60_000,
  // Forum posts that don't follow the template are closed after this long.
  formatGraceMs: 60 * 60_000,
};

// Levels: XP for talking (once a minute) and for time in voice with others.
export const LEVELS = {
  messageXp: [15, 25], messageCooldownMs: 60_000,
  voiceXpPerMinute: 10,
  noXp: ['botcommands', 'memes'], // channels that don't give XP
};
export const STARBOARD = { emoji: '⭐', threshold: 5 };

export const WELCOME = {
  title: 'Welcome to Horizon',
  description: [
    '**Horizon** is Minecraft: Java Edition rewritten from scratch in Rust, checked against the real game so it plays exactly like vanilla, and faster. This is its server: players, testers and the people building it.',
    '',
    '**Where things are**',
    '👋 **start here**: #horizon-info (what it is, **the download**), #faq, #rules, #announcements',
    '🌅 **horizon**: #horizon-support (help), #horizon-bugs, #horizon-ideas, #horizon-chat, #showcase (your videos, screenshots, builds), #releases, #updates (what changed)',
    '🛠️ **contributing**: #contributors (read by all, written by people with a merged PR)',
    '💬 **general**: #general for anything (other games, music, AI coding, life), introductions, memes, the #hall-of-fame.',
    '🌍 **languages**: #русский, #español, #português, #français, #deutsch, #italiano, #nederlands, #polski, #türkçe, #中文, #日本語',
    '🔊 **voice**: join **➕ create your room** for your own voice channel',
    '',
    '**How it works**',
    `• Get Horizon at ${LINKS.horizonSite}: download the launcher; you need your own copy of Minecraft: Java Edition.`,
    `• Everything that is happening, in one place: the roadmap, the kanban and the journal at ${LINKS.hub}. Here, \`/roadmap\` sums it up.`,
    '• Need help? Horizon won\'t start, runs slowly, sign-in, multiplayer: post in #horizon-support (not in the chats). Kira gives a first answer and 🤝 Support helps.',
    '• Found a bug you can make happen again? `/report`, or post in #horizon-bugs (read its 📌 **How to post here** post first): it becomes a GitHub issue, and you hear back in your post. An idea? Post it in #horizon-ideas: it goes to the suggestion queue.',
    '• Want to help run the server? `/apply` for 🤝 Support (helping players) or 🛡️ Mod: Kira DMs you the form. Merged pull requests in Horizon count, so verify your GitHub first (`/link-github`, `/verify-github`).',
    '• Want to contribute? Pick a good first task on the hub, `/claim` it before you start, and open your pull request with "Fixes #<number>". Coding with an AI agent? `/agent connect` gives it the board (how-to in #horizon-info).',
    '• Questions? Everything is in #faq. Need a mod? Send Kira a DM.',
    '',
    'Horizon is an unofficial fan project, not affiliated with Mojang or Microsoft. Read #rules, then pick your roles with the buttons below.',
  ].join('\n'),
  links: [
    ['playhorizon.dev', LINKS.horizonSite], ['The hub', LINKS.hub], ['Download the launcher', LINKS.horizonLauncher], ['GitHub', LINKS.horizon],
  ],
};

export const RULES = [
  ['Be respectful', 'No harassment, hate speech, slurs, threats or personal attacks. Critique the work, never the person.'],
  ['No spam, no ads', 'No floods, no copy-pasted messages, no mass mentions, no unsolicited DMs. No ads for other servers, projects or products. Your own Horizon videos, screenshots and builds are welcome in #showcase; anything that isn\'t about Horizon goes in #general.'],
  ['No piracy, no leaks', "Don't share or ask for game files, cracked launchers, accounts, leaked code or keys. Horizon needs your own legal copy of Minecraft: Java Edition, and it ships none of Mojang's files."],
  ['No scams or malware', 'No phishing, fake "free Nitro", or executables. Accounts younger than 3 days can\'t post links. Download Horizon only from playhorizon.dev or its GitHub releases.'],
  ['Keep it SFW', 'No NSFW, gore or shock content, anywhere: names, avatars and statuses included.'],
  ['Right channel, right format', 'Every channel says what it\'s for in its description. Help requests go in #horizon-support, not in the chats. Bugs, help and ideas have a template in their 📌 How to post here post, pinned at the top: posts without it are closed after an hour.'],
  ['Contributing', 'Working on an issue? `/claim` it first, so two people don\'t do the same work. Pull requests go to github.com/horizon-rust/horizon.'],
  ['English in the main channels', 'So everyone can follow. These languages have their own channels in 🌍 languages: #русский, #español, #português, #français, #deutsch, #italiano, #nederlands, #polski, #türkçe, #中文, #日本語.'],
  ['No drama with the mods in public', 'Disagree with a decision? DM Kira: it reaches the mods privately.'],
  ["Discord's rules apply", 'Follow the Discord Terms of Service and Community Guidelines (13+).'],
];
export const RULES_FOOTER = 'Kira enforces these day and night: spam gets a warning, then a timeout (10 min, then 1 h, then a day), then the mods warn, time out or ban. 3 warnings in 30 days = a 1-hour timeout.';

export const FAQ = [
  ['What is Horizon?', 'Minecraft: Java Edition rewritten from scratch in Rust, with AI agents, and checked against the real game with differential tests so it behaves exactly like vanilla. It uses the textures and sounds of your own copy of the game. More in #horizon-info.'],
  ['Where do I download it?', `Get the launcher from ${LINKS.horizonSite} (or the [launcher releases](${LINKS.horizonLauncher})). It installs Horizon and keeps it up to date. You need your own copy of Minecraft: Java Edition.`],
  ['Is it official?', 'No. Horizon is an unofficial fan project, not affiliated with, endorsed by or connected to Mojang Studios or Microsoft. It contains none of their code or files.'],
  ['Where do I post…?', '• a problem (it won\'t start, it\'s slow, sign-in, multiplayer) → #horizon-support\n• a bug you can make happen again → `/report` or #horizon-bugs · an idea → #horizon-ideas (search first)\n• a video, clip, screenshot or build made in Horizon → #showcase\n• talking about Horizon → #horizon-chat\n• anything that isn\'t Horizon (other games, music, AI coding, life) → #general\n• your language → its channel in 🌍 languages\n• new versions → #releases · what changed → #updates'],
  ['What is being worked on?', `The hub, ${LINKS.hub}: what is being done now, what comes next, the kanban and the journal, in simple or technical words. \`/roadmap\` (or \`@Kira roadmap\`) sums it up here.`],
  ['What happens to my bug report?', 'Kira sends it to GitHub as an issue and pings you in your post when a maintainer answers, and when it is fixed (with the release it ships in). `/status` lists your reports.'],
  ['What happens to my idea?', 'It goes to the suggestion queue the maintainers read. Good ones become items on the roadmap; nothing is published by itself. Ideas are not GitHub issues.'],
  ['How do I contribute?', `Pick a good first task on the hub (or \`/goodfirst\`), then \`/claim <number>\` **before you start**, so nobody does the same work twice. Open your pull request with "Fixes #<number>". \`/link-github <username>\` shows your Discord name on your pull requests (\`credit:True\` also lists you on the hub's contributors page). Done or stuck? \`/unclaim <number>\`. Claims lapse after 14 days without activity.`],
  ['Microsoft sign-in? CurseForge?', 'Microsoft sign-in is in the launcher since launcher 0.2.16: the account button at the top right → Sign in with Microsoft, then enter the code it shows at microsoft.com/link (online-mode servers need it). CurseForge is coming soon.'],
  ['Why was my post closed?', 'Forum posts must follow the template in the forum\'s 📌 How to post here post (pinned at the top; the post guidelines have it too). Kira tells you in your post what\'s missing. Edit your first message (⋯ → Edit) within an hour and the post stays; otherwise it\'s closed, and you can post again with the template.'],
  ['How do I get roles?', 'With the buttons in #welcome (click again to remove), or in **Channels & Roles** at the top of the channel list. Level roles come by themselves. 🛠️ **Contributor** (writes in #contributors) is for a merged PR: `/link-github`, then `/verify-github`.'],
  ['What are levels?', 'You earn XP by talking (once a minute) and by hanging out in voice with other people. lvl 5, 10, 20, 30 and 50 give a role. `/rank` shows yours, `/leaderboard` the top 10. #memes and #bot-commands give no XP.'],
  ['How do I get my own voice channel?', 'Join **➕ create your room**: Kira makes you one and moves you in. `/room lock`, `/room invite @someone`, `/room private`, `/room limit 4`, `/room rename`. It disappears when it\'s empty.'],
  ['How do I reach the mods?', 'Send a DM to **Kira**: only the mods read it, and they answer through Kira. To report a message: right-click it → Apps → **Report to mods**, or `/report`.'],
  ['Why can\'t I post links?', 'Accounts younger than 3 days can\'t post links: that\'s how most scams arrive. It goes away by itself.'],
];

// The questions asked most in #horizon-chat and #general (2026-10-27): a second FAQ embed, under the first's 4096 characters.
export const FAQ_MORE = [
  ['Do Java mods work? Fabric, Forge, OptiFine?', 'No: Horizon is not the Java game, so Java mods don\'t run in it. Horizon has its own mods: open **Mods** in the launcher, or browse https://playhorizon.dev/mods. Modders can port a Java mod to Horizon (with its author\'s licence or permission).'],
  ['Shaders?', 'Java shader packs (Iris, OptiFine) don\'t run in Horizon. Horizon\'s own shader support is being built: follow #updates.'],
  ['Can I play on servers (2b2t, Hypixel…)?', 'Horizon is Minecraft Java Edition 26.3: it joins servers that accept 26.3 clients. Online-mode servers need Microsoft sign-in (see above). A server\'s own rules and anti-cheat still apply: check them before you join with a different client.'],
  ['Which computers? Linux, Mac, Windows?', 'Windows (x64), macOS (Apple Silicon) and Linux (x86_64), from https://playhorizon.dev. Phones, consoles, Bedrock and app stores: no, Horizon is Java Edition for computers.'],
  ['Flatpak, Snap, AUR, a .deb?', 'No Flatpak, Snap or distro package for now. On Linux, download the launcher from https://playhorizon.dev: an AppImage or a .tar.gz (x86_64). It installs and updates the game itself.'],
  ['It crashes or closes when I click Play', 'Post it in #horizon-support with the template (your system, the launcher version, what happened, the log if you have it). If it turns out to be a bug in Horizon, it goes to #horizon-bugs and becomes a GitHub issue.'],
  ['Is it legal? Does Mojang approve it?', 'Horizon ships none of Mojang\'s code or files, and you need your own copy of Minecraft: Java Edition. Microsoft sign-in working doesn\'t mean Mojang or Microsoft endorse Horizon: it\'s an unofficial fan project.'],
  ['How do I become a mod or 🤝 Support?', '`/apply` and pick the role: Kira DMs you a link to a short form on playhorizon.dev (yours only, it works once). The mods and the Team read it, and you get the answer by DM. Merged pull requests in Horizon count: link and verify your GitHub first (`/link-github`, then `/verify-github`). One application per role at a time; after a no, you can apply again 14 days later.'],
  ['Where do I get help?', 'In #horizon-support: one post per problem. Kira gives a first answer, then 🤝 Support helps. Quick questions: mention @Kira anywhere. For something private, DM Kira: it reaches the mods.'],
];

export const HORIZON = {
  description: [
    '**Horizon** is Minecraft: Java Edition rewritten from scratch in Rust, with AI agents, and checked against the real game with differential tests so it behaves exactly like vanilla.',
    '',
    'Zero lines of Mojang\'s code: it uses the textures and sounds from **your own copy** of Minecraft Java Edition.',
  ].join('\n'),
  get: `Website: ${LINKS.horizonSite}\nLauncher: [download](${LINKS.horizonLauncher})\nCode: ${LINKS.horizon}`,
  disclaimer: 'Horizon is an unofficial fan project. It is not affiliated with, endorsed by, or connected to Mojang Studios or Microsoft. Minecraft is a trademark of Mojang and Microsoft; the game, its name, textures and sounds belong to them. Horizon contains none of Minecraft\'s code or files, and none are distributed. To play Horizon you must own a legal copy of Minecraft Java Edition. Horizon is a free, personal, educational project, not for sale, and used at your own risk.',
};

// Horizon's official survival server: #official-server, and the game's and the launcher's Multiplayer lists.
export const OFFICIAL_SERVER = {
  name: 'Horizon Official',
  address: 'play.playhorizon.dev',
  description: 'The **Official Horizon SMP**, hosted by **Sculk**: survival with an economy (/balance, /sell, /baltop), land claims and homes, and an anticheat. It runs horizon-server, Horizon\'s own server, updated from Horizon\'s builds. Ops: luzW, rdbtclient, azetech_ and levzzz.',
  join: 'You need Horizon to join (other clients are turned away). In Horizon: Multiplayer → Add Server, then the address.',
  problems: 'Try the same thing in single player first: if it happens there too, post it in #horizon-bugs; if it only happens on the server, say so in your #horizon-bugs post.',
};

// Contributors' AI agents (src/agents.js, src/mcp.js, src/features/agents.js): the MCP endpoint and its tokens.
export const AGENTS = {
  url: MCP_URL,
  // /agent connect hands out tokens only when KIRA_AGENT_ISSUANCE=on (off until the security review is done).
  issuance: process.env.KIRA_AGENT_ISSUANCE === 'on',
  defaultDays: 90, maxDays: 365, maxPerUser: 5, maxPerDay: 3, // tokens: live at once, issued per 24 h (revoked ones count)
  maxOpenCards: 10, // Kira cards a member may have open
  ludovicLogin: 'ludovic111',
};

// Kira answering on her own with the Claude API (src/ai.js, src/features/ai.js). KIRA_AI: unset or 0, off;
// `mentions` (or 1), a message that mentions Kira or replies to her; `all`, also a question in AI.helpChannels.
// It also needs ANTHROPIC_API_KEY. `/kira-ai off` (Ludovic and the mods) stops it without a deploy.
export const AI = {
  mode: (() => {
    const v = (process.env.KIRA_AI ?? '').trim().toLowerCase();
    return v === 'all' ? 'all' : ['1', 'on', 'mentions'].includes(v) ? 'mentions' : null;
  })(),
  dailyUsd: Number(process.env.KIRA_AI_DAILY_USD) > 0 ? Number(process.env.KIRA_AI_DAILY_USD) : 3, // then she passes questions to the team until midnight UTC
  perMemberHour: 5, // questions answered per member an hour
  helpChannels: [], // LAYOUT keys where a question needs no mention (mode `all`); none yet: added once the #mod-log lines are read
  contextMessages: 4, // the reply chain the model sees (the messages being replied to), at most
  handoffsKept: 200, // questions passed to the team that the orchestrator can read (MCP ai_handoffs)
  daysKept: 62, // daily usage kept for GET /ai-usage
  // KIRA_AI_BUGS=1: a bug report is read by the model before it's filed (src/features/github.js): a title, the
  // version and OS from the report, a duplicate check against open issues, one ask for what's missing.
  bugs: ['1', 'on'].includes((process.env.KIRA_AI_BUGS ?? '').trim().toLowerCase()),
  pendingMs: 30 * 60_000, // a "maybe the same as #N" waits this long for the reporter's yes or no, then is filed as new
  // Moderation in every language (src/features/moderation.js): messages in the 🌍 languages channels, in `modChannels`,
  // and non-English messages anywhere are read by Haiku, in batches per channel. On whenever KIRA_AI is (Ludovic,
  // 2026-10-28: "use Kira for it" rather than AutoMod regexes per language); KIRA_AI_MOD=0 turns it off for good,
  // `/kira-ai mod off` for now. Same daily budget as the answers.
  mod: !['0', 'off', 'false', 'no'].includes((process.env.KIRA_AI_MOD ?? '').trim().toLowerCase()),
  modChannels: ['horizonchat', 'general'], // every message there, any language (the busy English chats:
  // #horizon-team, 2026-10-29: "horizon-chat is absolutely off the walls … political and racist")
  modBatchMs: 4_000, // messages of one channel arriving within this are read in one call
  modBatchMax: 10,
  modPauseMs: 5 * 60_000, // after an API error, the check pauses this long (the filters still run)
};
