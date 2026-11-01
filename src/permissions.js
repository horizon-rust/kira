// Who sees and writes in each kind of channel of LAYOUT (config.js), with no Discord connection so it can be tested.
// `ids`: { everyone, mod, kira, owner, roles } (the IDs of @everyone, 🛡️ Mod, Kira, Ludovic, and state.roles by key).
// `mods`: the channel's own moderators (CHANNEL_MODS in config.js), member IDs.
import { PermissionFlagsBits as P, OverwriteType } from 'discord.js';

const role = (id, extra) => ({ id, type: OverwriteType.Role, ...extra });

export function overwrites(ids, spec, staffCategory, mods = []) {
  const { everyone, mod, kira, owner, roles = {} } = ids;
  const ow = [{ id: kira, type: OverwriteType.Member, allow: [P.ViewChannel, P.SendMessages, P.ManageMessages, P.ManageThreads, P.EmbedLinks, P.AddReactions, P.Connect, P.MoveMembers, P.ManageChannels] }];
  if (spec.staff || staffCategory) {
    // The staff channels: the mods and the Horizon Team (who moderate too).
    ow.push(role(everyone, { deny: [P.ViewChannel] }), ...[mod, roles.team].filter(Boolean).map((id) => role(id, { allow: [P.ViewChannel, P.SendMessages] })));
  } else if (spec.readonly) {
    // Only Kira, Ludovic and the Horizon Team post; everyone else reads (Ludovic 2026-10-31: the Team writes in the
    // big channels, the mods don't). `staffPost`: the mods post there too.
    ow.push(
      role(everyone, { deny: [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads] }),
      ...(spec.staffPost ? [mod, roles.team] : [roles.team]).filter(Boolean).map((id) => role(id, { allow: [P.SendMessages] })),
    );
    // Not where `staffPost` is set (#join-server, #server-chat): Ludovic is a mod there, and the live server has no overwrite for him.
    if (owner && !spec.staffPost) ow.push({ id: owner, type: OverwriteType.Member, allow: [P.SendMessages] });
  } else if (spec.members) {
    // Private to these roles: nobody else sees it.
    ow.push(
      role(everyone, { deny: [P.ViewChannel] }),
      ...spec.members.map((key) => roles[key]).filter(Boolean).map((id) => role(id, { allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.EmbedLinks, P.AttachFiles, P.AddReactions] })),
    );
  } else if (spec.writers) {
    // Everyone reads and reacts; only the mods and the roles in `writers` write, open threads and write in them.
    ow.push(
      role(everyone, { deny: [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads] }),
      ...[mod, ...spec.writers.map((key) => roles[key])].filter(Boolean).map((id) => role(id, { allow: [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads] })),
    );
  } else if (spec.helpers) {
    // A help forum: everyone opens posts and writes in them; these roles also manage its posts (tags, close, lock),
    // in this channel only.
    ow.push(...spec.helpers.map((key) => roles[key]).filter(Boolean).map((id) => role(id, { allow: [P.SendMessagesInThreads, P.ManageThreads] })));
  } else if (spec.posts === 'staff') {
    ow.push(role(everyone, { deny: [P.SendMessages], allow: [P.SendMessagesInThreads] }), ...[mod, roles.team].filter(Boolean).map((id) => role(id, { allow: [P.SendMessages] })));
  } else if (spec.locked) {
    // Everyone sees it, nobody joins by themselves: Ludovic (and mods) move people in.
    ow.push(role(everyone, { deny: [P.Connect] }), { id: owner, type: OverwriteType.Member, allow: [P.Connect, P.Speak, P.MoveMembers] });
  } else if (spec.lobby) {
    ow.push(role(everyone, { deny: [P.Speak, P.SendMessages] }));
  }
  // Moderators of this channel only: they delete messages, manage threads and pin.
  ow.push(...mods.map((id) => ({ id, type: OverwriteType.Member, allow: [P.ManageMessages, P.ManageThreads, P.PinMessages] })));
  return ow;
}
