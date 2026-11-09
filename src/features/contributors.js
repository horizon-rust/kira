// Contributors: 🛠️ Contributor is earned, not picked. A member whose GitHub account is verified (/verify-github: a
// code in their bio or a gist) and has at least one merged pull request in Horizon gets the role, which opens
// #contributors. Granted when they verify, when Kira sees their pull request merge, and by a daily sweep; it is
// never taken away because of a count, only when the link or the verification goes (src/contributor-kit.js).
// Ranks (⛏️ Iron … 🟪 Netherite, CONTRIBUTORS.ranks) sit above it, from the merged pull requests in
// every public repo of the org summed, settled on the same paths; they only go up, and go only with the link or the verification.
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { rateLimiter } from '../agents.js';
import { CONTRIBUTORS, GITHUB, GUILD_ID, OWNER_ID, ROLES, WORK } from '../config.js';
import { client, state, save, channel, isStaff, modlog } from '../core.js';
import { makeGitHub } from '../github.js';
import { githubToken } from '../github-app.js';
import { linkify } from '../texts.js';
import * as kit from '../contributor-kit.js';

const TOKEN = githubToken();
export const enabled = !!TOKEN;
let gh = makeGitHub({ token: TOKEN, dryRun: process.env.KIRA_GITHUB_DRY_RUN === '1' });
const limiter = rateLimiter({ verify: [CONTRIBUTORS.verifyPerHour, 3_600_000] });
const work = (state.work ??= {});
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const guild = () => client.guilds.cache.get(GUILD_ID);
const roleId = () => state.roles[CONTRIBUTORS.role];
const merged = (login) => kit.mergedCount(gh, GITHUB.owner, WORK.repo, login);
// The count the ranks use: every public repo of the org, summed (one search).
const mergedAll = (login) => kit.mergedPublicCount(gh, GITHUB.owner, login);
const RANKS = CONTRIBUTORS.ranks.map((r) => ({ ...r, name: ROLES.find((x) => x.key === r.key)?.name ?? r.key }));
// A rank role's id: setup's (state.roles, which only setup writes) or the one the admin route made (work.rankRoles).
const rankRole = (key) => state.roles[key] ?? work.rankRoles?.[key];
const ranksReady = () => RANKS.every((r) => rankRole(r.key));
const sameLogin = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const verified = (id) => kit.isVerified(work, id, WORK.github);
const fetchMember = (id) => guild()?.members.fetch(id).catch(() => null);
// Staff write in #contributors anyway: the role is for everyone else.
const isStaffMember = (m) => m.id === OWNER_ID || isStaff(m);
// Ludovic's trusted reviewers: nothing automatic takes the role from them.
const isTrusted = (id) => Object.hasOwn(CONTRIBUTORS.protectedMembers, id);

// ── Granting ─────────────────────────────────────────────────────────────────

// Gives the role to a member whose login is verified and has a merged pull request (`count`: what GitHub said, or
// null when Kira just saw one merge). One welcome line in #contributors. Returns 'granted', 'has' or 'gone'.
// The rank is settled on the way (`total`: the summed count, read here when not given).
async function grant(id, login, count = null, total = null) {
  const member = await fetchMember(id);
  const role = roleId();
  if (!member || !role) return 'gone';
  delete work.grace?.[id];
  total ??= ranksReady() ? await mergedAll(login).catch(() => null) : null;
  if (member.roles.cache.has(role)) {
    if (total !== null) await settle(member, login, total);
    save();
    return 'has';
  }
  await member.roles.add(role, 'verified GitHub account with a merged pull request');
  save();
  console.log(`contributors: role granted (${count === null ? 'seen merging' : `${count} merged`})`);
  const rank = total !== null ? await settle(member, login, total) : null;
  const above = rank && kit.rankIndex(RANKS, rank.key) > 0 ? rank : null;
  await channel(CONTRIBUTORS.channel)?.send({ content: kit.welcomeLine(id, login, above), allowedMentions: { users: [id] } }).catch((e) => console.error('contributors welcome', e.message));
  return 'granted';
}

// ── Ranks ────────────────────────────────────────────────────────────────────

