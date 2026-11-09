// The Horizon Team vote with no Discord (src/features/teamvote.js does the talking): who may start one, on whom, and
// the result. `/team-vote propose|remove member:` starts a 48-hour poll in #horizon-team; it passes with at least 2/3
// Yes among the votes cast, when at least half of the Team voted. Only the Team's votes count: the role holders and
// Ludovic, without the member voted on. Kira never changes the role: the result says who applies it.

// Whether `actor` ({ id, isOwner, isTeam }) may start a vote of `kind` on `target`
// ({ id, bot, isTeam, rankOk }) in the channel `channelId` (`teamChannel`: #horizon-team), with `open` the votes
// running (subject id → vote). { ok: true } or { ok: false, why }.
export function check({ kind, actor, target, channelId, teamChannel, open = {} }) {
  if (!actor.isOwner && !actor.isTeam) return { ok: false, why: 'Only the Horizon Team and Ludovic start a Team vote.' };
  if (channelId !== teamChannel) return { ok: false, why: 'Team votes happen in #horizon-team: run it there.' };
  if (!target) return { ok: false, why: 'That member is not in the server.' };
  if (target.bot) return { ok: false, why: 'Bots are not voted on.' };
  if (open[target.id]) return { ok: false, why: `There is already an open vote on <@${target.id}>: wait for its result.` };
  if (kind === 'propose') {
    if (target.isTeam) return { ok: false, why: `<@${target.id}> is already on the Horizon Team.` };
    if (!target.rankOk && !actor.isOwner) return { ok: false, why: `A candidate needs at least the 🥇 Gold contributor rank (\`/rank member:\` shows theirs).` };
  } else if (kind === 'remove') {
    if (!target.isTeam) return { ok: false, why: `<@${target.id}> is not on the Horizon Team.` };
  } else return { ok: false, why: 'Unknown kind of vote.' };
  return { ok: true };
}

// The result. `yes`, `no`: the ids that voted each way (a vote may be changed, so one id is in one list at most);
// `eligible`: the ids whose vote counts. Votes from anyone else are left out.
export function outcome({ yes, no, eligible, pass = 2 / 3, quorum = 1 / 2 }) {
  const set = new Set(eligible);
  const y = [...new Set(yes)].filter((id) => set.has(id)).length;
  const n = [...new Set(no)].filter((id) => set.has(id)).length;
  const voted = y + n;
  const needed = Math.ceil(set.size * quorum);
  const enough = voted > 0 && voted >= needed;
  const share = voted ? y / voted : 0;
  return { yes: y, no: n, voted, size: set.size, needed, enough, passed: enough && share >= pass - 1e-9 };
}

// ── Texts ────────────────────────────────────────────────────────────────────

const WHAT = { propose: 'join', remove: 'leave' };

// The poll's question (at most 300 characters, no mentions: Discord shows them as text there).
export const question = (kind, name) => `Should ${String(name).slice(0, 80)} ${WHAT[kind]} the Horizon Team?`.slice(0, 300);

// The message above the poll: the one ping of the Team role.
export const announce = ({ kind, subject, by, roleId, endsAt }) => `<@&${roleId}> Team vote: should <@${subject}> **${WHAT[kind]}** the Horizon Team? Started by <@${by}>, ends <t:${Math.floor(endsAt / 1000)}:R>. It passes with at least 2/3 Yes when at least half of the Team votes.`;

// The result line (no ping): the counts, and who applies a passed vote.
export function resultLine({ kind, subject, result }) {
  const counts = `${result.yes} Yes, ${result.no} No; ${result.voted} of ${result.size} Team members voted, ${result.needed} needed`;
  if (result.passed) {
    const act = kind === 'propose' ? `gives <@${subject}> the 🌌 Horizon Team role` : `takes the 🌌 Horizon Team role from <@${subject}>`;
    return `✅ **Passed**: <@${subject}> ${kind === 'propose' ? 'joins' : 'leaves'} the Horizon Team (${counts}). A 🛡️ Chief of Mods or Ludovic ${act}; Kira does not change roles.`;
  }
  const why = result.enough ? 'fewer than 2/3 Yes' : 'fewer than half of the Team voted';
  return `❌ **Not passed** (${why}): <@${subject}> ${kind === 'propose' ? 'does not join' : 'stays on'} the Horizon Team (${counts}).`;
}
