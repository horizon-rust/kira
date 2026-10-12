// Makes the server match config.js: settings, roles, channels, Community, texts, AutoMod, Onboarding, invite.
// Safe to run again: everything is found by the ID it got the first time (data/state.json) and updated.
import {
  Client, GatewayIntentBits, ChannelType, PermissionFlagsBits as P, OverwriteType,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Routes,
  GuildVerificationLevel, GuildExplicitContentFilter, GuildDefaultMessageNotifications,
  ForumLayoutType, SortOrderType, ChannelFlags,
  AutoModerationRuleTriggerType as T, AutoModerationRuleEventType, AutoModerationActionType as A, AutoModerationRuleKeywordPresetType as Preset,
} from 'discord.js';
import { GUILD_ID, OWNER_ID, LINKS, COLOR, ROLES, LAYOUT, RETIRED, PINS, WELCOME, RULES, RULES_FOOTER, FAQ, HORIZON, PROJECTS } from './config.js';
import { load, save } from './store.js';
import { linkify, rolesMessage, howToPost } from './texts.js';

const TYPES = { text: ChannelType.GuildText, voice: ChannelType.GuildVoice, forum: ChannelType.GuildForum, announcement: ChannelType.GuildAnnouncement };
const state = load();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const log = (...a) => console.log('·', ...a);

function linkRows(links) {
  const rows = [];
  for (let i = 0; i < links.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      links.slice(i, i + 5).map(([label, url]) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url)),
    ));
  }
  return rows;
}

async function ensureRoles(guild) {
  const me = guild.members.me;
  for (const spec of ROLES) {
    let role = guild.roles.cache.get(state.roles[spec.key] ?? state.roles[spec.was]);
    if (spec.managed) role ??= guild.roles.cache.find((r) => r.tags?.premiumSubscriberRole);
    role ??= guild.roles.cache.find((r) => r.name === spec.name);
    const data = { name: spec.name, colors: { primaryColor: spec.color }, hoist: !!spec.hoist, mentionable: false };
    if (!spec.managed) data.permissions = (spec.permissions ?? []).map((p) => P[p]);
    if (role) await role.edit(data);
    else if (spec.managed) { log('no', spec.name, 'role yet (Discord makes it)'); continue; }
    else { role = await guild.roles.create(data); log('role created', spec.name); }
    state.roles[spec.key] = role.id;
    if (spec.was) delete state.roles[spec.was];
  }
  // Order: the list is lowest first, with Kira's own role above all of them (so it can moderate everyone).
  const ordered = ROLES.filter((spec) => state.roles[spec.key]);
  await guild.roles.setPositions([
    ...ordered.map((spec, i) => ({ role: state.roles[spec.key], position: i + 1 })),
    { role: me.roles.botRole.id, position: ordered.length + 1 },
  ]);
  const owner = await guild.members.fetch(OWNER_ID);
  if (!owner.roles.cache.has(state.roles.owner)) await owner.roles.add(state.roles.owner);
  save();
}

function overwrites(guild, spec, staffCategory) {
  const everyone = guild.roles.everyone.id;
  const mod = state.roles.mod;
  const kira = guild.members.me.id;
  const ow = [{ id: kira, type: OverwriteType.Member, allow: [P.ViewChannel, P.SendMessages, P.ManageMessages, P.ManageThreads, P.EmbedLinks, P.AddReactions, P.Connect, P.MoveMembers, P.ManageChannels] }];
  if (spec.staff || staffCategory) {
    ow.push({ id: everyone, type: OverwriteType.Role, deny: [P.ViewChannel] }, { id: mod, type: OverwriteType.Role, allow: [P.ViewChannel, P.SendMessages] });
  } else if (spec.readonly) {
    ow.push(
      { id: everyone, type: OverwriteType.Role, deny: [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads] },
      { id: mod, type: OverwriteType.Role, allow: [P.SendMessages] },
    );
  } else if (spec.posts === 'staff') {
    ow.push({ id: everyone, type: OverwriteType.Role, deny: [P.SendMessages], allow: [P.SendMessagesInThreads] }, { id: mod, type: OverwriteType.Role, allow: [P.SendMessages] });
  } else if (spec.locked) {
    // Everyone sees it, nobody joins by themselves: Ludovic (and mods) move people in.
    ow.push({ id: everyone, type: OverwriteType.Role, deny: [P.Connect] }, { id: OWNER_ID, type: OverwriteType.Member, allow: [P.Connect, P.Speak, P.MoveMembers] });
  } else if (spec.lobby) {
    ow.push({ id: everyone, type: OverwriteType.Role, deny: [P.Speak, P.SendMessages] });
  }
  return ow;
}