// A verified member who holds 🛠️ Contributor, at `count` merged pull requests (summed): the rank roles they should
// hold (their highest rank only, never lower than the one reached with this login), work.ranks, and one line without
// a ping in #contributors when they climbed (not on a first record, nor the first one under a new counting rule). Nothing until every rank role exists. Returns the rank, or null.
async function settle(member, login, count) {
  if (!ranksReady() || member.id === OWNER_ID) return null; // Ludovic's pull requests are his agents'
  const before = work.ranks?.[member.id];
  const reached = before && sameLogin(before.login, login) ? before : null;
  const rank = kit.targetRank(RANKS, count, login, reached);
  const held = RANKS.filter((r) => member.roles.cache.has(rankRole(r.key))).map((r) => r.key);
  const { add, remove } = kit.rankRoles(RANKS, held, rank);
  const ids = (keys) => keys.filter((k) => k !== RANKS[0].key).map(rankRole);
  try {
    if (ids(remove).length) await member.roles.remove(ids(remove), 'a higher contributor rank');
    if (ids(add).length) await member.roles.add(ids(add), `contributor rank: ${count} merged pull requests`);
  } catch (e) { console.error('contributors rank roles', e.message); return reached ? RANKS[kit.rankIndex(RANKS, reached.key)] ?? null : null; }
  // A record written under another counting rule is only rewritten: the new rule can raise people without it being
  // a climb (CONTRIBUTORS.countScope). `reached` still decides the rank, so nobody goes down.
  const sameRule = before?.scope === CONTRIBUTORS.countScope;
  (work.ranks ??= {})[member.id] = { key: rank?.key ?? null, login, count, at: Date.now(), scope: CONTRIBUTORS.countScope };
  save();
  if (sameRule && kit.climbed(RANKS, reached, rank)) {
    await channel(CONTRIBUTORS.channel)?.send({ content: kit.rankUpLine(member.id, rank, count), allowedMentions: { parse: [] } }).catch((e) => console.error('contributors rank line', e.message));
  }
  return rank;
}

// Reads a holder's count again (when /rank finds it old), one read at a time per member.
const refreshing = new Set();
function refresh(id) {
  if (refreshing.has(id) || !ranksReady()) return;
  refreshing.add(id);
  (async () => {
    const login = kit.loginOf(work, id, WORK.github);
    const member = await fetchMember(id);
    if (!login || !verified(id) || !member?.roles.cache.has(roleId())) return;
    await settle(member, login, await mergedAll(login));
  })().catch((e) => console.error('contributors rank refresh', e.message)).finally(() => refreshing.delete(id));
}

// /rank's contributor part (src/features/levels.js), from what is stored; an old count is read again in the background.
export function rankNote(id) {
  if (!enabled || id === OWNER_ID) return '';
  const login = kit.loginOf(work, id, WORK.github);
  if (!login) return '';
  const isVerified = verified(id);
  const stored = work.ranks?.[id];
  const entry = stored && sameLogin(stored.login, login) ? stored : null;
  if (isVerified && (!entry || Date.now() - entry.at > CONTRIBUTORS.rankRefreshMs)) refresh(id);
  const rank = entry?.key ? RANKS[kit.rankIndex(RANKS, entry.key)] : null;
  return kit.rankText(RANKS, { login, verified: isVerified, entry, rank });
}

// Whether a member holds the rank `key` or a higher one (by their rank roles), for /team-vote's candidates.
export function hasRank(member, key) {
  const from = kit.rankIndex(RANKS, key);
  return from >= 0 && RANKS.slice(from).some((r) => { const id = rankRole(r.key); return !!id && !!member?.roles?.cache?.has(id); });
}

// The verified members on the board: [{ id, login, count, key }] (their stored counts).
export function rankRows() {
  return Object.entries(work.ranks ?? {})
    .filter(([id, e]) => id !== OWNER_ID && verified(id) && sameLogin(e.login, kit.loginOf(work, id, WORK.github)))
    .map(([id, e]) => ({ id, login: e.login, count: e.count, key: e.key }));
}

