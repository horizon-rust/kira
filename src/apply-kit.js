// /apply's texts, with no Discord connection so they can be tested (src/features/apply.js does the talking). The rules
// (who may apply, the cooldown, who decides) are the staff side's: docs/staff-api.md.
import { APPLY } from './config.js';
import { DECISION_TEXTS } from './staff-hooks.js';

const label = (role) => APPLY.roles[role]?.label ?? role;
const when = (ms) => `<t:${Math.floor(ms / 1000)}:D>`;

// Why someone can't apply, from canApply's or issueApplyLink's `why`.
export function refusal(why, role, retryAt = null) {
  if (why === 'has-role') return `You already have ${label(role)}.`;
  if (why === 'open') return `Your application for ${label(role)} is still waiting for an answer: you'll get it by DM.`;
  if (why === 'cooldown') return retryAt ? `You can apply for ${label(role)} again from ${when(retryAt)}.` : `You can't apply for ${label(role)} again yet.`;
  if (why === 'role') return 'Pick one of the roles in the list.';
  return 'Applications are closed right now.';
}

// The DM with the form's link (only ever sent in a DM).
export const linkDm = (role, url, expiresAt) =>
  `Here is your link to apply for **${label(role)}** on Horizon's Discord: <${url}>\nIt is yours only and works once${expiresAt ? `, until ${when(expiresAt)}` : ''}. Don't share it. Asking again with \`/apply\` makes a new one and voids this one.`;

// The applicant's DM once the staff decided.
export function decisionDm(role, outcome, cooldownUntil = null) {
  if (outcome === 'accept') return `🎉 Your application for **${label(role)}** on Horizon's Discord was accepted. Welcome! You now have the role. ${APPLY.roles[role]?.intro ?? ''}`.trim();
  return `Thank you for applying for **${label(role)}** on Horizon's Discord. We are not taking your application this time.${cooldownUntil ? ` You can apply again from ${when(cooldownUntil)}.` : ''}`;
}

// Ludovic's DM when a Team application is accepted.
export const ownerNotice = ({ userId, decidedBy, url }) => DECISION_TEXTS.ownerTeamAccepted({ userId, decidedBy, url });
