// Elections and body votes with no Discord (horizon-rust/horizon GOVERNANCE.md sections 2.1, 5.3 and 7;
// src/features/elections.js does the talking). Everything here is pure: the posts and who votes for them, the floors
// Kira can measure, quorum, the count (a single candidate, an approval ballot, a run-off), when a result is locked,
// the 30-day cooldown, the cap on open elections, the veto window, the seats and the monthly reminders.
//
// A body is a set of voters: 'mods' (🛡️ Mod and 🛡️ Chief of Mods), 'team' (🌌 Horizon Team), 'op' (the mods and the
// 🧭 Server lead), or 'group:<key>' (the group's active members and the Team). The council votes by poll, not here.

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export const RULES = {
  hours: 24,          // every vote
  vetoHours: 24,      // a council member calls a veto within this long of a result
  joinHours: 12,      // further nominations for the same seat join the ballot this long
  nominateHours: 24,  // a vacancy's nominations
  cooldownDays: 30,   // after a failed or vetoed election, for the same person and post
  maxOpen: 3,         // elections open at once in one body
  minVoters: 3,       // below this the council decides by poll
  maxCandidates: 5,   // one row of buttons
  groupRoleDays: 14,  // a group member votes once they held the group's role this long
  activeDays: 60,     // and had a counted contribution in this window
  coLeadAt: 8,        // a group with this many active members may have a co-lead
};

// The posts /elect knows. role: the GOVERNANCE.roles key Kira gives (null: nothing on Discord, only clicks).
// starters: who may start it ('mods', 'team', 'council', 'lead' = the group's current lead, 'lead-server').
// seats: how many may hold it (null: no limit). threshold: 'simple' | 'two-thirds'.
export const POSTS = {
  mod: { label: '🛡️ Mod', role: 'mod', body: () => 'mods', threshold: 'simple', starters: ['mods', 'council'], seats: null },
  chiefmod: { label: '🛡️ Chief of Mods', role: 'chiefmod', body: () => 'mods', threshold: 'simple', starters: ['mods', 'council'], seats: 1 },
  op: { label: 'Official server operator', role: null, body: () => 'op', threshold: 'simple', starters: ['lead-server', 'chiefmod', 'council'], seats: null },
  lead: { label: '🧭 Group lead', role: (g) => `lead-${g}`, body: (g) => `group:${g}`, threshold: 'simple', starters: ['lead', 'team', 'council'], seats: 1, group: true },
  team: { label: '🌌 Horizon Team', role: 'team', body: () => 'team', threshold: 'two-thirds', starters: ['team', 'council'], seats: null },
};

export const roleKeyOf = (post, group) => (typeof POSTS[post]?.role === 'function' ? POSTS[post].role(group) : POSTS[post]?.role ?? null);
export const bodyOf = (post, group) => POSTS[post].body(group);
export const seatKey = (post, group) => (POSTS[post]?.group ? `${post}:${group}` : post);

// ── Who may start, who votes ─────────────────────────────────────────────────

// The kinds a member holds, from their Discord roles. roles: Set of role ids; ids: GOVERNANCE.roles (+ group leads).
// → Set of 'mods' | 'chiefmod' | 'team' | 'council' | 'lead-<group>'.
export function kindsOf(roleIds, ids, { council = false } = {}) {
  const has = (k) => !!ids[k] && roleIds.has(ids[k]);
  const out = new Set();
  if (has('mod') || has('chiefmod')) out.add('mods');
  if (has('chiefmod')) out.add('chiefmod');
  if (has('team')) out.add('team');
  if (council) out.add('council');
  for (const k of Object.keys(ids)) if (k.startsWith('lead-') && has(k)) out.add(k);
  return out;
}

// Whether a member of these kinds may start this post's election (or recall). → null, or why not.
export function mayStart(post, group, kinds) {
  const p = POSTS[post];
  if (!p) return 'Unknown post.';
  const ok = p.starters.some((s) => (s === 'lead' ? kinds.has(`lead-${group}`) : kinds.has(s)));
  return ok ? null : `Only ${p.starters.map((s) => STARTER_NAMES[s] ?? s).join(', ')} can start this election.`;
}
const STARTER_NAMES = { mods: 'a mod', team: 'a Horizon Team member', council: 'a council member', lead: "the group's lead", 'lead-server': 'the Server lead', chiefmod: 'the Chief of Mods' };