// Makes the rank roles (CONTRIBUTORS.ranks above the base, specs in ROLES): `dry` lists what it would do. Each role is
// found by its id in state.roles, else by its name, else created with no permissions; then they are put in ROLES'
// order right above the role before them there (hoisted, so they show in the member list). After a real run the
// sweep starts, which gives everyone their rank without announcing it (a first record is never announced).
export async function ensureRankRoles({ dry = true } = {}) {
  const g = guild();
  if (!g) throw new Error('the guild is not known yet');
  await g.roles.fetch();
  const specs = ROLES.filter((r) => r.rank);
  const out = { dry, roles: [], moved: 0 };
  const found = {};
  for (const spec of specs) {
    let role = g.roles.cache.get(rankRole(spec.key)) ?? g.roles.cache.find((r) => r.name === spec.name);
    out.roles.push({ key: spec.key, name: spec.name, action: role ? 'exists' : dry ? 'would create' : 'created' });
    if (!role && !dry) {
      role = await g.roles.create({ name: spec.name, colors: { primaryColor: spec.color }, hoist: !!spec.hoist, mentionable: false, permissions: [], reason: 'contributor rank' });
    }
    if (role) found[spec.key] = role.id;
  }
  if (dry) return out;
  // Kira's own key: state.roles is setup's, and save() takes it back from disk.
  for (const [key, id] of Object.entries(found)) (work.rankRoles ??= {})[key] = id;
  save();
  await g.roles.fetch();
  const below = ROLES.slice(0, ROLES.indexOf(specs[0])).reverse().map((r) => state.roles[r.key]).find((id) => g.roles.cache.has(id));
  const sorted = [...g.roles.cache.values()].sort((a, b) => a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).map((r) => r.id);
  const moves = kit.rankPositions(sorted, below, specs.map((s) => rankRole(s.key)), (id) => g.roles.cache.get(id).position);
  if (moves.length) await g.roles.setPositions(moves.map(({ id, position }) => ({ role: id, position })));
  out.moved = moves.length;
  sweep().catch((e) => console.error('contributors sweep', e.message));
  return out;
}

// For a verified member: reads the count on GitHub and grants. 'none': verified, no merged pull request yet.
async function tryGrant(id) {
  const login = kit.loginOf(work, id, WORK.github);
  if (!login || !verified(id)) return 'unverified';
  const count = await merged(login);
  if (count < 1) return 'none';
  return grant(id, login, count);
}

// Kira's own feed of merges (the work board's refresh): a merged pull request by a verified login grants the role.
// The feed lists recent pull requests on every refresh: a holder whose count was read well after their latest merge
// is skipped (no search for nothing; the margin covers the search index lagging behind a merge).
export async function afterRefresh(raw) {
  const latest = new Map(); // lowercase login → the time of their latest merge in the feed
  for (const p of raw?.pulls ?? []) {
    if (!p.merged_at || !p.user?.login) continue;
    const key = p.user.login.toLowerCase();
    latest.set(key, Math.max(latest.get(key) ?? 0, Date.parse(p.merged_at) || 0));
  }
  for (const [id, login] of kit.verifiedPairs(work, WORK.github)) {
    if (id === OWNER_ID || !latest.has(login.toLowerCase())) continue;
    const counted = work.ranks?.[id];
    if (counted && sameLogin(counted.login, login) && counted.at > latest.get(login.toLowerCase()) + 10 * 60_000) continue;
    await grant(id, login).catch((e) => console.error('contributors feed', e.message));
  }
}

// ── /link-github's side ──────────────────────────────────────────────────────

// The link changed or went: its verification goes too, and the role with it (staff keep what they have).
// The ranks above it go for everyone, staff included: they count the pull requests of a proved account.
export async function relinked(id) {
  const had = !!work.verified?.[id];
  kit.clearVerification(work, id);
  delete work.ranks?.[id];
  save();
  if (!had) return;
  const member = await fetchMember(id);
  const role = roleId();
  const ranks = RANKS.slice(1).map((r) => rankRole(r.key)).filter((r) => r && member?.roles.cache.has(r));
  if (ranks.length) await member.roles.remove(ranks, 'GitHub link changed: verify again').catch(() => {});
  if (member && role && member.roles.cache.has(role) && !isStaffMember(member) && !isTrusted(id)) await member.roles.remove(role, 'GitHub link changed: verify again').catch(() => {});
}

// What /link-github adds to its answer: how to get #contributors (once, when the login already has a merged PR).
export async function linkNote(id) {
  const login = kit.loginOf(work, id, WORK.github);
  if (!login || verified(id) || work.told?.[id]) return graceNote(id);
  const count = await merged(login).catch(() => 0);
  if (count < 1) return '';
  (work.told ??= {})[id] = true;
  save();
  return `\n🛠️ **${login}** has a merged pull request in Horizon: run \`/verify-github\` to get the Contributor role and #contributors.`;
}
const graceNote = (id) => (work.grace?.[id] ? `\n⏳ Run \`/verify-github\` before <t:${Math.floor(work.grace[id].until / 1000)}:D> to keep 🛠️ Contributor.` : '');

