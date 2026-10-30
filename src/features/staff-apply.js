// Applications' routes and the staff side of the contract (docs/staff-api.md): the form's link and submission
// (public: the link is the proof), the dashboards' lists and decisions. Loaded by src/features/staff.js.
import { Routes } from 'discord.js';
import { GUILD_ID, GITHUB, WORK } from '../config.js';
import { client, state } from '../core.js';
import { makeGitHub } from '../github.js';
import { githubToken } from '../github-app.js';
import * as kit from '../contributor-kit.js';
import * as apps from '../applications.js';
import * as auth from '../staff-auth.js';
import { failures } from '../staff-http.js';
import { setStaffSide } from '../staff-hooks.js';

const ROLE_IDS = { team: '1564768999655481485', mod: '1559242168864997537' };
const roleId = (key) => state.roles[key] || ROLE_IDS[key] || null;
const gh = makeGitHub({ token: githubToken() });

async function member(userId) {
  try { return await client.rest.get(Routes.guildMember(GUILD_ID, userId)); } catch { return null; }
}
const hasRole = async (userId, role) => {
  const id = roleId(role);
  return !!id && !!(await member(userId))?.roles?.includes(id);
};

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

export function applicationRoutes({ store, site, log }) {
  setStaffSide({
    canApply: async (userId, role) => apps.canApply(store, userId, role, await hasRole(userId, role)),
    issueApplyLink: async (userId, role) => apps.issueApplyLink(store, userId, role, await hasRole(userId, role), site),
  });
  const limits = failures({ staffIp: [20, auth.MIN] });
  const bad = (ip) => { limits.fail('staffIp', ip); return { status: 404, body: { error: 'This link is unknown, used or expired. Ask Kira for a new one with /apply.' } }; };
  const slow = { status: 429, body: { error: 'Too many failed attempts. Try again later.' } };

  const decideRoute = (dashboard) => ({
    method: 'POST', path: `${dashboard}/applications/decide`, role: dashboard,
    handler: async (ctx) => {
      const a = await apps.decideApp(store, { id: String(ctx.body.id ?? ''), outcome: ctx.body.outcome, by: ctx.user, dashboard, site });
      log(`📝 ${apps.ROLE_NAMES[a.role]} application of <@${a.user}> ${a.status} by <@${ctx.user}>${a.result?.error ? ` (Discord side: ${a.result.error})` : ''}.`);
      return { body: { application: apps.list(store, dashboard).find((x) => x.id === a.id) } };
    },
  });

  return [
    { method: 'POST', path: 'apply/peek', role: 'public', handler: async (ctx) => {
      if (limits.blocked('staffIp', ctx.ip)) return slow;
      const link = auth.peekLink(store, ctx.body.token, 'apply', ctx.now);
      if (!link) return bad(ctx.ip);
      const m = await member(link.user);
      return { body: { role: link.role, roleName: apps.ROLE_NAMES[link.role], name: m?.user?.username ?? null, questions: apps.questions(link.role), expiresAt: link.expiresAt } };
    } },
    { method: 'POST', path: 'apply/submit', role: 'public', handler: async (ctx) => {
      if (limits.blocked('staffIp', ctx.ip)) return slow;
      const link = auth.peekLink(store, ctx.body.token, 'apply', ctx.now);
      if (!link) return bad(ctx.ip);
      const m = await member(link.user);
      if (!m) return { status: 403, body: { error: 'You need to be on Horizon\'s Discord server to apply.' } };
      apps.cleanAnswers(link.role, ctx.body.answers); // refuse before the GitHub lookup
      const a = apps.submit(store, { token: ctx.body.token, answers: ctx.body.answers, name: m.user.username, contributor: await contributor(link.user), hasRole: m.roles.includes(roleId(link.role)) }, ctx.now);
      log(`📝 New ${apps.ROLE_NAMES[a.role]} application from <@${a.user}>${a.contributor?.verified && a.contributor.merged ? ` (${a.contributor.merged} merged pull requests)` : ''}: ${site}/staff/${apps.DASHBOARD_OF[a.role]}#application-${a.id}`);
      return { body: { ok: true, role: a.role } };
    } },
    { method: 'GET', path: 'team/applications', role: 'team', handler: () => ({ body: { applications: apps.list(store, 'team') } }) },
    { method: 'GET', path: 'mod/applications', role: 'mod', handler: () => ({ body: { applications: apps.list(store, 'mod') } }) },
    decideRoute('team'),
    decideRoute('mod'),
  ];
}
