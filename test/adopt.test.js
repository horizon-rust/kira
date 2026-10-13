// Unit tests for what keeps setup from making copies: finding what exists, and not overwriting each other's IDs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unique, isCopy } from '../src/adopt.js';

test('unique: nothing → null, one → itself, two → an error that names both', () => {
  assert.equal(unique([], 'x'), null);
  assert.deepEqual(unique([{ id: '1' }], 'x'), { id: '1' });
  assert.throws(() => unique([{ id: '1' }, { id: '2' }], 'channel #faq'), /2 copies of channel #faq \(1, 2\)/);
});

test('isCopy: same author and embed title (or first words), nobody else, nothing else', () => {
  const embed = { data: { title: '❓ FAQ' } };
  const mine = (over) => ({ author: { id: 'kira' }, embeds: [{ title: '❓ FAQ' }], content: '', ...over });
  assert.equal(isCopy(mine(), 'kira', { embeds: [embed] }), true);
  assert.equal(isCopy(mine({ embeds: [{ title: 'Rules' }] }), 'kira', { embeds: [embed] }), false);
  assert.equal(isCopy(mine({ author: { id: 'someone' } }), 'kira', { embeds: [embed] }), false);
  const intro = { content: '👋 **Introduce yourself** (once), like this: …' };
  assert.equal(isCopy(mine({ embeds: [], content: intro.content + ' edited' }), 'kira', intro), true);
  assert.equal(isCopy(mine({ embeds: [], content: 'hello' }), 'kira', intro), false);
  assert.equal(isCopy(mine({ embeds: [], content: '' }), 'kira', {}), false);
});

test('store: the bot and setup keep to their own keys when both write the file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kira-store-'));
  process.env.KIRA_STATE = join(dir, 'state.json');
  try {
    const store = await import('../src/store.js');
    const state = store.load();
    store.claim('bot');
    state.levels = { me: 1 };
    store.save();
    // setup (another process) records the IDs it made
    const onDisk = JSON.parse(readFileSync(process.env.KIRA_STATE, 'utf8'));
    onDisk.channels = { faq: '42' };
    onDisk.messages = { faq: '43' };
    writeFileSync(process.env.KIRA_STATE, JSON.stringify(onDisk));
    // the bot, still holding its old copy, saves: the IDs must survive, its own data must stay
    state.levels = { me: 2 };
    store.save();
    let now = JSON.parse(readFileSync(process.env.KIRA_STATE, 'utf8'));
    assert.deepEqual(now.channels, { faq: '42' });
    assert.deepEqual(now.messages, { faq: '43' });
    assert.deepEqual(now.levels, { me: 2 });
    // and the other way round: setup saves with an old copy of the bot's data
    store.claim('setup');
    now.levels = { me: 9 };
    writeFileSync(process.env.KIRA_STATE, JSON.stringify(now));
    state.channels = { faq: '42', rules: '44' };
    state.levels = { me: 2 };
    store.save();
    now = JSON.parse(readFileSync(process.env.KIRA_STATE, 'utf8'));
    assert.deepEqual(now.channels, { faq: '42', rules: '44' });
    assert.deepEqual(now.levels, { me: 9 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
