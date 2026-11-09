// Applications' routes and the staff side of the contract (docs/staff-api.md): the form's link and submission
// (public: the link is the proof), the dashboards' lists, the vote and the owner's actions (src/application-votes.js),
// and the minute tick that closes votes and veto windows. Loaded by src/features/staff.js.
// With KIRA_GOVERNANCE on, Ludovic has no veto: a passed Mod vote opens the council's 24-hour objection window in
// #council (an "Object" button; two objections → a council poll), and the stalled ones go to a council poll too
// (src/application-votes.js has the rules). The dashboards' owner route then refuses.
import { Routes, MessageFlags } from 'discord.js';
import { GUILD_ID, GITHUB, WORK, OWNER_ID, GOVERNANCE } from '../config.js';
import { client, state } from '../core.js';
import * as gk from '../governance-kit.js';
import * as polls from './poll.js';
import * as age from './age.js';
import * as ageKit from '../age-kit.js';
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
  const url = (a) => `${site}/hub/${apps.DASHBOARD_OF[a.role]}#application-${a.id}`;
  const gov = GOVERNANCE.on ? (deps.gov ?? governed({ url, log })) : null;
  const ctxAt = (now) => ({
    now, owner: gov ? null : OWNER_ID, gov, holders: { mod: holders('mod'), team: holders('team') }, lastActive: store.data.activity ?? {},
    hooks: { decide, dm, revokeRole }, url,
  });
  const find = (dashboard, id) => {
    const a = store.data.applications[String(id ?? '')];
    if (!a?.answers || !apps.SHOWN_ON[a.role].includes(dashboard)) throw Object.assign(new Error('No such application here.'), { expose: true });
    return a;
  };
  // The names behind the ids in ballots and history: staff members' usernames (their staff account, else Discord's
  // cache), nothing about anyone else.
  const nameOf = deps.name ?? ((id) => client.users.cache.get(id)?.username ?? null);
  const people = (list) => {
    const ids = new Set(list.flatMap((a) => [...(a.vote?.ballots ?? []).map((b) => b.by), ...a.audit.map((e) => e.by)]));
    ids.delete('vote');
    return Object.fromEntries([...ids].map((id) => [id, store.data.accounts[id]?.name ?? nameOf(id)]).filter(([, n]) => n));
  };
  const view = (dashboard, viewer, id, now) => apps.list(store, dashboard, viewer, ctxAt(now)).find((x) => x.id === id);
  const said = { accepted: 'accepted', declined: 'declined', passed: 'passed the vote: veto window open', 'objection-window': 'passed the vote: the council\'s 24-hour objection window is open', 'to-council': 'sent to a council poll', 'age-wait': 'accepted, waiting for the 18+ declaration', stalled: 'stalled: the owner decides', owner: 'too few active voters: the owner decides', extended: 'extended by 48 hours (no quorum)' };

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

  // The council's side, with the governance on: the "Object" button in #council, and the polls' results.
  async function objectFrom(userId, appId, now = Date.now()) {
    const a = store.data.applications[String(appId ?? '')];
    if (!a) return 'This application is gone.';
    try {
      const what = await votes.object(store, a, userId, ctxAt(now));
      log(`📝 ${apps.ROLE_NAMES[a.role]} application of <@${a.user}>: a council member objected${what === 'to-council' ? '; two objections: sent to a council poll' : ''}.`);
      return what === 'to-council' ? `Objection recorded. That makes ${votes.VOTE.objections}: Kira opened a council poll on it.` : `Objection recorded (${a.objection.by.length} of ${votes.VOTE.objections}). One more sends it to a council poll; say why in #council.`;
    } catch (e) {
      if (e.expose) return e.message;
      throw e;
    }
  }
  async function pollDone(p, d, now = Date.now()) {
    const a = p.ref?.application && store.data.applications[p.ref.application];
    if (!a) return null;
    const what = await votes.pollClosed(store, a, { passed: !!d.result?.passed, decision: d.id }, ctxAt(now));
    if (what) log(`📝 ${apps.ROLE_NAMES[a.role]} application of <@${a.user}>: ${said[what]} (council decision ${d.id}).`);
    return what;
  }
  if (gov && !deps.gov) {
    polls.onClosed((p, d) => pollDone(p, d));
    client.on('interactionCreate', (i) => {
      if (!i.isButton?.() || i.guildId !== GUILD_ID || !i.customId.startsWith('appobj:')) return;
      objectFrom(i.user.id, i.customId.slice(7)).then((content) => i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }))
        .catch((e) => console.error('application objection', e));
    });
  }

  const actions = (dashboard) => [
    { method: 'GET', path: `${dashboard}/applications`, role: dashboard, handler: (ctx) => {
      const applications = apps.list(store, dashboard, ctx.user, ctxAt(ctx.now));
      return { body: { applications, people: people(applications) } };
    } },
    { method: 'POST', path: `${dashboard}/applications/vote`, role: dashboard, handler: async (ctx) => {
      const a = find(dashboard, ctx.body.id);
      if (ctx.body.recuse) votes.recuse(store, a, ctx.user, ctxAt(ctx.now));
      else votes.castBallot(store, a, { voter: ctx.user, choice: ctx.body.choice, comment: ctx.body.comment }, ctxAt(ctx.now));
      await tick(ctx.now); // every active voter has voted: it closes now
      return { body: { application: view(dashboard, ctx.user, a.id, ctx.now) } };
    } },
    { method: 'POST', path: `${dashboard}/applications/owner`, role: dashboard, handler: async (ctx) => {
      if (gov) return { status: 403, body: { error: 'The council decides applications now (GOVERNANCE.md): no veto or owner decision.' } };
      if (ctx.user !== OWNER_ID) return { status: 403, body: { error: 'Only Ludovic can do this.' } };
      const a = find(dashboard, ctx.body.id);
      await votes.ownerAct(store, a, String(ctx.body.action ?? ''), ctxAt(ctx.now), { note: ctx.body.note });
      log(`📝 ${apps.ROLE_NAMES[a.role]} application of <@${a.user}>: ${ctx.body.action} by the owner.`);
      return { body: { application: view(dashboard, ctx.user, a.id, ctx.now) } };
    } },
  ];

  const routes = [
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
      log(`📝 New ${apps.ROLE_NAMES[a.role]} application from <@${a.user}>${a.contributor?.verified && a.contributor.merged ? ` (${a.contributor.merged} merged pull requests)` : ''}: ${site}/hub/${apps.DASHBOARD_OF[a.role]}#application-${a.id}`);
      return { body: { ok: true, role: a.role } };
    } },
    ...actions('team'),
    ...actions('mod'),
  ];
  return Object.assign(routes, { tick, objectFrom, pollDone }); // the three for tests
}