// Whether a member of these kinds may start a body vote. Mods: any mod; Team: any Team member; a group: its lead, a
// Team member or a council member. The council may start any.
export function mayStartVote(body, kinds) {
  if (kinds.has('council')) return null;
  if (body === 'mods' && kinds.has('mods')) return null;
  if (body === 'team' && kinds.has('team')) return null;
  if (body.startsWith('group:') && (kinds.has(`lead-${body.slice(6)}`) || kinds.has('team'))) return null;
  return 'Only members of that body (or a council member) start its votes.';
}

// An active group member (GOVERNANCE.md 5.3): held the group's role for groupRoleDays (since: when Kira first saw it,
// null when she saw it before tracking began, which counts as long enough) and has a counted contribution in the
// last activeDays (recent: merged pull requests + reviews with the group's label).
export const isActive = ({ since = null, recent = 0 }, now) => (since == null || now - since >= RULES.groupRoleDays * DAY) && recent >= 1;

// The voters of an election or body vote, without whoever it is about and those left out for a conflict. members:
// [{ id, kinds: Set, active?: { [group]: bool } }]. → sorted ids.
export function electorate(body, members, { exclude = [] } = {}) {
  const out = new Set();
  const group = body.startsWith('group:') ? body.slice(6) : null;
  for (const m of members) {
    const k = m.kinds;
    const yes = body === 'mods' ? k.has('mods')
      : body === 'team' ? k.has('team')
        : body === 'op' ? k.has('mods') || k.has('lead-server')
          : group ? k.has('team') || !!m.active?.[group] : false;
    if (yes) out.add(String(m.id));
  }
  for (const id of exclude) out.delete(String(id));
  return [...out].sort();
}

// ── Floors (GOVERNANCE.md 5.2): what Kira can measure ────────────────────────
// ev: { inGuild, bot, joinedAt, level, verified, merged, reviews, areaMerged, areaReviews, lastCaseAt, declared,
//       roles: Set of kinds, modSince }. → the lines that fall short (empty: the floor is met). These lines go only to
// the candidate, privately: never to the person starting, never in public.
export const FLOORS = {
  mod: { daysInServer: 30, level: 10 },
  chiefmod: { modDays: 30 },
  op: {},
  lead: { daysInServer: 30, verified: true, areaMerged: 8, areaReviews: 20 },
  team: { daysInServer: 30, verified: true, merged: 40, reviews: 20 },
};
export const AREA_MERGED = { translations: 5 }; // Translations: 5 merged translation pull requests (5.2)

export function shortOf(post, group, ev, now) {
  const f = FLOORS[post] ?? {};
  const out = [];
  if (!ev?.inGuild || ev.bot) return ['you need to be a member of the Discord server'];
  if (!ev.declared) out.push('the 18+ declaration: run `/age-declaration` (only you see it)');
  if (ev.lastCaseAt && now - ev.lastCaseAt < 90 * DAY) out.push('a clean record: no timeout, quarantine or ban in the last 90 days');
  if (f.daysInServer && (!ev.joinedAt || now - ev.joinedAt < f.daysInServer * DAY)) out.push(`${f.daysInServer} days in the server`);
  if (f.level && (ev.level ?? 0) < f.level) out.push(`Kira level ${f.level} (now ${ev.level ?? 0})`);
  if (f.verified && !ev.verified) out.push('a verified GitHub account: `/link-github`, then `/verify-github`');
  if (f.merged && (ev.merged ?? 0) < f.merged) out.push(`${f.merged} merged pull requests (now ${ev.merged ?? 0})`);
  if (f.reviews && (ev.reviews ?? 0) < f.reviews) out.push(`${f.reviews} reviews of others' pull requests (now ${ev.reviews ?? 0})`);
  if (f.areaMerged) {
    const need = AREA_MERGED[group] ?? f.areaMerged;
    const merged = ev.areaMerged ?? 0;
    const reviews = ev.areaReviews ?? 0;
    const ok = group === 'translations' ? merged >= need : merged >= need || reviews >= f.areaReviews;
    if (!ok) out.push(group === 'translations' ? `${need} merged translation pull requests (now ${merged})` : `in the group's area, ${need} merged pull requests or ${f.areaReviews} reviews (now ${merged} and ${reviews})`);
  }
  if (f.modDays && (!ev.roles?.has('mods') || (ev.modSince != null && now - ev.modSince < f.modDays * DAY))) out.push(`${f.modDays} days as a moderator`);
  return out;
}

