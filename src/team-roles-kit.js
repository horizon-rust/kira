// Team roles' rules, no Discord connection (src/features/teamroles.js does the talking; TEAMS in config.js).
// A team's managers give and take back that team's role, and nothing else; the staff roles may do it on any team.
import { PermissionFlagsBits as P } from 'discord.js';

// A role carrying any of these is not a team role: handing it out would hand out moderation. Kira refuses it, even if
// it is listed in TEAMS (someone could add a permission to the role later).
export const DANGEROUS = [
  P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.ManageMessages, P.ManageThreads, P.ManageWebhooks,
  P.ManageNicknames, P.ManageEvents, P.ManageGuildExpressions, P.ModerateMembers, P.KickMembers, P.BanMembers,
  P.MentionEveryone, P.MoveMembers, P.MuteMembers, P.DeafenMembers, P.ViewAuditLog,
].reduce((all, bit) => all | bit, 0n);

export const isStaff = (actor, staffRoles, ownerId) => actor.id === ownerId || staffRoles.some((id) => actor.roles.includes(id));

// The teams this member may manage: all of them for the staff, else the ones that list them as a manager.
export function teamsFor(list, actor, staffRoles, ownerId) {
  return isStaff(actor, staffRoles, ownerId) ? list : list.filter((t) => t.managers.includes(actor.id));
}

// Which team a command is about: the one named (`key`), else the only one this member manages.
// → { team } or { why } (a sentence for the member).
export function pickTeam(list, actor, key, staffRoles, ownerId) {
  const mine = teamsFor(list, actor, staffRoles, ownerId);
  if (!mine.length) return { why: "You don't manage a team role." };
  if (key) {
    const team = mine.find((t) => t.key === key);
    if (team) return { team };
    return { why: list.some((t) => t.key === key) ? "That isn't your team: you can only manage your own team's role." : 'No such team.' };
  }
  if (mine.length === 1) return { team: mine[0] };
  return { why: `Pick the team: ${mine.map((t) => `\`${t.key}\``).join(', ')}.` };
}

// Whether `op` ('add' | 'remove') of `team`'s role on `target` may go ahead.
// `target`: { id, bot, roles: [ids] } or null (not in the server). `role`: { editable, permissions: bigint } or null
// (gone from the server). `quarantinedRole`: the 🔒 Quarantined role's id. → { ok: true } or { ok: false, why }.
export function check({ op, team, target, role, quarantinedRole }) {
  const no = (why) => ({ ok: false, why });
  if (!role) return no(`The **${team.name}** role doesn't exist any more: ask a mod.`);
  if (!role.editable) return no(`Kira can't manage **${team.name}** (her role is below it, or it's an integration's role): ask a mod.`);
  if ((BigInt(role.permissions) & DANGEROUS) !== 0n) return no(`**${team.name}** carries moderation permissions, so Kira won't hand it out: ask a mod.`);
  if (!target) return no("They're not in the server.");
  if (target.bot) return no('Bots never get team roles.');
  const has = target.roles.includes(team.role);
  if (op === 'add') {
    if (quarantinedRole && target.roles.includes(quarantinedRole)) return no("They're quarantined: a team role waits until their appeal is decided.");
    if (has) return no(`<@${target.id}> already has **${team.name}**.`);
  } else if (!has) {
    return no(`<@${target.id}> doesn't have **${team.name}**.`);
  }
  return { ok: true };
}
