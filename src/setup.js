// Makes the server match config.js: settings, roles, channels, Community, texts, AutoMod, Onboarding, invite.
// Safe to run again: everything is found by the ID it got the first time (data/state.json) and updated.
import {
  Client, GatewayIntentBits, ChannelType, PermissionFlagsBits as P,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Routes,
  GuildVerificationLevel, GuildExplicitContentFilter, GuildDefaultMessageNotifications,
  ForumLayoutType, SortOrderType, ChannelFlags,
} from 'discord.js';
import { GUILD_ID, OWNER_ID, SERVER, LINKS, COLOR, ROLES, RETIRED_ROLES, LAYOUT, RETIRED, REPLACED, PINS, WELCOME, RULES, RULES_FOOTER, FAQ, FAQ_MORE, HORIZON, OFFICIAL_SERVER, HOWTO, DEFAULT_CHANNELS } from './config.js';
import { screeningBody, screeningUpToDate } from './screening.js';
import { applyAutomod } from './automod.js';
import { overwrites as permissionOverwrites } from './permissions.js';
import { load, save, claim } from './store.js';
import { unique, isCopy, ensureThread } from './adopt.js';
import { linkify, rolesMessage, howToPost } from './texts.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exportChannel } from './archive.js';
import { createHash } from 'node:crypto';

const TYPES = { text: ChannelType.GuildText, voice: ChannelType.GuildVoice, forum: ChannelType.GuildForum, announcement: ChannelType.GuildAnnouncement };
claim('setup');
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
  await guild.members.fetch();
  // Roles of the old scope: deleted when nobody holds them, else kept as they are (never lossy).
  for (const key of RETIRED_ROLES) {
    const role = guild.roles.cache.get(state.roles[key]);
    if (role?.members.size) { log('kept retired role', role.name, `(${role.members.size} members hold it)`); continue; }
    if (role) { await role.delete('No longer used: the server is Horizon\'s only'); log('role removed', role.name); }
    delete state.roles[key];
  }
  save();
  for (const spec of ROLES) {
    let role = guild.roles.cache.get(state.roles[spec.key] ?? state.roles[spec.was]);
    if (spec.managed) role ??= guild.roles.cache.find((r) => r.tags?.premiumSubscriberRole);
    role ??= guild.roles.cache.find((r) => r.name === spec.name);
    const data = { name: spec.name, colors: { primaryColor: spec.color }, hoist: !!spec.hoist, mentionable: !!spec.mentionable };
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

const overwrites = (guild, spec, staffCategory) => permissionOverwrites(
  { everyone: guild.roles.everyone.id, mod: state.roles.mod, kira: guild.members.me.id, owner: OWNER_ID, roles: state.roles }, spec, staffCategory);

// Channels another one replaced (REPLACED): every message exported to scratch/replaced-channels-<date>/ (not
// committed), then the channel deleted. A failed export keeps the channel (setup stops, nothing is lost).
async function replaced(guild) {
  const dir = fileURLToPath(new URL(`../scratch/replaced-channels-${new Date().toISOString().slice(0, 10)}/`, import.meta.url));
  for (const { key, name, by } of REPLACED) {
    const ch = guild.channels.cache.get(state.channels[key]) ?? unique([...guild.channels.cache.filter((c) => c.name === name && c.isTextBased() && !c.isVoiceBased()).values()], `channel #${name}`);
    if (ch) {
      const n = await exportChannel(ch, name, dir);
      log('exported', `#${name}:`, n, 'messages →', dir);
      await ch.delete(`Replaced by #${by}`);
      log('removed', name, `(replaced by #${by})`);
    }
    delete state.channels[key];
    save();
  }
  if (state.messages.workguide) { delete state.messages.workguide; save(); } // the guide of #work-board
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
    let cat = guild.channels.cache.get(state.channels[ckey])
      ?? unique([...guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory && c.name === group.category).values()], `category ${group.category}`);
    if (cat && !state.channels[ckey]) log('category found', group.category);
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
      const sameKind = (c) => c.type === type || (c.isTextBased() && !c.isVoiceBased() && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(type) && c.type !== ChannelType.GuildForum);
      if (spec.was && !state.channels[spec.key] && state.channels[spec.was]) { state.channels[spec.key] = state.channels[spec.was]; delete state.channels[spec.was]; delete state.messages['howto:' + spec.was]; }
      let ch = guild.channels.cache.get(state.channels[spec.key])
        ?? unique([...guild.channels.cache.filter((c) => c.name === spec.name && sameKind(c) && !state.rooms?.[c.id]).values()], `channel #${spec.name}`);
      if (ch && !state.channels[spec.key]) log('channel found', spec.name);
      const data = { name: spec.name, parent: cat.id, permissionOverwrites: overwrites(guild, spec, group.staff) };
      if (spec.type === 'voice') data.bitrate = bitrate;
      else { data.topic = spec.topic ?? null; data.rateLimitPerUser = spec.slowmode ?? 0; }
      if (spec.type === 'forum') {
        const existing = ch?.availableTags ?? [];
        const tags = spec.template ? [HOWTO.tag, ...spec.tags] : spec.tags; // the guide post carries the "read me" tag
        data.availableTags = tags.map(([emoji, name, staffOnly]) => ({ ...(existing.find((t) => t.name === name) ?? {}), name, emoji: { id: null, name: emoji }, moderated: !!staffOnly }));
        data.topic = linkify(`${spec.topic}\n\n${spec.guide ?? ''}${spec.template ? `\n\n**Template:**\n${spec.template}` : ''}`, state).slice(0, 4096);
        data.defaultForumLayout = spec.gallery ? ForumLayoutType.GalleryView : ForumLayoutType.ListView;
        data.defaultSortOrder = SortOrderType.CreationDate;
        data.defaultReactionEmoji = spec.reaction ? { id: null, name: spec.reaction } : null;
        data.rateLimitPerUser = Math.min(spec.every ?? 0, 21600);            // time between two posts by the same member
        data.defaultThreadRateLimitPerUser = 0;              // and between two replies inside a post (none)
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
    name: SERVER.name,
    description: SERVER.description,
    preferredLocale: 'en-US',
  };
  if (!guild.features.includes('COMMUNITY')) settings.features = [...guild.features, 'COMMUNITY'];
  await guild.edit(settings);
  log('community', settings.features ? 'enabled' : 'on');
  // Kira's About me: the application's description.
  const app = await client.rest.get(Routes.currentApplication());
  if (app.description !== SERVER.about) {
    await client.rest.patch(Routes.currentApplication(), { body: { description: SERVER.about } });
    log('about me updated');
  }
  // The server icon: uploaded again only when the file changes (state.icon is its hash).
  const icon = readFileSync(new URL(`../${SERVER.icon}`, import.meta.url));
  const hash = createHash('sha256').update(icon).digest('hex');
  if (state.icon !== hash || !guild.icon) {
    await guild.setIcon(icon);
    state.icon = hash;
    save();
    log('server icon set');
  }
}

