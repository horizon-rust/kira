// The template check Kira runs on forum posts: a complete showcase post must pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missing } from '../src/features/forums.js';
import { LAYOUT } from '../src/config.js';

const forum = (key) => LAYOUT.flatMap((g) => g.channels).find((c) => c.key === key);
const post = (name, content, attachments = 0) => ({
  channel: { name },
  content,
  attachments: { size: attachments },
  embeds: [],
});

test('a showcase post with a description and screenshots passes, without the words "what" or "this"', () => {
  // The real post closed on 2026-11-05: title, a line of text, the version, eight screenshots and a link.
  const p = post(
    'Decided to port over a beautiful shader called Lux 1.2, its up on GitHub for anyone to grab!',
    'Yall are welcome to enjoy it just as much as i do, here yall go! Horizon version: nightly 2026-11-05 f319701\nhttps://github.com/GBanan/Lux-1.2-Shaders-For-Horizon/tree/main',
    8,
  );
  assert.deepEqual(missing(forum('showcase'), p), []);
});

test('a showcase post still needs a screenshot, a video or a link', () => {
  const p = post('My build', 'A castle I built over the weekend in survival mode.');
  assert.deepEqual(missing(forum('showcase'), p), ['a file or a link']);
});

test('a showcase post with only a picture and no words asks for more details', () => {
  const p = post('x', '', 1);
  assert.deepEqual(missing(forum('showcase'), p), ['more details (at least 20 characters)']);
});
