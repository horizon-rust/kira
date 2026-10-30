// The line between the staff dashboards (the website's form and dashboards, src/applications.js) and Kira's
// Discord side (/apply, role grants, DMs). Each side registers here; neither imports the other's files.
// docs/staff-api.md is the contract.

export const APPLY_ROLES = ['mod', 'support', 'team'];
export const DECLINE_COOLDOWN_DAYS = 14;

let staff = null; // { canApply, issueApplyLink }: src/applications.js
let discord = null; // { decide, dm, revokeRole? }: the Discord side (src/features/apply.js)

export const setStaffSide = (side) => { staff = side; };
export const setDiscordSide = (side) => { discord = side; };
export const discordSide = () => discord;

const closed = { ok: false, why: 'closed' };
export const canApply = async (userId, role) => (staff ? staff.canApply(userId, role) : closed);
export const issueApplyLink = async (userId, role) => (staff ? staff.issueApplyLink(userId, role) : closed);

// What the staff side asks the Discord side to do once a decision is recorded. Never throws.
export async function decide(event) {
  if (!discord) return { granted: false, dmSent: false, error: 'discord side not loaded' };
  try {
    const r = await discord.decide(event);
    return { granted: !!r?.granted, dmSent: !!r?.dmSent, error: r?.error ?? null };
  } catch (e) {
    return { granted: false, dmSent: false, error: String(e?.message ?? e).slice(0, 200) };
  }
}

// The owner takes back a role an accepted application gave (from the dashboard). Never throws.
export async function revokeRole(event) {
  if (!discord?.revokeRole) return { removed: false, error: 'discord side not loaded: remove the role in Discord by hand' };
  try {
    const r = await discord.revokeRole(event);
    return { removed: !!r?.removed, error: r?.error ?? null };
  } catch (e) {
    return { removed: false, error: String(e?.message ?? e).slice(0, 200) };
  }
}

// A DM the staff side asks Kira to send (Ludovic's veto window: DECISION_TEXTS.vetoWindow). Never throws.
export async function dm({ userId, content }) {
  if (!discord?.dm) return { sent: false, error: 'discord side not loaded' };
  try {
    const r = await discord.dm({ userId, content });
    return { sent: !!r?.sent, error: r?.error ?? null };
  } catch (e) {
    return { sent: false, error: String(e?.message ?? e).slice(0, 200) };
  }
}

const NAMES = { mod: '🛡️ Mod', support: '🤝 Support', team: '🌌 Horizon Team' };
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// Default texts for the Discord side's DMs (docs/staff-api.md, "Texts").
export const DECISION_TEXTS = {
  accept: (role) => [
    `Your application for ${NAMES[role]} on Horizon's Discord was accepted. Welcome! You now have the role.`,
    role === 'team' ? 'Only the Discord role was given: access to the GitHub organisation or its teams is set up by Ludovic by hand, and he has been told.' : null,
  ].filter(Boolean).join('\n'),
  decline: (role, cooldownUntil) => `Thank you for applying for ${NAMES[role]} on Horizon's Discord. We are not taking your application this time. You can apply again from ${day(cooldownUntil)}.`,
  // To Ludovic (OWNER_ID), the one DM he gets about an application: the vote passed and his veto window opened. Sent by
  // the staff side through dm(); the Discord side's decide() never DMs him (2026-10-30: no second DM).
  vetoWindow: ({ userId, role, yes, no, url, until }) => [
    `🗳️ The vote passed: <@${userId}> for ${NAMES[role]} (${yes} for, ${no} against). It goes through <t:${Math.floor(until / 1000)}:R> unless you veto it on the card: ${url}`,
    role === 'team' ? 'Once it does, GitHub organisation or team access is yours to give by hand.' : null,
  ].filter(Boolean).join('\n'),
};
