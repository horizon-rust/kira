// Voice rooms: join "➕ create your room" and Kira makes you your own voice channel, which you control
// with /room and which disappears when it's empty. And /pull, to bring someone into your voice channel.
// The owner gets no MuteMembers: with it, a member the staff server-muted could make a room and unmute themselves.
import { SlashCommandBuilder, ChannelType, PermissionFlagsBits as P, MessageFlags, OverwriteType } from 'discord.js';
import { GUILD_ID } from '../config.js';
import { client, state, save, modlog } from '../core.js';

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

async function createRoom(member) {
  const lobby = member.voice.channel;
  const room = await member.guild.channels.create({
    name: `🔊 ${member.displayName}'s room`.slice(0, 100),
    type: ChannelType.GuildVoice,
    parent: lobby.parentId,
    bitrate: member.guild.maximumBitrate,
    permissionOverwrites: [
      { id: member.id, type: OverwriteType.Member, allow: [P.Connect, P.Speak, P.MoveMembers, P.ManageChannels] },
      { id: client.user.id, type: OverwriteType.Member, allow: [P.ViewChannel, P.Connect, P.ManageChannels, P.MoveMembers] },
    ],
    reason: `room for ${member.user.tag}`,
  });
  state.rooms[room.id] = member.id;
  save();
  await member.voice.setChannel(room).catch(async () => { await room.delete().catch(() => {}); delete state.rooms[room.id]; save(); });
  await room.send(`👋 <@${member.id}>, this room is yours. \`/room lock\` so only the people you invite can join, \`/room invite\` someone, \`/room limit\`, \`/room rename\`, \`/room private\` to hide it. It disappears when everyone leaves.`).catch(() => {});
}

async function cleanup(channelId) {
  if (!state.rooms[channelId]) return;
  const ch = client.channels.cache.get(channelId);
  if (ch && ch.members.size > 0) return;
  delete state.rooms[channelId];
  save();
  await ch?.delete('empty room').catch(() => {});
}

export const commands = [
  new SlashCommandBuilder().setName('room').setDescription('Control your voice room')
    .addSubcommand((s) => s.setName('lock').setDescription('Only the people you invite can join'))
    .addSubcommand((s) => s.setName('unlock').setDescription('Anyone can join'))
    .addSubcommand((s) => s.setName('private').setDescription('Hide the room from everyone you have not invited'))
    .addSubcommand((s) => s.setName('public').setDescription('Show the room to everyone again'))
    .addSubcommand((s) => s.setName('invite').setDescription('Let someone in (even when locked)').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)))
    .addSubcommand((s) => s.setName('kick').setDescription('Remove someone and keep them out').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)))
    .addSubcommand((s) => s.setName('limit').setDescription('Maximum number of people (0 = no limit)').addIntegerOption((o) => o.setName('people').setDescription('0-99').setRequired(true).setMinValue(0).setMaxValue(99)))
    .addSubcommand((s) => s.setName('rename').setDescription('Rename the room').addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(90)))
    .addSubcommand((s) => s.setName('claim').setDescription('Take over the room if its owner left'))
    .addSubcommand((s) => s.setName('transfer').setDescription('Give the room to someone in it').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true))),
  new SlashCommandBuilder().setName('pull').setDescription('Move someone into your voice channel').setDefaultMemberPermissions(P.MoveMembers)
    .addUserOption((o) => o.setName('member').setDescription('Who (or leave it empty to bring everyone from the waiting room)')),
];

