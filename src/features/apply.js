// /apply (Ludovic, 2026-10-30): the Discord side of the applications for 🛡️ Mod, 🤝 Support and 🌌 Horizon Team
// (docs/staff-api.md). The form and the decisions live on the website's staff dashboards; Kira DMs the member a
// one-time link to the form, and when the staff decide she gives the role and DMs the member (and Ludovic, for an
// accepted Team application). The two sides meet only through src/staff-hooks.js.
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { APPLY, GUILD_ID, OWNER_ID } from '../config.js';
import { client, state, modlog } from '../core.js';
import { rateLimiter } from '../agents.js';
import { APPLY_ROLES, canApply, issueApplyLink, setDiscordSide } from '../staff-hooks.js';
import * as kit from '../apply-kit.js';
import { linkify } from '../texts.js';

const limits = rateLimiter({ link: [APPLY.perHour, 3_600_000] });
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const TEAM_DASHBOARD = 'https://playhorizon.dev/staff/team';

// What the staff side calls once a decision is recorded: the role on accept, the applicant's DM, Ludovic's notice for
// the Team. Never throws: { granted, dmSent, error }.
export async function decide({ applicationId, userId, role, outcome, decidedBy, cooldownUntil, url }) {
  const out = { granted: false, dmSent: false, error: null };
  const fail = (e) => { out.error ??= String(e?.message ?? e).slice(0, 200); };
  try {
    if (!APPLY_ROLES.includes(role) || !['accept', 'decline'].includes(outcome)) { fail(`unknown ${APPLY_ROLES.includes(role) ? 'outcome' : 'role'}`); return out; }
    const guild = client.guilds.cache.get(GUILD_ID) ?? await client.guilds.fetch(GUILD_ID).catch(() => null);
    const member = await guild?.members.fetch(userId).catch(() => null);
    if (outcome === 'accept') {
      if (!state.roles[role]) fail(`no ${role} role on the server yet`);
      else if (!member) fail('not on the server');
      else await member.roles.add(state.roles[role], `application ${applicationId} accepted by ${decidedBy}`).then(() => { out.granted = true; }, fail);
    }
    const user = member?.user ?? await client.users.fetch(userId).catch(() => null);
    if (!user) fail('no such user');
    else await user.send({ content: linkify(kit.decisionDm(role, outcome, cooldownUntil), state), allowedMentions: { parse: [] } }).then(() => { out.dmSent = true; }, () => fail('their DMs are closed'));
    if (outcome === 'accept' && role === 'team' && out.granted) {
      const owner = await client.users.fetch(OWNER_ID).catch(() => null);
      await owner?.send({ content: kit.ownerNotice({ userId, decidedBy, url: /^https:\/\/playhorizon\.dev\//.test(url ?? '') ? url : TEAM_DASHBOARD }), allowedMentions: { parse: [] } }).catch((e) => console.error('apply owner notice', e.message));
    }
    await modlog(`📝 Application ${outcome === 'accept' ? 'accepted' : 'declined'}`, `<@${userId}> for ${APPLY.roles[role].label}, by <@${decidedBy}> on the dashboard · role ${out.granted ? 'given' : outcome === 'accept' ? 'NOT given' : '–'} · DM ${out.dmSent ? 'sent' : 'not sent'}${out.error ? ` (${out.error})` : ''}`);
  } catch (e) {
    fail(e);
  }
  return out;
}

export const commands = [
  new SlashCommandBuilder().setName('apply').setDescription('Apply for 🤝 Support, 🛡️ Mod or 🌌 Horizon Team: Kira DMs you the form')
    .addStringOption((o) => o.setName('role').setDescription('Which role').setRequired(true)
      .addChoices(...Object.entries(APPLY.roles).map(([value, r]) => ({ name: r.label, value })))),
];

export const handlers = {
  async apply(i) {
    const role = i.options.getString('role');
    const can = await canApply(i.user.id, role);
    if (!can.ok) return i.reply(ephemeral(kit.refusal(can.why, role, can.retryAt)));
    if (!limits.take(i.user.id, 'link')) return i.reply(ephemeral('You asked for a few links this hour already: use the last one in your DMs, or try again later.'));
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const link = await issueApplyLink(i.user.id, role);
    if (!link.ok) return i.editReply(ephemeral(kit.refusal(link.why, role, link.retryAt)));
    const sent = await i.user.send({ content: kit.linkDm(role, link.url, link.expiresAt), allowedMentions: { parse: [] } }).then(() => true, () => false);
    return i.editReply(ephemeral(sent
      ? `Check your DMs: I sent you the link to the form for ${APPLY.roles[role].label}.`
      : "I couldn't DM you. Allow DMs from this server's members (the server's name → Privacy Settings), then run `/apply` again."));
  },
};

export const _test = { decide };

export function setup() {
  setDiscordSide({ decide });
}
