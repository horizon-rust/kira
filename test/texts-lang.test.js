import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkify } from '../src/texts.js';

test('channel names in other scripts link too', () => {
  const state = { channels: { russian: 'r1', portuguese: 'p1', spanish: 's1', offtopic: 'o1' } };
  assert.equal(linkify('#off-topic, #русский, #português, #español.', state), '<#o1>, <#r1>, <#p1>, <#s1>.');
});