// Sends a message once and keeps editing that same message on later runs.
async function upsert(guild, key, channelKey, payload) {
  const ch = guild.channels.cache.get(state.channels[channelKey]);
  let msg = state.messages[key] && await ch.messages.fetch(state.messages[key]).catch(() => null);
  if (!msg) {
    const copies = [...(await ch.messages.fetch({ limit: 50 })).filter((m) => isCopy(m, client.user.id, payload)).values()];
    msg = unique(copies, `the message ${key}`);
    if (msg) log('message found', key);
  }
  if (msg) await msg.edit(payload);
  else { msg = await ch.send(payload); log('posted', key); }
  state.messages[key] = msg.id;
  save();
  return msg;
}

// The guide of one forum: found by the ID in the state, else by its name among Kira's posts of that forum
// (active and archived), else made. Found twice → setup stops. Then locked and pinned.
async function howTo(guild, spec) {
  const forum = guild.channels.cache.get(state.channels[spec.key]);
  const key = 'howto:' + spec.key;
  const payload = howToPost(spec, state);
  const readMe = forum.availableTags.find((t) => t.name === HOWTO.tag[1])?.id;
  const { thread, created } = await ensureThread({
    id: state.messages[key],
    fetchById: (id) => guild.channels.fetch(id),
    list: async () => {
      const active = (await forum.threads.fetchActive()).threads;
      const archived = (await forum.threads.fetchArchived({ type: 'public', limit: 100 })).threads;
      return [...active.values(), ...archived.values()];
    },
    match: (t) => t.parentId === forum.id && t.ownerId === client.user.id && t.name === HOWTO.name,
    create: () => forum.threads.create({ name: HOWTO.name, message: payload, appliedTags: readMe ? [readMe] : [] }),
    label: `the "${HOWTO.name}" post of #${spec.name}`,
  });
  state.messages[key] = thread.id;
  save(); // right away: a crash later must not make it post the guide again
  if (created) log('how-to posted', spec.name);
  else {
    if (thread.archived) await thread.setArchived(false).catch(() => {});
    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (starter) await starter.edit(payload);
    if (thread.name !== HOWTO.name) await thread.setName(HOWTO.name).catch(() => {});
    log('how-to found', spec.name);
  }
  if (!thread.locked) await thread.setLocked(true).catch(() => {});
  if (!thread.flags.has('Pinned')) await thread.pin().catch((e) => log('pin', spec.name, e.message));
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
    embeds: [FAQ, FAQ_MORE].map((list, i) => new EmbedBuilder().setColor(COLOR).setTitle(i ? '❓ More questions' : '❓ FAQ').setDescription(L(list.map(([q, a]) => `**${q}**\n${a}`).join('\n\n')).slice(0, 4096))),
  });
  for (const group of LAYOUT) for (const spec of group.channels) {
    if (spec.pin) {
      const msg = await upsert(guild, 'pin:' + spec.key, spec.key, { content: L(PINS[spec.pin]) });
      if (!msg.pinned) await msg.pin().catch(() => {});
    }
    // Each forum with a template gets ONE locked, pinned "How to post here" post: its guide and template.
    if (spec.type === 'forum' && spec.template) await howTo(guild, spec);
  }
  await upsert(guild, 'horizon', 'horizoninfo', {
    embeds: [
      new EmbedBuilder().setColor(COLOR).setTitle('🌅 Horizon').setURL(LINKS.horizon).setDescription(HORIZON.description)
        .addFields(
          { name: 'Get it', value: HORIZON.get },
          { name: 'Talk about it', value: L('#horizon-chat · bugs: `/report` or #horizon-bugs · ideas: `/suggest` or #horizon-ideas') },
          { name: "What's happening", value: L(`${LINKS.hub}: the roadmap, the kanban, the journal and how to help · what changed: #updates · \`/roadmap\``) },
        ),
      new EmbedBuilder().setColor(0x555555).setTitle('⚠️ Disclaimer').setDescription(HORIZON.disclaimer),
    ],
    components: linkRows([['playhorizon.dev', LINKS.horizonSite], ['The hub', LINKS.hub], ['Download the launcher', LINKS.horizonLauncher], ['GitHub', LINKS.horizon]]),
  });
  await upsert(guild, 'officialserver', 'officialserver', {
    embeds: [
      new EmbedBuilder().setColor(COLOR).setTitle(`🏕️ ${OFFICIAL_SERVER.name}`).setDescription(OFFICIAL_SERVER.description)
        .addFields(
          { name: 'Address', value: `\`${OFFICIAL_SERVER.address}\`` },
          { name: 'Join', value: OFFICIAL_SERVER.join },
          { name: 'A problem?', value: L(OFFICIAL_SERVER.problems) },
        ),
    ],
  });
  // The old catalogue of Ludovic's projects (#projects) was deleted with the server's old scope.
  for (const key of Object.keys(state.messages)) if (key.startsWith('project:')) delete state.messages[key];
  save();
}

