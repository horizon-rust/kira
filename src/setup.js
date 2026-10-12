// Makes the server match config.js: settings, roles, channels, Community, texts, AutoMod, Onboarding, invite.
// Safe to run again: everything is found by the ID it got the first time (data/state.json) and updated.
import {
  Client, GatewayIntentBits, ChannelType, PermissionFlagsBits as P, OverwriteType,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Routes,
  GuildVerificationLevel, GuildExplicitContentFilter, GuildDefaultMessageNotifications,
  AutoModerationRuleTriggerType as T, AutoModerationRuleEventType, AutoModerationActionType as A, AutoModerationRuleKeywordPresetType as Preset,
} from 'discord.js';
import { GUILD_ID, LINKS, COLOR, ROLES, LAYOUT, WELCOME, RULES, RULES_FOOTER, HORIZON, PROJECTS } from './config.js';
import { load, save } from './store.js';

const TYPES = { text: ChannelType.GuildText, voice: ChannelType.GuildVoice, forum: ChannelType.GuildForum, announcement: ChannelType.GuildAnnouncement };
const state = load();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
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
    let role = guild.roles.cache.get(state.roles[spec.key]) ?? guild.roles.cache.find((r) => r.name === spec.name);
    const data = {
      name: spec.name, colors: { primaryColor: spec.color }, hoist: !!spec.hoist, mentionable: !!spec.mentionable,
      permissions: (spec.permissions ?? []).map((p) => P[p]),
    };
    if (role) await role.edit(data);
    else { role = await guild.roles.create(data); log('role created', spec.name); }
    state.roles[spec.key] = role.id;
  }
  // Order: the list is lowest first, with Kira's own role above all of them (so it can moderate everyone).
  await guild.roles.setPositions([
    ...ROLES.map((spec, i) => ({ role: state.roles[spec.key], position: i + 1 })),
    { role: me.roles.botRole.id, position: ROLES.length + 1 },
  ]);
  save();
}

function overwrites(guild, spec, staffCategory) {
  const everyone = guild.roles.everyone.id;
  const mod = state.roles.mod;
  const kira = guild.members.me.id;
  const ow = [{ id: kira, type: OverwriteType.Member, allow: [P.ViewChannel, P.SendMessages, P.ManageMessages, P.ManageThreads, P.EmbedLinks, P.AddReactions] }];
  if (spec.staff || staffCategory) {
    ow.push({ id: everyone, type: OverwriteType.Role, deny: [P.ViewChannel] }, { id: mod, type: OverwriteType.Role, allow: [P.ViewChannel, P.SendMessages] });
  } else if (spec.readonly) {
    ow.push(
      { id: everyone, type: OverwriteType.Role, deny: [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads] },
      { id: mod, type: OverwriteType.Role, allow: [P.SendMessages] },
    );
  } else if (spec.posts === 'staff') {
    ow.push({ id: everyone, type: OverwriteType.Role, deny: [P.SendMessages], allow: [P.SendMessagesInThreads] }, { id: mod, type: OverwriteType.Role, allow: [P.SendMessages] });
  }
  return ow;
}

async function ensureChannels(guild, community) {
  for (const group of LAYOUT) {
    let cat = guild.channels.cache.get(state.channels['cat:' + group.category]);
    const catData = { name: group.category, type: ChannelType.GuildCategory, permissionOverwrites: group.staff ? overwrites(guild, { staff: true }) : [] };
    if (cat) await cat.edit(catData);
    else { cat = await guild.channels.create(catData); log('category created', group.category); }
    state.channels['cat:' + group.category] = cat.id;

    for (const spec of group.channels) {
      const wanted = TYPES[spec.type];
      // Forums and announcement channels need Community: until it's on, announcements is a text channel and forums wait.
      if (!community && spec.type === 'forum') continue;
      const type = !community && spec.type === 'announcement' ? ChannelType.GuildText : wanted;
      let ch = guild.channels.cache.get(state.channels[spec.key]);
      if (!ch && spec.adopt) ch = guild.channels.cache.find((c) => c.name === spec.adopt && c.type === wanted && !Object.values(state.channels).includes(c.id));
      const data = { name: spec.name, parent: cat.id, permissionOverwrites: overwrites(guild, spec, group.staff) };
      if (spec.type !== 'voice') { data.topic = spec.topic ?? null; data.rateLimitPerUser = spec.slowmode ?? 0; }
      if (spec.type === 'forum') {
        const existing = ch?.availableTags ?? [];
        data.availableTags = spec.tags.map((name) => existing.find((t) => t.name === name) ?? { name });
      }
      if (ch && ch.type !== type) await ch.setType(type);
      if (ch) await ch.edit(data);
      else { ch = await guild.channels.create({ ...data, type }); log('channel created', spec.name); }
      state.channels[spec.key] = ch.id;
    }
  }
  save();
}