export const handlers = {
  async room(i) {
    const sub = i.options.getSubcommand();
    const room = i.member.voice.channel;
    if (!room || !state.rooms[room.id]) return i.reply(ephemeral('Join your room first (join **➕ create your room** to make one).'));
    const owner = state.rooms[room.id];
    if (sub === 'claim') {
      if (room.members.has(owner)) return i.reply(ephemeral('Its owner is still here.'));
      state.rooms[room.id] = i.user.id; save();
      await room.permissionOverwrites.edit(i.user.id, { Connect: true, Speak: true, MoveMembers: true, ManageChannels: true });
      return i.reply(ephemeral('The room is yours now.'));
    }
    if (owner !== i.user.id) return i.reply(ephemeral(`Only <@${owner}> controls this room (or \`/room claim\` once they leave).`));
    const everyone = i.guild.roles.everyone;
    const who = i.options.getUser('member');
    switch (sub) {
      case 'lock': await room.permissionOverwrites.edit(everyone, { Connect: false }); return i.reply(ephemeral('🔒 Locked. `/room invite` to let people in.'));
      case 'unlock': await room.permissionOverwrites.edit(everyone, { Connect: null }); return i.reply(ephemeral('🔓 Unlocked.'));
      case 'private': await room.permissionOverwrites.edit(everyone, { ViewChannel: false, Connect: false }); return i.reply(ephemeral('🙈 Hidden: only you and the people you invite see it.'));
      case 'public': await room.permissionOverwrites.edit(everyone, { ViewChannel: null, Connect: null }); return i.reply(ephemeral('👀 Visible again.'));
      case 'invite': await room.permissionOverwrites.edit(who.id, { ViewChannel: true, Connect: true }); return i.reply(ephemeral(`<@${who.id}> can join.`));
      case 'kick': {
        if (who.id === i.user.id) return i.reply(ephemeral("That's you."));
        await room.permissionOverwrites.edit(who.id, { Connect: false });
        const m = room.members.get(who.id);
        if (m) await m.voice.disconnect('kicked from the room').catch(() => {});
        return i.reply(ephemeral(`<@${who.id}> is out and can't come back.`));
      }
      case 'limit': await room.setUserLimit(i.options.getInteger('people')); return i.reply(ephemeral('Limit set.'));
      case 'rename': await room.setName(`🔊 ${i.options.getString('name')}`); return i.reply(ephemeral('Renamed.'));
      case 'transfer': {
        if (!room.members.has(who.id) || who.bot) return i.reply(ephemeral('They need to be in the room.'));
        state.rooms[room.id] = who.id; save();
        await room.permissionOverwrites.edit(who.id, { Connect: true, Speak: true, MoveMembers: true, ManageChannels: true });
        await room.permissionOverwrites.delete(i.user.id).catch(() => {});
        return i.reply(ephemeral(`The room is <@${who.id}>'s now.`));
      }
    }
  },
  async pull(i) {
    const here = i.member.voice.channel;
    if (!here) return i.reply(ephemeral('Join a voice channel first.'));
    const who = i.options.getUser('member');
    if (who) {
      const m = await i.guild.members.fetch(who.id).catch(() => null);
      if (!m?.voice.channel) return i.reply(ephemeral(`<@${who.id}> isn't in a voice channel.`));
      await m.voice.setChannel(here, `pulled by ${i.user.tag}`);
      return i.reply(ephemeral(`Moved <@${who.id}> into ${here.name}.`));
    }
    const waiting = client.channels.cache.get(state.channels.waiting);
    const people = [...(waiting?.members.values() ?? [])];
    for (const m of people) await m.voice.setChannel(here, `pulled by ${i.user.tag}`).catch(() => {});
    return i.reply(ephemeral(people.length ? `Moved ${people.length} from the waiting room.` : 'Nobody in the waiting room.'));
  },
};

export function setup() {
  client.once('clientReady', async () => {
    // Rooms left empty while Kira was off.
    for (const id of Object.keys(state.rooms)) {
      const ch = await client.channels.fetch(id).catch(() => null);
      if (!ch) { delete state.rooms[id]; continue; }
      await cleanup(id);
    }
    save();
  });
  client.on('voiceStateUpdate', async (before, after) => {
    if (after.guild.id !== GUILD_ID) return;
    if (after.channelId && after.channelId === state.channels.lobby && after.member && !after.member.user.bot) {
      await createRoom(after.member).catch((e) => { console.error('room', e); modlog('Room error', String(e.message)); });
    }
    if (before.channelId && before.channelId !== after.channelId) await cleanup(before.channelId);
    // Someone is waiting for Ludovic: tell the staff.
    if (after.channelId === state.channels.waiting && before.channelId !== after.channelId && after.member && !after.member.user.bot) {
      await modlog('⏳ Waiting room', `<@${after.member.id}> is waiting in ⏳ waiting room. \`/pull\` to bring them into your channel.`, 0x5aa9ff);
    }
  });
}
