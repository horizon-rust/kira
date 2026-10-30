#!/usr/bin/env node
// The staff dashboards' API with fake data, for working on the website's pages (horizon-site) and its screenshots.
// No Discord, no GitHub (the stats are made up), a fresh store in a temporary folder, on 127.0.0.1 only.
//
//   node scripts/staff-dev.mjs [--port 8787] [--site http://localhost:4173]
//   then in horizon-site: STAFF_UPSTREAM=http://127.0.0.1:8787 STAFF_PROXY_KEY=<printed key> node serve.mjs
//
// Every fake member's password is "horizon dev password"; it prints a password link and an application link too.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const PORT = Number(arg('port', 8787));
const SITE = arg('site', 'http://localhost:4173');
const dir = mkdtempSync(join(tmpdir(), 'kira-staff-dev-'));
const KEY = `dev-${randomBytes(24).toString('hex')}`;
Object.assign(process.env, { KIRA_STATE: join(dir, 'state.json'), KIRA_STAFF: join(dir, 'staff.json'), STAFF_PROXY_KEY: KEY, STAFF_SITE_URL: SITE });

const { OWNER_ID } = await import('../src/config.js');
const { state } = await import('../src/core.js');
const staff = await import('../src/features/staff.js');
const auth = await import('../src/staff-auth.js');
const apps = await import('../src/applications.js');
const votes = await import('../src/application-votes.js');
const team = await import('../src/team-data.js');
const { makeHandler } = await import('../src/mcp.js');
const { openStore } = await import('../src/agents.js');

const store = staff.staffStore();
const H = 3_600_000;
const DAY = 24 * H;
const now = Date.now();
const PASSWORD = 'horizon dev password';
state.roles.mod = 'role-mod';
state.roles.team = 'role-team';
state.roles.support = 'role-support';

// Fake members: id → { name, roles }
const id = (n) => `1000000000000000${String(n).padStart(2, '0')}`;
const people = {
  [OWNER_ID]: { name: 'ludovic', roles: [] },
  [id(1)]: { name: 'aurora', roles: ['role-team'] }, [id(2)]: { name: 'basalt', roles: ['role-team'] }, [id(3)]: { name: 'cinder', roles: ['role-team', 'role-mod'] },
  [id(4)]: { name: 'dune', roles: ['role-mod'] }, [id(5)]: { name: 'ember', roles: ['role-mod'] }, [id(6)]: { name: 'fjord', roles: ['role-mod'] },
  [id(7)]: { name: 'newcomer', roles: ['role-team'] },
  [id(11)]: { name: 'glacier', roles: [] }, [id(12)]: { name: 'harbor', roles: [] }, [id(13)]: { name: 'islet', roles: [] }, [id(14)]: { name: 'juniper', roles: [] },
};
const dashboards = (uid) => (uid === OWNER_ID ? ['team', 'mod'] : [['team', 'role-team'], ['mod', 'role-mod']].filter(([, r]) => people[uid]?.roles.includes(r)).map(([d]) => d));
const holders = (key) => new Set(Object.keys(people).filter((uid) => people[uid].roles.includes(state.roles[key])));
const fakeRoadmap = await fetch('https://playhorizon.dev/data/roadmap.json').then((r) => r.json()).catch(() => ({ areas: [{ id: 'performance', name: 'Performance' }], items: [{ id: 'smooth-frames', title: 'Steady frames at long render distances', area: 'performance', status: 'now', links: [] }] }));

// Made-up GitHub numbers for the stats: 12 weeks of pull requests by a few authors, issues, releases.
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const iso = (ms) => new Date(ms).toISOString();
function fakeGitHub() {
  const prs = [];
  const authors = ['aurora-gh', 'basalt-gh', 'cinder-gh', 'dune-gh', 'contrib-1', 'contrib-2'];
  const items = fakeRoadmap.items.filter((i) => i.status !== 'shipped').slice(0, 8).map((i) => `roadmap:${i.id}`);
  for (let n = 1; n <= 900; n++) {
    const created = now - 84 * DAY + (n / 900) * 84 * DAY;
    const open = created > now - 4 * DAY && rnd() < 0.5;
    const merged = !open && rnd() < 0.85 ? created + (0.5 + rnd() * 30) * H : null;
    prs.push({
      number: n, author: authors[Math.floor(rnd() ** 1.6 * authors.length)], createdAt: iso(created), mergedAt: merged && merged < now ? iso(merged) : null,
      closedAt: null, state: open ? 'OPEN' : merged && merged < now ? 'MERGED' : 'CLOSED', draft: open && rnd() < 0.2,
      labels: rnd() < 0.4 ? [items[Math.floor(rnd() * items.length)]] : [], firstReviewAt: rnd() < 0.4 ? iso(created + (0.2 + rnd() * 6) * H) : null,
      ci: open ? ['SUCCESS', 'SUCCESS', 'SUCCESS', 'FAILURE', 'PENDING'][Math.floor(rnd() * 5)] : 'SUCCESS',
    });
  }
  const areas = ['client', 'launcher', 'server', 'rendering', 'worldgen', 'mobs', ''];
  const issues = Array.from({ length: 120 }, (_, i) => ({ number: 2000 + i, labels: [rnd() < 0.6 ? 'bug' : 'enhancement', areas[Math.floor(rnd() * areas.length)], rnd() < 0.7 ? 'from-discord' : '', rnd() < 0.08 ? 'crucial' : ''].filter(Boolean) }));
  const releases = Array.from({ length: 60 }, (_, i) => ({ tag: i % 4 ? `v0.${Math.floor(i / 10)}.${i}` : `launcher@0.${i}.0`, publishedAt: iso(now - (i * 30 + 2) * H), draft: false }));
  return { prs, issues, releases, at: now };
}

