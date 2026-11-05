// Contributors: 🛠️ Contributor is earned, not picked. A member whose GitHub account is verified (/verify-github: a
// code in their bio or a gist) and has at least one merged pull request in Horizon gets the role, which opens
// #contributors. Granted when they verify, when Kira sees their pull request merge, and by a daily sweep; it is
// never taken away because of a count, only when the link or the verification goes (src/contributor-kit.js).
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { rateLimiter } from '../agents.js';
import { CONTRIBUTORS, GITHUB, GUILD_ID, OWNER_ID, WORK } from '../config.js';
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
const verified = (id) => kit.isVerified(work, id, WORK.github);
const fetchMember = (id) => guild()?.members.fetch(id).catch(() => null);
// Staff write in #contributors anyway: the role is for everyone else.
const isStaffMember = (m) => m.id === OWNER_ID || isStaff(m);
// Ludovic's trusted reviewers: nothing automatic takes the role from them.
const isTrusted = (id) => Object.hasOwn(CONTRIBUTORS.protectedMembers, id);

// ── Granting ─────────────────────────────────────────────────────────────────

// Gives the role to a member whose login is verified and has a merged pull request (`count`: what GitHub said, or
// null when Kira just saw one merge). One welcome line in #contributors. Returns 'granted', 'has' or 'gone'.
async function grant(id, login, count = null) {
  const member = await fetchMember(id);
  const role = roleId();
  if (!member || !role) return 'gone';
  delete work.grace?.[id];
  if (member.roles.cache.has(role)) { save(); return 'has'; }
  await member.roles.add(role, 'verified GitHub account with a merged pull request');
  save();
  console.log(`contributors: role granted (${count === null ? 'seen merging' : `${count} merged`})`);
  await channel(CONTRIBUTORS.channel)?.send({ content: kit.welcomeLine(id, login), allowedMentions: { users: [id] } }).catch((e) => console.error('contributors welcome', e.message));
  return 'granted';
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
export async function afterRefresh(raw) {
  const authors = new Set((raw?.pulls ?? []).filter((p) => p.merged_at && p.user?.login).map((p) => p.user.login.toLowerCase()));
  for (const [id, login] of kit.verifiedPairs(work, WORK.github)) {
    if (id === OWNER_ID || !authors.has(login.toLowerCase())) continue;
    await grant(id, login).catch((e) => console.error('contributors feed', e.message));
  }
}

// ── /link-github's side ──────────────────────────────────────────────────────

// The link changed or went: its verification goes too, and the role with it (staff keep what they have).
export async function relinked(id) {
  const had = !!work.verified?.[id];
  kit.clearVerification(work, id);
  save();
  if (!had) return;
  const member = await fetchMember(id);
  const role = roleId();
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
  new SlashCommandBuilder().setName('verify-github').setDescription('Prove your linked GitHub account is yours (a merged Horizon PR then gives you Contributor)')
    .addBooleanOption((o) => o.setName('check').setDescription('I put the code on GitHub: check it now'))
    .addUserOption((o) => o.setName('member').setDescription('Mods: verify someone by hand')),
] : [];

export const handlers = {
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

// Verified members with a merged pull request who lack the role get it; holders whose grace is over lose it unless
// they have verified by now. Never removes the role for any other reason.
export async function sweep() {
  work.sweepAt = Date.now();
  save();
  const role = roleId();
  const g = guild();
  if (!g || !role) return;
  for (const [id, login] of kit.verifiedPairs(work, WORK.github)) {
    if (id === OWNER_ID) continue;
    const member = await fetchMember(id);
    if (!member || member.roles.cache.has(role)) continue;
    try {
      const n = await merged(login);
      await sleep(CONTRIBUTORS.searchPaceMs);
      if (n >= 1) await grant(id, login, n);
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
    const due = () => Date.now() - (work.sweepAt ?? 0) >= CONTRIBUTORS.sweepEveryMs;
    const check = () => { if (due()) sweep().catch((e) => console.error('contributors sweep', e.message)); };
    setTimeout(check, 5 * 60_000).unref?.();
    setInterval(check, 60 * 60_000).unref?.();
  });
}

export const _test = { work, setGitHub: (g) => { gh = g; } };
