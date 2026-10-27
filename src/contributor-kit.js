// Who counts as a Horizon contributor, with no Discord: the one-time code that proves a GitHub account is the
// member's, who is verified, the 7-day grace of the role holders who haven't verified, and the merged-PR count.
// src/features/contributors.js does the talking. The data lives in `work` (state.work, shared with the work board):
//   links:      Discord id → GitHub login (/link-github)
//   verified:   Discord id → login proved with /verify-github (or by a mod)
//   challenges: Discord id → { login, code, expires }
//   grace:      Discord id → { until, dmFailed } (holds the role until `until`, then loses it unless verified)
import { randomInt } from 'node:crypto';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/i/l: the code is typed and read by people
export const GIST_FILE = 'kira.txt';
const LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
const same = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

export const newCode = (rand = randomInt) => 'kira-' + Array.from({ length: 8 }, () => ALPHABET[rand(ALPHABET.length)]).join('');

// ── Who is verified ──────────────────────────────────────────────────────────

// `fixed`: the logins the maintainers set in config.js (WORK.github): trusted, no proof needed.
export const loginOf = (work, id, fixed = {}) => work.links?.[id] ?? fixed[id] ?? null;
// Verified: the login in use is the one proved, or the one the maintainers set.
export function isVerified(work, id, fixed = {}) {
  const login = loginOf(work, id, fixed);
  return !!login && (same(work.verified?.[id], login) || same(fixed[id], login));
}
// Every member whose GitHub login is proved: [id, login].
export function verifiedPairs(work, fixed = {}) {
  const ids = new Set([...Object.keys(fixed), ...Object.keys(work.links ?? {})]);
  return [...ids].filter((id) => isVerified(work, id, fixed)).map((id) => [id, loginOf(work, id, fixed)]);
}
// The member a login is verified to.
export const holderOf = (work, login, fixed = {}) => verifiedPairs(work, fixed).find(([, l]) => same(l, login))?.[0] ?? null;

// A login belongs to one member: verifying it takes it from anyone else who had linked it.
export function markVerified(work, id, login) {
  for (const [other, l] of Object.entries(work.links ?? {})) {
    if (other !== id && same(l, login)) clearVerification(work, other, { link: true });
  }
  (work.links ??= {})[id] = login;
  (work.verified ??= {})[id] = login;
  delete work.challenges?.[id];
}
// A changed or removed link, or a removed verification.
export function clearVerification(work, id, { link = false } = {}) {
  delete work.verified?.[id];
  delete work.challenges?.[id];
  if (link) delete work.links?.[id];
}

// ── The code ─────────────────────────────────────────────────────────────────

// The member's pending code for `login` (the same one until it expires, so a second /verify-github doesn't confuse).
export function startChallenge(work, id, login, now, ttlMs, code = newCode()) {
  const c = work.challenges?.[id];
  if (c && same(c.login, login) && c.expires > now) return c;
  return ((work.challenges ??= {})[id] = { login, code, expires: now + ttlMs });
}
export const expired = (challenge, now) => challenge.expires <= now;

// Looks for the code where only the account's owner can write: the profile bio, then a public gist named kira.txt.
export async function codeIsPublished(gh, login, code) {
  if (!LOGIN.test(login)) return false;
  const who = encodeURIComponent(login);
  const user = await gh.get(`/users/${who}`);
  if (typeof user?.bio === 'string' && user.bio.includes(code)) return true;
  const gists = (await gh.get(`/users/${who}/gists?per_page=30`)) ?? [];
  for (const g of gists.filter((x) => x.files?.[GIST_FILE]).slice(0, 3)) {
    const full = await gh.get(`/gists/${encodeURIComponent(g.id)}`);
    if (typeof full?.files?.[GIST_FILE]?.content === 'string' && full.files[GIST_FILE].content.includes(code)) return true;
  }
  return false;
}

// ── Merged pull requests ─────────────────────────────────────────────────────

// How many pull requests by `login` were merged in owner/repo (the search API: its own limit, 30 a minute).
export async function mergedCount(gh, owner, repo, login) {
  if (!LOGIN.test(login)) return 0;
  const q = encodeURIComponent(`repo:${owner}/${repo} is:pr is:merged author:${login}`);
  const found = await gh.get(`/search/issues?q=${q}&per_page=1`);
  return Number(found?.total_count) || 0;
}

// ── Grace ────────────────────────────────────────────────────────────────────

export function startGrace(work, id, now, days) {
  work.grace ??= {};
  return (work.grace[id] ??= { until: now + days * 86_400_000 });
}
export const graceOver = (work, now) => Object.entries(work.grace ?? {}).filter(([, g]) => g.until <= now).map(([id]) => id);

// ── Texts ────────────────────────────────────────────────────────────────────

export const MEANING = '🛠️ Contributor now means a merged PR in Horizon, verified with `/verify-github`; it opens #contributors.';

export const graceDm = (login, until) => `🛠️ **Contributor** now means a merged pull request in Horizon, verified with \`/verify-github\`. Your GitHub account **${login}** has one, so you keep the role if you run \`/verify-github\` in the server before <t:${Math.floor(until / 1000)}:D> (it gives you a code to put in your GitHub bio, takes a minute). After that date the role is removed.`;

export const codeInstructions = (login, challenge) => [
  `To prove **${login}** is yours, put this code in your GitHub profile bio (or in a public gist named \`${GIST_FILE}\`):`,
  `\`${challenge.code}\``,
  `It is valid until <t:${Math.floor(challenge.expires / 1000)}:t>. Then run \`/verify-github check:True\`. You can remove the code afterwards.`,
].join('\n');

export const welcomeLine = (id, login) => `🛠️ Welcome <@${id}>! A pull request by **${login}** is merged in Horizon: you are a contributor now.`;
