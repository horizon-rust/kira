// Applications' routes and the staff side of the contract (docs/staff-api.md): the form's link and submission
// (public: the link is the proof), the dashboards' lists, the vote and the owner's actions (src/application-votes.js),
// and the minute tick that closes votes and veto windows. Loaded by src/features/staff.js.
import { Routes } from 'discord.js';
import { GUILD_ID, GITHUB, WORK, OWNER_ID } from '../config.js';
import { client, state } from '../core.js';
import { makeGitHub } from '../github.js';
import { githubToken } from '../github-app.js';
import * as kit from '../contributor-kit.js';
import * as apps from '../applications.js';
import * as auth from '../staff-auth.js';
import { failures } from '../staff-http.js';
import { setStaffSide, decide, dm, revokeRole } from '../staff-hooks.js';
import * as votes from '../application-votes.js';

const ROLE_IDS = { team: '1564768999655481485', mod: '1559242168864997537' };
const roleId = (key) => state.roles[key] || ROLE_IDS[key] || null;
const gh = makeGitHub({ token: githubToken() });

async function member(userId) {
  try { return await client.rest.get(Routes.guildMember(GUILD_ID, userId)); } catch { return null; }
}

// What GitHub says about the member: their linked login, whether it is verified, their merged pull requests in Horizon.
async function contributor(userId) {
  const work = state.work ?? {};
  const login = { ...WORK.github, ...work.links }[userId] ?? null;
  if (!login) return null;
  const verified = kit.isVerified(work, userId, WORK.github);
  try {
    const q = encodeURIComponent(`repo:${GITHUB.owner}/${WORK.repo} is:pr is:merged author:${login}`);
    const found = await gh.get(`/search/issues?q=${q}&per_page=10&sort=created&order=desc`);
    return { login, verified, merged: Number(found?.total_count) || 0, prs: (found?.items ?? []).map((p) => ({ number: p.number, title: String(p.title).slice(0, 200), url: p.html_url })) };
  } catch (e) {
    return { login, verified, merged: null, prs: [], error: 'GitHub did not answer' };
  }
}