// ── Starting: cooldown, cap, seats ───────────────────────────────────────────

// The failed or vetoed election that blocks this person, post and action now, or null. log: the decisions log. A
// candidate who lost an approval ballot failed too; a failed recall can't be started again for 30 days either.
export function cooldownBlock(log, { post, group = null, member, action = 'add' }, now) {
  const m = String(member);
  const same = (d) => d.post === post && (d.group ?? null) === (group ?? null) && (d.action ?? 'add') === action;
  const lost = (d) => !d.result?.passed || (d.result?.winner && d.result.winner !== m);
  return log.filter((d) => d.type === 'election' && same(d) && (d.candidates ?? []).includes(m) && lost(d) && now - d.closedAt < RULES.cooldownDays * DAY).at(-1)
    ?? log.filter((d) => d.type === 'veto' && same(d) && d.member === m && d.passed && now - d.at < RULES.cooldownDays * DAY).at(-1)
    ?? null;
}

// How many seats this post has in this group now. activeCount: the group's active members (a co-lead from coLeadAt).
export const seatsFor = (post, activeCount = 0) => (post === 'lead' ? (activeCount >= RULES.coLeadAt ? 2 : 1) : POSTS[post].seats);

// Whether an add-election may start, or which open election the nominee joins. open: the open elections; holders:
// ids holding the post's role; council polls: the open council polls (state.polls). → { ok, join?: election } or
// { ok: false, why } (why is for the person starting: never about the candidate's floor or age).
export function startCheck({ post, group = null, member, action, starter }, { open = [], holders = [], polls = [], log = [], seats = null, now }) {
  const m = String(member);
  if (m === String(starter)) return { ok: false, why: "You can't start an election about yourself: ask someone who can start it." };
  const roleKey = roleKeyOf(post, group);
  const body = bodyOf(post, group);
  if (action === 'add' && holders.includes(m)) return { ok: false, why: 'They already hold this post.' };
  if (action === 'remove' && !holders.includes(m) && post !== 'op') return { ok: false, why: "They don't hold this post." };
  if (roleKey && polls.some((p) => p.outcome?.member === m && p.outcome?.role === roleKey)) return { ok: false, why: 'The council is already voting on this person and post.' };
  if (open.some((e) => e.post === post && (e.group ?? null) === (group ?? null) && e.candidates.includes(m))) return { ok: false, why: 'An election about them for this post is already running.' };
  const blocked = cooldownBlock(log, { post, group, member: m, action }, now);
  if (blocked) return { ok: false, why: `This can't be started again for this person and post before ${new Date((blocked.closedAt ?? blocked.at) + RULES.cooldownDays * DAY).toISOString().slice(0, 10)} (${blocked.id}).` };
  if (action === 'add' && seats != null) {
    const same = open.find((e) => e.action === 'add' && e.post === post && (e.group ?? null) === (group ?? null));
    if (same) {
      if (same.stage === 'nominating' || now < same.joinUntil) {
        if (same.candidates.length >= RULES.maxCandidates) return { ok: false, why: `That seat's ballot is full (${RULES.maxCandidates} candidates).` };
        return { ok: true, join: same };
      }
      return { ok: false, why: "An election for this seat is running and its 12 hours for more candidates are over: wait for its result." };
    }
    if (holders.length >= seats) return { ok: false, why: 'This seat is held: it changes only by a recall or the 6-month confirmation.' };
  }
  if (open.filter((e) => e.body === body).length >= RULES.maxOpen) return { ok: false, why: `This body already has ${RULES.maxOpen} elections running: wait for one to end.` };
  return { ok: true };
}

