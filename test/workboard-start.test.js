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
