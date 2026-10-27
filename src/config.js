// Everything Kira knows about the server: its layout, its texts and its feeds.
// `npm run setup` makes the server match this file; the bot reads the same file at runtime.
// Since 2026-10-14 the server is Horizon's alone: the channels about Ludovic's other projects, videos and
// music were deleted (their messages were exported first), and the roles of the old scope are gone (RETIRED_ROLES).

export const GUILD_ID = '1559227979002028052'; // "Horizon" (was "ludovic's server"), created 2026-10-12
export const OWNER_ID = '622720516779802630'; // Ludovic
export const SERVER = {
  name: 'Horizon',
  description: 'Minecraft Java Edition rewritten in Rust. Bugs, ideas, releases. playhorizon.dev · Not affiliated with Mojang/Microsoft.', // 120 max
  // Kira's About me (the application's description, 400 max).
  about: "Kira, Horizon's front desk 🌅 /report a bug (it becomes a GitHub issue), /suggest an idea, ask /roadmap what's being built, /claim a task. I post every release and what changed in #updates, and help the mods keep things friendly. /help for the rest, or DM me to reach the mods. playhorizon.dev/hub",
  // Horizon's mark (horizon repo, docs/media/brand/social): the server icon and Kira's own avatar, on violet so
  // Kira reads apart from the project. src/brand.js applies them when they change.
  icon: 'assets/horizon-icon.png', // Horizon's avatar.svg at 512 px (README: Discord brand assets)
  avatar: 'assets/kira-avatar.png', // from assets/kira-avatar.svg
};

