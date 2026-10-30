// The line between the staff dashboards and the Discord side (docs/staff-api.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canApply, issueApplyLink, decide, setStaffSide, setDiscordSide, DECISION_TEXTS } from '../src/staff-hooks.js';

test('without the staff side, applications are closed', async () => {
  setStaffSide(null);
  assert.deepEqual(await canApply('1', 'mod'), { ok: false, why: 'closed' });
  assert.deepEqual(await issueApplyLink('1', 'mod'), { ok: false, why: 'closed' });
});

test('the staff side answers once registered', async () => {
  setStaffSide({ canApply: async () => ({ ok: true }), issueApplyLink: async (u, r) => ({ ok: true, url: `https://playhorizon.dev/apply#${u}${r}` }) });
  assert.deepEqual(await canApply('1', 'mod'), { ok: true });
  assert.equal((await issueApplyLink('1', 'team')).url, 'https://playhorizon.dev/apply#1team');
  setStaffSide(null);
});

test('decide reports what happened and never throws', async () => {
  setDiscordSide(null);
  assert.deepEqual(await decide({ outcome: 'accept' }), { granted: false, dmSent: false, error: 'discord side not loaded' });
  setDiscordSide({ decide: async () => ({ granted: true, dmSent: true }) });
  assert.deepEqual(await decide({ outcome: 'accept' }), { granted: true, dmSent: true, error: null });
  setDiscordSide({ decide: async () => { throw new Error('Missing Permissions'); } });
  assert.deepEqual(await decide({ outcome: 'accept' }), { granted: false, dmSent: false, error: 'Missing Permissions' });
  setDiscordSide(null);
});

test('the Team accept text says GitHub access is manual; the decline says when to apply again', () => {
  assert.match(DECISION_TEXTS.accept('team'), /GitHub organisation/);
  assert.doesNotMatch(DECISION_TEXTS.accept('mod'), /GitHub/);
  assert.match(DECISION_TEXTS.decline('support', Date.UTC(2026, 10, 13)), /2026-11-13/);
});
