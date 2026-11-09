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

// Reads a public GitHub API path without a token (60 requests an hour per address).
export async function publicGet(path) {
  const r = await fetch(`https://api.github.com${path}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'kira' } });
  if (!r.ok) throw new Error(`GitHub GET ${path} without a token: HTTP ${r.status}`);
  return r.json();
}

// Looks for the code where only the account's owner can write: the profile bio, then a public gist named kira.txt.
// A GitHub App's token may not read gists (HTTP 403 "Resource not accessible by integration"), so public gists are
// then read without it (`pub`).
export async function codeIsPublished(gh, login, code, pub = publicGet) {
  if (!LOGIN.test(login)) return false;
  const who = encodeURIComponent(login);
  const user = await gh.get(`/users/${who}`);
  if (typeof user?.bio === 'string' && user.bio.includes(code)) return true;
  const get = (path) => gh.get(path).catch((e) => (/HTTP 403/.test(e?.message ?? '') ? pub(path) : Promise.reject(e)));
  const gists = (await get(`/users/${who}/gists?per_page=30`)) ?? [];
  for (const g of gists.filter((x) => x.files?.[GIST_FILE]).slice(0, 3)) {
    const full = await get(`/gists/${encodeURIComponent(g.id)}`);
    if (typeof full?.files?.[GIST_FILE]?.content === 'string' && full.files[GIST_FILE].content.includes(code)) return true;
  }
  return false;
}

// ── Merged pull requests ─────────────────────────────────────────────────────

// How many pull requests by `login` were merged in owner/repo (the search API: its own limit, 30 a minute).
export async function mergedCount(gh, owner, repo, login) {
  return searchCount(gh, `repo:${owner}/${repo}`, login);
}
// The same summed over every PUBLIC repo of the org `owner`, in one search. `is:public` matters: a bare `org:` also
// counts the private repos the token can see (checked on 2026-11-09: 2198 public + 149 private = 2347).
export async function mergedPublicCount(gh, owner, login) {
  return searchCount(gh, `org:${owner} is:public`, login);
}
async function searchCount(gh, scope, login) {
  if (!LOGIN.test(login)) return 0;
  const q = encodeURIComponent(`${scope} is:pr is:merged author:${login}`);
  const found = await gh.get(`/search/issues?q=${q}&per_page=1`);
  return Number(found?.total_count) || 0;
}

// Every distinct GitHub login that has a merged pull request in owner/repo, bots left out. The search API shows only
// the first 1000 results of a query, so the merge dates are split into windows (halved while one holds more than 1000).
export async function mergedAuthors(gh, owner, repo, { today = new Date(), sleep = async () => {}, paceMs = 0 } = {}) {
  const day = (d) => d.toISOString().slice(0, 10);
  const created = (await gh.get(`/repos/${owner}/${repo}`))?.created_at;
  const first = new Date(Date.parse(created ?? '') || Date.parse('2026-01-01'));
  const authors = new Map(); // lowercase login → login as GitHub writes it
  const search = async (from, to, page) => {
    const q = encodeURIComponent(`repo:${owner}/${repo} is:pr is:merged merged:${day(from)}..${day(to)}`);
    await sleep(paceMs);
    return (await gh.get(`/search/issues?q=${q}&per_page=100&page=${page}`, { cache: false })) ?? { total_count: 0, items: [] };
  };
  const window = async (from, to) => {
    const head = await search(from, to, 1);
    const total = Number(head.total_count) || 0;
    if (total > 1000 && to - from >= 86_400_000) {
      const mid = new Date(from.getTime() + Math.floor((to - from) / 2 / 86_400_000) * 86_400_000);
      await window(from, mid);
      return window(new Date(mid.getTime() + 86_400_000), to);
    }
    for (let page = 1; (page - 1) * 100 < Math.min(total, 1000); page++) {
      const found = page === 1 ? head : await search(from, to, page);
      for (const item of found.items ?? []) {
        const login = item.user?.login;
        if (login && LOGIN.test(login) && item.user?.type !== 'Bot') authors.set(login.toLowerCase(), login);
      }
    }
  };
  await window(first, today);
  return authors;
}

// ── Ranks ────────────────────────────────────────────────────────────────────
// `ranks`: [{ key, min, name }] lowest first (CONTRIBUTORS.ranks with the role names); the first is the base role,
// 🛠️ Contributor. The ranks above it are held one at a time (the highest reached), with the base kept. They count
// merged pull requests in every public repo of the org, summed. Ranks only go up: `reached` ({ key, login } in work.ranks) keeps the
// best one a member had with the login they still have verified; a new login starts again from its own count.

export const rankIndex = (ranks, key) => ranks.findIndex((r) => r.key === key);
// The highest rank `count` reaches, or null under the base.
export const rankFor = (ranks, count) => ranks.filter((r) => count >= r.min).at(-1) ?? null;
// The next rank above `count`, or null at the top.
export const nextRank = (ranks, count) => ranks.find((r) => count < r.min) ?? null;

// The rank a verified member should hold now: the count's, or the one already reached with this login if higher.
export function targetRank(ranks, count, login, reached = null) {
  const byCount = rankFor(ranks, count);
  const kept = reached && same(reached.login, login) ? ranks[rankIndex(ranks, reached.key)] ?? null : null;
  if (!kept) return byCount;
  return !byCount || rankIndex(ranks, kept.key) > rankIndex(ranks, byCount.key) ? kept : byCount;
}

// The rank roles to add and remove (keys) so a member holds `target` and the base, and no other rank above the base.
// `held`: the rank keys they hold now. The base is only added here, never removed.
export function rankRoles(ranks, held, target) {
  const want = new Set(target ? [ranks[0].key, target.key] : []);
  const has = new Set(held);
  return {
    add: [...want].filter((k) => !has.has(k)),
    remove: ranks.slice(1).map((r) => r.key).filter((k) => has.has(k) && !want.has(k)),
  };
}

// True when the member climbed: a rank above the base, higher than the one recorded before. The first record of a
// member (the backfill when ranks start, or a fresh verification, whose welcome line says the rank) is not announced.
export function climbed(ranks, before, after) {
  if (!before || !after) return false;
  return rankIndex(ranks, after.key) > Math.max(0, rankIndex(ranks, before.key));
}

// The role moves that put the rank roles (`ranks`, lowest first) right above `below`, in order. `sorted`: every role
// id of the server, lowest position first (@everyone first); `positionOf`: a role's position now (Discord's may repeat
// or skip numbers). Returns [{ id, position }] for the roles whose position changes (positions are the indexes of the
// new order), or [] when they are already there or `below` is unknown.
export function rankPositions(sorted, below, ranks, positionOf = (id) => sorted.indexOf(id)) {
  if (!sorted.includes(below) || !ranks.every((id) => sorted.includes(id))) return [];
  const rest = sorted.filter((id) => !ranks.includes(id));
  const order = [...rest.slice(0, rest.indexOf(below) + 1), ...ranks, ...rest.slice(rest.indexOf(below) + 1)];
  return order.map((id, position) => ({ id, position })).filter(({ id, position }) => positionOf(id) !== position);
}

// The top `n` by merged pull requests: [{ id, login, count, key }] → the same, sorted, ties by login.
export const topRanks = (rows, n = 10) => [...rows].filter((r) => r.count > 0)
  .sort((a, b) => b.count - a.count || String(a.login).localeCompare(String(b.login))).slice(0, n);

// ── Who is who: Discord names against GitHub logins ──────────────────────────

// "Ana_B.", "ana b" → "anab": lowercase, without spaces, dots and underscores.
export const squash = (name) => String(name ?? '').toLowerCase().replace(/[\s._]+/g, '');
// The same with look-alike digits read as letters (Excurs1ons ~ excursions): 0 o, 1 i, 3 e, 4 a, 5 s, 7 t.
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' };
export const squashLeet = (name) => squash(name).replace(/[013457]/g, (d) => LEET[d]);

// The GitHub login a member's names point to, or null: a name equal to a login once squashed (digits as they are, or
// read as letters), else one containing the other when both are at least 5 characters. The best match wins (equal
// first, then the longest login).
export function matchLogin(names, logins) {
  const forms = [squash, squashLeet];
  let best = null;
  for (const login of logins) {
    let rank = 0;
    for (const form of forms) {
      const l = form(login);
      for (const n of names.map(form).filter(Boolean)) {
        if (n === l) rank = Math.max(rank, 2);
        else if (n.length >= 5 && l.length >= 5 && (n.includes(l) || l.includes(n))) rank = Math.max(rank, 1);
      }
    }
    const length = squash(login).length;
    if (rank && (!best || rank > best.rank || (rank === best.rank && length > best.length))) best = { login, rank, length };
  }
  return best?.login ?? null;
}

// ── Grace ────────────────────────────────────────────────────────────────────

export function startGrace(work, id, now, days) {
  work.grace ??= {};
  return (work.grace[id] ??= { until: now + days * 86_400_000 });
}
export const graceOver = (work, now) => Object.entries(work.grace ?? {}).filter(([, g]) => g.until <= now).map(([id]) => id);

// ── Texts ────────────────────────────────────────────────────────────────────

export const MEANING = '🛠️ Contributor now means a merged PR in Horizon, verified with `/verify-github`; it opens #contributors.';

export const removedDm = () => '🛠️ **Contributor** now means a merged pull request in Horizon, so Kira took the role away from you. If you have one, you get it back by running `/link-github <your GitHub username>` and then `/verify-github` in the server (a code in your GitHub bio, takes a minute).';

export const graceDmUnlinked = (until) => `🛠️ **Contributor** now means a merged pull request in Horizon, verified with \`/verify-github\`. If you have one, keep the role: run \`/link-github <your GitHub username>\` in the server, then \`/verify-github\` (it gives you a code to put in your GitHub bio, takes a minute), before <t:${Math.floor(until / 1000)}:D>. After that date the role is removed if no verified GitHub account of yours has a merged pull request.`;

export const graceDm = (login, until, hasPr = true) => `🛠️ **Contributor** now means a merged pull request in Horizon, verified with \`/verify-github\`. ${hasPr ? `Your GitHub account **${login}** has one, so you keep the role` : `Your GitHub account **${login}** is linked, so you keep the role`} if you run \`/verify-github\` in the server before <t:${Math.floor(until / 1000)}:D> (it gives you a code to put in your GitHub bio, takes a minute). After that date the role is removed${hasPr ? '' : ' unless an account of yours has a merged pull request'}.`;

export const codeInstructions = (login, challenge) => [
  `To prove **${login}** is yours, put this code in your GitHub profile bio (or in a public gist named \`${GIST_FILE}\`):`,
  `\`${challenge.code}\``,
  `It is valid until <t:${Math.floor(challenge.expires / 1000)}:t>. Then run \`/verify-github check:True\`. You can remove the code afterwards.`,
].join('\n');

export const welcomeLine = (id, login, rank = null) => `🛠️ Welcome <@${id}>! A pull request by **${login}** is merged in Horizon: you are a contributor now${rank ? `, at **${rank.name}** already` : ''}.`;

export const COUNTED = 'merged pull requests in every public horizon-rust repo, summed';
const plural = (n) => `${n} merged pull request${n === 1 ? '' : 's'}`;

// One line in #contributors, no ping.
export const rankUpLine = (id, rank, count) => `${rank.name.split(' ')[0]} <@${id}> reached **${rank.name}**: ${plural(count)} in Horizon.`;

// /rank's contributor part. `entry`: { login, count, at } or null; `verified`: the member's GitHub is proved.
export function rankText(ranks, { login = null, verified = false, entry = null, rank = null } = {}) {
  if (!login) return 'No GitHub account linked: `/link-github <username>`, then `/verify-github`.';
  if (!verified) return `GitHub **${login}** is linked but not verified: \`/verify-github\` counts its pull requests.`;
  if (!entry) return `GitHub **${login}**: not counted yet, it is read at the next check.`;
  const next = nextRank(ranks, entry.count);
  const now = rank ? `**${rank.name}**` : 'no rank yet';
  const ahead = next ? ` · next: **${next.name}** at ${next.min} (${next.min - entry.count} to go)` : ' · the highest rank';
  return `${now} · ${plural(entry.count)} by **${login}**${ahead}\n-# Counted: ${COUNTED}.`;
}

// /ranks: the top 10, one line each, with the rank's emoji.
export function leaderboardText(ranks, rows) {
  if (!rows.length) return 'Nobody is counted yet: `/link-github` and `/verify-github` put you on it.';
  const emoji = (key) => (ranks.find((r) => r.key === key)?.name ?? '').split(' ')[0];
  const lines = rows.map((r, n) => `**${n + 1}.** ${emoji(r.key)} <@${r.id}> · ${r.login} · ${r.count}`);
  return `**🏆 Contributor ranks**\n${lines.join('\n')}\n-# Counted: ${COUNTED}. ${ranks.slice(1).map((r) => `${r.name} ${r.min}+`).join(' · ')}`;
}
