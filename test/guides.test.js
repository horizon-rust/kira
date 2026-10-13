// Unit tests for the "How to post here" guides: one per forum, found again by name when the state loses its ID,
// and never counted as member posts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureThread, isOwnPost } from '../src/adopt.js';
import { howToPost, missingMessage } from '../src/texts.js';
import { LAYOUT, HOWTO, DEFAULT_CHANNELS } from '../src/config.js';

// A forum with a few posts, as setup sees it: `ensure(id)` is what setup calls for the guide of that forum.
function fakeForum(posts = []) {
  const forum = { id: 'forum1', posts: [...posts], creates: 0 };
  forum.ensure = (id) => ensureThread({
    id,
    fetchById: async (i) => {
      const p = forum.posts.find((t) => t.id === i);
      if (!p) throw new Error('Unknown Channel');
      return p;
    },
    list: async () => forum.posts,
    match: (t) => t.parentId === forum.id && t.ownerId === 'kira' && t.name === HOWTO.name,
    create: async () => {
      forum.creates++;
      const t = { id: 'guide' + forum.creates, parentId: forum.id, ownerId: 'kira', name: HOWTO.name };
      forum.posts.push(t);
      return t;
    },
    label: 'the guide of #test',
  });
  return forum;
}

test('guide: made once; with the state ID lost, found by name and never posted twice', async () => {
  // a member who copies the title is not the guide
  const forum = fakeForum([{ id: 'p1', parentId: 'forum1', ownerId: 'member', name: HOWTO.name }]);
  const first = await forum.ensure(undefined);
  assert.equal(first.created, true);
  const again = await forum.ensure(undefined); // the state lost the ID
  assert.equal(again.created, false);
  assert.equal(again.thread.id, first.thread.id);
  assert.equal((await forum.ensure(first.thread.id)).created, false);
  const stale = await forum.ensure('deleted-post'); // the remembered post is gone: found by name again
  assert.equal(stale.thread.id, first.thread.id);
  assert.equal(forum.creates, 1);
});

test('guide: two copies stop setup instead of making a third', async () => {
  const forum = fakeForum();
  await forum.ensure(undefined);
  forum.posts.push({ id: 'dup', parentId: 'forum1', ownerId: 'kira', name: HOWTO.name });
  await assert.rejects(forum.ensure(undefined), /2 copies of the guide of #test/);
  assert.equal(forum.creates, 1);
});

test("guide: Kira's own posts are not member posts", () => {
  assert.equal(isOwnPost({ ownerId: 'kira' }, 'kira'), true);
  assert.equal(isOwnPost({ ownerId: 'someone' }, 'kira'), false);
  assert.equal(isOwnPost({ ownerId: 'kira' }, undefined), false); // before the client is ready
});

test('guide: every forum with a template has its text, and the template check points to the post', () => {
  const forums = LAYOUT.flatMap((g) => g.channels).filter((c) => c.type === 'forum' && c.template);
  assert.ok(forums.length >= 8);
  for (const spec of forums) {
    const embed = howToPost(spec, { channels: {} }).embeds[0].data;
    assert.match(embed.title, new RegExp(`#${spec.name}`));
    assert.ok(embed.description.includes(spec.template.replace(/\*\*/g, '').split('\n')[0]));
    const linked = missingMessage(spec, ['x'], '1', { messages: { ['howto:' + spec.key]: '99' } }).embeds[0].data.description;
    assert.match(linked, /<#99>/);
    assert.match(missingMessage(spec, ['x'], '1').embeds[0].data.description, /How to post here/);
  }
});

test('onboarding: #new-members is a default channel, and every default channel exists', () => {
  assert.ok(DEFAULT_CHANNELS.includes('newmembers'));
  assert.equal(new Set(DEFAULT_CHANNELS).size, DEFAULT_CHANNELS.length);
  const keys = new Set(LAYOUT.flatMap((g) => g.channels).map((c) => c.key));
  for (const k of DEFAULT_CHANNELS) assert.ok(keys.has(k), k);
});
