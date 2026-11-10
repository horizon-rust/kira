// The Horizon Team by vote (dezer-x in #horizon-team, Ludovic agreed, 2026-11-09): `/team-vote propose|remove member:`,
// for the Team and Ludovic, in #horizon-team. Kira posts a 48-hour native poll (Yes/No) with one ping of the Team
// role, then the result: at least 2/3 Yes among the votes, with at least half of the Team voting. Kira never gives or
// takes the role; the result line says who does (a Chief of Mods or Ludovic). One open vote per member; a candidate
// for propose holds at least 🥇 Gold (Ludovic may skip that). Rules in src/team-vote-kit.js.
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { GUILD_ID, OWNER_ID, TEAM_VOTE, GOVERNANCE, ELECTIONS } from '../config.js';
import { client, state, save, modlog } from '../core.js';
import { hasRank } from './contributors.js';
import * as kit from '../team-vote-kit.js';

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const votes = () => (state.teamVotes ??= {}); // subject id → { kind, subject, by, channelId, messageId, startedAt, endsAt }
const teamRole = () => state.roles[TEAM_VOTE.role] ?? TEAM_VOTE.roleId;
const teamChannel = () => state.channels[TEAM_VOTE.channel] ?? TEAM_VOTE.channelId;
const guild = () => client.guilds.cache.get(GUILD_ID);
export const GOVERNED = 'The Horizon Team is decided by the council now: a council member starts a 2/3 poll with `/poll` (GOVERNANCE.md). Votes already running still end and post their result.';
// With KIRA_ELECTIONS on, the Team elects its own members (GOVERNANCE.md 5.3).
export const ELECTED = 'The Horizon Team elects its members now: a Team or council member runs `/elect post:team member:` (24 hours, two thirds; GOVERNANCE.md 5.3). Votes already running still end and post their result.';
const ANSWERS = [{ text: 'Yes', emoji: '✅' }, { text: 'No', emoji: '❌' }];

const memberOption = (o, what) => o.setName('member').setDescription(what).setRequired(true);
export const commands = [
  new SlashCommandBuilder().setName('team-vote').setDescription('Horizon Team: start a 48-hour vote on who joins or leaves the Team')
    .addSubcommand((s) => s.setName('propose').setDescription('Vote on adding a member to the Horizon Team').addUserOption((o) => memberOption(o, 'The candidate (🥇 Gold rank or higher)')))
    .addSubcommand((s) => s.setName('remove').setDescription('Vote on removing a member from the Horizon Team').addUserOption((o) => memberOption(o, 'The Team member'))),
];

export const handlers = {
  async 'team-vote'(i) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    // Under the governance (GOVERNANCE.md 4.3) the council decides who joins or leaves the Team, by a 2/3 poll.
    if (GOVERNANCE.on) return i.editReply(ephemeral(ELECTIONS.on ? ELECTED : GOVERNED));
    const kind = i.options.getSubcommand();
    const user = i.options.getUser('member');
    const member = await i.guild.members.fetch(user.id).catch(() => null);
    const role = teamRole();
    const actor = { id: i.user.id, isOwner: i.user.id === OWNER_ID, isTeam: !!i.member?.roles?.cache?.has(role) };
    const target = member && { id: member.id, bot: !!member.user.bot, isTeam: member.roles.cache.has(role), rankOk: hasRank(member, TEAM_VOTE.minRank) };
    const verdict = kit.check({ kind, actor, target, channelId: i.channelId, teamChannel: teamChannel(), open: votes() });
    if (!verdict.ok) return i.editReply(ephemeral(verdict.why));
    const now = Date.now();
    // The slot is taken before the first await that could let a second vote on the same member in.
    const vote = (votes()[member.id] = { kind, subject: member.id, by: i.user.id, startedAt: now, endsAt: now + TEAM_VOTE.hours * 3_600_000 });
    try {
      const msg = await i.channel.send({
        content: kit.announce({ kind, subject: member.id, by: i.user.id, roleId: role, endsAt: vote.endsAt }),
        allowedMentions: { parse: [], roles: [role] }, // the one ping: the Team role
        poll: { question: { text: kit.question(kind, member.displayName ?? member.user.username) }, answers: ANSWERS, duration: TEAM_VOTE.hours, allowMultiselect: false },
      });
      Object.assign(vote, { channelId: msg.channelId ?? i.channelId, messageId: msg.id, endsAt: msg.poll?.expiresTimestamp || vote.endsAt });
      save();
    } catch (e) {
      delete votes()[member.id];
      save();
      console.error('team-vote', e.message);
      return i.editReply(ephemeral('The poll could not be posted: try again in a minute.'));
    }
    await modlog('🗳️ Team vote', `<@${i.user.id}> started a vote: should <@${member.id}> ${kind === 'propose' ? 'join' : 'leave'} the Horizon Team?`, 0x9b59b6).catch(() => {});
    return i.editReply(ephemeral(`Vote started: it ends <t:${Math.floor(vote.endsAt / 1000)}:R>, then I post the result here.`));
  },
};