export const LINKS = {
  github: 'https://github.com/ludovic111',
  horizon: 'https://github.com/ludovic111/horizon',
  horizonSite: 'https://playhorizon.dev',
  hub: 'https://playhorizon.dev/hub', // the roadmap, the kanban, the journal and how to help
  horizonLauncher: 'https://github.com/ludovic111/horizon/releases?q=launcher&expanded=true',
  horizonIssues: 'https://github.com/ludovic111/horizon/issues',
  horizonPulls: 'https://github.com/ludovic111/horizon/pulls',
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
// `was`: the key it had before, so setup renames the role instead of making a new one.
export const ROLES = [
  { key: 'releases', name: '📦 Releases', color: 0x5aa9ff, self: true, label: 'Every release' },
  { key: 'horizon', name: '📣 Big news', color: COLOR, self: true, label: 'Big news' },
  // Not key 'videos': that is the old role of the all-projects server (🔔 Videos), in RETIRED_ROLES, which setup
  // deletes by key when nobody holds it. Pinged by every post of src/videos.js.
  { key: 'newvideos', name: '🎬 Videos', color: 0xff4d4d, self: true, label: 'New videos' },
  // Not a role to pick: a merged PR in Horizon, verified with /verify-github (src/features/contributors.js). It opens #contributors.
  { key: 'contributor', was: 'ai', name: '🛠️ Contributor', color: 0x9b7bff, self: false, label: 'Contributor' },
  { key: 'modder', name: '🧩 Modder', color: 0x4cc38a, self: true, label: 'Modder' },
  { key: 'lvl5', name: 'lvl 5', color: 0x95a5a6, level: 5 },
  { key: 'lvl10', name: 'lvl 10', color: 0x7ed6df, level: 10 },
  { key: 'lvl20', name: 'lvl 20', color: 0x22a6b3, level: 20 },
  { key: 'lvl30', name: 'lvl 30', color: 0xf0932b, level: 30 },
  { key: 'lvl50', name: 'lvl 50', color: 0xeb4d4b, level: 50, hoist: true },
  { key: 'booster', managed: 'premium_subscriber', name: '💎 Booster', color: 0xf47fff, hoist: true },
  { key: 'tester', name: '🧪 Horizon Tester', color: 0xffd166, hoist: true },
  {
    key: 'mod', name: '🛡️ Mod', color: 0x2ecc71, hoist: true,
    permissions: ['KickMembers', 'BanMembers', 'ModerateMembers', 'ManageMessages', 'ManageThreads', 'ManageNicknames', 'ViewAuditLog', 'MuteMembers', 'DeafenMembers', 'MoveMembers'],
  },
  { key: 'owner', name: '👑 ludovic', color: 0xf2a33a, hoist: true, owner: true },
];

// Roles of the old, all-projects server. Setup deletes each one nobody holds; one a member holds stays
// (renamed by nobody) until it can go without taking something away from someone.
export const RETIRED_ROLES = ['videos', 'beatmaker', 'rapper', 'singer', 'youtuber', 'editor', 'designer'];

// Channel types: text, voice, forum, announcement.
// readonly: everyone reads, only staff and Kira post. writers: everyone reads, only staff, Kira and these roles post. staff: only mods see it. posts: 'staff' → only staff open forum posts.
// locked: a voice channel nobody joins by themselves (Ludovic or a mod moves people in). lobby: join it to get your own room.
// Forums: `guide` is the post guidelines Discord shows above the forum (with the template) and the text of the
// locked, pinned HOWTO post (one per forum that has a template);
// `template` is what a post must look like; `check` is what Kira verifies on each new post (missing → it asks,
// still missing after an hour → the post is closed); `tags` are [emoji, name, staffOnly]; `done` is the tag
// /done puts on a post (solved, taken, found…); `react` the reactions Kira adds; `every` the minimum time
// between two posts by the same member (seconds); `gallery` for media forums.
// `was` on a category: the name it had, so setup moves it instead of making a new one.

const LINK_OR_FILE = 'a file or a link';

export const LAYOUT = [
  {
    key: 'start', category: '👋 start here',
    channels: [
      { key: 'welcome', name: 'welcome', type: 'text', readonly: true, topic: 'Start here: what Horizon is, where everything is, and your roles (buttons below).' },
      { key: 'newmembers', name: 'new-members', type: 'text', readonly: true, topic: 'Everyone who joins, welcomed here.' },
      { key: 'rules', name: 'rules', type: 'text', readonly: true, topic: 'The rules. Kira enforces them, day and night.' },
      { key: 'faq', name: 'faq', type: 'text', readonly: true, topic: 'Every question you might have, answered: downloading Horizon, posting a bug, contributing, roles, the mods.' },
      { key: 'announcements', name: 'announcements', type: 'announcement', readonly: true, topic: 'Big Horizon news. Pick the 📣 Big news role to get pinged.' },
      { key: 'ludovicvideos', name: 'ludovic-videos', type: 'text', readonly: true, topic: 'Ludovic\'s new YouTube videos, posted by Kira as they come out.' },
    ],
  },
  {
    key: 'horizon', was: 'mine', category: '🌅 horizon',
    channels: [
      { key: 'horizoninfo', name: 'horizon-info', type: 'text', readonly: true, topic: 'Horizon: Minecraft Java Edition rewritten in Rust. What it is, the download, the disclaimer.' },
      { key: 'horizonchat', name: 'horizon-chat', type: 'text', topic: 'Talk about Horizon. Bugs go in #horizon-bugs and ideas in #horizon-ideas, so they don\'t get lost here.' },
      // writers: everyone reads; only the mods and these roles write, open threads and write in them (src/permissions.js).
      { key: 'contributors', name: 'contributors', type: 'text', writers: ['contributor'], topic: "Where Horizon's contributors talk. Everyone can read. To write: have a merged PR, then `/link-github` + `/verify-github`." },
      {
        key: 'horizonbugs', name: 'horizon-bugs', type: 'forum',
        topic: 'One bug per post, with the template. Search first: if it\'s already reported, add your details in that post.',
        tags: [['💥', 'crash'], ['🖼️', 'rendering'], ['🎮', 'gameplay'], ['🌍', 'world gen'], ['⚡', 'performance'], ['🔊', 'sound'], ['🖥️', 'install / launch'], ['🔍', 'confirmed', true], ['🔁', 'duplicate', true], ['✅', 'fixed', true], ['📝', 'via /report', true]],
        guide: 'One bug per post. **Search first**: if someone already reported it, reply in their post instead. Title: what\'s broken, in a few words ("Water renders black on AMD"). Pick a tag. Kira checks that the template is filled in; posts without it are closed after an hour. Each post becomes a GitHub issue, and you are pinged here when it is answered or fixed. `/report` (anywhere) opens a form that makes the post for you.',
        template: '**What I did:** the steps, one per line\n**What happened:**\n**What I expected:**\n**Horizon version:** release or commit\n**OS, CPU, GPU:**\n+ a screenshot, a video or the log file if you have one',
        check: { min: 80, needs: [['What I did', /what i did|steps/i], ['What happened', /what happened|happen/i], ['What I expected', /expect/i], ['OS, CPU, GPU', /\b(os|windows|linux|mac|macos|gpu|nvidia|amd|intel|radeon|geforce)\b/i]] },
      },
      {
        key: 'horizonideas', name: 'horizon-ideas', type: 'forum', react: ['👍', '👎'],
        topic: 'One idea per post, with the template. Vote with 👍 and 👎. Kira sends each idea to the suggestion queue; picked ones become roadmap items (playhorizon.dev/hub).',
        tags: [['⚡', 'performance'], ['🧩', 'modding'], ['🌐', 'multiplayer'], ['🤖', 'mcp / agents'], ['🎬', 'video studio'], ['🎮', 'gameplay'], ['🚀', 'launcher'], ['💡', 'other'], ['📌', 'planned', true], ['✅', 'done', true], ['❌', "won't do", true]],
        guide: 'One idea per post. **Search first** and vote 👍 on the existing post rather than making a new one. Title: the idea in a few words. Horizon aims at 100% vanilla behaviour first: ideas that change gameplay come after that. Kira closes posts without the template after an hour. Each post goes to the suggestion queue the maintainers read (`/suggest` does the same from any channel); the ones they pick become items on the roadmap at playhorizon.dev/hub. Ideas are not GitHub issues.',
        template: '**The idea:**\n**Why:** what it makes better\n**How it could work:** (optional)',
        check: { min: 40, needs: [['The idea', /the idea|idea/i], ['Why', /why/i]] },
      },
      {
        key: 'showcase', was: 'videofeedback', name: 'showcase', type: 'forum', gallery: true, reaction: '🔥', react: ['🔥'],
        topic: 'Your Horizon creations: YouTube videos, clips, screenshots, builds, worlds, redstone, benchmarks. One post each, with the template.',
        tags: [['🎬', 'video'], ['📸', 'screenshot'], ['🏰', 'build'], ['🎞️', 'clip'], ['🔴', 'redstone'], ['🌍', 'world'], ['⚡', 'benchmark'], ['🧩', 'mod'], ['⭐', 'featured', true]],
        guide: 'Show what you made **in Horizon**: a video, a clip, screenshots, a build, a benchmark. One post per creation (updates go in your own post), one new post every hour at most. Your own YouTube videos about Horizon are welcome here: this is the place for them. A screenshot, a video or a link is required. Content that isn\'t about Horizon goes in #off-topic.',
        template: '**What it is:**\n**Horizon version:** release or commit (optional)\n+ a screenshot, a video or a link',
        check: { media: true, needs: [['What it is', /what it is|\bwhat\b|\bthis\b/i]] },
      },
      { key: 'releases', name: 'releases', type: 'text', readonly: true, topic: 'Every new Horizon version and launcher, posted by Kira. Pick the 📦 Releases role to get pinged.' },
      { key: 'updates', name: 'updates', type: 'text', readonly: true, topic: 'What changed in Horizon: merged work grouped by roadmap item, releases, the weekly summary, and the board at a glance. The full kanban and roadmap: playhorizon.dev/hub. Talk about it in #horizon-chat.' },
    ],
  },
  {
    key: 'general', category: '💬 general',
    channels: [
      { key: 'general', name: 'general', type: 'text', topic: 'Talk about anything. English please, so everyone can follow. Horizon talk is welcome here too.' },
      { key: 'introductions', name: 'introductions', type: 'text', pin: 'intro', topic: 'Say hi once, with the template in the pinned message. One introduction per person.' },
      { key: 'offtopic', name: 'off-topic', type: 'text', topic: "Everything that isn't Horizon: other games, music, AI coding, Ludovic's other projects, life. Any language." },
      { key: 'memes', name: 'memes', type: 'text', topic: 'Memes and funny stuff (Minecraft ones welcome). SFW only. No XP here.' },
      { key: 'halloffame', name: 'hall-of-fame', type: 'text', readonly: true, topic: 'Messages that got 5 ⭐. React ⭐ to a message you love to send it here.' },
      { key: 'botcommands', name: 'bot-commands', type: 'text', topic: 'Use Kira here: /rank, /leaderboard, /working, /remind, /userinfo… Level-ups are announced here. No XP here.' },
    ],
  },
  {
    key: 'voice', category: '🔊 voice',
    channels: [
      { key: 'lounge', name: 'Lounge', type: 'voice' },
      { key: 'gaming', name: 'Gaming', type: 'voice' },
      { key: 'waiting', name: '⏳ waiting room', type: 'voice' },
      { key: 'ludovic', name: '🎙️ ludovic', type: 'voice', locked: true },
      { key: 'lobby', name: '➕ create your room', type: 'voice', lobby: true },
    ],
  },
  {
    key: 'staff', category: '🛡️ staff', staff: true,
    channels: [
      { key: 'modchat', name: 'mod-chat', type: 'text', staff: true },
      { key: 'modlog', name: 'mod-log', type: 'text', staff: true, topic: 'Kira logs here: joins (and the invite they used), leaves, deleted and edited messages, warnings, timeouts, bans, raids, AutoMod.' },
      { key: 'reports', name: 'reports', type: 'text', staff: true, topic: 'Reports from members: /report-member and "Report to mods" on a message.' },
      { key: 'modmail', name: 'mod-mail', type: 'text', staff: true, topic: "Members DM Kira; each conversation is a thread here. Write in the thread to answer (start with // for a note they don't see, //close to close)." },
      { key: 'discordupdates', name: 'discord-updates', type: 'text', staff: true, topic: 'Messages from Discord to community servers.' },
      { key: 'roadmapsuggestions', name: 'roadmap-suggestions', type: 'text', staff: true, topic: 'The suggestion queue: /suggest, @Kira suggest, #horizon-ideas posts and the hub\'s form. A good one becomes a roadmap item (a pull request to roadmap.toml), never an issue. Kira posts here once ROADMAP_SUGGESTIONS_CHANNEL_ID is this channel\'s ID.' },
      { key: 'agentlog', name: 'agent-log', type: 'text', staff: true, topic: "Every call contributors' AI agents make through Kira's MCP server: who (the token's owner), which tool, the outcome. Tokens: /agent tokens member:." },
    ],
  },
];

// The locked, pinned post at the top of each forum that has a template. Setup finds it again by this name.
// `tag` is the staff-only tag it carries (forums require a tag); `mention` is how texts name it.
export const HOWTO = { name: '📌 How to post here: read me first', tag: ['📌', 'read me', true], mention: 'the 📌 **How to post here** post' };

// What everyone sees in the channel list from the start; the Onboarding answers add the rest.
export const DEFAULT_CHANNELS = ['welcome', 'newmembers', 'rules', 'faq', 'announcements', 'ludovicvideos', 'horizoninfo', 'horizonchat', 'contributors', 'horizonbugs', 'horizonideas', 'showcase', 'releases', 'updates', 'general', 'introductions', 'offtopic', 'memes', 'halloffame', 'botcommands'];

// Replaced by another channel (2026-10-25: #updates replaces #work-board and #dev-log). Setup exports every message of
// each one to scratch/ (not committed), then deletes it; if the export fails, the channel stays.
export const REPLACED = [{ key: 'workboard', name: 'work-board', by: 'updates' }, { key: 'devlog', name: 'dev-log', by: 'updates' }];

// Deleted by setup when no member ever wrote in them (empty channels of the old scope).
export const RETIRED = ['tracks', 'chill', 'aicoding', 'rewrites', 'coding', 'creatorschat', 'editing', 'musicchat', 'studio'];

// Pinned messages in text channels.
export const PINS = {
  intro: '👋 **Introduce yourself** (once), like this:\n\n**Name:** what we call you\n**How I play:** survival, creative, redstone, servers, speedruns…\n**My setup:** OS and GPU (optional, it helps with bugs)\n**Here to:** play, test, report bugs, contribute code, mod…\n**GitHub:** (optional, if you contribute: then run `/link-github`)\n\nOne message, one introduction. To chat, go to #general or #horizon-chat.',
};

// Releases announced in #releases: Horizon's game (`v…` tags) and launcher (`launcher-v…` tags) only.
export const RELEASE_REPOS = ['horizon'];
export const RELEASE_EVERY_MS = 3 * 60 * 1000; // one GitHub API request each time

// Ludovic's YouTube videos → #ludovic-videos (src/videos.js): the channel's public Atom feed, polled every 10 minutes.
// His channel is @lu4ovic (LINKS.youtube).
export const VIDEOS = {
  channelId: 'UCNpwCgIK6O6oct9ra9ohZ7w',
  feedUrl: 'https://www.youtube.com/feeds/videos.xml',
  everyMs: 10 * 60 * 1000,
};

// One-off announcements Kira posts once (the key is remembered in state.oneOffs), for big releases.
// `role`: the only role pinged (none if absent). Posted when Kira starts; written by hand.
const V2026_10_13_1 = 'https://github.com/ludovic111/horizon/releases/tag/v2026.10.13.1';
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
        'The channels about my other projects, music and AI coding are gone: those topics are welcome in #off-topic.',
        '',
        `**Get Horizon:** ${LINKS.horizonSite} · [the launcher](${LINKS.horizonLauncher}) · [GitHub](${LINKS.horizon})`,
        '**Found a bug?** #horizon-bugs · **An idea?** #horizon-ideas · **Made something in it?** #showcase',
        '**Want to help build it?** #work-board shows who is on what: `/claim` an issue before you start.',
      ].join('\n'),
      footer: { text: 'Horizon is an unofficial fan project, not affiliated with Mojang or Microsoft.' },
    },
  },
  // Posted once /agent connect is open (KIRA_AGENT_ISSUANCE=on); `editable`: edited in place at each start,
  // so a new endpoint (KIRA_MCP_URL) or text reaches the existing messages. `pin`: pinned where it's posted.
  { key: 'agents-live', channel: 'announcements', when: 'agents', editable: true, content: 'Contributors: your AI coding agent can now work with Horizon\'s board.', embed: AGENT_GUIDE },
  { key: 'agents-info', channel: 'horizoninfo', when: 'agents', editable: true, pin: true, content: '', embed: AGENT_GUIDE },
];