const automod = (guild) => applyAutomod(guild, { modlog: state.channels.modlog, modchat: state.channels.modchat, mod: state.roles.mod, team: state.roles.team }, log);

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
      default_channel_ids: DEFAULT_CHANNELS.map((k) => c[k]),
      prompts: [
        {
          id: id(), type: 0, title: 'What brings you to Horizon?', single_select: false, required: false, in_onboarding: true,
          options: [
            option('🎮', 'Playing it', 'Download, help, chat, share your creations', [], [c.horizoninfo, c.horizonchat, c.showcase]),
            option('🐛', 'Testing and bug reports', 'Find bugs and report them', [], [c.horizonbugs, c.releases]),
            option('💡', 'Ideas', 'Suggest and vote on what comes next', [], [c.horizonideas]),
            // No role: 🛠️ Contributor is earned with a merged PR and /verify-github (src/features/contributors.js).
            option('🛠️', 'Contributing code', 'Claim an issue, follow what gets merged, connect your AI agent', [], [c.updates, c.horizoninfo, c.contributors]),
            option('🧩', 'Modding', 'Make or use mods for Horizon', [r.modder], [c.horizonideas]),
            option('👀', 'Just following', 'News and hanging out', [], [c.general, c.announcements]),
          ],
        },
        {
          id: id(), type: 0, title: 'Want to be pinged?', single_select: false, required: false, in_onboarding: true,
          options: [
            option('📣', 'Big news', 'Major Horizon announcements', [r.horizon], []),
            option('📦', 'Every release', 'Each new Horizon version and launcher', [r.releases], []),
            option('🎬', 'New videos', "Ludovic's new YouTube videos", [r.newvideos], []),
          ],
        },
      ],
    },
  });
  log('onboarding: 2 questions');
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
      message: "Welcome to Horizon! I'm Ludovic: Horizon is Minecraft Java Edition rewritten in Rust, built with AI agents and contributors. Get it at playhorizon.dev, /report what breaks, /suggest ideas, and follow the work at playhorizon.dev/hub. Not affiliated with Mojang or Microsoft.",
    },
    new_member_actions: [
      action('rules', 0, 'Read the rules', 'Kira enforces them, day and night', '📜'),
      action('horizoninfo', 0, 'Get Horizon', 'Download the launcher, see what it is', '🌅'),
      action('welcome', 0, 'Pick your roles', 'Pings for news, releases and videos, modder', '🎭'),
      action('introductions', 1, 'Introduce yourself', 'One message, with the template', '👋'),
      action('horizonchat', 1, 'Say hi in #horizon-chat', 'Talk about Horizon', '💬'),
    ],
    // Resource pages must be channels only staff post in.
    resource_channels: [
      res('horizoninfo', 'Horizon', 'What it is, the download, the disclaimer', '🌅'),
      res('faq', 'FAQ', 'Downloading, bug reports, contributing, the mods', '❓'),
      res('releases', 'Releases', 'Every new version and launcher', '📦'),
      res('updates', 'Updates', 'What got merged, releases, the week, the board at a glance', '🗞️'),
    ],
  };
  try {
    await client.rest.put(`/guilds/${guild.id}/new-member-welcome`, { body });
    log('server guide on');
  } catch (e) {
    log('server guide: bots cannot set it ("Bots cannot use this endpoint"): Ludovic applies state.serverGuide by hand in Server Settings → Onboarding');
    state.serverGuide = body; // so it can be applied another way
    save();
  }
}