async function ensureChannels(guild, community) {
  const bitrate = guild.maximumBitrate; // 128 kbps with the server's boosts
  for (const key of RETIRED) {
    const ch = guild.channels.cache.get(state.channels[key]);
    if (ch) {
      const humans = ch.isTextBased() && !ch.isVoiceBased() ? (await ch.messages.fetch({ limit: 50 })).filter((m) => !m.author.bot).size : ch.members?.size ?? 0;
      if (humans) { log('kept retired', ch.name, '(members wrote in it)'); continue; }
      await ch.delete('No longer in the layout'); log('removed', ch.name);
    }
    delete state.channels[key];
  }
  for (const group of LAYOUT) {
    const ckey = 'cat:' + group.key;
    state.channels[ckey] ??= state.channels['cat:' + group.was];
    if (group.was) delete state.channels['cat:' + group.was];
    let cat = guild.channels.cache.get(state.channels[ckey]);
    const catData = { name: group.category, type: ChannelType.GuildCategory, permissionOverwrites: group.staff ? overwrites(guild, { staff: true }) : [] };
    if (cat) await cat.edit(catData);
    else { cat = await guild.channels.create(catData); log('category created', group.category); }
    state.channels[ckey] = cat.id;
    save();

    for (const spec of group.channels) {
      const wanted = TYPES[spec.type];
      // Forums and announcement channels need Community: until it's on, announcements is a text channel and forums wait.
      if (!community && spec.type === 'forum') continue;
      const type = !community && spec.type === 'announcement' ? ChannelType.GuildText : wanted;
      let ch = guild.channels.cache.get(state.channels[spec.key]);
      const data = { name: spec.name, parent: cat.id, permissionOverwrites: overwrites(guild, spec, group.staff) };
      if (spec.type === 'voice') data.bitrate = bitrate;
      else { data.topic = spec.topic ?? null; data.rateLimitPerUser = spec.slowmode ?? 0; }
      if (spec.type === 'forum') {
        const existing = ch?.availableTags ?? [];
        const tags = spec.template ? [['📌', 'read me', true], ...spec.tags] : spec.tags; // "read me": the pinned how-to post
        data.availableTags = tags.map(([emoji, name, staffOnly]) => ({ ...(existing.find((t) => t.name === name) ?? {}), name, emoji: { id: null, name: emoji }, moderated: !!staffOnly }));
        data.topic = linkify(`${spec.topic}\n\n${spec.guide ?? ''}${spec.template ? `\n\n**Template:**\n${spec.template}` : ''}`, state).slice(0, 4096);
        data.defaultForumLayout = spec.gallery ? ForumLayoutType.GalleryView : ForumLayoutType.ListView;
        data.defaultSortOrder = SortOrderType.CreationDate;
        data.defaultReactionEmoji = spec.reaction ? { id: null, name: spec.reaction } : null;
        data.rateLimitPerUser = Math.min(spec.every ?? 0, 21600);            // time between two posts by the same member
        data.defaultThreadRateLimitPerUser = 2;              // and between two replies inside a post
        data.flags = spec.readonly ? 0 : ChannelFlags.RequireTag;
      } else if (spec.type !== 'voice' && spec.topic) data.topic = linkify(spec.topic, state);
      if (ch && ch.type !== type) await ch.setType(type);
      if (ch) await ch.edit(data);
      else { ch = await guild.channels.create({ ...data, type }); log('channel created', spec.name); }
      state.channels[spec.key] = ch.id;
      save(); // right away: a crash later must not make it create the channel again
    }
  }
  save();
}

