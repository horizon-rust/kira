// Team roles (TEAMS in config.js, rules in src/team-roles-kit.js): `/team add member:`, `/team remove member:` and
// `/team list` let a team's managers give and take back their team's role, and only it, without Discord's Manage
// Roles (which would also let them edit every channel's overwrites). The mods, the Chief of Mods and Ludovic may run
// it on any team. Replies are ephemeral; each change is one line in #mod-log.
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { rateLimiter } from '../agents.js';
import { OWNER_ID, TEAMS, GOVERNANCE } from '../config.js';
import { state, modlog } from '../core.js';
import * as kit from '../team-roles-kit.js';

const limiter = rateLimiter({ team: [TEAMS.perHour, 3_600_000] });
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const quarantinedRole = () => state.roles?.quarantined || state.ownRoles?.quarantined || TEAMS.quarantinedRole;
// The roles that may manage every team: the staff, and 🏛️ Council once the governance is on.
export const staffRoles = () => (GOVERNANCE.on ? [...TEAMS.staffRoles, state.roles?.council || GOVERNANCE.roles.council] : TEAMS.staffRoles);
const actorOf = (i) => ({ id: i.user.id, roles: [...(i.member?.roles?.cache?.keys?.() ?? i.member?.roles ?? [])] });

const teamOption = (o) => {
  o.setName('team').setDescription('Which team (only needed if you manage several)');
  if (TEAMS.list.length > 1) o.addChoices(...TEAMS.list.map((t) => ({ name: t.name, value: t.key })));
  return o;
};

export const commands = TEAMS.list.length ? [
  new SlashCommandBuilder().setName('team').setDescription("Give or take back your team's role")
    .addSubcommand((s) => s.setName('add').setDescription("Give your team's role to a member")
      .addUserOption((o) => o.setName('member').setDescription('Who joins the team').setRequired(true))
      .addStringOption(teamOption))
    .addSubcommand((s) => s.setName('remove').setDescription("Take your team's role back from a member")
      .addUserOption((o) => o.setName('member').setDescription('Who leaves the team').setRequired(true))
      .addStringOption(teamOption))
    .addSubcommand((s) => s.setName('list').setDescription("Who has your team's role")
      .addStringOption(teamOption)),
] : [];

async function change(i, op, team) {
  const user = i.options.getUser('member');
  const member = await i.guild.members.fetch(user.id).catch(() => null);
  const role = i.guild.roles.cache.get(team.role) ?? await i.guild.roles.fetch(team.role).catch(() => null);
  const target = member && { id: member.id, bot: member.user.bot, roles: [...member.roles.cache.keys()] };
  const verdict = kit.check({ op, team, target, role: role && { editable: role.editable, permissions: role.permissions.bitfield }, quarantinedRole: quarantinedRole() });
  if (!verdict.ok) return i.editReply(ephemeral(verdict.why));
  if (!limiter.take(i.user.id, 'team')) return i.editReply(ephemeral('That is a lot of changes for one hour: wait a little, then try again.'));
  const why = `Kira /team ${op}: by ${i.user.tag ?? i.user.id}`;
  if (op === 'add') await member.roles.add(team.role, why);
  else await member.roles.remove(team.role, why);
  await modlog('👥 Team role', `<@${i.user.id}> ${op === 'add' ? 'gave' : 'took back'} **${team.name}** ${op === 'add' ? 'to' : 'from'} <@${member.id}>`, op === 'add' ? 0x2ecc40 : 0xffb020);
  return i.editReply(ephemeral(op === 'add' ? `Gave **${team.name}** to <@${member.id}>.` : `Took **${team.name}** back from <@${member.id}>.`));
}

async function list(i, team) {
  const role = i.guild.roles.cache.get(team.role);
  if (!role) return i.editReply(ephemeral(`The **${team.name}** role doesn't exist any more: ask a mod.`));
  const ids = [...role.members.keys()];
  if (!ids.length) return i.editReply(ephemeral(`Nobody has **${team.name}** yet. Add someone with \`/team add member:\`.`));
  const shown = ids.slice(0, 60).map((id) => `<@${id}>`).join(', ');
  return i.editReply(ephemeral(`**${team.name}** (${ids.length}): ${shown}${ids.length > 60 ? ', …' : ''}`));
}

export const handlers = {
  async team(i) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const picked = kit.pickTeam(TEAMS.list, actorOf(i), i.options.getString('team'), staffRoles(), OWNER_ID);
    if (!picked.team) return i.editReply(ephemeral(picked.why));
    const sub = i.options.getSubcommand();
    return sub === 'list' ? list(i, picked.team) : change(i, sub, picked.team);
  },
};

export const _test = { limiter };