// ── /verify-github ───────────────────────────────────────────────────────────

const GRANTED = {
  granted: '🛠️ You are a **Contributor** now: #contributors is open to you.',
  has: '🛠️ You already have the **Contributor** role.',
  none: 'No merged pull request by this account in Horizon yet. When one is merged you get the role by yourself.',
};
const say = (text) => linkify(text, state);

async function verifyByHand(i, target) {
  if (!isStaff(i.member)) return i.editReply(ephemeral('Only mods verify someone else.'));
  const login = work.links?.[target.id];
  if (!login) return i.editReply(ephemeral('They have not linked GitHub: they run `/link-github <username>` first (or a mod does it with `member:`).'));
  kit.markVerified(work, target.id, login);
  save();
  await modlog('GitHub verified by hand', `<@${i.user.id}> verified <@${target.id}> as GitHub **${login}**.`, 0x5865f2);
  const result = await tryGrant(target.id);
  return i.editReply(ephemeral(`✅ <@${target.id}> is verified as **${login}**. ${say(GRANTED[result] ?? '')}`));
}

async function verifyMyself(i, check) {
  const id = i.user.id;
  const login = kit.loginOf(work, id, WORK.github);
  if (!login) return i.editReply(ephemeral('Link your GitHub account first: `/link-github <username>`.'));
  if (verified(id)) {
    const result = await tryGrant(id);
    return i.editReply(ephemeral(say(`✅ **${login}** is verified. ${GRANTED[result] ?? ''}${graceNote(id)}`.trim())));
  }
  if (!limiter.take(id, 'verify')) return i.editReply(ephemeral('That is a lot of tries: wait a little, then run it again.'));
  const now = Date.now();
  if (!check) {
    return i.editReply(ephemeral(`${kit.codeInstructions(login, kit.startChallenge(work, id, login, now, CONTRIBUTORS.codeTtlMs))}${graceNote(id)}`));
  }
  const challenge = work.challenges?.[id];
  if (!challenge || challenge.login.toLowerCase() !== login.toLowerCase()) return i.editReply(ephemeral('You have no code yet: run `/verify-github` first.'));
  if (kit.expired(challenge, now)) {
    delete work.challenges[id];
    save();
    return i.editReply(ephemeral('That code expired. Run `/verify-github` for a new one.'));
  }
  if (!(await kit.codeIsPublished(gh, login, challenge.code))) {
    return i.editReply(ephemeral(`I don't see \`${challenge.code}\` in the bio of **${login}** (or in a public gist named \`${kit.GIST_FILE}\`). Save it on GitHub, wait a few seconds, and run \`/verify-github check:True\` again.`));
  }
  kit.markVerified(work, id, login);
  save();
  const result = await tryGrant(id);
  return i.editReply(ephemeral(say(`✅ **${login}** is yours now. ${GRANTED[result]} You can remove the code from GitHub.`)));
}

export const commands = enabled ? [
  new SlashCommandBuilder().setName('ranks').setDescription('The top 10 contributors by merged pull requests (every public Horizon repo)'),
  new SlashCommandBuilder().setName('verify-github').setDescription('Prove your linked GitHub account is yours (a merged Horizon PR then gives you Contributor)')
    .addBooleanOption((o) => o.setName('check').setDescription('I put the code on GitHub: check it now'))
    .addUserOption((o) => o.setName('member').setDescription('Mods: verify someone by hand')),
] : [];

export const handlers = {
  // Only the asker sees it, in every channel (rdbt, 2026-11-09). Names only: nobody is pinged.
  async ranks(i) {
    return i.reply(ephemeral(kit.leaderboardText(RANKS, kit.topRanks(rankRows(), 10))));
  },
  async 'verify-github'(i) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const target = i.options.getUser('member');
      return await (target && target.id !== i.user.id ? verifyByHand(i, target) : verifyMyself(i, i.options.getBoolean('check') === true));
    } catch (e) {
      console.error('verify-github', e.message);
      return i.editReply(ephemeral('GitHub is not answering right now: try again in a few minutes.'));
    }
  },
};

