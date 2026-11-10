// What Kira can measure about a member for an election (GOVERNANCE.md 5.1 and 5.2), from her own state and GitHub's
// search. One function per need, so an election only runs the searches its post needs. Counts only: nothing here is
// ever published; the floors' short lines go to the candidate alone (src/elections-kit.js shortOf).
import * as ck from './contributor-kit.js';

const LOGIN = /^[A-Za-z0-9-]{1,39}$/;
const DAY = 86_400_000;
const labelQ = (labels) => `label:${labels.map((l) => `"${l}"`).join(',')}`;

// deps: { gh (makeGitHub client), org, state, work (state.work), fixed (WORK.github), levelOf, isDeclared, roleSince,
// sleep, paceMs, now }. → { candidate(member, { post, group, kinds }), recent(id, group), groupLabels }.
export function makeEvidence({ gh, org, state, work, fixed = {}, groups, levelOf, isDeclared, sleep = async () => {}, paceMs = 0, now = () => Date.now() }) {
  const count = async (q) => {
    await sleep(paceMs);
    const found = await gh.get(`/search/issues?q=${encodeURIComponent(q)}&per_page=1`, { cache: false });
    return Number(found?.total_count) || 0;
  };
  const scope = `org:${org} is:public is:pr`;
  const loginOf = (id) => (ck.isVerified(work, id, fixed) ? ck.loginOf(work, id, fixed) : null);
  const lastCaseAt = (id) => Math.max(0, ...Object.values(state.modcases?.cases ?? {})
    .filter((c) => c.userId === String(id) && ['timeout', 'quarantine', 'ban'].includes(c.action)).map((c) => c.at ?? 0)) || null;

  return {
    loginOf,
    // Merged pull requests and reviews with the group's labels in the last activeDays (0 when not verified).
    async recent(id, group, days = 60) {
      const login = loginOf(id);
      const labels = groups[group]?.labels;
      if (!login || !LOGIN.test(login) || !labels?.length) return 0;
      const since = new Date(now() - days * DAY).toISOString().slice(0, 10);
      const merged = await count(`${scope} is:merged author:${login} ${labelQ(labels)} merged:>=${since}`);
      if (merged) return merged;
      return count(`${scope} reviewed-by:${login} -author:${login} ${labelQ(labels)} updated:>=${since}`);
    },
    // The evidence card's numbers that this post's floor needs. member: a guild member (or null).
    async candidate(member, { post, group, kinds, modSince = null }) {
      const id = String(member?.id ?? '');
      const login = loginOf(id);
      const ev = {
        inGuild: !!member, bot: !!member?.user?.bot, joinedAt: member?.joinedTimestamp ?? null,
        level: levelOf(state.levels?.[id]?.xp ?? 0).level, verified: !!login, declared: isDeclared(id),
        lastCaseAt: lastCaseAt(id), roles: kinds, modSince,
      };
      if (!login || !LOGIN.test(login)) return ev;
      if (post === 'team') {
        ev.merged = Number(work.ranks?.[id]?.count) || await count(`${scope} is:merged author:${login}`);
        ev.reviews = await count(`${scope} reviewed-by:${login} -author:${login}`);
      }
      if (post === 'lead' && groups[group]) {
        ev.areaMerged = await count(`${scope} is:merged author:${login} ${labelQ(groups[group].labels)}`);
        ev.areaReviews = ev.areaMerged >= 8 ? 0 : await count(`${scope} reviewed-by:${login} -author:${login} ${labelQ(groups[group].labels)}`);
      }
      return ev;
    },
  };
}
