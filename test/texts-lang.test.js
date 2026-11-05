import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkify } from '../src/texts.js';

test('channel names in other scripts link too', () => {
  const state = { channels: { russian: 'r1', portuguese: 'p1', spanish: 's1', general: 'o1' } };
  assert.equal(linkify('#general, #русский, #português, #español.', state), '<#o1>, <#r1>, <#p1>, <#s1>.');
});

test('language channels: eleven, everyone sees them (default channels), each topic in its language pointing to the English forums, #welcome and #rules list them all', async () => {
  const { LAYOUT, DEFAULT_CHANNELS, WELCOME, RULES } = await import('../src/config.js');
  const langs = LAYOUT.find((g) => g.key === 'languages').channels;
  assert.deepEqual(langs.map((c) => c.name), ['русский', 'português', 'español', 'français', 'deutsch', 'italiano', 'nederlands', 'polski', 'türkçe', '中文', '日本語']);
  for (const c of langs) {
    assert.ok(DEFAULT_CHANNELS.includes(c.key), c.key);
    assert.match(c.topic, /#horizon-bugs.*#horizon-ideas/);
  }
  const state = { channels: Object.fromEntries(langs.map((c, i) => [c.key, `id${i}`])) };
  assert.equal(linkify('#中文 #日本語 #türkçe #polski.', state), `<#${state.channels.chinese}> <#${state.channels.japanese}> <#${state.channels.turkish}> <#${state.channels.polish}>.`);
  assert.equal(linkify('#italiano #français', state), `<#${state.channels.italian}> <#${state.channels.french}>`);
  assert.equal(linkify('#nederlands #deutsch', state), `<#${state.channels.dutch}> <#${state.channels.german}>`);
  const welcome = String(WELCOME.description);
  const names = langs.map((c) => `#${c.name}`);
  const rule = RULES.find(([t]) => t === 'English in the main channels')[1];
  for (const name of names) {
    assert.ok(rule.includes(name), `#rules lists ${name}`);
    assert.ok(welcome.includes(name), `#welcome lists ${name}`);
  }
  assert.equal(langs.find((c) => c.key === 'italian').name, 'italiano');
  assert.deepEqual(langs.map((c) => c.key).slice(5, 7), ['italian', 'dutch'], '#nederlands right after #italiano');
  assert.equal(linkify('Bug 请发到 #horizon-bugs，想法', { channels: { horizonbugs: 'b' } }), 'Bug 请发到 <#b>，想法'); // the full-width comma ends the name
});
