// Everything Kira knows about the server: its layout, its texts and its feeds.
// `npm run setup` makes the server match this file; the bot reads the same file at runtime.

export const GUILD_ID = '1559227979002028052'; // "ludovic's server", created 2026-10-12

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

// Roles, from lowest to highest. `self` roles are picked by members in Onboarding.
export const ROLES = [
  { key: 'videos', name: '🔔 Videos', color: 0xff4d4d, self: true, mentionable: false },
  { key: 'releases', name: '📦 Releases', color: 0x5aa9ff, self: true, mentionable: false },
  { key: 'horizon', name: 'Horizon', color: COLOR, self: true },
  { key: 'ai', name: 'AI coder', color: 0x9b7bff, self: true },
  { key: 'modder', name: 'Modder', color: 0x4cc38a, self: true },
  { key: 'creator', name: 'Creator', color: 0xff8ad8, self: true },
  { key: 'tester', name: 'Horizon Tester', color: 0xffd166, hoist: true },
  {
    key: 'mod', name: 'Mod', color: 0x2ecc71, hoist: true,
    permissions: ['KickMembers', 'BanMembers', 'ModerateMembers', 'ManageMessages', 'ManageThreads', 'ManageNicknames', 'ViewAuditLog', 'MuteMembers', 'MoveMembers'],
  },
];

// Channel types: text, voice, forum, announcement. `readonly`: everyone reads, only staff and Kira post.
// `staff`: only mods see it. Forum `posts: 'staff'`: only staff open posts, everyone replies.
export const LAYOUT = [
  {
    category: '👋 start here',
    channels: [
      { key: 'welcome', name: 'welcome', type: 'text', readonly: true, topic: 'Who I am, what this server is, and where to start.' },
      { key: 'rules', name: 'rules', type: 'text', readonly: true, topic: 'Read these. Kira enforces them.' },
      { key: 'announcements', name: 'announcements', type: 'announcement', readonly: true, topic: 'New videos and big news. Pick the 🔔 Videos role to get pinged.' },
    ],
  },
  {
    category: '💬 community',
    channels: [
      { key: 'general', name: 'general', type: 'text', adopt: 'general', topic: 'Talk about anything. English please, so everyone can follow.' },
      { key: 'introductions', name: 'introductions', type: 'text', topic: 'Say hi: who you are, what you build, what brought you here.', slowmode: 60 },
      { key: 'offtopic', name: 'off-topic', type: 'text', topic: 'Everything else. Any language.' },
      { key: 'memes', name: 'memes', type: 'text', topic: 'Memes. Keep them SFW.' },
      { key: 'lounge', name: 'Lounge', type: 'voice', adopt: 'General' },
    ],
  },
  {
    category: '🤖 ai coding',
    channels: [
      { key: 'aicoding', name: 'ai-coding', type: 'text', topic: 'Harnesses, models, prompts, workflows: Claude Code, Codex and the rest.' },
      { key: 'rewrites', name: 'rewrites', type: 'text', topic: 'Decompiles, ports and rewrites done with agents: games, apps, anything. No leaked or pirated files.' },
      { key: 'showcase', name: 'showcase', type: 'text', topic: 'Show what you built. Self-promo is fine here, and only here.' },
      { key: 'help', name: 'help', type: 'forum', topic: 'Stuck with an agent, a build or a setup? Open a post.', tags: ['claude code', 'codex', 'setup', 'build', 'solved'] },
      { key: 'coding', name: 'Coding together', type: 'voice' },
    ],
  },
  {
    category: '🌅 horizon',
    channels: [
      { key: 'horizoninfo', name: 'horizon-info', type: 'text', readonly: true, topic: 'Horizon: Minecraft Java Edition rewritten in Rust. What it is, how to get it, the roadmap.' },
      { key: 'horizonchat', name: 'horizon-chat', type: 'text', topic: 'Talk about Horizon.' },
      { key: 'horizonideas', name: 'horizon-suggestions', type: 'forum', vote: true, topic: 'One idea per post. Kira adds 👍 and 👎: vote on the ones you want.', tags: ['performance', 'modding', 'multiplayer', 'mcp / agents', 'video studio', 'other', 'planned', 'done'] },
      { key: 'horizonbugs', name: 'horizon-bugs', type: 'forum', topic: 'One bug per post: what you did, what happened, what you expected, your OS and GPU. Screenshots help.', tags: ['crash', 'rendering', 'gameplay', 'world gen', 'performance', 'confirmed', 'fixed'] },
    ],
  },
  {
    category: "🛠️ ludovic's projects",
    channels: [
      { key: 'projects', name: 'projects', type: 'forum', posts: 'staff', topic: 'One post per project. Ask questions and give feedback in its post.', tags: ['lsuite', 'app', 'research'] },
      { key: 'releases', name: 'releases', type: 'text', readonly: true, topic: 'Every new release of my open-source projects. Pick the 📦 Releases role to get pinged.' },
      { key: 'feedback', name: 'feedback', type: 'forum', vote: true, topic: 'Ideas and bugs for lsuite, DISPO and my other projects. Tag the project.', tags: ['lsuite', 'ryolune', 'kimchi', 'nori', 'folio', 'DISPO', 'other', 'bug', 'idea'] },
    ],
  },
  {
    category: '🛡️ staff',
    staff: true,
    channels: [
      { key: 'modchat', name: 'mod-chat', type: 'text', staff: true },
      { key: 'modlog', name: 'mod-log', type: 'text', staff: true, topic: 'Kira logs here: joins, leaves, deleted and edited messages, warnings, timeouts, AutoMod.' },
      { key: 'discordupdates', name: 'discord-updates', type: 'text', staff: true, topic: 'Messages from Discord to community servers.' },
    ],
  },
];

