// Governance with no Discord (horizon-rust/horizon GOVERNANCE.md): who is on the council, and who holds each power
// that used to be the owner's. Off until the launch (GOVERNANCE.on, KIRA_GOVERNANCE=on): while it is off, every
// check here answers exactly as before (the owner alone), so turning the flag off undoes the switch.
//
// The council registry: the founding six in config (GOVERNANCE.founding), then state.council once a passed poll has
// changed it (src/features/poll.js applies outcomes). Discord id → GitHub login.

// The owner-only powers, sorted (GOVERNANCE.md sections 3, 10 and 11):
// - council: a project decision. With the flag on, the council holds it (by poll, or any one member where the
//   document says one member may act); the owner keeps it only as one of the council.
// - account: the account holder's own things (his spending, his accounts, his machines). Stays his.
// - unchanged: plain operations, or a rule about Ludovic's own data (his pull requests are his agents'); no power.
export const POWERS = {
  'team-vote': { kind: 'council', where: 'features/teamvote.js', note: 'Team membership: a 2/3 council poll (/poll) replaces /team-vote' },
  'team-roles': { kind: 'council', where: 'features/teamroles.js', note: 'any team role: the staff roles, plus 🏛️ Council' },
  'application-owner': { kind: 'council', where: 'features/staff-apply.js, application-votes.js', note: "the 12 h veto becomes a council objection window: planned (build plan 3.11), unchanged until then" },
  'kira-ai': { kind: 'account', where: 'features/ai.js', note: "Kira's AI spending is the account holder's budget (the mods may also switch it)" },
  'agents-maintainer': { kind: 'account', where: 'features/agents.js', note: 'agent tokens run on the account holder’s services' },
  'org-chart-owner': { kind: 'unchanged', where: 'bot.js, org-chart.js', note: 'the 👑 Founder tier: symbolic, no power (Ludovic, 2026-11-09)' },
  'staff-dashboards': { kind: 'unchanged', where: 'features/staff.js', note: 'the owner sees both dashboards; council members do through their roles' },
  'triage-pause': { kind: 'unchanged', where: 'features/triage.js', note: 'the owner and the mods: an operational stop' },
  'contributor-self': { kind: 'unchanged', where: 'features/contributors.js', note: "Ludovic's pull requests are his agents': no rank" },
  'moderation-exempt': { kind: 'unchanged', where: 'features/moderation.js, batchmod.js', note: 'the owner is never auto-moderated' },
  'channel-overwrites': { kind: 'unchanged', where: 'setup.js, features/modcases.js', note: "the owner's overwrites on staff channels" },
};

// The council now: Discord id → GitHub login.
export const registry = (state, gov) => ({ ...(state?.council ?? gov.founding) });

// Whether `id` sits on the council. Always false while governance is off: nothing changes before the launch.
export const isCouncil = (id, { state, gov }) => !!gov.on && !!id && Object.hasOwn(registry(state, gov), String(id));

// Whether `id` may use `power` (a POWERS key). Off: the owner, as before. On: council powers go to the council,
// account powers stay the owner's.
export function may(power, id, { state, gov, ownerId }) {
  const p = POWERS[power];
  if (!p) throw new Error(`unknown power ${power}`);
  if (!gov.on || p.kind !== 'council') return id === ownerId;
  return isCouncil(id, { state, gov });
}

// A new registry with `id` added (login: their GitHub login, may be '') or removed. → { council } or { why }.
// It never writes state: the caller stores it once the poll's outcome is applied.
export function change(state, gov, { id, login = '', add }) {
  const council = registry(state, gov);
  const key = String(id ?? '');
  if (!/^\d{5,25}$/.test(key)) return { why: 'Not a Discord member id.' };
  if (add) {
    if (Object.hasOwn(council, key)) return { why: 'Already on the council.' };
    if (Object.keys(council).length >= gov.maxSize) return { why: `The council is full (${gov.maxSize} seats): a 2/3 poll on its size comes first.` };
    council[key] = String(login ?? '');
  } else {
    if (!Object.hasOwn(council, key)) return { why: 'Not on the council.' };
    delete council[key];
  }
  return { council };
}
