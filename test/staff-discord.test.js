// The staff dashboards' Discord side: who opens which dashboard, and the counters behind the stats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-staffd-')), 'state.json');
const { dashboardsFor } = await import('../src/features/staff.js');
const { OWNER_ID } = await import('../src/config.js');
const { openStaffStore } = await import('../src/staff-store.js');
const { counters, series } = await import('../src/staff-counters.js');

test('the Team role opens /staff/team, the Mod role /staff/mod, Ludovic both', () => {
  assert.deepEqual(dashboardsFor('5', ['1564768999655481485']), ['team']);
  assert.deepEqual(dashboardsFor('5', ['1559242168864997537']), ['mod']);
  assert.deepEqual(dashboardsFor('5', ['1559242168864997537', '1564768999655481485']), ['team', 'mod']);
  assert.deepEqual(dashboardsFor('5', ['123']), []);
  assert.deepEqual(dashboardsFor(OWNER_ID, []), ['team', 'mod']);
});

test('counters: per day, distinct authors, written on flush, old days dropped', () => {
  let now = Date.UTC(2026, 9, 30, 10);
  const store = openStaffStore(join(mkdtempSync(join(tmpdir(), 'kira-staffd-')), 'staff.json'), { now: () => now });
  const c = counters(store, { now: () => now });
  assert.equal(c.flush(), false);
  c.message('a'); c.message('a'); c.message('b'); c.bump('joins'); c.bump('reports', 2);
  assert.deepEqual(store.data.counters, {});
  assert.equal(c.flush(), true);
  assert.deepEqual(store.data.counters['2026-10-30'], { messages: 3, authors: 2, joins: 1, reports: 2 });
  now += 86_400_000;
  c.message('a');
  c.flush();
  assert.equal(store.data.counters['2026-10-31'].authors, 1);
  const s = series(store.data, 3, now);
  assert.deepEqual(s.map((r) => r.day), ['2026-10-29', '2026-10-30', '2026-10-31']);
  assert.equal(s[0].messages, 0);
  assert.equal(s[1].messages, 3);
  assert.ok(!JSON.stringify(store.data.counters).includes('"a"'));
  now += 200 * 86_400_000;
  c.bump('joins'); c.flush();
  assert.deepEqual(Object.keys(store.data.counters), [new Date(now).toISOString().slice(0, 10)]);
});