// Puts categories and channels in the order of LAYOUT, and removes Discord's default empty categories.
async function order(guild) {
  await guild.channels.fetch();
  for (const name of ['Text Channels', 'Voice Channels']) {
    const cat = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === name);
    if (cat && !guild.channels.cache.some((c) => c.parentId === cat.id)) { await cat.delete('Empty default category'); log('removed', name); }
  }
  const positions = [];
  LAYOUT.forEach((group, i) => {
    positions.push({ channel: state.channels['cat:' + group.category], position: i });
    group.channels.forEach((spec, j) => positions.push({ channel: state.channels[spec.key], position: j }));
  });
  await guild.channels.setPositions(positions.filter((p) => p.channel));
}

async function enableCommunity(guild) {
  const settings = {
    verificationLevel: GuildVerificationLevel.Medium, // verified e-mail, account older than 5 minutes
    explicitContentFilter: GuildExplicitContentFilter.AllMembers,
    defaultMessageNotifications: GuildDefaultMessageNotifications.OnlyMentions,
    systemChannel: null, // Kira greets newcomers itself
    rulesChannel: state.channels.rules,
    publicUpdatesChannel: state.channels.discordupdates,
    description: 'The community of Ludovic: AI coding, Horizon (Minecraft in Rust), lsuite and the rest.',
    preferredLocale: 'en-US',
  };
  if (!guild.features.includes('COMMUNITY')) settings.features = [...guild.features, 'COMMUNITY'];
  await guild.edit(settings);
  log('community', settings.features ? 'enabled' : 'already on');
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
  const ch = (k) => `<#${state.channels[k]}>`;
  await upsert(guild, 'welcome', 'welcome', {
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle(WELCOME.title).setDescription(
      WELCOME.description.replace('Read the rules', `Read ${ch('rules')}`),
    )],
    components: linkRows(WELCOME.links),
  });
  await upsert(guild, 'rules', 'rules', {
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle('Rules')
      .setDescription(RULES.map(([t, d], i) => `**${i + 1}. ${t}**\n${d}`).join('\n\n')
        .replace('#showcase', ch('showcase')).replace('#horizon-bugs', ch('horizonbugs'))
        .replace('#horizon-suggestions', ch('horizonideas')).replace('#feedback', ch('feedback')).replace('#off-topic', ch('offtopic')))
      .setFooter({ text: RULES_FOOTER })],
    components: linkRows([['Discord Community Guidelines', 'https://discord.com/guidelines']]),
  });
  await upsert(guild, 'horizon', 'horizoninfo', {
    embeds: [
      new EmbedBuilder().setColor(COLOR).setTitle('🌅 Horizon').setURL(LINKS.horizon).setDescription(HORIZON.description)
        .addFields(
          { name: 'Get it', value: HORIZON.get },
          { name: 'Roadmap', value: HORIZON.roadmap },
          { name: 'Talk about it', value: `${ch('horizonchat')} · ideas in ${ch('horizonideas')} · bugs in ${ch('horizonbugs')}` },
        ),
      new EmbedBuilder().setColor(0x555555).setTitle('⚠️ Disclaimer').setDescription(HORIZON.disclaimer),
    ],
    components: linkRows([['GitHub', LINKS.horizon], ['The video', LINKS.youtube]]),
  });

  // One post per project in the #projects forum.
  const forum = guild.channels.cache.get(state.channels.projects);
  for (const p of PROJECTS) {
    const key = 'project:' + p.name;
    const embed = new EmbedBuilder().setColor(COLOR).setTitle(p.name).setDescription(p.text);
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
  ];
  for (const r of rules) {
    const data = { ...r, eventType: AutoModerationRuleEventType.MessageSend, enabled: true };
    const found = existing.find((e) => e.name === r.name);
    if (found) await found.edit(data);
    else { await guild.autoModerationRules.create(data); log('automod rule', r.name); }
  }
}

async function onboarding(guild) {
  let n = 0;
  const id = () => String(((BigInt(Date.now()) - 1420070400000n) << 22n) + BigInt(n++));
  const c = state.channels, r = state.roles;
  const option = (emoji, title, description, roles, channels) => ({ id: id(), emoji_name: emoji, title, description, role_ids: roles, channel_ids: channels });
  await client.rest.put(Routes.guildOnboarding(guild.id), {
    body: {
      enabled: true,
      mode: 0,
      default_channel_ids: ['welcome', 'rules', 'announcements', 'general', 'introductions', 'offtopic', 'memes', 'aicoding', 'showcase', 'horizoninfo', 'horizonchat', 'projects', 'releases'].map((k) => c[k]),
      prompts: [
        {
          id: id(), type: 0, title: 'What brings you here?', single_select: false, required: false, in_onboarding: true,
          options: [
            option('🌅', 'Horizon', 'Minecraft rewritten in Rust', [r.horizon], [c.horizonideas, c.horizonbugs]),
            option('🤖', 'AI coding', 'Building with Claude Code, Codex and agents', [r.ai], [c.rewrites, c.help]),
            option('🧩', 'Modding', 'Mods, rewrites and reverse engineering', [r.modder], [c.rewrites]),
            option('🎨', 'Creating', 'Music, video, images: lsuite and DISPO', [r.creator], [c.feedback]),
            option('📺', 'Just the videos', 'I watch the YouTube channel', [r.videos], []),
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
  log('onboarding on');
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
    console.log('invite', await invite(guild));
    console.log('done');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});

client.login(process.env.DISCORD_TOKEN);
