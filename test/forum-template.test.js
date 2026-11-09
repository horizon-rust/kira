// The template check Kira runs on forum posts: a complete showcase post must pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missing, withReplies, answeredByTeam } from '../src/features/forums.js';
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

// A Discord message as the template check reads it, for the support forum's replies.
const msg = (id, authorId, content, { files = 0, bot = false, member = null } = {}) => ({
  id,
  author: { id: authorId, bot },
  member,
  channel: { name: 'When shaders on my game is fine but off my game is lagging' },
  content,
  attachments: new Map(Array.from({ length: files }, (_, i) => [`${id}-${i}`, { name: `clip${i}.mp4` }])),
  embeds: [],
});
const staff = { permissions: { has: () => true }, roles: { cache: { has: () => false } } };
const member = { permissions: { has: () => false }, roles: { cache: { has: () => false } } };

test('a support post whose template came in a later message from the poster passes (#120)', () => {
  // The post closed on 2026-11-04: two videos first, the template in a reply after Kira's notice.
  const starter = msg('1', 'poster', '', { files: 2 });
  const replies = [
    msg('2', 'kira', 'Your post is missing: What\'s wrong, OS, CPU, GPU', { bot: true }),
    msg('3', 'poster', "What's wrong: with shaders off the game stutters every few seconds. Windows 11, Ryzen 5 5600, RTX 3060."),
  ];
  const support = forum('horizonsupport');
  assert.notDeepEqual(missing(support, starter), []);
  const post = withReplies(starter, replies);
  assert.deepEqual(missing(support, post), []);
  assert.equal(post.attachments.size, 2);
  assert.equal(post.author.id, 'poster');
});

test("other people's messages don't fill in the poster's template", () => {
  const starter = msg('1', 'poster', 'lag', { files: 1 });
  const replies = [msg('2', 'someone', "What's wrong: lag on Windows with an NVIDIA GPU, every time I open the world.", { member })];
  assert.notDeepEqual(missing(forum('horizonsupport'), withReplies(starter, replies)), []);
});

test('a post a mod answered is not closed for its template, one only members answered still is', () => {
  const support = forum('horizonsupport');
  const starter = msg('1', 'poster', 'lag', { member });
  assert.equal(answeredByTeam(support, starter, [msg('2', 'kira', 'missing…', { bot: true, member: staff })]), false);
  assert.equal(answeredByTeam(support, starter, [msg('2', 'friend', 'same here', { member })]), false);
  assert.equal(answeredByTeam(support, starter, [msg('2', 'poster', 'bump', { member: staff })]), false);
  assert.equal(answeredByTeam(support, starter, [msg('2', 'mod', 'Can you share your log?', { member: staff })]), true);
});