// Rules screening: new members read the rules and agree before they talk. Built from RULES, only ever turned on.
async function screening(guild) {
  const route = `/guilds/${guild.id}/member-verification`;
  const body = screeningBody(RULES);
  try {
    const current = await client.rest.get(route).catch(() => null);
    if (screeningUpToDate(current, body, guild.features.includes('MEMBER_VERIFICATION_GATE_ENABLED'))) return log('rules screening up to date');
    await client.rest.patch(route, { body });
    log('rules screening on,', body.form_fields[0].values.length, 'rules');
  } catch (e) {
    log('rules screening:', e.message); // setup goes on; screening is left as it is (never switched off)
  }
}

async function invite(guild) {
  const welcome = guild.channels.cache.get(state.channels.welcome);
  const invites = await guild.invites.fetch();
  let inv = state.invite && invites.get(state.invite);
  inv ??= invites.find((i) => i.inviterId === client.user.id && i.maxAge === 0 && i.maxUses === 0 && i.channelId === state.channels.welcome);
  if (!inv) {
    inv = await welcome.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: 'Permanent invite (playhorizon.dev, README)' });
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
    await replaced(guild); // after the channels that replace them exist
    await onboarding(guild);
    await serverGuide(guild);
    await order(guild);
    await posts(guild);
    await automod(guild);
    await screening(guild);
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