// ── The store's fake content ─────────────────────────────────────────────────
for (const uid of Object.keys(people)) if (dashboards(uid).length && uid !== id(7)) await auth.setPassword(store, { user: uid, name: people[uid].name, password: PASSWORD });
store.update((d) => { for (const uid of Object.keys(people)) if (dashboards(uid).length) (d.activity ??= {})[uid] = now - DAY; });

const ctx = (at) => ({ now: at, owner: OWNER_ID, holders: { mod: holders('mod'), team: holders('team') }, lastActive: store.data.activity, url: (a) => `${SITE}/staff/${apps.DASHBOARD_OF[a.role]}#application-${a.id}`, hooks: { decide: async () => ({ granted: true, dmSent: true, error: null }), dm: async () => ({ sent: true, error: null }), revokeRole: async () => ({ removed: true, error: null }) } });
const answers = {
  why: 'I have been helping in #horizon-support every evening for a month and I would like to do it properly.',
  experience: 'Moderator of a 2,000-member modding server for two years; I wrote its FAQ and its rules.',
  hours: '6 to 8', timezone: 'Europe/Paris (UTC+1)', languages: 'French, English, some German',
  situation: 'Step in early, move it to DMs or a thread, remind both of the rules, and time out only if it goes on.',
  work: 'Chunk streaming and the mesher: I already landed the light-engine fixes and want to take the far-terrain item.',
};
const submit = (uid, role, at, contributor) => {
  const link = apps.issueApplyLink(store, uid, role, false, SITE, at);
  return apps.submit(store, { token: link.url.split('#')[1], answers, name: people[uid].name, contributor, hasRole: false }, at);
};
const prs = (n) => Array.from({ length: Math.min(n, 10) }, (_, i) => ({ number: 3300 - i * 17, title: ['Light: skylight spreads through slabs', 'Mesher: merge faces across sections', 'Far terrain: reuse LOD meshes', 'Chunks: stream in spiral order'][i % 4], url: `https://github.com/horizon-rust/horizon/pull/${3300 - i * 17}` }));
const a1 = submit(id(12), 'team', now - 30 * H, { login: 'harbor-dev', verified: true, merged: 14, prs: prs(14) });
votes.castBallot(store, a1, { voter: id(1), choice: 'for' }, ctx(now - 20 * H));
const a2 = submit(id(11), 'support', now - 50 * H, { login: 'glacier', verified: false, merged: 0, prs: [] });
votes.castBallot(store, a2, { voter: id(4), choice: 'for' }, ctx(now - 40 * H));
votes.castBallot(store, a2, { voter: id(5), choice: 'abstain' }, ctx(now - 39 * H));
const a3 = submit(id(13), 'mod', now - 80 * H, null);
for (const v of [id(3), id(4), id(5), id(6)]) votes.castBallot(store, a3, { voter: v, choice: v === id(6) ? 'against' : 'for', comment: v === id(6) ? 'Only two weeks on the server.' : '' }, ctx(now - 6 * H));
await votes.advance(store, a3, ctx(now - 6 * H)); // passed: Ludovic's veto window
const a4 = submit(id(14), 'mod', now - 10 * DAY, null);
for (const v of [id(3), id(4), id(5), id(6)]) votes.castBallot(store, a4, { voter: v, choice: 'against', comment: 'Not active enough here yet.' }, ctx(now - 9 * DAY));
await votes.advance(store, a4, ctx(now - 9 * DAY));

const by = [id(1), id(2), id(3), OWNER_ID];
[['Releases ship in batches of 5 merged PRs, or after 6 hours', 'The release-now label skips the wait; only Ludovic adds it.', '#2448', ''],
  ['Performance comes first in review order', 'Perf PRs with before/after numbers get reviewed before features.', '', 'smooth-frames'],
  ['Support answers in English in #horizon-support', 'Language channels stay for chat; support threads in English so anyone can help.', '', ''],
  ['No Docker image for servers yet', 'Hosting stays GUI-only in the launcher for now.', 'https://github.com/horizon-rust/horizon/issues/1500', '']]
  .forEach(([title, body, l, item], i) => team.addDecision(store, { by: by[i], title, body, link: l, item }, now - (4 - i) * 2 * DAY));
