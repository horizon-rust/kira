// Council polls with no Discord (horizon-rust/horizon GOVERNANCE.md section 4; src/features/poll.js does the talking):
// the kinds and their thresholds, who may vote, the count, the reminders and the 7-day rule on asking again.
//
// A poll lasts 24 hours and closes early once every eligible member has voted. Ballots: yes, no, abstain, and a member
// may change theirs until the close. Quorum: at least half of the eligible members vote (abstain counts). Simple
// majority: more Yes than No. Two-thirds: Yes is at least 2/3 of Yes + No, and at least 3 Yes. A tie fails. Eligible:
// the council, without the member the poll is about and without anyone who recused themselves.

export const HOUR = 3_600_000;
export const POLL = { hours: 24, remindAt: [12, 2], repeatDays: 7, reopenSigners: 2, minYesTwoThirds: 3 };

// Every kind: its threshold, and where it runs ('public': #polls-and-decisions; 'council': #council, only the result
// is public). A role change that removes someone always runs in #council (a poll about a person).
export const KINDS = {
  decision: { pass: 'simple', where: 'public', label: 'Project decision' },
  rule: { pass: 'two-thirds', where: 'public', label: 'Rules (GOVERNANCE.md, server rules, contributing policy, licence)' },
  money: { pass: 'two-thirds', where: 'public', label: 'Money' },
  accounts: { pass: 'two-thirds', where: 'public', label: 'Account handover step' },
  waiver: { pass: 'two-thirds', where: 'public', label: 'Waiving part of the selection filter' },
  size: { pass: 'two-thirds', where: 'public', label: "The council's size" },
  'member-add': { pass: 'two-thirds', where: 'public', label: 'Adding a council or Horizon Team member', roles: ['council', 'team'], action: 'add' },
  'member-remove': { pass: 'two-thirds', where: 'council', label: 'Removing a council or Horizon Team member', roles: ['council', 'team'], action: 'remove' },
  lead: { pass: 'simple', where: 'public', label: 'Group lead: appoint, remove, confirm', roles: 'lead', action: 'any' },
  mod: { pass: 'simple', where: 'public', label: 'Moderator, Chief of Mods, Support: confirm or remove', roles: ['mod', 'chiefmod', 'support'], action: 'any' },
  'probation-end': { pass: 'simple', where: 'public', label: 'Ending a probation early' },
  'emergency-confirm': { pass: 'simple', where: 'public', label: 'Confirming an emergency action' },
  appeal: { pass: 'simple', where: 'council', label: 'Second-level moderation appeal' },
  age: { pass: 'simple', where: 'council', label: 'An 18+ case' },
  return: { pass: 'simple', where: 'public', label: 'Bringing back someone who stepped down for inactivity', roles: 'any', action: 'add' },
  // Opened only by the Veto button under a body's result (src/features/elections.js), never by /poll start.
  veto: { pass: 'simple', where: 'public', label: "Council veto of a body's vote or election", internal: true },
};

// GOVERNANCE.md 4.2: 48 hours for this document, the licence, money and the GitHub organisation's ownership (money
// always; a rule or accounts poll when its opener says it is one of those). Only with KIRA_ELECTIONS on.
export const LONG = { hours: 48, always: ['money'], optional: ['rule', 'accounts'] };
export function hoursFor(kind, long, on) {
  if (!on) return { hours: POLL.hours };
  if (LONG.always.includes(kind)) return { hours: LONG.hours };
  if (!long) return { hours: POLL.hours };
  if (LONG.optional.includes(kind)) return { hours: LONG.hours };
  return { why: '48 hours is only for this document, the licence, money and the GitHub organisation\'s ownership.' };
}

export const LEAD_ROLES = ['lead-modding', 'lead-rendering', 'lead-performance', 'lead-launcher', 'lead-server', 'lead-translations', 'lead-website', 'lead-parity', 'lead-ui'];
export const ROLE_KEYS = ['council', 'team', 'chiefmod', 'mod', 'support', ...LEAD_ROLES];

