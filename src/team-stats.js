// The dashboards' statistics, computed from public GitHub data (pull requests, issues, releases), the website's
// roadmap and Kira's daily counters (counts only). No network here: src/features/staff-stats.js fetches.
import { series } from './staff-counters.js';

export const WEEKS = 12;
const DAY = 86_400_000;
const WEEK = 7 * DAY;
// The area labels of horizon's issues (an issue can have several).
export const AREAS = ['client', 'launcher', 'server', 'multiplayer', 'rendering', 'worldgen', 'chunks', 'mobs', 'blocks', 'commands', 'saves', 'audio', 'ui', 'mods', 'perf', 'parity', 'tooling', 'website'];
const STATUS_ORDER = ['now', 'next', 'help-wanted', 'later', 'shipped'];

// Monday 00:00 UTC of the week of `ms`.
export function weekStart(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
const hours = (a, b) => Math.round(((b - a) / 3_600_000) * 10) / 10;
const ms = (s) => (s ? Date.parse(s) : null);

// prs: [{ number, author, createdAt, mergedAt, closedAt, state: 'OPEN'|'MERGED'|'CLOSED', draft, labels, firstReviewAt, ci }]
// (firstReviewAt: the first review by someone other than the author; ci: the head commit's check state or null)
// issues: open issues [{ number, labels }]; releases: [{ tag, publishedAt, draft, prerelease }];
// roadmap: the website's roadmap.json; data: staff.json's data (counters).
export function teamStats({ prs = [], issues = [], releases = [], roadmap = null, data, now = Date.now() }) {
  const first = weekStart(now) - (WEEKS - 1) * WEEK;
  const weeks = Array.from({ length: WEEKS }, (_, i) => ({ week: iso(first + i * WEEK), opened: 0, merged: 0, review: [], merge: [], reviewed: 0 }));
  const at = (t) => (t >= first ? weeks[Math.floor((t - first) / WEEK)] : null);
  const people = new Map();
  const person = (login) => people.get(login) ?? people.set(login, { login, opened: 0, merged: 0 }).get(login);

  for (const p of prs) {
    const created = ms(p.createdAt);
    const merged = ms(p.mergedAt);
    const w = at(created);
    if (w) {
      w.opened++;
      if (p.author) person(p.author).opened++;
      const r = ms(p.firstReviewAt);
      if (r) { w.reviewed++; w.review.push(hours(created, r)); }
    }
    const m = merged ? at(merged) : null;
    if (m) {
      m.merged++;
      m.merge.push(hours(created, merged));
      if (p.author) person(p.author).merged++;
    }
  }

  const open = prs.filter((p) => p.state === 'OPEN');
  const ready = open.filter((p) => !p.draft);
  const ci = { passing: 0, failing: 0, pending: 0, none: 0 };
  for (const p of ready) ci[{ SUCCESS: 'passing', FAILURE: 'failing', ERROR: 'failing', PENDING: 'pending', EXPECTED: 'pending' }[p.ci] ?? 'none']++;
  const oldest = Math.min(...ready.map((p) => ms(p.createdAt)));

  // Open bugs by area label (few issues have one yet), by where they came from, and the crucial ones.
  const bugs = issues.filter((i) => i.labels.includes('bug'));
  const byArea = {};
  let noArea = 0;
  for (const b of bugs) {
    const areas = b.labels.filter((l) => AREAS.includes(l));
    if (!areas.length) noArea++;
    for (const a of areas) byArea[a] = (byArea[a] ?? 0) + 1;
  }
  const bySource = { discord: 0, website: 0, github: 0 };
  for (const b of bugs) bySource[b.labels.includes('from-discord') ? 'discord' : b.labels.includes('from-website') ? 'website' : 'github']++;

  const items = (roadmap?.items ?? []).map((it) => {
    const mine = prs.filter((p) => p.labels.includes(`roadmap:${it.id}`));
    return { id: it.id, title: it.title, status: it.status, merged: mine.filter((p) => p.state === 'MERGED').length, open: mine.filter((p) => p.state === 'OPEN').length };
  }).filter((it) => it.status !== 'shipped' || it.merged || it.open)
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.merged + b.open - (a.merged + a.open));

  const published = releases.filter((r) => !r.draft && r.publishedAt);
  const game = published.filter((r) => /^v\d/.test(r.tag)).map((r) => ms(r.publishedAt)).sort((a, b) => a - b);
  const launcher = published.filter((r) => /^launcher[@-]/.test(r.tag)).map((r) => ms(r.publishedAt)).sort((a, b) => a - b);
  const perWeek = (list) => weeks.map((w, i) => list.filter((t) => t >= first + i * WEEK && t < first + (i + 1) * WEEK).length);
  const recentGame = game.filter((t) => t >= first);
  const gaps = recentGame.slice(1).map((t, i) => (t - recentGame[i]) / 3_600_000);

  const days = series(data, WEEKS * 7, now);
  const discord = weeks.map((w) => {
    const mine = days.filter((d) => d.day >= w.week && d.day < iso(Date.parse(w.week) + WEEK));
    const counted = mine.filter((d) => d.messages); // days before counting began don't lower the average
    return { week: w.week, messages: sum(mine, 'messages'), dailyActive: counted.length ? Math.round(sum(counted, 'authors') / counted.length) : 0, joins: sum(mine, 'joins'), leaves: sum(mine, 'leaves') };
  });

  return {
    generatedAt: new Date(now).toISOString(),
    weeks: weeks.map((w) => ({ week: w.week, opened: w.opened, merged: w.merged, medianHoursToFirstReview: median(w.review), medianHoursToMerge: median(w.merge), reviewedShare: w.opened ? Math.round((w.reviewed / w.opened) * 100) : null })),
    people: [...people.values()].sort((a, b) => b.merged - a.merged || b.opened - a.opened).slice(0, 20),
    openPullRequests: { total: open.length, drafts: open.length - ready.length, ready: ready.length, ci, oldestReadyDays: ready.length ? Math.floor((now - oldest) / DAY) : null },
    bugs: { open: bugs.length, crucial: bugs.filter((b) => b.labels.includes('crucial')).length, openIssues: issues.length, byArea, noArea, bySource },
    roadmap: items,
    releases: { gamePerWeek: perWeek(game), launcherPerWeek: perWeek(launcher), lastGame: game.length ? new Date(game.at(-1)).toISOString() : null, medianHoursBetweenGame: gaps.length ? Math.round(median(gaps) * 10) / 10 : null },
    discord,
  };
}