[['Plan the 0.3 release notes', 'doing', id(1)], ['Onboarding guide for new Team members', 'todo', id(2)], ['Review the modpack port ledger', 'todo', id(3)], ['Triage the from-discord bugs', 'doing', id(2)], ['Set up the Support role', 'done', id(3)]]
  .forEach(([title, column, owner], i) => team.saveCard(store, { by: owner, title, column, owner, note: '' }, now - i * H));
const pub = new Set(fakeRoadmap.items.map((i) => i.id));
team.saveItem(store, { by: id(1), title: 'Second release manager', area: 'platforms', status: 'next', owner: id(2), note: 'So releases never wait for one person.' }, { publicIds: pub }, now - 3 * DAY);
team.saveItem(store, { by: id(3), title: 'Partner servers program', area: 'servers', status: 'later', note: 'Only once online mode is the default everywhere.', plain: 'Servers we work with get early builds.', dev: 'A channel of early builds for partner hosts.' }, { publicIds: pub }, now - 2 * DAY);
if (fakeRoadmap.items[0]) team.saveNote(store, { id: fakeRoadmap.items[0].id, by: id(1), owner: id(3), priority: 'high', note: 'Top for 0.3.' }, { publicIds: pub }, now);
store.update((d) => {
  for (let i = 0; i < 84; i++) {
    const day = new Date(now - i * DAY).toISOString().slice(0, 10);
    d.counters[day] = { messages: 600 + Math.round(rnd() * 500), authors: 80 + Math.round(rnd() * 60), joins: 10 + Math.round(rnd() * 25), leaves: 3 + Math.round(rnd() * 8), reports: Math.round(rnd() * 3), modmail: Math.round(rnd() * 2), warns: Math.round(rnd() * 2), timeouts: Math.round(rnd() * 2), kicks: rnd() < 0.1 ? 1 : 0, bans: rnd() < 0.08 ? 1 : 0, automod: Math.round(rnd() * 6) };
  }
});

const board = () => ({ generatedAt: iso(now), columns: [
  { key: 'todo', name: 'To do', cards: [{ id: 'issue#2101', kind: 'issue', number: 2101, title: 'Water renders black under glass panes', url: 'https://github.com/horizon-rust/horizon/issues/2101', labels: ['bug'], people: [], claim: null, prs: [] }] },
  { key: 'progress', name: 'In progress', cards: [{ id: 'issue#2050', kind: 'issue', number: 2050, title: 'Villagers forget their workstation after a reload', url: 'https://github.com/horizon-rust/horizon/issues/2050', labels: ['bug', 'mobs'], people: [{ name: 'aurora' }], claim: { name: 'aurora' }, prs: [] }] },
  { key: 'review', name: 'Review', cards: [{ id: 'pr#3301', kind: 'pr', number: 3301, title: 'Far terrain: reuse LOD meshes between frames', url: 'https://github.com/horizon-rust/horizon/pull/3301', labels: ['perf'], people: [{ name: 'basalt' }], claim: null, prs: [] }] },
  { key: 'done', name: 'Done', cards: [{ id: 'pr#3290', kind: 'pr', number: 3290, title: 'Launcher: remember the window size', url: 'https://github.com/horizon-rust/horizon/pull/3290', labels: [], people: [{ name: 'cinder' }], claim: null, prs: [] }] },
] });

const deps = {
  access: async (uid) => (people[uid] ? { name: people[uid].name, dashboards: dashboards(uid) } : null),
  member: async (uid) => (people[uid] ? { user: { username: people[uid].name }, roles: people[uid].roles } : null),
  contributor: async () => ({ login: 'someone', verified: true, merged: 3, prs: prs(3) }),
  holders,
  people: () => Object.fromEntries(Object.entries(people).filter(([uid]) => dashboards(uid).includes('team')).map(([uid, p]) => [uid, p.name])),
  board,
  roadmap: async () => fakeRoadmap,
  fetchAll: async () => fakeGitHub(),
};
const routes = staff.routes([], deps);
const handler = makeHandler({ store: openStore(join(dir, 'agents.json')), api: { snapshot: () => null, isActiveMember: async () => false }, routes });
createServer(handler).listen(PORT, '127.0.0.1', () => {
  const setup = auth.issueLink(store, { user: id(7), purpose: 'password' });
  const apply = apps.issueApplyLink(store, id(11), 'mod', false, SITE);
  console.log(`staff dev API on http://127.0.0.1:${PORT} (store: ${dir})
  in horizon-site: STAFF_UPSTREAM=http://127.0.0.1:${PORT} STAFF_PROXY_KEY=${KEY} node serve.mjs
  logins: ludovic (both), aurora (team), cinder (team + mod), dune (mod); password "${PASSWORD}"
  set a password (newcomer): ${SITE}/staff/setup#${setup.token}
  apply (glacier, Mod): ${apply.url}`);
});
