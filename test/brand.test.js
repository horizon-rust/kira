import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBrand } from '../src/brand.js';

test('the server icon and the avatar are set once, then only when their files change', async () => {
  const calls = [];
  const guild = { setIcon: async (b) => calls.push(['icon', b.length]) };
  const client = { user: { setAvatar: async (b) => calls.push(['avatar', b.length]) } };
  const state = {};
  let saves = 0;
  await applyBrand(client, guild, state, () => saves++);
  assert.deepEqual(calls.map((c) => c[0]), ['icon', 'avatar']);
  assert.ok(calls.every((c) => c[1] > 0));
  assert.equal(saves, 2);
  await applyBrand(client, guild, state, () => saves++);
  assert.equal(calls.length, 2);
  state.brand.avatar = 'an older file';
  await applyBrand(client, guild, state, () => saves++);
  assert.deepEqual(calls.at(-1)[0], 'avatar');
  assert.equal(calls.length, 3);
});