// The hub (playhorizon.dev/hub): the one public place for the roadmap, the kanban, the journal and how to help.
// Kira is its front desk on Discord, with the same verbs (src/hub.js, src/features/hub.js). The website publishes
// the roadmap and the journal as JSON (the horizon repo's roadmap/README.md). Suggestions, from Discord and from
// the site, go to one private queue: #roadmap-suggestions, whose ID is ROADMAP_SUGGESTIONS_CHANNEL_ID (unset: off).
export const HUB = {
  url: process.env.HUB_URL || LINKS.hub,
  roadmapJson: process.env.HUB_ROADMAP_URL || 'https://playhorizon.dev/data/roadmap.json',
  journalJson: process.env.HUB_JOURNAL_URL || 'https://playhorizon.dev/data/journal.json',
  suggestionsChannel: process.env.ROADMAP_SUGGESTIONS_CHANNEL_ID?.trim() || null,
  // The suggestions sent from the hub's form, kept by the telemetry server: Kira relays them into the queue.
  intakeUrl: (process.env.HUB_INTAKE_URL || 'https://telemetry.playhorizon.dev').replace(/\/+$/, ''),
  token: process.env.HUB_TOKEN?.trim() || null, // its bearer token (HORIZON_TELEMETRY_HUB_TOKEN there); sealed on Railway
  relayEveryMs: 5 * 60_000,
  cacheMs: 5 * 60_000, // the roadmap is fetched again at most every 5 minutes
  journalEveryMs: 10 * 60_000, // the journal, for #updates
  suggestPerHour: 3, // suggestions per member an hour (/suggest, @Kira suggest)
  reportPerHour: 3, // bugs per member an hour (/report); the GitHub limits of GITHUB.rate apply too
};

