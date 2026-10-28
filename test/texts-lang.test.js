import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkify } from '../src/texts.js';

test('channel names in other scripts link too', () => {
  const state = { channels: { russian: 'r1', portuguese: 'p1', spanish: 's1', offtopic: 'o1' } };
  assert.equal(linkify('#off-topic, #русский, #português, #español.', state), '<#o1>, <#r1>, <#p1>, <#s1>.');
});

test('language channels: nine, opt-in through onboarding, each topic in its language pointing to the English forums', async () => {
  const { LAYOUT, LANGUAGES, DEFAULT_CHANNELS } = await import('../src/config.js');
  const langs = LAYOUT.find((g) => g.key === 'languages').channels;
  assert.deepEqual(langs.map((c) => c.name), ['русский', 'português', 'español', 'français', 'deutsch', 'polski', 'türkçe', '中文', '日本語']);
  assert.deepEqual(LANGUAGES.map(([k]) => k).sort(), langs.map((c) => c.key).sort()); // every one is in the question
  for (const c of langs) {
    assert.ok(!DEFAULT_CHANNELS.includes(c.key), c.key);
    assert.match(c.topic, /#horizon-bugs.*#horizon-ideas/);
  }
  const state = { channels: Object.fromEntries(langs.map((c, i) => [c.key, `id${i}`])) };
  assert.equal(linkify('#中文 #日本語 #türkçe #polski.', state), `<#${state.channels.chinese}> <#${state.channels.japanese}> <#${state.channels.turkish}> <#${state.channels.polish}>.`);
  assert.equal(linkify('Bug 请发到 #horizon-bugs，想法', { channels: { horizonbugs: 'b' } }), 'Bug 请发到 <#b>，想法'); // the full-width comma ends the name
});