// Puts categories and channels in the order of LAYOUT; removes empty categories that are no longer in it.
async function order(guild) {
  await guild.channels.fetch();
  const keep = new Set(LAYOUT.map((g) => state.channels['cat:' + g.key]));
  const rooms = new Set(Object.keys(state.rooms ?? {}));
  // Only categories Kira made (or Discord's defaults), never one made by hand.
  const mine = new Map(Object.entries(state.channels).filter(([k]) => k.startsWith('cat:')).map(([k, v]) => [v, k]));
  for (const cat of guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).values()) {
    if (keep.has(cat.id) || guild.channels.cache.some((c) => c.parentId === cat.id)) continue;
    if (!mine.has(cat.id) && !['Text Channels', 'Voice Channels'].includes(cat.name)) continue;
    await cat.delete('No longer in the layout'); log('removed category', cat.name);
    if (mine.has(cat.id)) delete state.channels[mine.get(cat.id)];
  }
  save();
  const positions = [];
  LAYOUT.forEach((group, i) => {
    positions.push({ channel: state.channels['cat:' + group.key], position: i });
    group.channels.forEach((spec, j) => positions.push({ channel: state.channels[spec.key], position: j }));
  });
  await guild.channels.setPositions(positions.filter((p) => p.channel && !rooms.has(p.channel)));
}

// What every member can do by default. No @everyone, no TTS, no threads in text channels (forum posts
// and replies still work), no user-installed apps posting in channels.
const EVERYONE = [
  'ViewChannel', 'CreateInstantInvite', 'ChangeNickname', 'SendMessages', 'SendMessagesInThreads', 'EmbedLinks',
  'AttachFiles', 'AddReactions', 'UseExternalEmojis', 'UseExternalStickers', 'ReadMessageHistory', 'UseApplicationCommands',
  'SendVoiceMessages', 'SendPolls', 'Connect', 'Speak', 'Stream', 'UseVAD', 'RequestToSpeak', 'UseEmbeddedActivities', 'UseSoundboard',
];

async function enableCommunity(guild) {
  await guild.roles.everyone.setPermissions(EVERYONE.map((p) => P[p]), 'safe defaults');
  const settings = {
    verificationLevel: GuildVerificationLevel.High, // verified e-mail, account older than 5 minutes, 10 minutes on the server before talking
    explicitContentFilter: GuildExplicitContentFilter.AllMembers,
    defaultMessageNotifications: GuildDefaultMessageNotifications.OnlyMentions,
    systemChannel: null, // Kira greets newcomers itself
    rulesChannel: state.channels.rules,
    publicUpdatesChannel: state.channels.discordupdates,
    afkChannel: null,
    description: 'The community of Ludovic: vibe coding, Horizon (Minecraft in Rust), lsuite, and rap: beatmakers and rappers.',
    preferredLocale: 'en-US',
  };
  if (!guild.features.includes('COMMUNITY')) settings.features = [...guild.features, 'COMMUNITY'];
  await guild.edit(settings);
  log('community', settings.features ? 'enabled' : 'on');
}

// Sends a message once and keeps editing that same message on later runs.
async function upsert(guild, key, channelKey, payload) {
  const ch = guild.channels.cache.get(state.channels[channelKey]);
  let msg = state.messages[key] && await ch.messages.fetch(state.messages[key]).catch(() => null);
  if (msg) await msg.edit(payload);
  else { msg = await ch.send(payload); log('posted', key); }
  state.messages[key] = msg.id;
  save();
  return msg;
}