const rolesOf = (spec) => (spec === 'lead' ? LEAD_ROLES : spec === 'any' ? ROLE_KEYS : spec);

// Whether a poll may start. p: { kind, question, member, role, action, opener }; council: the registry (id → login);
// log: the decisions (for the 7-day rule); now. → { ok: true, poll } with the poll's fixed fields, or { ok: false, why }.
export function check(p, { council, log = [], now }) {
  const kind = KINDS[p.kind];
  if (!Object.hasOwn(council, String(p.opener))) return { ok: false, why: 'Only council members start a poll. Ask one of them to start it for you.' };
  if (!kind) return { ok: false, why: 'Unknown kind of poll.' };
  if (kind.internal) return { ok: false, why: 'A veto starts from the Veto button under the result it is about.' };
  const question = String(p.question ?? '').replace(/\s+/g, ' ').trim();
  if (question.length < 10) return { ok: false, why: 'Write the question in a full sentence (10 characters or more).' };
  if (question.length > 1000) return { ok: false, why: 'The question is too long (1000 characters at most): link a thread for the details.' };
  let outcome = null;
  if (kind.roles) {
    if (!p.member || !p.role) return { ok: false, why: 'This kind of poll changes a role: give the member and the role.' };
    if (!rolesOf(kind.roles).includes(p.role)) return { ok: false, why: `A ${p.kind} poll can't change that role.` };
    const action = kind.action === 'any' ? p.action : kind.action;
    if (!['add', 'remove'].includes(action)) return { ok: false, why: 'Say whether the role is given or taken (action).' };
    if (p.action && p.action !== action) return { ok: false, why: `A ${p.kind} poll can only ${kind.action} a role.` };
    if (action === 'add' && p.role === 'council' && Object.hasOwn(council, String(p.member))) return { ok: false, why: 'That member is already on the council.' };
    if (action === 'remove' && p.role === 'council' && !Object.hasOwn(council, String(p.member))) return { ok: false, why: 'That member is not on the council.' };
    outcome = { member: String(p.member), role: p.role, action };
  } else if (p.role || p.action) return { ok: false, why: `A ${p.kind} poll changes no role: leave the role and the action out, or pick a kind that does.` };
  const poll = { kind: p.kind, question, threshold: kind.pass, where: outcome?.action === 'remove' ? 'council' : kind.where, subject: outcome?.member ?? (p.member ? String(p.member) : null), outcome, key: keyOf({ kind: p.kind, question, outcome }) };
  const blocked = repeatBlocked(log, poll.key, now);
  if (blocked) return { ok: false, why: `The same poll failed on ${new Date(blocked.closedAt).toISOString().slice(0, 10)} (${blocked.id}): it can be asked again after ${POLL.repeatDays} days, unless two council members sign \`/poll reopen\` for it.` };
  return { ok: true, poll };
}

// What makes two polls "the same" for the 7-day rule: the role change, else the kind and the question's words.
export function keyOf({ kind, question, outcome }) {
  if (outcome) return `${kind}:${outcome.member}:${outcome.role}:${outcome.action}`;
  return `${kind}:${String(question).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`;
}

// The failed poll that blocks `key` now, or null. A `reopen` entry signed by enough members after it lifts the block.
export function repeatBlocked(log, key, now) {
  const failed = log.filter((d) => d.type === 'poll' && d.key === key && !d.result?.passed && now - d.closedAt < POLL.repeatDays * 24 * HOUR).at(-1);
  if (!failed) return null;
  const signers = new Set(log.filter((d) => d.type === 'reopen' && d.of === failed.id).map((d) => d.by));
  return signers.size >= POLL.reopenSigners ? null : failed;
}

// Who votes: the council without the member the poll is about and without those who recused themselves.
export const eligible = (council, poll) => Object.keys(council).filter((id) => id !== poll.subject && !(poll.recused ?? []).includes(id));