// Every id that voted for the answer with this text (100 per page).
async function voters(poll, text) {
  const answer = [...poll.answers.values()].find((a) => a.text === text);
  const out = [];
  if (!answer) return out;
  for (let after; ;) {
    const page = await answer.voters.fetch({ limit: 100, ...(after ? { after } : {}) });
    out.push(...page.keys());
    if (page.size < 100) return out;
    after = [...page.keys()].at(-1);
  }
}

// The Team whose votes count: the role's holders and Ludovic, without the member voted on.
async function eligible(subject) {
  const g = guild();
  await g.members.fetch();
  const ids = new Set([...g.members.cache.values()].filter((m) => !m.user.bot && m.roles.cache.has(teamRole())).map((m) => m.id));
  ids.add(OWNER_ID);
  ids.delete(subject);
  return [...ids];
}

// The votes whose poll has ended: the result as a reply to the poll, no ping. Waits for Discord to finalise the
// counts (up to 30 minutes after the end). A poll message that is gone ends its vote with a line saying so.
export async function closeDue(now = Date.now()) {
  for (const [subject, v] of Object.entries(votes())) {
    if (!v.messageId || now < v.endsAt + 60_000) continue;
    try {
      const ch = client.channels.cache.get(v.channelId) ?? await client.channels.fetch(v.channelId).catch(() => null);
      const msg = await ch?.messages.fetch(v.messageId).catch(() => null);
      let content;
      let result = null;
      if (!msg?.poll) content = `The poll on <@${subject}> is gone: no result. Start a new vote with \`/team-vote\` if it is still wanted.`;
      else {
        if (!msg.poll.resultsFinalized && now < v.endsAt + 30 * 60_000) continue;
        result = kit.outcome({ yes: await voters(msg.poll, 'Yes'), no: await voters(msg.poll, 'No'), eligible: await eligible(subject), pass: TEAM_VOTE.pass, quorum: TEAM_VOTE.quorum });
        content = kit.resultLine({ kind: v.kind, subject, result });
      }
      await ch?.send({ content, allowedMentions: { parse: [] }, ...(msg ? { reply: { messageReference: v.messageId, failIfNotExists: false } } : {}) });
      delete votes()[subject];
      (state.teamVoteLog ??= []).push({ ...v, result, closedAt: now });
      state.teamVoteLog.splice(0, Math.max(0, state.teamVoteLog.length - 50));
      save();
      await modlog('🗳️ Team vote ended', content, result?.passed ? 0x2ecc40 : 0xffb020).catch(() => {});
    } catch (e) { console.error('team-vote close', e.message); }
  }
}

export function setup() {
  client.once('clientReady', () => {
    const check = () => closeDue().catch((e) => console.error('team-vote', e.message));
    setTimeout(check, 60_000).unref?.();
    setInterval(check, TEAM_VOTE.checkEveryMs).unref?.();
  });
}