async function posts(guild) {
  const L = (t) => linkify(t, state);
  await upsert(guild, 'welcome', 'welcome', {
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle(WELCOME.title).setDescription(L(WELCOME.description.replace('Read the rules', 'Read #rules')))],
    components: linkRows(WELCOME.links),
  });
  await upsert(guild, 'roles', 'welcome', rolesMessage(state));
  await upsert(guild, 'rules', 'rules', {
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle('Rules')
      .setDescription(L(RULES.map(([t, d], i) => `**${i + 1}. ${t}**\n${d}`).join('\n\n')))
      .setFooter({ text: RULES_FOOTER })],
    components: linkRows([['Discord Community Guidelines', 'https://discord.com/guidelines']]),
  });
  await upsert(guild, 'faq', 'faq', {
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle('❓ FAQ').setDescription(L(FAQ.map(([q, a]) => `**${q}**\n${a}`).join('\n\n')).slice(0, 4096))],
  });
  for (const group of LAYOUT) for (const spec of group.channels) {
    if (spec.pin) {
      const msg = await upsert(guild, 'pin:' + spec.key, spec.key, { content: L(PINS[spec.pin]) });
      if (!msg.pinned) await msg.pin().catch(() => {});
    }
    // Each forum (except the catalogue) gets a locked, pinned "how to post" post with its rules and template.
    if (spec.type === 'forum' && spec.template) {
      const forum = guild.channels.cache.get(state.channels[spec.key]);
      const key = 'howto:' + spec.key;
      const payload = howToPost(spec, state);
      let thread = state.messages[key] && await guild.channels.fetch(state.messages[key]).catch(() => null);
      if (thread) {
        const starter = await thread.fetchStarterMessage().catch(() => null);
        if (starter) await starter.edit(payload);
      } else {
        const readMe = forum.availableTags.find((t) => t.name === 'read me')?.id;
        thread = await forum.threads.create({ name: '📌 How to post here: read me first', message: payload, appliedTags: readMe ? [readMe] : [] });
        log('how-to posted', spec.name);
      }
      if (!thread.locked) await thread.setLocked(true).catch(() => {});
      if (!thread.flags.has('Pinned')) await thread.pin().catch((e) => log('pin', spec.name, e.message));
      state.messages[key] = thread.id;
      save();
    }
  }
  await upsert(guild, 'horizon', 'horizoninfo', {
    embeds: [
      new EmbedBuilder().setColor(COLOR).setTitle('🌅 Horizon').setURL(LINKS.horizon).setDescription(HORIZON.description)
        .addFields(
          { name: 'Get it', value: HORIZON.get },
          { name: 'Roadmap', value: HORIZON.roadmap },
          { name: 'Talk about it', value: L('#horizon-chat · ideas in #horizon-ideas · bugs in #horizon-bugs') },
        ),
      new EmbedBuilder().setColor(0x555555).setTitle('⚠️ Disclaimer').setDescription(HORIZON.disclaimer),
    ],
    components: linkRows([['Download (GitHub)', LINKS.horizon], ['YouTube', LINKS.youtube]]),
  });

  // One post per project in the #projects forum.
  const forum = guild.channels.cache.get(state.channels.projects);
  for (const p of [...PROJECTS].reverse()) { // the newest post shows first: create the first project last
    const key = 'project:' + p.name;
    const embed = new EmbedBuilder().setColor(COLOR).setTitle(p.name).setDescription(L(p.text));
    if (p.sub) embed.setFooter({ text: p.sub });
    const payload = { embeds: [embed], components: linkRows(p.links) };
    const tag = forum.availableTags.find((t) => t.name === p.tag)?.id;
    let thread = state.messages[key] && await guild.channels.fetch(state.messages[key]).catch(() => null);
    if (thread) {
      await thread.edit({ name: p.name, appliedTags: tag ? [tag] : [] });
      const starter = await thread.fetchStarterMessage().catch(() => null);
      if (starter) await starter.edit(payload);
    } else {
      thread = await forum.threads.create({ name: p.name, message: payload, appliedTags: tag ? [tag] : [] });
      log('project posted', p.name);
    }
    state.messages[key] = thread.id;
    save();
  }
  // Pin Horizon on top of the forum.
  const horizon = await guild.channels.fetch(state.messages['project:Horizon']).catch(() => null);
  if (horizon && !horizon.flags.has('Pinned')) await horizon.pin().catch((e) => log('pin', e.message));
}

