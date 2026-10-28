// Unit tests for the chat clear (src/clear-kit.js): what it deletes, how, and where /clear-chat works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortForClear, oldestId, batches, clearAllowed, clearLine, BULK_MAX_AGE_MS } from '../src/clear-kit.js';
import { CLEAR, LAYOUT, MOD } from '../src/config.js';

const H = 3_600_000, D = 24 * H;
const now = Date.parse('2026-10-28T12:00:00Z');
const msg = (id, ageMs, extra = {}) => ({ id, createdTimestamp: now - ageMs, pinned: false, hasThread: false, deletable: true, ...extra });

test('chat clear: only messages older than the age go; under 14 days in bulk, older one by one', () => {
  const page = [msg('1', 2 * H), msg('2', 23 * H), msg('3', 25 * H), msg('4', 10 * D), msg('5', 15 * D), msg('6', 14 * D - 30 * 60_000)];
  const out = sortForClear(page, { now, olderThanMs: 24 * H });
  assert.deepEqual(out.bulk, ['3', '4']);
  assert.deepEqual(out.single, ['5', '6']); // within an hour of 14 days: one by one, so it can't age out of bulk meanwhile
  assert.ok(BULK_MAX_AGE_MS < 14 * D);
});

test('chat clear: pins, thread starters and undeletable messages stay', () => {
  const page = [msg('1', 2 * D, { pinned: true }), msg('2', 2 * D, { hasThread: true }), msg('3', 20 * D, { deletable: false }), msg('4', 2 * D), msg('5', 1 * H, { pinned: true })];
  const out = sortForClear(page, { now, olderThanMs: 24 * H });
  assert.deepEqual(out.bulk, ['4']);
  assert.deepEqual(out.single, []);
  assert.equal(out.pinned, 1); // the recent pin isn't counted: it was never a candidate
  assert.equal(out.threads, 1);
  assert.equal(out.undeletable, 1);
});

test('chat clear: older_than in hours, pages and batches', () => {
  assert.deepEqual(sortForClear([msg('1', 2 * H), msg('2', 30 * 60_000)], { now, olderThanMs: 1 * H }).bulk, ['1']);
  assert.equal(oldestId(['1559239271271891004', '1559227979002028052', '1559239271271891005']), '1559227979002028052');
  assert.deepEqual(batches(Array.from({ length: 250 }, (_, i) => i)).map((b) => b.length), [100, 100, 50]);
  assert.deepEqual(batches([]), []);
});

test('chat clear: /clear-chat works in chat channels only', () => {
  const spec = (key) => LAYOUT.flatMap((g) => g.channels.map((c) => ({ ...c, staff: c.staff || g.staff }))).find((c) => c.key === key);
  assert.equal(clearAllowed({ isText: true, spec: spec('horizonchat') }), true);
  assert.equal(clearAllowed({ isText: true, spec: spec('introductions') }), true);
  assert.equal(clearAllowed({ isText: true, spec: spec('offtopic') }), true);
  assert.equal(clearAllowed({ isText: true, spec: undefined }), true); // a channel made by hand
  assert.equal(clearAllowed({ isText: true, spec: spec('rules') }), false); // read-only: Kira's own posts
  assert.equal(clearAllowed({ isText: true, spec: spec('modlog') }), false);
  assert.equal(clearAllowed({ isText: true, spec: spec('horizonteam') }), false);
  assert.equal(clearAllowed({ isText: true, spec: undefined, staffParent: true }), false);
  assert.equal(clearAllowed({ isText: false, spec: spec('general') }), false); // threads, forums, voice
});

test('chat clear: the schedule is #horizon-chat and #general, a day, every 6 hours, and no channel has slowmode', () => {
  assert.deepEqual(CLEAR.channels, ['horizonchat', 'general']);
  assert.equal(CLEAR.olderThanHours, 24);
  assert.equal(CLEAR.everyMs, 6 * H);
  const text = LAYOUT.flatMap((g) => g.channels);
  for (const key of CLEAR.channels) {
    const c = text.find((x) => x.key === key);
    assert.ok(c && c.type === 'text', key);
    assert.match(c.topic, /older than a day are cleared every 6 hours/);
    assert.ok(c.topic.length <= 1024);
  }
  assert.deepEqual(text.filter((c) => c.slowmode).map((c) => c.key), []); // Ludovic, 2026-10-28
  assert.deepEqual(MOD.autoSlowmode, []);
});

test('chat clear: one line for #mod-log', () => {
  assert.equal(clearLine([['10', { deleted: 1234, pinned: 2, failed: 0 }], ['11', { deleted: 5, pinned: 1, failed: 3 }]], 24),
    'Older than 24 h: <#10> 1,234 deleted · <#11> 5 deleted (3 failed) · 3 pinned kept');
  assert.equal(clearLine([], 24), 'Older than 24 h: no channel');
});
