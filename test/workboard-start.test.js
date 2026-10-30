// The board at start: the last board.json until the first refresh, and a failed refresh retried in a minute.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kira-wbs-'));
process.env.KIRA_STATE = join(dir, 'state.json');
const saved = { version: 1, repo: 'x/y', generatedAt: '2026-10-14T00:00:00.000Z', doneDays: 7, columns: [{ key: 'todo', name: 'To do', cards: [] }] };
writeFileSync(join(dir, 'board.json'), JSON.stringify(saved));
const wb = await import('../src/features/workboard.js');

test('until the first refresh, the board is the last one written', () => {
  assert.deepEqual(wb.current(), saved);
});

test('a refresh that fails is tried again a minute later', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  let gets = 0;
  wb._test.setGitHub({ get: async () => { gets++; throw new Error('GitHub GET …: HTTP 500'); }, write: async () => ({}) });
  await wb.refresh();
  const first = gets;
  assert.ok(first > 0);
  mock.timers.tick(59_000);
  await new Promise((r) => setImmediate(r));
  assert.equal(gets, first);
  mock.timers.tick(1_000);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  assert.ok(gets > first);
  assert.deepEqual(wb.current(), saved); // still the saved board, not nothing
  mock.timers.reset();
});

test('a finished head and unchanged reviews are not read again on the next refresh', async () => {
  const paths = [];
  const pull = (n, sha, updated) => ({ number: n, head: { sha }, draft: false, updated_at: updated, title: 't', user: { login: 'u' } });
  let pulls = [pull(1, 'aaa', 'u1'), pull(2, 'bbb', 'u1')];
  wb._test.setGitHub({
    get: async (path) => {
      paths.push(path);
      if (path.includes('/pulls?state=open')) return path.includes('page=1') ? pulls : [];
      if (path.includes('/check-runs')) return { check_runs: [{ status: path.includes('bbb') ? 'in_progress' : 'completed', conclusion: 'success' }] };
      if (path.includes('/status')) return { statuses: [] };
      if (path.includes('/reviews')) return [];
      return null;
    },
    write: async () => ({}),
  });
  const first = await wb._test.openPulls();
  assert.deepEqual(first.map((p) => p.ci), ['passing', 'running']);
  paths.length = 0;
  pulls = [pull(1, 'aaa', 'u1'), pull(2, 'bbb', 'u2')];
  await wb._test.openPulls();
  // #1: passing head, same updated_at: nothing read. #2: still running and updated: CI and reviews read again.
  assert.deepEqual(paths.filter((p) => !p.includes('state=open')).sort(), [
    '/repos/horizon-rust/horizon/commits/bbb/check-runs?per_page=100',
    '/repos/horizon-rust/horizon/commits/bbb/status',
    '/repos/horizon-rust/horizon/pulls/2/reviews?per_page=100',
  ]);
});
