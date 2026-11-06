// Floods and copy-pastes (src/spam-kit.js): what times someone out and what is just talk. The cases are real ones
// from #mod-actions (2026-11-01..05): the mods lifted the short-reply ones on appeal and kept the ads and scams.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { MOD } = await import('../src/config.js');
const MOD_KIT = await import('../src/spam-kit.js');
const { spamVerdict, liftStrike } = MOD_KIT;

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

// Case #61/#63 (2026-11-05): one announcement posted in a few channels within a minute was a false spam timeout.
const announcement = 'Fabric mods in Horizon: beta download is out https://github.com/horizon-rust/horizon/releases';
function posted(channels, gap = 5_000) {
  const list = channels.map((ch, i) => ({ id: String(i), channelId: ch, at: T0 + i * gap, content: announcement.toLowerCase(), links: true }));
  return spamVerdict(list, list.at(-1).at, MOD);
}

test('an announcement cross-posted to three channels is sharing, not spam: the copies are left alone', () => {
  assert.deepEqual(posted(['news', 'chat', 'mods']), []);
  assert.deepEqual(posted(['news', 'chat', 'mods', 'help']), []);
});

test('the same long message three times in one channel is still a copy-paste', () => {
  const [why, offending] = posted(['chat', 'chat', 'chat']);
  assert.equal(why, 'the same message 3 times');
  assert.equal(offending.length, 3);
});

test('five channels with the same message is a spray', () => {
  const [why, offending] = posted(['a', 'b', 'c', 'd', 'e']);
  assert.equal(why, 'the same message in 5 channels');
  assert.equal(offending.length, 5);
});

test('the link flood still catches a bot that sends different links to many channels', () => {
  const list = Array.from({ length: 5 }, (_, i) => ({ id: String(i), channelId: `c${i}`, at: T0 + i * 3_000, content: `free nitro ${i} https://x.test/${i}`, links: true }));
  assert.equal(spamVerdict(list, list.at(-1).at, MOD)[0], '5 messages with links in 30 s');
});

test('a lifted timeout no longer counts as a strike: only that timeout\'s strike goes', () => {
  assert.deepEqual(liftStrike([T0, T0 + 3_600_000], T0 + 2_000), [T0 + 3_600_000]);
  assert.deepEqual(liftStrike([T0, T0 + 3_600_000], T0 + 3_600_000 + 2_000), [T0]);
  assert.deepEqual(liftStrike([T0], T0 + 3_600_000), [T0], 'no strike near that timeout: nothing dropped');
  assert.deepEqual(liftStrike([], T0), []);
});

test('a first copy-paste from an established member is a warning, the second a timeout', () => {
  const { warnFirst } = MOD_KIT;
  const day = 86_400_000;
  const said = [1, 2, 3, 4, 5].map((i) => ({ content: 'false ban btw', links: 0, channelId: 'c', at: i }));
  assert.equal(warnFirst(said, { accountAgeMs: 400 * day, warnedToday: false }, MOD), true);
  assert.equal(warnFirst(said, { accountAgeMs: 400 * day, warnedToday: true }, MOD), false);
});

test('ads, pings and new accounts still time out on the first copy-paste', () => {
  const { warnFirst } = MOD_KIT;
  const day = 86_400_000;
  const old = { accountAgeMs: 400 * day, warnedToday: false };
  const ad = [{ content: 'free nitro https://x.y', links: 1 }];
  const ping = [{ content: '<@123> dm me for free ai', links: 0 }];
  assert.equal(warnFirst(ad, old, MOD), false);
  assert.equal(warnFirst(ping, old, MOD), false);
  assert.equal(warnFirst([{ content: 'dm me for free ai', links: 0 }], { accountAgeMs: day, warnedToday: false }, MOD), false);
  const sprayed = ['a', 'b', 'c', 'd', 'e'].map((channelId) => ({ content: 'dm me for free ai', links: 0, channelId }));
  assert.equal(warnFirst(sprayed, old, MOD), false);
});