// Forum posts → GitHub issues (src/features/github.js). Off until GITHUB_TOKEN is set (see the README).
// Per forum: the repo and kind. `fixed` / `notPlanned` / `duplicate`: the forum tags Kira applies when
// the issue is closed that way.
export const GITHUB = {
  owner: 'ludovic111',
  forums: {
    horizonbugs: { repo: 'horizon', kind: 'bug', fixed: 'fixed', duplicate: 'duplicate' },
    // queue: ideas go to the suggestion queue (HUB), not to GitHub; ideas sent before that keep their issue and answers.
    horizonideas: { repo: 'horizon', kind: 'idea', fixed: 'done', notPlanned: "won't do", queue: true },
  },
  private: [], // repos whose issues get no link in Discord (players can't open them)
  labels: { bug: 'bug', idea: 'enhancement', from: 'from-discord' },
  pollEveryMs: 5 * 60 * 1000,
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
  floodMessages: 6, floodWindowMs: 8_000,        // 6 messages in 8 s
  repeatCount: 3, repeatWindowMs: 60_000,        // the same message 3 times in a minute (any channels)
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
  // No slowmode anywhere (Ludovic, 2026-10-14): channels have none and none is added when busy.
  // [[messages per minute, seconds of slowmode], …] turns the automatic one back on.
  autoSlowmode: [],
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
    '🌅 **horizon**: #horizon-info (what it is, the download), #horizon-chat, #contributors (read by all, written by people with a merged PR), #horizon-bugs, #horizon-ideas, #showcase (your videos, screenshots, builds), #releases, #updates (what changed)',
    '💬 **general**: chat, introductions, memes, the #hall-of-fame. Anything that isn\'t Horizon (other games, music, AI coding, Ludovic\'s other projects) goes in #off-topic.',
    '🔊 **voice**: join **➕ create your room** for your own voice channel',
    '',
    '**How it works**',
    `• Get Horizon at ${LINKS.horizonSite}: download the launcher; you need your own copy of Minecraft: Java Edition.`,
    `• Everything that is happening, in one place: the roadmap, the kanban and the journal at ${LINKS.hub}. Here, \`/roadmap\` sums it up.`,
    '• Found a bug? `/report`, or post in #horizon-bugs (read its 📌 **How to post here** post first): it becomes a GitHub issue, and you hear back in your post. An idea? `/suggest`, or post in #horizon-ideas: it goes to the suggestion queue.',
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
  ['No spam, no ads', 'No floods, no copy-pasted messages, no mass mentions, no unsolicited DMs. No ads for other servers, projects or products. Your own Horizon videos, screenshots and builds are welcome in #showcase; anything that isn\'t about Horizon goes in #off-topic.'],
  ['No piracy, no leaks', "Don't share or ask for game files, cracked launchers, accounts, leaked code or keys. Horizon needs your own legal copy of Minecraft: Java Edition, and it ships none of Mojang's files."],
  ['No scams or malware', 'No phishing, fake "free Nitro", or executables. Accounts younger than 3 days can\'t post links. Download Horizon only from playhorizon.dev or its GitHub releases.'],
  ['Keep it SFW', 'No NSFW, gore or shock content, anywhere: names, avatars and statuses included.'],
  ['Right channel, right format', 'Every channel says what it\'s for in its description. Bugs and ideas have a template in their 📌 How to post here post, pinned at the top: posts without it are closed after an hour.'],
  ['Contributing', 'Working on an issue? `/claim` it first, so two people don\'t do the same work. Pull requests go to github.com/ludovic111/horizon.'],
  ['English in the main channels', 'So everyone can follow. Any language is fine in #off-topic.'],
  ['No drama with the mods in public', 'Disagree with a decision? DM Kira: it reaches the mods privately.'],
  ["Discord's rules apply", 'Follow the Discord Terms of Service and Community Guidelines (13+).'],
];
export const RULES_FOOTER = 'Kira enforces these day and night: spam gets a timeout (10 min, then 1 h, then a day), then the mods warn, time out or ban. 3 warnings in 30 days = a 1-hour timeout.';

