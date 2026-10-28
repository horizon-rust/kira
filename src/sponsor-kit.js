// Who gets 💚 Sponsor, with no Discord: the GitHub check, the proof that the account is the member's (the same code as
// /verify-github, src/contributor-kit.js), and the daily recheck. src/features/sponsors.js does the talking.
// The data lives in state.sponsors:
//   links:      Discord id → { login, by, at }. `by`: 'kira' (Kira gave the role after /sponsor: rechecked, taken back
//               when GitHub stops reporting the sponsorship), 'had' (the member held the role already) or 'hand'
//               (/sponsor-grant): never taken back by Kira.
//   challenges: Discord id → { login, code, expires }
//   checkedAt:  when the daily recheck last ran
import { startChallenge, expired, GIST_FILE } from './contributor-kit.js';

export { startChallenge, GIST_FILE };
export const LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const same = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

const QUERY = 'query($maintainer: String!, $login: String!) { user(login: $maintainer) { isSponsoredBy(accountLogin: $login) } }';

// Does `login` sponsor `maintainer` (one-time sponsors included, as long as GitHub reports them)? An account that
// doesn't exist is not a sponsor; any other GitHub error throws, so nothing is decided on it.
export async function isSponsor(gh, maintainer, login) {
  if (!LOGIN.test(login)) return false;
  const res = await gh.graphql(QUERY, { maintainer, login });
  const errors = (res?.errors ?? []).filter((e) => e.type !== 'NOT_FOUND');
  if (errors.length || !res?.data) throw new Error(`GitHub isSponsoredBy: ${errors[0]?.message ?? 'no answer'}`);
  return res.data.user?.isSponsoredBy === true;
}

// The Verify button: the member's code must be published on the account (`published(login, code)`), and the account
// must sponsor (`sponsor(login)`). On 'ok' the challenge is used up; `takenFrom` are the other members who had this
// login linked (proof wins: they lose it). Nothing else changes here: the caller links and gives the role.
export async function verify({ sp, id, now, published, sponsor }) {
  const c = sp.challenges?.[id];
  if (!c) return { result: 'nocode' };
  if (expired(c, now)) { delete sp.challenges[id]; return { result: 'expired' }; }
  if (!(await published(c.login, c.code))) return { result: 'unpublished', login: c.login, code: c.code };
  if (!(await sponsor(c.login))) return { result: 'notsponsor', login: c.login };
  delete sp.challenges[id];
  const takenFrom = Object.entries(sp.links ?? {}).filter(([other, l]) => other !== id && same(l.login, c.login)).map(([other]) => other);
  return { result: 'ok', login: c.login, takenFrom };
}

export function link(sp, id, login, by, now) {
  (sp.links ??= {})[id] = { login: login ?? null, by, at: now };
}

// The daily recheck: only the roles Kira gave ('kira') are looked at. Returns the ids whose sponsorship GitHub no
// longer reports (`lapsed`); a GitHub error leaves that member alone (`errors`).
export async function recheck({ sp, sponsor, sleep = async () => {} }) {
  const out = { checked: 0, lapsed: [], errors: 0 };
  for (const [id, l] of Object.entries(sp.links ?? {})) {
    if (l.by !== 'kira') continue;
    out.checked++;
    try { if (!(await sponsor(l.login))) out.lapsed.push(id); } catch { out.errors++; }
    await sleep();
  }
  return out;
}

export const codeText = (login, challenge) => [
  `GitHub shows **${login}** as a sponsor of Horizon, thank you! 💚 To prove the account is yours, put this code in its profile bio, or in a public gist with a file named \`${GIST_FILE}\`:`,
  `\`${challenge.code}\``,
  `Then press **Verify** (valid until <t:${Math.floor(challenge.expires / 1000)}:t>). You can remove the code afterwards.`,
].join('\n');
