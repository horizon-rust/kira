// /apply (Ludovic, 2026-10-30): the Discord side of the applications for 🛡️ Mod, 🤝 Support and 🌌 Horizon Team
// (docs/staff-api.md). The form, the vote and Ludovic's veto live on the website's staff dashboards; Kira DMs the
// member a one-time link to the form, gives the role and DMs the member once a decision is final, and sends the DMs
// the staff side asks for (Ludovic's veto window) through dm(). The two sides meet only through src/staff-hooks.js.
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { APPLY, GUILD_ID } from '../config.js';
import { client, state, modlog } from '../core.js';
import { rateLimiter } from '../agents.js';
import { APPLY_ROLES, canApply, issueApplyLink, setDiscordSide } from '../staff-hooks.js';
import * as kit from '../apply-kit.js';
import { linkify } from '../texts.js';

const limits = rateLimiter({ link: [APPLY.perHour, 3_600_000] });
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

// What the staff side calls once a decision is final (after the vote and Ludovic's veto window): the role on accept and
// the applicant's DM. Ludovic hears of it through the veto-window DM the staff side sends with dm(), not from here.
// Never throws: { granted, dmSent, error }.
export async function decide({ applicationId, userId, role, outcome, decidedBy, cooldownUntil }) {
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
    await modlog(`📝 Application ${outcome === 'accept' ? 'accepted' : 'declined'}`, `<@${userId}> for ${APPLY.roles[role].label}, by <@${decidedBy}> on the dashboard · role ${out.granted ? 'given' : outcome === 'accept' ? 'NOT given' : '–'} · DM ${out.dmSent ? 'sent' : 'not sent'}${out.error ? ` (${out.error})` : ''}`);
  } catch (e) {
    fail(e);
  }
  return out;
}

// A DM the staff side asks for (Ludovic's veto window, docs/staff-api.md): the text as given, nobody pinged, at most
// 2000 characters. Never throws: { sent, error }.
export async function dm({ userId, content }) {
  try {
    const text = String(content ?? '').trim();
    if (!/^\d{5,25}$/.test(String(userId ?? '')) || !text) return { sent: false, error: 'bad request' };
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return { sent: false, error: 'no such user' };
    return await user.send({ content: text.slice(0, 2000), allowedMentions: { parse: [] } }).then(() => ({ sent: true, error: null }), () => ({ sent: false, error: 'their DMs are closed' }));
  } catch (e) {
    return { sent: false, error: String(e?.message ?? e).slice(0, 200) };
  }
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

export const _test = { decide, dm };

export function setup() {
  setDiscordSide({ decide, dm });
}