// ── The count ────────────────────────────────────────────────────────────────

export const quorumOf = (n) => Math.max(RULES.minVoters, Math.ceil(n / 3));

// One candidate (or a body vote): ballots id → 'yes' | 'no' | 'abstain'. tieBreaker: the id whose Yes or No settles a
// tie (the Chief of Mods in the mods' votes), if they are a voter. → { yes, no, abstain, voted, size, needed, quorum,
// passed, why }.
export function countYesNo({ ballots, voters, threshold, tieBreaker = null }) {
  const set = new Set(voters);
  const n = { yes: 0, no: 0, abstain: 0 };
  for (const [id, b] of Object.entries(ballots ?? {})) if (set.has(id) && b in n) n[b]++;
  const voted = n.yes + n.no + n.abstain;
  const needed = quorumOf(set.size);
  const quorum = set.size >= RULES.minVoters && voted >= needed;
  let passed = false;
  let why;
  if (!quorum) why = 'no quorum';
  else if (threshold === 'two-thirds') {
    passed = n.yes + n.no > 0 && n.yes * 3 >= 2 * (n.yes + n.no) && n.yes >= 3;
    why = passed ? 'two thirds' : 'fewer than two thirds Yes, or fewer than 3 Yes';
  } else if (n.yes === n.no) {
    const tb = tieBreaker && set.has(String(tieBreaker)) ? ballots?.[tieBreaker] : null;
    passed = tb === 'yes';
    why = tb === 'yes' || tb === 'no' ? `tie, broken by the Chief of Mods (${tb === 'yes' ? 'Yes' : 'No'})` : 'tie';
  } else {
    passed = n.yes > n.no;
    why = passed ? 'majority' : 'majority No';
  }
  return { ...n, voted, size: set.size, needed, quorum, passed, why };
}

// Whether the result can still change: cast ballots are taken as they are, and the voters who haven't voted yet could
// all vote Yes, or all No. → { locked, passed }.
export function lockedYesNo({ ballots, voters, threshold, tieBreaker = null }) {
  const rest = voters.filter((id) => !Object.hasOwn(ballots ?? {}, id));
  const all = (b) => ({ ...ballots, ...Object.fromEntries(rest.map((id) => [id, b])) });
  const canPass = countYesNo({ ballots: all('yes'), voters, threshold, tieBreaker }).passed;
  const now = countYesNo({ ballots, voters, threshold, tieBreaker }).passed;
  const canFail = !now || !countYesNo({ ballots: all('no'), voters, threshold, tieBreaker }).passed;
  return { locked: !(canPass && canFail), passed: canPass && !canFail };
}

// Several candidates: ballots id → [approved candidate ids] ([] = abstain). The seat goes to the most approvals if it
// is unique and at least half of the voters; otherwise a run-off of the top two (ties for a place: the earlier
// nominee). → { counts, voted, size, needed, quorum, winner, runoff: [a, b] | null, passed, why }.
export function countApproval({ ballots, voters, candidates }) {
  const set = new Set(voters);
  const counts = Object.fromEntries(candidates.map((c) => [c, 0]));
  let voted = 0;
  for (const [id, list] of Object.entries(ballots ?? {})) {
    if (!set.has(id) || !Array.isArray(list)) continue;
    voted++;
    for (const c of new Set(list)) if (c in counts) counts[c]++;
  }
  const needed = quorumOf(set.size);
  const quorum = set.size >= RULES.minVoters && voted >= needed;
  const order = [...candidates].sort((a, b) => counts[b] - counts[a] || candidates.indexOf(a) - candidates.indexOf(b));
  const [first, second] = order;
  const base = { counts, voted, size: set.size, needed, quorum, winner: null, runoff: null, passed: false };
  if (!quorum) return { ...base, why: 'no quorum' };
  if (counts[first] === 0) return { ...base, why: 'no approvals' };
  if (counts[first] > (counts[second] ?? -1) && counts[first] * 2 >= voted) return { ...base, winner: first, passed: true, why: 'most approvals, at least half of the voters' };
  if (second == null || counts[second] === 0) return { ...base, why: 'fewer than half of the voters approved anyone' };
  return { ...base, runoff: [first, second], why: 'run-off of the top two' };
}

