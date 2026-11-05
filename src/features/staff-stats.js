// Fetches what the dashboards' statistics need from GitHub (public data of horizon: pull requests of the last 12
// weeks and every open one, open issues, releases), at most once an hour, and serves src/team-stats.js's numbers:
// /hub/team's at GET team/stats, /hub/mod's at GET mod/stats. GraphQL's own budget, paced; a failed refresh keeps
// the last good numbers.
import { GITHUB, WORK } from '../config.js';
import { makeGitHub } from '../github.js';
import { githubToken } from '../github-app.js';
import { teamStats, modStats, weekStart, WEEKS } from '../team-stats.js';
import { roadmap } from './hub.js';

const gh = makeGitHub({ token: githubToken() });
const REFRESH_MS = 3_600_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPO = `${GITHUB.owner}/${WORK.repo}`;

const QUERY = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest { number createdAt mergedAt closedAt state isDraft author { login } labels(first: 20) { nodes { name } }
        reviews(first: 5) { nodes { submittedAt author { login } } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }
      ... on Issue { number labels(first: 20) { nodes { name } } }
    }
  }
}`;

// Every result of a search (pages of 100). GitHub shows 1000 at most: with more, null after the first page (unless
// `partial`), so the caller splits the range.
async function search(q, { partial = false } = {}) {
  const out = [];
  let after = null;
  for (let page = 0; page < 10; page++) {
    const r = await gh.graphql(QUERY, { q, after });
    if (r?.errors?.length) throw new Error(`GitHub GraphQL: ${r.errors[0].message}`);
    const s = r?.data?.search;
    if (!s) break;
    if (s.issueCount > 1000 && !partial) return null;
    out.push(...s.nodes.filter(Boolean));
    if (!s.pageInfo.hasNextPage) break;
    after = s.pageInfo.endCursor;
    await sleep(500);
  }
  return out;
}

const stamp = (ms) => `${new Date(ms).toISOString().slice(0, 19)}Z`;
// Pull requests created in [from, to), halving the range while it holds more than 1000.
async function createdIn(from, to) {
  const found = await search(`repo:${REPO} is:pr created:${stamp(from)}..${stamp(to - 1000)}`, { partial: to - from < 3_600_000 });
  if (found) return found;
  const mid = from + Math.floor((to - from) / 2);
  return [...(await createdIn(from, mid)), ...(await createdIn(mid, to))];
}

const pr = (n) => ({
  number: n.number, author: n.author?.login ?? null, createdAt: n.createdAt, mergedAt: n.mergedAt, closedAt: n.closedAt, state: n.state, draft: n.isDraft,
  labels: (n.labels?.nodes ?? []).map((l) => l.name),
  firstReviewAt: (n.reviews?.nodes ?? []).find((r) => r.author?.login && r.author.login !== n.author?.login)?.submittedAt ?? null,
  ci: n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
});

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
let raw = null; // { prs, issues, releases, at }
let running = null;

async function fetchAll(now = Date.now()) {
  const byNumber = new Map();
  // Pull requests created in the last 12 weeks, then every open one (older ones too, for the queue) and those merged
  // in the window but created before it.
  const first = weekStart(now) - (WEEKS - 1) * 7 * 86_400_000;
  for (const n of await createdIn(first, now + 60_000)) byNumber.set(n.number, pr(n));
  for (const n of await search(`repo:${REPO} is:pr is:open`, { partial: true })) byNumber.set(n.number, pr(n));
  for (const n of await search(`repo:${REPO} is:pr is:merged created:<${day(first)} merged:>=${day(first)}`, { partial: true })) byNumber.set(n.number, pr(n));
  const issues = (await search(`repo:${REPO} is:issue is:open`, { partial: true })).map((n) => ({ number: n.number, labels: (n.labels?.nodes ?? []).map((l) => l.name) }));
  const rel = [];
  for (let page = 1; page <= 5; page++) { // newest first: stop once a page reaches before the window
    const list = (await gh.get(`/repos/${REPO}/releases?per_page=100&page=${page}`, { cache: false })) ?? [];
    rel.push(...list);
    if (list.length < 100 || Date.parse(list.at(-1).published_at ?? list.at(-1).created_at) < first) break;
  }
  const releases = rel.map((r) => ({ tag: r.tag_name, publishedAt: r.published_at, draft: r.draft, prerelease: r.prerelease }));
  return { prs: [...byNumber.values()], issues, releases, at: now };
}

let fetcher = fetchAll;
function refresh() {
  running ??= fetcher()
    .then((r) => { raw = r; console.log(`staff stats: ${r.prs.length} pull requests, ${r.issues.length} open issues, ${r.releases.length} releases`); })
    .catch((e) => console.error('staff stats', e.message))
    .finally(() => { running = null; });
  return running;
}

export const _test = { fetchAll };

// deps (the dev server's fakes): fetchAll() → { prs, issues, releases, at }, roadmap() → the public roadmap.
export function statsRoutes({ store, deps = {} }) {
  if (deps.fetchAll) fetcher = deps.fetchAll;
  const roadmapOf = deps.roadmap ?? roadmap;
  if (!statsRoutes.started) { // the first numbers a minute after start, then every hour
    statsRoutes.started = true;
    setTimeout(refresh, deps.fetchAll ? 0 : 60_000).unref?.();
    setInterval(refresh, REFRESH_MS).unref?.();
  }
  return [
    { method: 'GET', path: 'team/stats', role: 'team', handler: async (ctx) => {
      if (!raw) { refresh(); return { status: 503, body: { error: 'Counting from GitHub: try again in a minute.' } }; }
      return { body: { ...teamStats({ ...raw, roadmap: await roadmapOf(), data: store.data, now: ctx.now }), githubAt: new Date(raw.at).toISOString() } };
    } },
    { method: 'GET', path: 'mod/stats', role: 'mod', handler: (ctx) => ({ body: modStats({ data: store.data, now: ctx.now }) }) },
  ];
}