// deps (the dev server's fakes, scripts/staff-dev.mjs): member(id) → Discord's member object or null,
// contributor(id), holders(roleKey) → Set of ids.
export function applicationRoutes({ store, site, log, deps = {} }) {
  const memberOf = deps.member ?? member;
  const contributorOf = deps.contributor ?? contributor;
  const hasRoleOf = async (userId, role) => { const id = roleId(role); return !!id && !!(await memberOf(userId))?.roles?.includes(id); };
  setStaffSide({
    canApply: async (userId, role) => apps.canApply(store, userId, role, await hasRoleOf(userId, role)),
    issueApplyLink: async (userId, role) => apps.issueApplyLink(store, userId, role, await hasRoleOf(userId, role), site),
  });
  const limits = failures({ staffIp: [20, auth.MIN] });
  const bad = (ip) => { limits.fail('staffIp', ip); return { status: 404, body: { error: 'This link is unknown, used or expired. Ask Kira for a new one with /apply.' } }; };
  const slow = { status: 429, body: { error: 'Too many failed attempts. Try again later.' } };

  const holders = deps.holders ?? ((key) => new Set(client.guilds.cache.get(GUILD_ID)?.roles.cache.get(roleId(key))?.members.keys() ?? []));
  const ctxAt = (now) => ({
    now, owner: OWNER_ID, holders: { mod: holders('mod'), team: holders('team') }, lastActive: store.data.activity ?? {},
    hooks: { decide, dm, revokeRole }, url: (a) => `${site}/staff/${apps.DASHBOARD_OF[a.role]}#application-${a.id}`,
  });
  const find = (dashboard, id) => {
    const a = store.data.applications[String(id ?? '')];
    if (!a?.answers || !apps.SHOWN_ON[a.role].includes(dashboard)) throw Object.assign(new Error('No such application here.'), { expose: true });
    return a;
  };
  const view = (dashboard, viewer, id, now) => apps.list(store, dashboard, viewer, ctxAt(now)).find((x) => x.id === id);
  const said = { accepted: 'accepted', declined: 'declined', passed: 'passed the vote: veto window open', stalled: 'stalled: the owner decides', owner: 'too few active voters: the owner decides', extended: 'extended by 48 hours (no quorum)' };

  // Moves every application whose time came (closing votes, ending veto windows), once a minute and after each ballot.
  let ticking = false;
  async function tick(now = Date.now()) {
    if (ticking) return;
    ticking = true;
    try {
      for (const a of Object.values(store.data.applications)) {
        if (votes.FINAL.includes(a.status) || !a.vote) continue;
        const what = await votes.advance(store, a, ctxAt(now));
        if (what) log(`📝 ${apps.ROLE_NAMES[a.role]} application of <@${a.user}>: ${said[what]}${a.tally ? ` (${a.tally.for} for, ${a.tally.against} against, ${a.tally.abstain} abstain)` : ''}.`);
      }
    } catch (e) {
      console.error('applications tick', e.message);
    } finally {
      ticking = false;
    }
  }
  setInterval(() => tick(), 60_000).unref?.();

  const actions = (dashboard) => [
    { method: 'GET', path: `${dashboard}/applications`, role: dashboard, handler: (ctx) => ({ body: { applications: apps.list(store, dashboard, ctx.user, ctxAt(ctx.now)) } }) },
    { method: 'POST', path: `${dashboard}/applications/vote`, role: dashboard, handler: async (ctx) => {
      const a = find(dashboard, ctx.body.id);
      if (ctx.body.recuse) votes.recuse(store, a, ctx.user, ctxAt(ctx.now));
      else votes.castBallot(store, a, { voter: ctx.user, choice: ctx.body.choice, comment: ctx.body.comment }, ctxAt(ctx.now));
      await tick(ctx.now); // every active voter has voted: it closes now
      return { body: { application: view(dashboard, ctx.user, a.id, ctx.now) } };
    } },
    { method: 'POST', path: `${dashboard}/applications/owner`, role: dashboard, handler: async (ctx) => {
      if (ctx.user !== OWNER_ID) return { status: 403, body: { error: 'Only Ludovic can do this.' } };
      const a = find(dashboard, ctx.body.id);
      await votes.ownerAct(store, a, String(ctx.body.action ?? ''), ctxAt(ctx.now));
      log(`📝 ${apps.ROLE_NAMES[a.role]} application of <@${a.user}>: ${ctx.body.action} by the owner.`);
      return { body: { application: view(dashboard, ctx.user, a.id, ctx.now) } };
    } },
  ];

  return [
    { method: 'POST', path: 'apply/peek', role: 'public', handler: async (ctx) => {
      if (limits.blocked('staffIp', ctx.ip)) return slow;
      const link = auth.peekLink(store, ctx.body.token, 'apply', ctx.now);
      if (!link) return bad(ctx.ip);
      const m = await memberOf(link.user);
      return { body: { role: link.role, roleName: apps.ROLE_NAMES[link.role], name: m?.user?.username ?? null, questions: apps.questions(link.role), expiresAt: link.expiresAt } };
    } },
    { method: 'POST', path: 'apply/submit', role: 'public', handler: async (ctx) => {
      if (limits.blocked('staffIp', ctx.ip)) return slow;
      const link = auth.peekLink(store, ctx.body.token, 'apply', ctx.now);
      if (!link) return bad(ctx.ip);
      const m = await memberOf(link.user);
      if (!m) return { status: 403, body: { error: 'You need to be on Horizon\'s Discord server to apply.' } };
      apps.cleanAnswers(link.role, ctx.body.answers); // refuse before the GitHub lookup
      const a = apps.submit(store, { token: ctx.body.token, answers: ctx.body.answers, name: m.user.username, contributor: await contributorOf(link.user), hasRole: m.roles.includes(roleId(link.role)) }, ctx.now);
      log(`📝 New ${apps.ROLE_NAMES[a.role]} application from <@${a.user}>${a.contributor?.verified && a.contributor.merged ? ` (${a.contributor.merged} merged pull requests)` : ''}: ${site}/staff/${apps.DASHBOARD_OF[a.role]}#application-${a.id}`);
      return { body: { ok: true, role: a.role } };
    } },
    ...actions('team'),
    ...actions('mod'),
  ];
}