async function automod(guild) {
  const existing = await guild.autoModerationRules.fetch();
  const alert = { type: A.SendAlertMessage, metadata: { channel: state.channels.modlog } };
  const block = (msg) => ({ type: A.BlockMessage, metadata: { customMessage: msg } });
  const exempt = { exemptRoles: [state.roles.mod] };
  const rules = [
    { name: 'Kira · spam', triggerType: T.Spam, actions: [block('Kira blocked this as spam.'), alert], ...exempt },
    { name: 'Kira · slurs and sexual content', triggerType: T.KeywordPreset, triggerMetadata: { presets: [Preset.Slurs, Preset.SexualContent] }, actions: [block('That word is not allowed here (rule 1 and 5).'), alert], ...exempt },
    { name: 'Kira · mention spam', triggerType: T.MentionSpam, triggerMetadata: { mentionTotalLimit: 5, mentionRaidProtectionEnabled: true }, actions: [block('Too many mentions.'), alert, { type: A.Timeout, metadata: { durationSeconds: 600 } }], ...exempt },
    {
      name: 'Kira · invites and scams', triggerType: T.Keyword,
      triggerMetadata: {
        regexPatterns: [
          'discord(?:app)?\\.(?:gg|com/invite|io|me|li)/\\S+',
          '(?i)free\\s*nitro', '(?i)nitro\\s*(?:for\\s*)?free', '(?i)steam\\s*gift',
          'd[il1][sz]c[o0]r[dcl][a-z]*\\.(?:gift|ru|xyz|top|click|link)',
        ],
      },
      actions: [block('Server invites and gift links are not allowed (rule 2 and 4).'), alert], ...exempt,
    },
    { name: 'Kira · bad names', triggerType: T.MemberProfile, triggerMetadata: { keywordFilter: ['*nigg*', '*fagg*', '*hitler*', '*nazi*', '*discord.gg*'] }, actions: [{ type: A.BlockMemberInteraction }], ...exempt },
  ];
  for (const r of rules) {
    const data = { ...r, eventType: r.triggerType === T.MemberProfile ? AutoModerationRuleEventType.MemberUpdate : AutoModerationRuleEventType.MessageSend, enabled: true };
    const found = existing.find((e) => e.name === r.name);
    try {
      if (found) await found.edit(data);
      else { await guild.autoModerationRules.create(data); log('automod rule', r.name); }
    } catch (e) { log('automod', r.name, e.message); }
  }
}

async function onboarding(guild) {
  let n = 0;
  const id = () => String(((BigInt(Date.now()) - 1420070400000n) << 22n) + BigInt(n++));
  const c = state.channels, r = state.roles;
  const option = (emoji, title, description, roles, channels) => ({ id: id(), emoji_name: emoji, title, description, role_ids: roles.filter(Boolean), channel_ids: channels.filter(Boolean) });
  await client.rest.put(Routes.guildOnboarding(guild.id), {
    body: {
      enabled: true,
      mode: 0,
      // Everyone sees these; the answers below add the rest.
      default_channel_ids: ['welcome', 'rules', 'faq', 'announcements', 'general', 'introductions', 'offtopic', 'memes', 'resources', 'halloffame', 'botcommands', 'horizoninfo', 'projects', 'releases'].map((k) => c[k]),
      prompts: [
        {
          id: id(), type: 0, title: 'What are you here for?', single_select: false, required: false, in_onboarding: true,
          options: [
            option('🌅', 'Horizon', 'Minecraft rewritten in Rust: news, bugs, ideas', [r.horizon], [c.horizonchat, c.horizonbugs, c.horizonideas]),
            option('🤖', 'Vibe coding', 'Building with Claude Code, Codex and agents', [r.ai], [c.aicoding, c.rewrites, c.communityprojects, c.help]),
            option('🧩', 'Mods and rewrites', 'Decompiles, ports, reverse engineering', [r.modder], [c.rewrites, c.communityprojects]),
            option('🎬', 'Making videos', 'YouTube, editing, thumbnails', [], [c.creatorschat, c.videofeedback, c.hire]),
            option('🎤', 'Music', 'Rap, beats, collabs', [], [c.musicchat, c.beats, c.collabs, c.trackposts]),
            option('🛠️', "Ludovic's apps", 'lsuite, DISPO and the rest', [], [c.feedback]),
          ],
        },
        {
          id: id(), type: 0, title: 'What do you make?', single_select: false, required: false, in_onboarding: true,
          options: [
            option('💻', 'Code', 'Apps, games, tools, with or without AI', [r.ai], [c.communityprojects, c.help]),
            option('🎬', 'YouTube videos', 'I run a channel', [r.youtuber], [c.creatorschat, c.videofeedback, c.hire]),
            option('✂️', 'Edits', "I'm a video editor", [r.editor], [c.creatorschat, c.videofeedback, c.hire]),
            option('🖼️', 'Thumbnails', 'I design thumbnails', [r.designer], [c.creatorschat, c.videofeedback, c.hire]),
            option('🥁', 'Beats', "I'm a beatmaker", [r.beatmaker], [c.musicchat, c.beats, c.collabs]),
            option('🎤', 'Raps', "I'm a rapper", [r.rapper], [c.musicchat, c.beats, c.collabs, c.trackposts]),
            option('🎶', 'Singing', 'Hooks, R&B, toplines', [r.singer], [c.musicchat, c.collabs, c.trackposts]),
            option('👀', 'Nothing yet', "I'm here to watch and hang out", [], [c.general, c.memes]),
          ],
        },
        {
          id: id(), type: 0, title: 'Want to be pinged?', single_select: false, required: false, in_onboarding: true,
          options: [
            option('🔔', 'New videos', 'When a video comes out', [r.videos], []),
            option('📦', 'New releases', 'When Horizon, lsuite or another project ships', [r.releases], []),
          ],
        },
      ],
    },
  });
  log('onboarding: 3 questions');
}

