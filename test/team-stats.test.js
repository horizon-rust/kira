// The dashboards' statistics (src/team-stats.js), from fixed GitHub data and counters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamStats, modStats, weekStart, median, WEEKS } from '../src/team-stats.js';

const NOW = Date.UTC(2026, 9, 30, 12); // a Friday
const H = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();
const pr = (n, o) => ({ number: n, author: 'a', createdAt: iso(NOW - 48 * H), mergedAt: null, closedAt: null, state: 'OPEN', draft: false, labels: [], firstReviewAt: null, ci: null, ...o });

test('weeks start on Monday UTC; median', () => {
  assert.equal(iso(weekStart(NOW)), '2026-10-26T00:00:00.000Z');
  assert.equal(iso(weekStart(Date.UTC(2026, 9, 26))), '2026-10-26T00:00:00.000Z');
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test('pull requests per week and per person, review and merge times, the CI queue', () => {
  const prs = [
    pr(1, { author: 'kacpherek', state: 'MERGED', mergedAt: iso(NOW - 38 * H), firstReviewAt: iso(NOW - 46 * H) }),
    pr(2, { author: 'kacpherek', state: 'MERGED', mergedAt: iso(NOW - 44 * H) }),
    pr(3, { author: 'rdbt', ci: 'FAILURE', labels: ['roadmap:server-thread'] }),
    pr(4, { author: 'rdbt', ci: 'SUCCESS', labels: ['roadmap:server-thread'] }),
    pr(5, { author: 'rdbt', draft: true }),
    pr(6, { author: 'old', createdAt: iso(NOW - 200 * 24 * H), ci: 'PENDING' }),
    pr(7, { author: 'x', state: 'MERGED', mergedAt: iso(NOW - 40 * H), labels: ['roadmap:server-thread'] }),
  ];
  const s = teamStats({ prs, data: { counters: {} }, roadmap: { items: [{ id: 'server-thread', title: 'Server thread', status: 'now' }, { id: 'done-thing', title: 'Done', status: 'shipped' }] }, now: NOW });
  assert.equal(s.weeks.length, WEEKS);
  const w = s.weeks.at(-1);
  assert.equal(w.week, '2026-10-26');
  assert.equal(w.opened, 6); // pr 6 is older than the window
  assert.equal(w.merged, 3);
  assert.equal(w.medianHoursToFirstReview, 2);
  assert.equal(w.medianHoursToMerge, 8); // 10, 4, 8
  assert.equal(w.reviewedShare, 17);
  assert.deepEqual(s.people[0], { login: 'kacpherek', opened: 2, merged: 2 });
  assert.deepEqual(s.openPullRequests, { total: 4, drafts: 1, ready: 3, ci: { passing: 1, failing: 1, pending: 1, none: 0 }, oldestReadyDays: 200 });
  assert.deepEqual(s.roadmap, [{ id: 'server-thread', title: 'Server thread', status: 'now', merged: 1, open: 2 }]);
});

test('bugs by area and by source; releases per week and their pace', () => {
  const issues = [{ number: 1, labels: ['bug', 'from-discord'] }, { number: 2, labels: ['bug', 'client', 'crucial'] }, { number: 3, labels: ['enhancement'] }, { number: 4, labels: ['bug', 'from-website', 'launcher', 'ui'] }];
  const releases = [
    { tag: 'v0.3.1', publishedAt: iso(NOW - 2 * H) }, { tag: 'v0.3.0', publishedAt: iso(NOW - 6 * H) }, { tag: 'v0.2.9', publishedAt: iso(NOW - 8 * H) },
    { tag: 'launcher@0.4.0', publishedAt: iso(NOW - 3 * H) }, { tag: 'v9', publishedAt: null, draft: true },
  ];
  const s = teamStats({ issues, releases, data: { counters: {} }, now: NOW });
  assert.deepEqual(s.bugs, { open: 3, crucial: 1, openIssues: 4, byArea: { client: 1, launcher: 1, ui: 1 }, noArea: 1, bySource: { discord: 1, website: 1, github: 1 } });
  assert.equal(s.releases.gamePerWeek.at(-1), 3);
  assert.equal(s.releases.launcherPerWeek.at(-1), 1);
  assert.equal(s.releases.medianHoursBetweenGame, 3);
  assert.equal(s.releases.lastGame, iso(NOW - 2 * H));
});

test('Discord activity and moderation from the daily counters; no Team data in the moderation stats', () => {
  const data = {
    counters: { '2026-10-29': { messages: 100, authors: 20, joins: 3, reports: 1, warns: 2 }, '2026-10-30': { messages: 50, authors: 10, leaves: 1, timeouts: 1 }, _warnsAfter: 5 },
    applications: { a: { role: 'mod', status: 'open' }, v: { role: 'mod', status: 'veto-window' }, s: { role: 'support', status: 'stalled' }, b: { role: 'support', status: 'declined', decidedAt: NOW - 1000 }, c: { role: 'team', status: 'open' } },
    decisions: [{ title: 'secret plan' }],
  };
  const t = teamStats({ data, now: NOW });
  assert.deepEqual(t.discord.at(-1), { week: '2026-10-26', messages: 150, dailyActive: 15, joins: 3, leaves: 1 });
  const m = modStats({ data, now: NOW });
  assert.equal(m.weeks.at(-1).reports, 1);
  assert.equal(m.last7.warns, 2);
  assert.equal(m.last30.timeouts, 1);
  assert.deepEqual(m.applications, { open: { mod: 2, support: 1 }, accepted30: 0, declined30: 1 });
  assert.equal(m.countingSince, '2026-10-29');
  assert.ok(!JSON.stringify(m).includes('secret plan'));
});