// An approval ballot is locked once the leader can't be caught and keeps half of the voters even if everyone left
// votes for the runner-up alone. Otherwise it runs to the end (or until everyone voted).
export function lockedApproval({ ballots, voters, candidates }) {
  const r = countApproval({ ballots, voters, candidates });
  const rest = voters.filter((id) => !Object.hasOwn(ballots ?? {}, id)).length;
  if (!rest) return { locked: true, passed: r.passed };
  if (!r.quorum || !r.winner) return { locked: false, passed: false };
  const others = candidates.filter((c) => c !== r.winner).map((c) => r.counts[c]);
  const lead = r.counts[r.winner];
  return { locked: lead > Math.max(0, ...others) + rest && lead * 2 >= r.voted + rest, passed: true };
}

// A run-off: ballots id → candidate id | 'abstain'. More votes wins; a tie fails.
export function countRunoff({ ballots, voters, pair }) {
  const set = new Set(voters);
  const n = { [pair[0]]: 0, [pair[1]]: 0 };
  let voted = 0;
  for (const [id, b] of Object.entries(ballots ?? {})) {
    if (!set.has(id)) continue;
    if (b === 'abstain' || b in n) voted++;
    if (b in n) n[b]++;
  }
  const needed = quorumOf(set.size);
  const quorum = set.size >= RULES.minVoters && voted >= needed;
  const [a, b] = pair;
  const winner = quorum && n[a] !== n[b] ? (n[a] > n[b] ? a : b) : null;
  return { counts: n, voted, size: set.size, needed, quorum, winner, passed: !!winner, why: !quorum ? 'no quorum' : winner ? 'more votes' : 'tie' };
}

export function lockedRunoff({ ballots, voters, pair }) {
  const r = countRunoff({ ballots, voters, pair });
  const rest = voters.filter((id) => !Object.hasOwn(ballots ?? {}, id)).length;
  if (!rest) return { locked: true, passed: r.passed };
  const gap = Math.abs(r.counts[pair[0]] - r.counts[pair[1]]);
  return { locked: r.quorum && gap > rest, passed: r.quorum && gap > rest };
}

// ── Veto, seats, reminders ───────────────────────────────────────────────────

// Whether a council veto can still be called on a result closed at `closedAt`.
export const vetoOpen = (closedAt, now) => now - closedAt < RULES.vetoHours * HOUR;

// The seats that just became empty: before/after map seat → [holder ids]. A seat empty in `before` (or never seen) is
// not a vacancy: the monthly reminder covers seats that were never filled.
export const vacated = (before, after) => Object.keys(after).filter((k) => (before?.[k]?.length ?? 0) > 0 && (after[k]?.length ?? 0) === 0);

// The month key ('2026-11') reminders were last sent for, and whether they are due now (once a month, from day 1).
export const monthOf = (ms) => new Date(ms).toISOString().slice(0, 7);
export const monthlyDue = (last, now) => last !== monthOf(now);

// Whether a group gets the monthly reminder: no lead, or someone active in it meets the lead floor.
export const groupReminderDue = ({ leads = 0, meetsFloor = 0 }) => leads === 0 || meetsFloor > 0;

// ── Texts ────────────────────────────────────────────────────────────────────

export const thresholdText = (t, body) => (t === 'two-thirds' ? 'two thirds of Yes + No, and at least 3 Yes' : `more Yes than No${body === 'mods' ? ' (the Chief of Mods breaks a tie)' : ''}`);
export const notNow = (name) => `Kira can't open this election now: ${name} doesn't meet this post's requirements yet. Kira told them privately what's missing; nothing was posted.`;
export const shortDm = (postLabel, lines) => [
  `Someone wanted to start an election for **${postLabel}** with you as the candidate. It can't open yet, because this is still missing:`,
  ...lines.map((l) => `• ${l}`),
  'Nobody else sees this list. Once it is done, they can start it again.',
].join('\n');