// The Server Guide (Discord's "home" for newcomers): a welcome from Ludovic, first steps, useful channels.
async function serverGuide(guild) {
  const c = state.channels;
  const action = (key, type, title, description, emoji) => ({ channel_id: c[key], action_type: type, title, description, emoji: { name: emoji } });
  const res = (key, title, description, emoji) => ({ channel_id: c[key], title, description, emoji: { name: emoji } });
  const body = {
    enabled: true,
    welcome_message: {
      author_ids: [OWNER_ID],
      message: "Welcome to my community! I'm Ludovic: I direct AI agents to build software (like Horizon, Minecraft rewritten in Rust) and I make videos about it. Here you'll find people who build with AI, make videos and make music. Do the steps below, and have fun.",
    },
    new_member_actions: [
      action('rules', 0, 'Read the rules', 'Kira enforces them, day and night', '📜'),
      action('welcome', 0, 'Pick your roles', 'Buttons in #welcome: pings and what you make', '🎭'),
      action('introductions', 1, 'Introduce yourself', 'One message, with the template', '👋'),
      action('faq', 0, 'Read the FAQ', 'Where to post what, levels, voice rooms', '❓'),
      action('general', 1, 'Say hi in #general', 'Talk about anything', '💬'),
    ],
    // Resource pages must be channels only staff post in.
    resource_channels: [
      res('horizoninfo', 'Horizon', 'Minecraft in Rust: download, roadmap, disclaimer', '🌅'),
      res('projects', "Ludovic's projects", 'Every project, with its links', '🛠️'),
      res('faq', 'FAQ', 'Where to post what, levels, voice rooms, the mods', '❓'),
      res('releases', 'Releases', 'Every new version of the projects', '📦'),
    ],
  };
  try {
    await client.rest.put(`/guilds/${guild.id}/new-member-welcome`, { body });
    log('server guide on');
  } catch (e) {
    log('server guide: bots cannot set it; applied from Ludovic\'s session instead (body saved in state.serverGuide)');
    state.serverGuide = body; // so it can be applied another way
    save();
  }
}

async function invite(guild) {
  const welcome = guild.channels.cache.get(state.channels.welcome);
  const invites = await guild.invites.fetch();
  let inv = state.invite && invites.get(state.invite);
  if (!inv) {
    inv = await welcome.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: 'Permanent invite (video description, portfolio)' });
    state.invite = inv.code;
    save();
  }
  return `https://discord.gg/${inv.code}`;
}

client.once('clientReady', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.channels.fetch();
    await guild.roles.fetch();
    await ensureRoles(guild);
    await ensureChannels(guild, guild.features.includes('COMMUNITY'));
    await enableCommunity(guild);
    await guild.fetch();
    await ensureChannels(guild, true); // forums and the announcement channel, now that Community is on
    await order(guild);
    await posts(guild);
    await automod(guild);
    await onboarding(guild);
    await serverGuide(guild);
    console.log('invite', await invite(guild));
    console.log('done');
  } catch (e) {
    console.error(e.rawError ? JSON.stringify(e.rawError.errors ?? e.rawError, null, 1) : e);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});

client.login(process.env.DISCORD_TOKEN);