// ── The role holders who haven't proved a merged pull request ────────────────

// The 2026-10-27 clean-up of 🛠️ Contributor (it used to be a role anyone picked), and the model of the sweep.
// `dry`: counts only, nothing changes. Per holder:
//   staff → kept; verified with ≥1 merged PR → kept; a linked login with ≥1 merged PR, not verified → a DM and 7
//   days to run /verify-github; no link but a name that looks like the GitHub login of someone with a merged PR (or
//   one of CONTRIBUTORS.protectedLogins) → a DM and 7 days to /link-github and /verify-github; everyone else → the
//   role is removed at once, with a DM saying how to get it back. A GitHub error leaves that holder alone.
//   Trusted reviewers (CONTRIBUTORS.protectedMembers, by Discord id) always count with their login.
// Returns counts and the lists `matches` ({ discord, github } of the unlinked holders kept on their username),
// `kept` and `removed` (Discord names): public names only.
export async function cleanup({ dry = true } = {}) {
  const g = guild();
  const role = roleId();
  if (!g || !role) throw new Error('the guild or the Contributor role is not known yet');
  await g.members.fetch();
  const count = new Map(); // login → merged count (or null: GitHub failed)
  const lookup = async (login) => {
    const key = login.toLowerCase();
    if (!count.has(key)) {
      count.set(key, await merged(login).catch(() => null));
      await sleep(CONTRIBUTORS.searchPaceMs);
    }
    return count.get(key);
  };
  const guarded = new Set(CONTRIBUTORS.protectedLogins.map((l) => l.toLowerCase()));
  const holders = [...g.members.cache.filter((x) => !x.user.bot && x.roles.cache.has(role)).values()];
  // The merged-PR authors, only if some holder has no link (their names are compared with these logins).
  let authors = null;
  if (holders.some((m) => !isStaffMember(m) && !kit.loginOf(work, m.id, WORK.github))) {
    authors = await kit.mergedAuthors(gh, GITHUB.owner, WORK.repo, { sleep, paceMs: CONTRIBUTORS.searchPaceMs }).catch((e) => { console.error('contributors authors', e.message); return null; });
    for (const l of CONTRIBUTORS.protectedLogins) authors?.set(l.toLowerCase(), l);
  }
  const out = { dry, holders: 0, staff: 0, keepVerified: 0, graceDm: 0, graceAlready: 0, graceUnlinkedMatch: 0, removeNoLink: 0, removeNoMergedPr: 0, unknown: 0, authors: authors?.size ?? null, linked: 0, linkedQualify: 0, linkedQualifyNeedVerify: 0, dmFailed: 0, removeFailed: 0, matches: [], kept: [], removed: [] };
  const now = Date.now();
  // Gives the 7 days (once) and the DM; counted under `kind` (or graceAlready when they already have them).
  const giveGrace = async (m, kind, text) => {
    if (work.grace?.[m.id]) { out.graceAlready++; return; }
    out[kind]++;
    if (dry) return;
    const until = kit.startGrace(work, m.id, now, CONTRIBUTORS.graceDays);
    const sent = await m.send(text(until.until)).then(() => true).catch(() => false);
    if (!sent) { until.dmFailed = true; out.dmFailed++; } // /link-github and /verify-github tell them the next time
    save();
  };
  const who = (m) => `${m.displayName} (${m.user.username})`;
  for (const m of holders) {
    out.holders++;
    if (isStaffMember(m)) { out.staff++; out.kept.push(`${who(m)}: staff`); continue; }
    // The login that counts: the linked one, the maintainers' (config.js), or a trusted reviewer's (found by hand).
    const login = kit.loginOf(work, m.id, WORK.github) ?? CONTRIBUTORS.protectedMembers[m.id] ?? null;
    if (!login) {
      // Not linked: only the Discord username is compared with the merged-PR authors (display names are too loose).
      const guess = authors ? kit.matchLogin([m.user.username], authors.values()) : null;
      if (guess) {
        out.matches.push({ discord: who(m), github: guess });
        out.kept.push(`${who(m)}: username matches ${guess}`);
        await giveGrace(m, 'graceUnlinkedMatch', kit.graceDmUnlinked);
        continue;
      }
      if (!authors) { out.unknown++; continue; } // the list of authors failed: nobody is removed on a guess
      out.removeNoLink++;
    } else {
      const n = await lookup(login);
      if (n === null) { out.unknown++; continue; }
      const qualifies = n >= 1 || guarded.has(login.toLowerCase()) || isTrusted(m.id);
      if (qualifies && verified(m.id)) { out.keepVerified++; out.kept.push(`${who(m)}: verified ${login}`); delete work.grace?.[m.id]; continue; }
      if (qualifies) {
        out.kept.push(`${who(m)}: ${login}`);
        await giveGrace(m, 'graceDm', kit.loginOf(work, m.id, WORK.github) ? (until) => kit.graceDm(login, until, n >= 1) : kit.graceDmUnlinked);
        continue;
      }
      out.removeNoMergedPr++;
    }
    out.removed.push(who(m));
    if (dry) continue;
    // Ludovic, 2026-10-27: no merged PR, no role, and no grace. One DM says how to get it back.
    try {
      await m.roles.remove(role, 'Contributor now needs a merged PR and /verify-github');
      delete work.grace?.[m.id];
      if (!(await m.send(kit.removedDm()).then(() => true).catch(() => false))) out.dmFailed++;
    } catch { out.removeFailed++; }
  }
  // Everyone who linked GitHub, holder or not: who already has a merged PR and only needs /verify-github.
  for (const [id, login] of Object.entries(work.links ?? {})) {
    if (!g.members.cache.has(id)) continue;
    out.linked++;
    const n = await lookup(login);
    if (n >= 1) { out.linkedQualify++; if (!verified(id)) out.linkedQualifyNeedVerify++; }
  }
  if (!dry) {
    save();
    if (!work.cleanupAnnounced) {
      work.cleanupAnnounced = true;
      save();
      await channel('announcements')?.send({ content: say(kit.MEANING), allowedMentions: { parse: [] } }).catch((e) => console.error('contributors announcement', e.message));
    }
  }
  return out;
}