export const FAQ = [
  ['What is Horizon?', 'Minecraft: Java Edition rewritten from scratch in Rust, with AI agents, and checked against the real game with differential tests so it behaves exactly like vanilla. It uses the textures and sounds of your own copy of the game. More in #horizon-info.'],
  ['Where do I download it?', `Get the launcher from ${LINKS.horizonSite} (or the [launcher releases](${LINKS.horizonLauncher})). It installs Horizon and keeps it up to date. You need your own copy of Minecraft: Java Edition.`],
  ['Is it official?', 'No. Horizon is an unofficial fan project, not affiliated with, endorsed by or connected to Mojang Studios or Microsoft. It contains none of their code or files.'],
  ['Where do I post…?', '• a bug → `/report` or #horizon-bugs · an idea → `/suggest` or #horizon-ideas (search first)\n• a video, clip, screenshot or build made in Horizon → #showcase\n• a question or just talking → #horizon-chat\n• anything that isn\'t Horizon (other games, music, AI coding, Ludovic\'s other projects) → #off-topic\n• new versions → #releases · what changed → #updates'],
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

export const HORIZON = {
  description: [
    '**Horizon** is Minecraft: Java Edition rewritten from scratch in Rust, with AI agents, and checked against the real game with differential tests so it behaves exactly like vanilla.',
    '',
    'Zero lines of Mojang\'s code: it uses the textures and sounds from **your own copy** of Minecraft Java Edition.',
  ].join('\n'),
  get: `Website: ${LINKS.horizonSite}\nLauncher: [download](${LINKS.horizonLauncher})\nCode: ${LINKS.horizon}`,
  disclaimer: 'Horizon is an unofficial fan project. It is not affiliated with, endorsed by, or connected to Mojang Studios or Microsoft. Minecraft is a trademark of Mojang and Microsoft; the game, its name, textures and sounds belong to them. Horizon contains none of Minecraft\'s code or files, and none are distributed. To play Horizon you must own a legal copy of Minecraft Java Edition. Horizon is a free, personal, educational project, not for sale, and used at your own risk.',
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
