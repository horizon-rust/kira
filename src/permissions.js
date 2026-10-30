// Who sees and writes in each kind of channel of LAYOUT (config.js), with no Discord connection so it can be tested.
// `ids`: { everyone, mod, kira, owner, roles } (the IDs of @everyone, 🛡️ Mod, Kira, Ludovic, and state.roles by key).
import { PermissionFlagsBits as P, OverwriteType } from 'discord.js';

const role = (id, extra) => ({ id, type: OverwriteType.Role, ...extra });

export function overwrites(ids, spec, staffCategory) {
  const { everyone, mod, kira, owner, roles = {} } = ids;
  const ow = [{ id: kira, type: OverwriteType.Member, allow: [P.ViewChannel, P.SendMessages, P.ManageMessages, P.ManageThreads, P.EmbedLinks, P.AddReactions, P.Connect, P.MoveMembers, P.ManageChannels] }];
  if (spec.staff || staffCategory) {
    // The staff channels: the mods and the Horizon Team (who moderate too).
    ow.push(role(everyone, { deny: [P.ViewChannel] }), ...[mod, roles.team].filter(Boolean).map((id) => role(id, { allow: [P.ViewChannel, P.SendMessages] })));
  } else if (spec.readonly) {
    // The mods and the Horizon Team (who have the mods' permissions, Ludovic 2026-10-28) post; everyone else reads.
    ow.push(
      role(everyone, { deny: [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads] }),
      ...[mod, roles.team].filter(Boolean).map((id) => role(id, { allow: [P.SendMessages] })),
    );
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
  return ow;
}