// Whether `id` may cast a ballot on this poll now. → null, or why not.
export function mayVote(id, council, poll) {
  if (!Object.hasOwn(council, id)) return 'Only council members vote. Anyone may comment in the thread.';
  if (id === poll.subject) return "This poll is about you: you don't vote on it.";
  if ((poll.recused ?? []).includes(id)) return 'You recused yourself from this poll.';
  if (poll.closedAt) return 'This poll is closed.';
  return null;
}

// The count. ballots: id → 'yes' | 'no' | 'abstain' (only eligible ids count); threshold: 'simple' | 'two-thirds'.
export function outcome({ ballots, eligible: ids, threshold }) {
  const set = new Set(ids);
  const n = { yes: 0, no: 0, abstain: 0 };
  for (const [id, b] of Object.entries(ballots ?? {})) if (set.has(id) && b in n) n[b]++;
  const voted = n.yes + n.no + n.abstain;
  const needed = Math.ceil(set.size / 2);
  const quorum = set.size > 0 && voted >= needed;
  let passed = false;
  let why;
  if (!quorum) why = 'no quorum';
  else if (threshold === 'two-thirds') {
    passed = n.yes + n.no > 0 && n.yes * 3 >= 2 * (n.yes + n.no) && n.yes >= POLL.minYesTwoThirds;
    why = passed ? 'two thirds' : n.yes * 3 >= 2 * (n.yes + n.no) && n.yes + n.no > 0 ? `fewer than ${POLL.minYesTwoThirds} Yes` : 'fewer than two thirds Yes';
  } else {
    passed = n.yes > n.no;
    why = passed ? 'majority' : n.yes === n.no ? 'tie' : 'majority No';
  }
  return { ...n, voted, size: set.size, needed, quorum, threshold, passed, why };
}

// Whether every eligible member has voted (the poll then closes early).
export const allVoted = (ballots, ids) => ids.length > 0 && ids.every((id) => Object.hasOwn(ballots ?? {}, id));

// The reminders due now: [{ mark, ids }] for each mark (hours before the end) reached and not sent yet; ids: the
// eligible members who haven't voted. Marks already past when the poll started are skipped.
export function remindersDue(poll, ids, now) {
  const out = [];
  for (const h of POLL.remindAt) {
    const at = poll.endsAt - h * HOUR;
    if (now < at || (poll.reminded ?? []).includes(h) || poll.startedAt > at) continue;
    out.push({ mark: h, ids: ids.filter((id) => !Object.hasOwn(poll.ballots ?? {}, id)) });
  }
  return out;
}

// ── Texts ────────────────────────────────────────────────────────────────────

const ROLE_NAMES = {
  council: '🏛️ Council', team: '🌌 Horizon Team', chiefmod: '🛡️ Chief of Mods', mod: '🛡️ Mod', support: '🤝 Support',
  'lead-modding': '🧭 Modding lead', 'lead-rendering': '🧭 Rendering lead', 'lead-performance': '🧭 Performance lead', 'lead-launcher': '🧭 Launcher lead',
  'lead-server': '🧭 Server lead', 'lead-translations': '🧭 Translations lead', 'lead-website': '🧭 Website lead', 'lead-parity': '🧭 Parity lead', 'lead-ui': '🧭 UI lead',
};
export const roleName = (key) => ROLE_NAMES[key] ?? key;
export const thresholdText = (t) => (t === 'two-thirds' ? `two thirds of Yes + No, and at least ${POLL.minYesTwoThirds} Yes` : 'more Yes than No');
export const outcomeText = (o) => (o ? `${o.action === 'add' ? 'give' : 'take'} ${roleName(o.role)} ${o.action === 'add' ? 'to' : 'from'} <@${o.member}>` : null);

// The result line (no ping): counts, threshold, and what Kira applies.
export function resultLine(poll, r) {
  const counts = `${r.yes} Yes, ${r.no} No, ${r.abstain} Abstain; ${r.voted} of ${r.size} voted, ${r.needed} needed`;
  const head = r.passed ? '✅ **Passed**' : `❌ **Not passed** (${r.why})`;
  return `${head}: ${poll.id} · ${KINDS[poll.kind].label} (${counts}; ${thresholdText(r.threshold)}).`;
}