const sum = (rows, k) => rows.reduce((t, r) => t + (r[k] ?? 0), 0);
const MOD_KEYS = ['reports', 'modmail', 'warns', 'timeouts', 'kicks', 'bans', 'automod', 'joins', 'leaves'];

// The Moderation dashboard: counters per week and totals, and open applications. Nothing of the Team's data.
export function modStats({ data, now = Date.now() }) {
  const first = weekStart(now) - (WEEKS - 1) * WEEK;
  const days = series(data, WEEKS * 7 + 7, now);
  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const from = iso(first + i * WEEK);
    const to = iso(first + (i + 1) * WEEK);
    const mine = days.filter((d) => d.day >= from && d.day < to);
    return { week: from, ...Object.fromEntries(MOD_KEYS.map((k) => [k, sum(mine, k)])) };
  });
  const last = (n) => Object.fromEntries(MOD_KEYS.map((k) => [k, sum(days.slice(-n), k)]));
  const apps = Object.values(data.applications ?? {});
  const openApps = Object.fromEntries(['mod', 'support'].map((r) => [r, apps.filter((a) => a.role === r && a.status === 'open').length]));
  const decided30 = apps.filter((a) => ['mod', 'support'].includes(a.role) && a.status !== 'open' && a.decidedAt >= now - 30 * DAY);
  return {
    generatedAt: new Date(now).toISOString(),
    weeks,
    last7: last(7),
    last30: last(30),
    applications: { open: openApps, accepted30: decided30.filter((a) => a.status === 'accepted').length, declined30: decided30.filter((a) => a.status === 'declined').length },
    countingSince: Object.keys(data.counters ?? {}).filter((k) => /^\d{4}-/.test(k)).sort()[0] ?? null,
  };
}