// Public repositories announced in #releases (orion-aic is never promoted).
export const RELEASE_REPOS = ['horizon', 'lsuite', 'ryolune', 'kimchi', 'nori', 'folio', 'PokemonSunNative', 'obsidian-360'];
export const YOUTUBE_CHANNEL_ID = 'UCNpwCgIK6O6oct9ra9ohZ7w'; // @lu4ovic
export const FEED_EVERY_MS = 10 * 60 * 1000;

// Moderation knobs.
export const MOD = {
  floodMessages: 6, floodWindowMs: 8_000,        // 6 messages in 8 s
  repeatCount: 3, repeatWindowMs: 60_000,        // the same message 3 times in a minute
  floodTimeoutMs: 10 * 60_000,                   // → 10 min timeout
  newAccountDays: 3,                             // accounts younger than this can't post links
  warnLimit: 3, warnWindowDays: 30, warnTimeoutMs: 60 * 60_000, // 3 warnings in 30 days → 1 h timeout
};

export const WELCOME = {
  title: "Welcome to ludovic's server",
  description: [
    "Hey, I'm **Ludovic**. I direct AI agents to build software, and I make videos about it.",
    '',
    'This server is for everyone who watches, builds with AI, or uses what I make:',
    '• **💬 community**: hang out, introduce yourself',
    '• **🤖 ai coding**: harnesses, models, rewrites, and show what you built',
    '• **🌅 horizon**: my Minecraft rewrite in Rust: news, ideas, bugs',
    "• **🛠️ ludovic's projects**: lsuite, DISPO and the rest, with every release",
    '',
    'Read the rules, then pick your roles in **Channels & Roles** (top of the channel list): 🔔 Videos and 📦 Releases get you pinged.',
  ].join('\n'),
  links: [
    ['YouTube', LINKS.youtube], ['Portfolio', LINKS.portfolio], ['GitHub', LINKS.github],
    ['lsuite', LINKS.lsuite], ['Horizon', LINKS.horizon], ['X', LINKS.x], ['Instagram', LINKS.instagram],
  ],
};

export const RULES = [
  ['Be respectful', 'No harassment, hate speech, slurs, threats or personal attacks. Argue about ideas, not people.'],
  ['No spam', 'No floods, no copy-pasted messages, no mass mentions, no unsolicited DMs. Self-promo only in #showcase.'],
  ['No piracy, no leaks', "Don't share or ask for game files, leaked code, cracked software or keys. Horizon needs your own copy of Minecraft."],
  ['No scams or malware', 'No phishing, fake "free Nitro", or suspicious downloads. Accounts younger than 3 days can\'t post links.'],
  ['Keep it SFW', 'No NSFW, gore or shock content, anywhere: names and avatars included.'],
  ['Right channel', 'Horizon bugs in #horizon-bugs, Horizon ideas in #horizon-suggestions, everything else for my projects in #feedback.'],
  ['English in the main channels', 'So everyone can follow. Any language is fine in #off-topic.'],
  ["Discord's rules apply", 'Follow the Discord Terms of Service and Community Guidelines (13+).'],
];
export const RULES_FOOTER = 'Kira and the mods enforce these: a warning, then a timeout, then a ban. 3 warnings in 30 days = a 1-hour timeout. Floods get an automatic 10-minute timeout.';

export const HORIZON = {
  description: [
    '**Horizon** is Minecraft: Java Edition rewritten from scratch in Rust, with AI agents, and checked against the real game with differential tests so it behaves exactly like vanilla.',
    '',
    'Zero lines of Mojang\'s code: it uses the textures and sounds from **your own copy** of Minecraft Java Edition.',
  ].join('\n'),
  get: `Source and builds: ${LINKS.horizon}`,
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