const ROLE_LINE = { mod: '🛡️ Mod', support: '🤝 Support', team: '🌌 Horizon Team' };
const REASONS = {
  objections: "two council members objected during the council's 24-hour window",
  stalled: "the vote didn't reach its quorum, even after 48 more hours",
  owner: 'too few active voters to hold the vote',
  team: 'a Horizon Team application passed the Team\'s vote, and the Team needs a 2/3 council poll',
};

// The Discord side of the governed flow (ctx.gov in src/application-votes.js).
function governed({ url, log }) {
  const channel = async (id) => client.channels.cache.get(id) ?? await client.channels.fetch(id).catch(() => null);
  const councilRole = () => state.roles?.council || GOVERNANCE.roles.council;
  return {
    isCouncil: (id) => gk.isCouncil(id, { state, gov: GOVERNANCE }),
    // The objection window's notice in #council, with the button. → { channelId, messageId } or null.
    async announce(a, until) {
      const ch = await channel(state.channels?.council || GOVERNANCE.channels.council);
      const t = a.tally ?? {};
      const content = [
        `<@&${councilRole()}> 📝 <@${a.user}>'s **${ROLE_LINE[a.role]}** application passed the mods' vote (${t.for ?? 0} for, ${t.against ?? 0} against, ${t.abstain ?? 0} abstain).`,
        `It is accepted <t:${Math.floor(until / 1000)}:R> unless two council members object (GOVERNANCE.md, section 2). Two objections send it to a council poll; say why here.`,
        `The answers and the votes: ${url(a)}`,
      ].join('\n');
      try {
        const msg = await ch.send({ content, allowedMentions: { parse: [], roles: [councilRole()] }, components: [{ type: 1, components: [{ type: 2, style: 4, label: 'Object', custom_id: `appobj:${a.id}` }] }] });
        return { channelId: msg.channelId ?? ch.id, messageId: msg.id };
      } catch (e) {
        log(`⚠️ The objection window of <@${a.user}>'s ${ROLE_LINE[a.role]} application could not be posted in #council (${e.message}): its card is ${url(a)}.`);
        return null;
      }
    },
    async openPoll(a, reason) {
      const t = a.tally ? ` The vote: ${a.tally.for} for, ${a.tally.against} against, ${a.tally.abstain} abstain.` : '';
      const question = `Accept <@${a.user}> as ${ROLE_LINE[a.role]}? Their application comes to the council because ${REASONS[reason]}.${t} The answers: ${url(a)}`;
      const kind = a.role === 'team' ? 'member-add' : 'mod';
      return polls.open({ kind, question, threshold: a.role === 'team' ? 'two-thirds' : votes.TO_COUNCIL[reason] ?? 'simple', where: 'council', subject: a.user, outcome: null, key: `application:${a.id}`, ref: { application: a.id } }, { openedBy: 'kira' });
    },
    needsDeclaration: (a) => age.required(a.role) && !age.isDeclared(a.user),
    async askDeclaration(a) {
      try {
        const user = await client.users.fetch(a.user);
        await user.send({ content: `${ageKit.promptText}\nYour application for ${ROLE_LINE[a.role]} was accepted: the role comes as soon as you confirm.`, components: [ageKit.button], allowedMentions: { parse: [] } });
        return { sent: true };
      } catch (e) {
        return { sent: false, error: String(e.message).slice(0, 200) };
      }
    },
  };
}
