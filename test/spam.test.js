// Floods and copy-pastes (src/spam-kit.js): what times someone out and what is just talk. The cases are real ones
// from #mod-actions (2026-11-01..05): the mods lifted the short-reply ones on appeal and kept the ads and scams.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { MOD } = await import('../src/config.js');
const { spamVerdict } = await import('../src/spam-kit.js');

const T0 = 1_000_000;
// `texts` sent `gap` ms apart; returns the verdict at the last one.
function verdict(texts, gap = 2_000, links = () => false) {
  const list = texts.map((t, i) => ({ id: String(i), channelId: 'c', at: T0 + i * gap, content: t.trim().toLowerCase(), links: links(t) }));
  return spamVerdict(list, list.at(-1).at, MOD);
}
const hasLink = (t) => /https?:\/\//.test(t);

test('short replies said three times are talk, not spam', () => {
  for (const word of ['no', 'sim', 'omfg', 'boi', "you're wrong", '<@1244850147121168446>']) {
    assert.deepEqual(verdict([word, word, word]), [], word);
  }
});

test('the same short reply five times in a minute is still a copy-paste', () => {
  const [why, offending] = verdict(['no', 'no', 'no', 'no', 'no']);
  assert.equal(why, 'the same message 5 times');
  assert.equal(offending.length, 5);
});

test('a longer message pasted three times is a copy-paste', () => {
  const q = 'can someone send me the super duper vanilla shader?';
  assert.equal(verdict([q, q, q])[0], 'the same message 3 times');
});

test('ads and scams stay caught at three: headings and links count as long', () => {
  const ad = '# check my b​i​0 😁';
  assert.equal(verdict([ad, ad, ad])[0], 'the same message 3 times');
  const scam = 'free https://example.test/x';
  assert.equal(verdict([scam, scam, scam], 2_000, hasLink)[0], 'the same message 3 times');
});

test('one sentence typed over several lines is not a flood', () => {
  assert.deepEqual(verdict(['solo se', 'que el zoom', 'el mapa', 'no', 'funciona', 'en android'], 1_300), []);
});

test('a real burst is a flood', () => {
  const lines = Array.from({ length: 8 }, (_, i) => `line ${i}`);
  assert.equal(verdict(lines, 1_000)[0], '8 messages in 10 s');
});

test('repeats more than a minute apart do not add up', () => {
  const q = 'where can i report crash reports';
  assert.deepEqual(verdict([q, q, q], 31_000), []);
});
