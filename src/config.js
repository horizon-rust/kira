// Everything Kira knows about the server: its layout, its texts and its feeds.
// `npm run setup` makes the server match this file; the bot reads the same file at runtime.

export const GUILD_ID = '1559227979002028052'; // "ludovic's server", created 2026-10-12
export const OWNER_ID = '622720516779802630'; // Ludovic

export const LINKS = {
  youtube: 'https://youtube.com/@lu4ovic',
  portfolio: 'https://lu4ovic.com',
  github: 'https://github.com/ludovic111',
  x: 'https://x.com/lu4ovic',
  instagram: 'https://instagram.com/lu4ovic',
  sponsor: 'https://github.com/sponsors/ludovic111',
  lsuite: 'https://lsuite.xyz',
  horizon: 'https://github.com/ludovic111/horizon',
};

export const COLOR = 0xf2a33a; // sunrise orange, for Horizon

// Roles, from lowest to highest. `self`: members can pick it (Onboarding and the buttons in #welcome).
// `was`: the key it had before, so setup renames the role instead of making a new one.
export const ROLES = [
  { key: 'videos', name: '🔔 Videos', color: 0xff4d4d, self: true, label: 'New videos' },
  { key: 'releases', name: '📦 Releases', color: 0x5aa9ff, self: true, label: 'New releases' },
  { key: 'ai', name: '🤖 Vibe coder', color: 0x9b7bff, self: true, label: 'Vibe coder' },
  { key: 'horizon', name: '🌅 Horizon', color: COLOR, self: true, label: 'Horizon' },
  { key: 'modder', name: '🧩 Modder', color: 0x4cc38a, self: true, label: 'Modder' },
  { key: 'beatmaker', was: 'creator', name: '🥁 Beatmaker', color: 0xff8ad8, self: true, label: 'Beatmaker' },
  { key: 'rapper', name: '🎤 Rapper', color: 0xe056fd, self: true, label: 'Rapper' },
  { key: 'singer', name: '🎶 Singer', color: 0xf8a5c2, self: true, label: 'Singer' },
  { key: 'youtuber', name: '🎬 YouTuber', color: 0xff0000, self: true, label: 'YouTuber' },
  { key: 'editor', name: '✂️ Editor', color: 0x48dbfb, self: true, label: 'Editor' },
  { key: 'designer', name: '🖼️ Thumbnail artist', color: 0xfeca57, self: true, label: 'Thumbnail artist' },
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

// Channel types: text, voice, forum, announcement.
// readonly: everyone reads, only staff and Kira post. staff: only mods see it. posts: 'staff' → only staff open forum posts.
// locked: a voice channel nobody joins by themselves (Ludovic or a mod moves people in). lobby: join it to get your own room.
// Forums: `guide` is the post guidelines Discord shows above the forum, and the pinned "how to post" post;
// `template` is what a post must look like; `check` is what Kira verifies on each new post (missing → it asks,
// still missing after an hour → the post is closed); `tags` are [emoji, name, staffOnly]; `done` is the tag
// /done puts on a post (solved, taken, found…); `react` the reactions Kira adds; `every` the minimum time
// between two posts by the same member (seconds); `gallery` for media forums.
// `was` on a category: the name it had, so setup moves it instead of making a new one.
// `retired`: channels setup deletes if no member ever wrote in them.

const LINK_OR_FILE = 'a file or a link';

export const LAYOUT = [
  {
    key: 'start', category: '👋 start here',
    channels: [
      { key: 'welcome', name: 'welcome', type: 'text', readonly: true, topic: 'Start here: what this server is, where everything is, and your roles (buttons below).' },
      { key: 'newmembers', name: 'new-members', type: 'text', readonly: true, topic: 'Everyone who joins, welcomed here.' },
      { key: 'rules', name: 'rules', type: 'text', readonly: true, topic: 'The rules. Kira enforces them, day and night.' },
      { key: 'faq', name: 'faq', type: 'text', readonly: true, topic: 'Every question you might have, answered: roles, levels, voice rooms, posting, Horizon, reaching the mods.' },
      { key: 'announcements', name: 'announcements', type: 'announcement', readonly: true, topic: 'New videos and big news. Pick the 🔔 Videos role to get pinged.' },
    ],
  },
  {
    key: 'general', category: '💬 general',
    channels: [
      { key: 'general', name: 'general', type: 'text', slowmode: 3, topic: 'Talk about anything. English please, so everyone can follow. Topics have their own channels below.' },
      { key: 'introductions', name: 'introductions', type: 'text', slowmode: 300, pin: 'intro', topic: 'Say hi once, with the template in the pinned message. One introduction per person.' },
      { key: 'offtopic', name: 'off-topic', type: 'text', slowmode: 3, topic: 'Everything that fits nowhere else. Any language.' },
      { key: 'memes', name: 'memes', type: 'text', slowmode: 10, topic: 'Memes and funny stuff. SFW only. No XP here.' },
      {
        key: 'resources', name: 'resources', type: 'forum', every: 3600, reaction: '👍',
        topic: 'Useful tools, guides, kits and assets for coding, music and video.',
        tags: [['🤖', 'ai and code'], ['🎤', 'music'], ['🎬', 'video'], ['🎨', 'design'], ['📚', 'guide'], ['🆓', 'free'], ['💰', 'paid']],
        guide: 'One resource per post: a tool, a guide, a kit, a preset, a plugin. **Legal stuff only**: no cracked software, no ripped or leaked assets (instant ban). Search before posting, it might be here already.',
        template: '**What it is:** one or two sentences\n**Link:** where to get it\n**Free or paid:** free / paid (price)\n**Why it\'s good:** what it helped you with',
        check: { media: true, needs: [['What it is', /what it is/i], ['Free or paid', /free or paid|price|\bfree\b|\bpaid\b/i]] },
      },
      { key: 'halloffame', name: 'hall-of-fame', type: 'text', readonly: true, topic: 'Messages that got 5 ⭐. React ⭐ to a message you love to send it here.' },
      { key: 'botcommands', name: 'bot-commands', type: 'text', topic: 'Use Kira here: /rank, /leaderboard, /remind, /userinfo… Level-ups are announced here. No XP here.' },
    ],
  },
  {
    key: 'mine', category: "🛠️ ludovic's projects",
    channels: [
      { key: 'horizoninfo', name: 'horizon-info', type: 'text', readonly: true, topic: 'Horizon: Minecraft Java Edition rewritten in Rust. What it is, the download, the roadmap, the disclaimer.' },
      { key: 'horizonchat', name: 'horizon-chat', type: 'text', slowmode: 3, topic: 'Talk about Horizon. Bugs go in #horizon-bugs and ideas in #horizon-ideas, so they don\'t get lost here.' },
      {
        key: 'horizonbugs', name: 'horizon-bugs', type: 'forum', every: 600,
        topic: 'One bug per post, with the template. Search first: if it\'s already reported, add your details in that post.',
        tags: [['💥', 'crash'], ['🖼️', 'rendering'], ['🎮', 'gameplay'], ['🌍', 'world gen'], ['⚡', 'performance'], ['🔊', 'sound'], ['🖥️', 'install / launch'], ['🔍', 'confirmed', true], ['🔁', 'duplicate', true], ['✅', 'fixed', true]],
        guide: 'One bug per post. **Search first**: if someone already reported it, reply in their post instead. Title: what\'s broken, in a few words ("Water renders black on AMD"). Pick a tag. Kira checks that the template is filled in; posts without it are closed after an hour.',
        template: '**What I did:** the steps, one per line\n**What happened:**\n**What I expected:**\n**Horizon version:** release or commit\n**OS, CPU, GPU:**\n+ a screenshot, a video or the log file if you have one',
        check: { min: 80, needs: [['What I did', /what i did|steps/i], ['What happened', /what happened|happen/i], ['What I expected', /expect/i], ['OS, CPU, GPU', /\b(os|windows|linux|mac|macos|gpu|nvidia|amd|intel|radeon|geforce)\b/i]] },
      },
      {
        key: 'horizonideas', name: 'horizon-ideas', type: 'forum', every: 1800, react: ['👍', '👎'],
        topic: 'One idea per post, with the template. Vote with 👍 and 👎: the most wanted ones go on the roadmap.',
        tags: [['⚡', 'performance'], ['🧩', 'modding'], ['🌐', 'multiplayer'], ['🤖', 'mcp / agents'], ['🎬', 'video studio'], ['🎮', 'gameplay'], ['💡', 'other'], ['📌', 'planned', true], ['✅', 'done', true], ['❌', "won't do", true]],
        guide: 'One idea per post. **Search first** and vote 👍 on the existing post rather than making a new one. Title: the idea in a few words. Horizon aims at 100% vanilla behaviour first: ideas that change gameplay come after that. Kira closes posts without the template after an hour.',
        template: '**The idea:**\n**Why:** what it makes better\n**How it could work:** (optional)',
        check: { min: 40, needs: [['The idea', /the idea|idea/i], ['Why', /why/i]] },
      },
      {
        key: 'projects', name: 'projects', type: 'forum', readonly: true, gallery: true,
        topic: 'Every project of mine, one post each, with its links. Questions and feedback: #project-feedback (or the Horizon channels).',
        tags: [['🎮', 'game'], ['🎨', 'lsuite'], ['📱', 'app'], ['🧪', 'research']],
        guide: 'The catalogue of my projects: one post each, kept up to date. You can\'t reply here: ask questions and give feedback in #project-feedback, and for Horizon in #horizon-chat, #horizon-bugs and #horizon-ideas.',
      },
      {
        key: 'feedback', name: 'project-feedback', type: 'forum', every: 600, react: ['👍', '👎'],
        topic: 'Questions, bugs and ideas for lsuite, DISPO and my other projects (not Horizon: it has its own channels). Tag the project and the kind of post.',
        tags: [['🎨', 'lsuite'], ['🎵', 'ryolune'], ['🎬', 'kimchi'], ['🖼️', 'nori'], ['📄', 'folio'], ['🎸', 'DISPO'], ['🧪', 'research'], ['🐛', 'bug'], ['💡', 'idea'], ['❓', 'question'], ['✅', 'done', true]],
        done: '✅ done',
        guide: 'For lsuite (ryolune, kimchi, nori, folio), DISPO and my research projects. **Horizon has its own channels.** Two tags: the project, and bug / idea / question. Search first. For a bug, give the steps, what you expected, the version and your OS. When your question is answered, type `/done`.',
        template: '**Project:** which app\n**Details:** your question, idea, or the bug: steps, what you expected, version, OS',
        check: { min: 40, needs: [['Project', /project|lsuite|ryolune|kimchi|nori|folio|dispo|pokemon|obsidian/i], ['Details', /details|steps|expect|why|how|\?/i]] },
      },
      { key: 'releases', name: 'releases', type: 'text', readonly: true, topic: 'Every new release of my open-source projects, posted by Kira. Pick the 📦 Releases role to get pinged.' },
    ],
  },
  {
    key: 'vibe', category: '🤖 vibe coding',
    channels: [
      { key: 'aicoding', name: 'vibe-coding', type: 'text', slowmode: 3, topic: 'Building with AI: harnesses, models, prompts, workflows (Claude Code, Codex and the rest). Problems → #help. Your projects → #community-projects.' },
      { key: 'rewrites', name: 'rewrites', type: 'text', slowmode: 3, topic: 'Decompiles, ports and rewrites with agents (Skate 3, Minecraft…): techniques and progress. Never share game files, leaked code or ROMs.' },
      {
        key: 'communityprojects', name: 'community-projects', type: 'forum', every: 21600, gallery: true, reaction: '🔥', react: ['🔥'],
        topic: 'Your projects: one post per project, with the template. Post updates in your own post, not a new one. Self-promo is fine here.',
        tags: [['🎮', 'game'], ['📱', 'app'], ['🛠️', 'tool'], ['🌐', 'website'], ['🤖', 'ai agent'], ['🔁', 'rewrite'], ['🎵', 'music'], ['🎬', 'video'], ['📖', 'open source'], ['🚧', 'wip'], ['🚀', 'released']],
        guide: 'One post per project, and **updates go in your own post** (one new post every 6 hours at most). Show it: a screenshot or a video is required. Pick at least one tag. Self-promo is fine here and only here. No malware, no piracy, no rewrites shipping someone else\'s files.',
        template: '**What it is:** one or two sentences\n**Link:** where to try it or see the code\n**Made with:** the tools and models you used\n**Looking for:** feedback, testers, contributors… (optional)\n+ at least one screenshot or video',
        check: { min: 60, files: true, needs: [['What it is', /what it is/i], ['Made with', /made with|built with|using|claude|codex|gpt|cursor/i]] },
      },
      {
        key: 'help', name: 'help', type: 'forum', every: 300, done: '✅ solved',
        topic: 'Stuck with an agent, a build or a setup? One post per problem, with the template. Type /done when it\'s solved.',
        tags: [['🧠', 'claude code'], ['💻', 'codex'], ['🧰', 'other tool'], ['⚙️', 'setup'], ['🏗️', 'build error'], ['🧩', 'mcp'], ['✅', 'solved', true]],
        guide: 'One problem per post. Title: the problem in one line ("Claude Code can\'t find cargo on Windows"). Paste errors as text in a code block (between ``` ```), not as photos of your screen. Never paste API keys or tokens. When it\'s solved, type `/done` in your post so others find the answer.',
        template: '**What I\'m trying to do:**\n**What happens instead:** the error, in a code block\n**What I tried:**\n**Setup:** OS, tool, model',
        check: { min: 60, needs: [["What I'm trying to do", /trying to do|trying|want to/i], ['What happens instead', /happens|error|instead/i], ['Setup', /setup|windows|linux|mac|os\b|claude|codex/i]] },
      },
      { key: 'coding', name: 'Coding together', type: 'voice' },
    ],
  },
  {
    key: 'creators', category: '🎬 creators',
    channels: [
      { key: 'creatorschat', name: 'creators-chat', type: 'text', slowmode: 3, topic: 'YouTubers, editors, thumbnail artists: growth, the algorithm, editing, gear. Feedback on a video → #video-feedback. Jobs → #hire.' },
      {
        key: 'videofeedback', name: 'video-feedback', type: 'forum', every: 21600, gallery: true, react: ['🔥'],
        topic: 'Get feedback on a video, a short, an edit, a thumbnail or a title. One post each, with the template.',
        tags: [['🎞️', 'video'], ['📱', 'short'], ['✂️', 'edit'], ['🖼️', 'thumbnail'], ['🏷️', 'title'], ['📺', 'channel review']],
        guide: 'One post per video (or thumbnail, or title), one new post every 6 hours at most. Say what you want feedback on. Give feedback to others too: that\'s how this works. Be honest and kind: critique the work, never the person.',
        template: '**Link or file:** the video, short, edit or thumbnail\n**Niche and channel size:**\n**Feedback wanted on:** hook, pacing, editing, sound, thumbnail, title…',
        check: { media: true, needs: [['Feedback wanted on', /feedback|wanted|hook|pacing|thumbnail|title/i]] },
      },
      {
        key: 'hire', name: 'hire', type: 'forum', every: 21600, done: '✅ filled',
        topic: 'Paid work for creators: hire an editor, a thumbnail artist, a scriptwriter… or offer your services. With the template.',
        tags: [['📢', 'hiring'], ['🙋', 'for hire'], ['✂️', 'editor'], ['🖼️', 'thumbnails'], ['✍️', 'script'], ['🎙️', 'voice-over'], ['🎵', 'music / sfx'], ['💻', 'developer'], ['✅', 'filled', true]],
        guide: 'Two tags: **hiring** or **for hire**, and the job. One post every 6 hours at most. Paid work only: no "exposure", no "revenue share" with no money. **For hire**: a portfolio link is required. Deals are between you: the mods don\'t check payments, so ask for half up front and keep everything in writing. Scams are banned; report them with `/report`. When it\'s done, type `/done`.',
        template: '**Role:** editor, thumbnail artist, scriptwriter…\n**Portfolio / examples:** links\n**Budget or rates:** real money\n**Availability or deadline:**\n**Contact:** DMs or e-mail',
        check: { min: 60, needs: [['Role', /role|editor|thumbnail|script|voice|music|developer/i], ['Budget or rates', /budget|rate|\$|€|£|usd|eur|paid|per (video|hour|min)/i], ['Contact', /contact|dm|e-?mail|@/i]] },
      },
      { key: 'editing', name: 'Editing room', type: 'voice' },
    ],
  },
  {
    key: 'music', category: '🎤 music',
    channels: [
      { key: 'musicchat', name: 'music-chat', type: 'text', slowmode: 3, topic: 'Rap, beats, plugins, gear, what you listen to. Prods → #beats, songs → #tracks, looking for someone → #collabs.' },
      {
        key: 'beats', name: 'beats', type: 'forum', every: 1800, reaction: '🔥', react: ['🔥'], done: '🔒 taken',
        topic: 'Beatmakers: one beat per post, with the template. Rappers: reply in the post if you want it.',
        tags: [['🔥', 'trap'], ['🔪', 'drill'], ['📦', 'boom bap'], ['⚡', 'rage'], ['💜', 'r&b'], ['🎉', 'jersey'], ['🌍', 'afro'], ['🌙', 'lo-fi'], ['🎹', 'other'], ['🆓', 'free'], ['💰', 'for sale'], ['🔒', 'taken', true]],
        guide: '**One beat per post**, one new post every 30 minutes at most. Title: the beat\'s name and style ("Midnight — dark trap"). Two tags: the style, and free or for sale. The audio file (mp3 or wav) or a link (YouTube, SoundCloud, BeatStars…) is required. Rappers: reply in the post to get it, and always credit the beatmaker. When it\'s gone, type `/done`.',
        template: '**BPM:**\n**Key:**\n**Vibe / type beat:**\n**License:** free (non-profit) / lease / exclusive, with the price\n**Contact:** DMs, e-mail or your store\n+ the audio file or a link',
        check: { media: true, needs: [['BPM', /bpm|\b\d{2,3}\s*bpm/i], ['Key', /key/i], ['License', /licen[cs]e|free|lease|exclusive|price/i]] },
      },
      {
        key: 'collabs', name: 'collabs', type: 'forum', every: 3600, done: '✅ found',
        topic: 'Looking for a rapper, a beatmaker, a singer, a feature, someone to mix? One post, with the template.',
        tags: [['🎤', 'rapper wanted'], ['🥁', 'beatmaker wanted'], ['🎶', 'singer wanted'], ['🤝', 'feature'], ['🎚️', 'mix / master'], ['🆓', 'free'], ['💰', 'paid'], ['✅', 'found', true]],
        guide: 'Say what you need and what you bring, with a link to your work. One post every hour at most. Free or paid: say it. When you\'ve found someone, type `/done`. Scams or stolen beats: `/report`.',
        template: '**Looking for:**\n**I bring:** your skills, with a link to your work\n**Style / references:**\n**Free or paid:**',
        check: { min: 50, needs: [['Looking for', /looking for|need|wanted/i], ['I bring', /i bring|i make|i rap|i sing|my work|portfolio|soundcloud|youtube|http/i], ['Free or paid', /free|paid|\$|€|price/i]] },
      },
      {
        key: 'trackposts', name: 'tracks', type: 'forum', every: 3600, reaction: '🔥', react: ['🔥'],
        topic: 'Your finished songs and demos, one per post, with the template. Feedback goes in the post.',
        tags: [['🎤', 'rap'], ['🎶', 'singing'], ['🧪', 'demo'], ['✅', 'finished'], ['🎚️', 'mix feedback'], ['✍️', 'lyrics feedback']],
        guide: 'One song per post, one new post every hour at most. **Credit the beatmaker** (required). The audio file or a link is required. Say what you want feedback on, and give some to others.',
        template: '**Artist:**\n**Beat by:** credit the beatmaker\n**Feedback wanted on:** flow, lyrics, mix, the hook…\n+ the audio file or a link',
        check: { media: true, needs: [['Beat by', /beat by|prod|produced/i], ['Feedback wanted on', /feedback|wanted/i]] },
      },
      { key: 'studio', name: 'Studio', type: 'voice' },
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
      { key: 'reports', name: 'reports', type: 'text', staff: true, topic: 'Reports from members: /report and "Report to mods" on a message.' },
      { key: 'modmail', name: 'mod-mail', type: 'text', staff: true, topic: "Members DM Kira; each conversation is a thread here. Write in the thread to answer (start with // for a note they don't see, //close to close)." },
      { key: 'discordupdates', name: 'discord-updates', type: 'text', staff: true, topic: 'Messages from Discord to community servers.' },
    ],
  },
];

export const RETIRED = ['showcase', 'tracks', 'chill'];

// Pinned messages in text channels.
export const PINS = {
  intro: '👋 **Introduce yourself** (once), like this:\n\n**Name:** what we call you\n**What I do:** vibe coding, beats, rap, videos, editing…\n**What I\'m working on:**\n**Where to find me:** (optional: YouTube, GitHub, SoundCloud…)\n\nOne message, one introduction. To chat, go to #general.',
};

// Public repositories announced in #releases (orion-aic is never promoted).
export const RELEASE_REPOS = ['horizon', 'lsuite', 'ryolune', 'kimchi', 'nori', 'folio', 'PokemonSunNative', 'obsidian-360'];
export const YOUTUBE_CHANNEL_ID = 'UCNpwCgIK6O6oct9ra9ohZ7w'; // @lu4ovic
export const FEED_EVERY_MS = 10 * 60 * 1000;

// Forum posts → GitHub issues (src/features/github.js). Off until GITHUB_TOKEN is set (see the README).
// Per forum: the repo and kind, or (#project-feedback) a repo per project tag and a kind per tag.
// `fixed` / `notPlanned` / `duplicate`: the forum tags Kira applies when the issue is closed that way.
export const GITHUB = {
  owner: 'ludovic111',
  forums: {
    horizonbugs: { repo: 'horizon', kind: 'bug', fixed: 'fixed', duplicate: 'duplicate' },
    horizonideas: { repo: 'horizon', kind: 'idea', fixed: 'done', notPlanned: "won't do" },
    feedback: {
      projects: { lsuite: 'lsuite', ryolune: 'ryolune', kimchi: 'kimchi', nori: 'nori', folio: 'folio', DISPO: 'DISPO' },
      kinds: { bug: 'bug', idea: 'idea' },
      fixed: 'done',
    },
  },
  private: ['DISPO'], // issues there get no link in Discord: players can't open them
  labels: { bug: 'bug', idea: 'enhancement', from: 'from-discord' },
  pollEveryMs: 5 * 60 * 1000,
  rate: { perUser: 3, global: 20, windowMs: 60 * 60 * 1000 }, // issues opened per hour
  notifyByDm: false, // also DM the poster when their post gets an answer (the thread mention is the main channel)
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
  // A channel moving faster than this gets an automatic slowmode, removed when it calms down.
  autoSlowmode: [[60, 15], [30, 5]],             // [messages per minute, seconds of slowmode]
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
  title: "Welcome to ludovic's server",
  description: [
    "Hey, I'm **Ludovic**. I direct AI agents to build software, and I make videos about it.",
    'This is my community: people who build with AI, make videos, make music, or use what I make.',
    '',
    '**Where things are**',
    '💬 **general**: chat, introductions, memes, #resources, the #hall-of-fame',
    "🛠️ **ludovic's projects**: Horizon (Minecraft in Rust) with its bugs and ideas, the catalogue of my projects, #releases",
    '🤖 **vibe coding**: building with AI, rewrites, **your** projects in #community-projects, #help',
    '🎬 **creators**: YouTubers, editors and thumbnail artists: #video-feedback and #hire',
    '🎤 **music**: beatmakers post prods in #beats, rappers find them, #collabs and #tracks',
    '🔊 **voice**: join **➕ create your room** for your own voice channel',
    '',
    '**How it works**',
    '• Channels with posts (forums) each have a template: read the pinned post before posting. Kira checks it.',
    '• Questions? Everything is in #faq. Need a mod? Send Kira a DM.',
    '• Talk and hang out in voice to level up (`/rank`).',
    '',
    'Read #rules, then pick your roles with the buttons below.',
  ].join('\n'),
  links: [
    ['YouTube', LINKS.youtube], ['Portfolio', LINKS.portfolio], ['GitHub', LINKS.github],
    ['lsuite', LINKS.lsuite], ['Horizon', LINKS.horizon], ['X', LINKS.x], ['Instagram', LINKS.instagram],
  ],
};

export const RULES = [
  ['Be respectful', 'No harassment, hate speech, slurs, threats or personal attacks. Critique the work, never the person.'],
  ['No spam', 'No floods, no copy-pasted messages, no mass mentions, no unsolicited DMs, no unsolicited ads. Self-promo only in #community-projects, #beats, #tracks, #video-feedback and #hire.'],
  ['No piracy, no leaks', "Don't share or ask for game files, ROMs, leaked code, cracked software, plugins or keys. Horizon needs your own copy of Minecraft."],
  ['No scams or malware', 'No phishing, fake "free Nitro", or executables. Accounts younger than 3 days can\'t post links. Never pay someone outside a clear agreement.'],
  ['Keep it SFW', 'No NSFW, gore or shock content, anywhere: names, avatars and statuses included.'],
  ['Right channel, right format', 'Every channel says what it\'s for in its description. Forums have a template in their pinned post: posts without it are closed after an hour.'],
  ['Respect people\'s work', "Don't steal or resell someone else's beat, edit or code. Credit the beatmaker when you use a prod. Free beats are for non-profit use unless the post says otherwise."],
  ['English in the main channels', 'So everyone can follow. Any language is fine in #off-topic.'],
  ['No drama with the mods in public', 'Disagree with a decision? DM Kira: it reaches the mods privately.'],
  ["Discord's rules apply", 'Follow the Discord Terms of Service and Community Guidelines (13+).'],
];
export const RULES_FOOTER = 'Kira enforces these day and night: spam gets a timeout (10 min, then 1 h, then a day), then the mods warn, time out or ban. 3 warnings in 30 days = a 1-hour timeout.';

export const FAQ = [
  ['How do I get roles?', 'With the buttons in #welcome (click again to remove), or in **Channels & Roles** at the top of the channel list. Level roles come by themselves.'],
  ['What are levels?', 'You earn XP by talking (once a minute) and by hanging out in voice with other people. lvl 5, 10, 20, 30 and 50 give a role. `/rank` shows yours, `/leaderboard` the top 10. #memes and #bot-commands give no XP.'],
  ['Where do I post…?', '• a bug in Horizon → #horizon-bugs · an idea for Horizon → #horizon-ideas\n• a question or bug about lsuite, DISPO… → #project-feedback\n• your own project → #community-projects · a coding problem → #help\n• a beat → #beats · a song → #tracks · looking for a rapper or beatmaker → #collabs\n• a video to review → #video-feedback · a paid job → #hire\n• a tool, guide or kit → #resources'],
  ['Why was my post closed?', 'Forum posts must follow the template in the forum\'s pinned post. Kira tells you in your post what\'s missing. Edit your first message (⋯ → Edit) within an hour and the post stays; otherwise it\'s closed, and you can post again with the template.'],
  ['How do I mark my post as solved?', 'Type `/done` in your post (help, collabs, beats, hire, project feedback). It gets the right tag and closes.'],
  ['How do I get my own voice channel?', 'Join **➕ create your room**: Kira makes you one and moves you in. `/room lock` (only people you invite), `/room invite @someone`, `/room private` (hidden), `/room limit 4`, `/room rename`. It disappears when it\'s empty.'],
  ['What is 🎙️ ludovic?', "Ludovic's voice channel. Nobody joins it by themselves: wait in **⏳ waiting room** and he moves people in."],
  ['Where do I download Horizon?', `${LINKS.horizon}. You need your own copy of Minecraft Java Edition: Horizon uses its textures and sounds. Read #horizon-info.`],
  ['How do I reach the mods?', 'Send a DM to **Kira**: only the mods read it, and they answer through Kira. To report a message: right-click it → Apps → **Report to mods**, or `/report`.'],
  ['Why can\'t I post links?', 'Accounts younger than 3 days can\'t post links: that\'s how most scams arrive. It goes away by itself.'],
  ['Why is a channel in slowmode?', 'When a channel moves too fast to read, Kira turns on a slowmode by itself, and turns it off when it calms down.'],
  ['Can I advertise my server, my channel, my product?', 'Only in the places made for it: #community-projects, #beats, #tracks, #video-feedback and #hire. Server invites are blocked everywhere.'],
];

export const HORIZON = {
  description: [
    '**Horizon** is Minecraft: Java Edition rewritten from scratch in Rust, with AI agents, and checked against the real game with differential tests so it behaves exactly like vanilla.',
    '',
    'Zero lines of Mojang\'s code: it uses the textures and sounds from **your own copy** of Minecraft Java Edition.',
  ].join('\n'),
  get: `Download: ${LINKS.horizon}`,
  roadmap: [
    '**0.** 100% parity with vanilla Java Edition',
    '**1.** Full optimization of the client and the server: as many FPS as possible, same gameplay',
    '**2.** Modding support, and porting mods to Horizon',
    '**3.** MCP and CLI support, so AI agents can control the game',
    '**4.** A built-in video studio: you or your AI direct every aspect of the game for Minecraft videos',
    '**5.** A pipeline that ports any past or future Minecraft version to Rust',
  ].join('\n'),
  disclaimer: 'Horizon is an unofficial fan project. It is not affiliated with, endorsed by, or connected to Mojang Studios or Microsoft. Minecraft is a trademark of Mojang and Microsoft; the game, its name, textures and sounds belong to them. Horizon contains none of Minecraft\'s code or files, and none are distributed. To play Horizon you must own a legal copy of Minecraft Java Edition. Horizon is a free, personal, educational project, not for sale, and used at your own risk.',
};

// One post per project in #projects (stratosph3re and orion aic are never shown).
export const PROJECTS = [
  {
    name: 'Horizon', tag: 'game', sub: 'Minecraft in Rust · in development',
    text: `Minecraft: Java Edition rewritten from scratch in Rust with AI agents, checked against the original game with differential tests. It uses the textures and sounds from your own copy of the game. Everything else about it: #horizon-info.`,
    links: [['Download (GitHub)', 'https://github.com/ludovic111/horizon']],
  },
  {
    name: 'lsuite', tag: 'lsuite',
    text: 'A free, open-source creative suite written in Rust, where every app can be driven end to end by an AI agent: through its CLI, its MCP server or its built-in agent. Four apps, all in beta, MIT licensed: ryolune, kimchi, nori and folio.',
    links: [['lsuite.xyz', 'https://lsuite.xyz'], ['GitHub', 'https://github.com/ludovic111/lsuite']],
  },
  {
    name: 'ryolune', tag: 'lsuite', sub: 'music · open-source DAW',
    text: 'Music production for Linux and macOS. Record, arrange, mix and export, or ask the built-in agent: it runs the same commands, with the same undo. Opens DAWproject sessions from other music apps, and plugs into Claude Code, Codex or any MCP client.',
    links: [['lsuite.xyz/ryolune', 'https://lsuite.xyz/ryolune'], ['Download', 'https://lsuite.xyz/ryolune/download'], ['GitHub', 'https://github.com/ludovic111/ryolune']],
  },
  {
    name: 'kimchi', tag: 'lsuite', sub: 'video · open-source editor',
    text: 'A video editor where image, video and sound models are part of the cut: generate a shot at the playhead, animate a frame, extend a clip, then edit it like any footage. Motion design and 3D built in; opens your Final Cut, Premiere and Resolve timelines. Your own API keys, or local models.',
    links: [['lsuite.xyz/kimchi', 'https://lsuite.xyz/kimchi'], ['Download', 'https://lsuite.xyz/kimchi/download'], ['GitHub', 'https://github.com/ludovic111/kimchi']],
  },
  {
    name: 'nori', tag: 'lsuite', sub: 'images · photos, vectors, layout',
    text: 'Photo editing, vector illustration and page layout in one document: the work of Photoshop, Illustrator and InDesign combined. Every action is a command your AI can run. Linux and macOS.',
    links: [['lsuite.xyz/nori', 'https://lsuite.xyz/nori'], ['Download', 'https://lsuite.xyz/nori/download'], ['GitHub', 'https://github.com/ludovic111/nori']],
  },
  {
    name: 'folio', tag: 'lsuite', sub: 'office · documents, sheets, slides',
    text: 'Documents, spreadsheets and presentations in one app: the work of Word, Excel and PowerPoint combined. Every action is a command your AI can run. Linux and macOS.',
    links: [['lsuite.xyz/folio', 'https://lsuite.xyz/folio'], ['Download', 'https://lsuite.xyz/folio/download'], ['GitHub', 'https://github.com/ludovic111/folio']],
  },
  {
    name: 'DISPO', tag: 'app', sub: 'mobile app for musicians',
    text: 'When a musician drops out of a gig or a rehearsal, DISPO finds someone free to step in, by instrument, level, style and the songs they already know. It also runs your bands: sessions, attendance, setlists and shared repertoires. On the App Store for iPhone; Android is coming.',
    links: [['dispoapp.net', 'https://dispoapp.net'], ['App Store', 'https://apps.apple.com/app/id6792306161']],
  },
  {
    name: 'PokemonSunNative', tag: 'research', sub: 'static recompilation · experimental',
    text: 'Pokémon Sun recompiled from the 3DS binary to native x86-64 Linux, with Vulkan rendering. Playable from the start to Route 1. Bring your own legally obtained copy of the game; no game files included.',
    links: [['GitHub', 'https://github.com/ludovic111/PokemonSunNative']],
  },
  {
    name: 'obsidian-360', tag: 'research', sub: 'hardware research',
    text: 'Evidence-based research on the Xbox 360 hardware, modern Linux on the console, and reproducible diagnostic tools. Not affiliated with Microsoft.',
    links: [['GitHub', 'https://github.com/ludovic111/obsidian-360']],
  },
];