// ── The daily sweep ──────────────────────────────────────────────────────────

// Verified members with a merged pull request who lack the role get it; verified holders get their rank settled;
// holders whose grace is over lose it unless they have verified by now. Never removes the role for any other reason.
export async function sweep() {
  work.sweepAt = Date.now();
  work.sweepScope = CONTRIBUTORS.countScope; // every record is rewritten under the current counting rule by this pass
  save();
  const role = roleId();
  const g = guild();
  if (!g || !role) return;
  for (const [id, login] of kit.verifiedPairs(work, WORK.github)) {
    if (id === OWNER_ID) continue;
    const member = await fetchMember(id);
    if (!member) continue;
    try {
      if (member.roles.cache.has(role)) {
        if (!ranksReady()) continue;
        const total = await mergedAll(login);
        await sleep(CONTRIBUTORS.searchPaceMs);
        await settle(member, login, total);
        continue;
      }
      const n = await merged(login);
      await sleep(CONTRIBUTORS.searchPaceMs);
      if (n >= 1) { await grant(id, login, n); await sleep(CONTRIBUTORS.searchPaceMs); }
    } catch (e) { console.error('contributors sweep', e.message); }
  }
  for (const id of kit.graceOver(work, Date.now())) {
    const member = await fetchMember(id);
    try {
      const login = kit.loginOf(work, id, WORK.github);
      const ok = member && login && verified(id) && (CONTRIBUTORS.protectedLogins.some((l) => l.toLowerCase() === login.toLowerCase()) || (await merged(login)) >= 1);
      if (member && !ok && !isTrusted(id) && member.roles.cache.has(role)) await member.roles.remove(role, 'did not verify GitHub in time');
      delete work.grace[id];
      save();
    } catch (e) { console.error('contributors grace', e.message); }
  }
}

export function setup() {
  if (!enabled) return console.log('contributors: off (GITHUB_TOKEN is not set)');
  client.once('clientReady', () => {
    // Also due once after the counting rule changed, so the rewrite happens at once and quietly (see settle).
    const due = () => Date.now() - (work.sweepAt ?? 0) >= CONTRIBUTORS.sweepEveryMs || work.sweepScope !== CONTRIBUTORS.countScope;
    const check = () => { if (due()) sweep().catch((e) => console.error('contributors sweep', e.message)); };
    setTimeout(check, 5 * 60_000).unref?.();
    setInterval(check, 60 * 60_000).unref?.();
  });
}

export const _test = { work, RANKS, setGitHub: (g) => { gh = g; } };
