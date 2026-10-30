// Unit tests for the AutoMod rules (src/automod.js): the piracy and Telegram lists catch what they should and leave
// ordinary talk alone; every rule alerts #mod-log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { automodRules, keywordRegex, patternRegex, piracyMatch, telegramMatch, TELEGRAM_PATTERNS, TELEGRAM_MESSAGE } from '../src/automod.js';
import { MOD } from '../src/config.js';

const ids = { modlog: '1', mod: '3', team: '4' };

test('automod: the piracy rule blocks, alerts #mod-log and exempts the mods and the Horizon Team', () => {
  const rules = automodRules(ids);
  assert.equal(new Set(rules.map((r) => r.name)).size, rules.length, 'names are how setup finds a rule again');
  const piracy = rules.find((r) => r.name === 'Kira · piracy');
  assert.deepEqual(piracy.exemptRoles, ['3', '4']);
  assert.equal(piracy.actions[0].metadata.customMessage, MOD.piracy.message);
  assert.equal(piracy.actions[1].metadata.channel, '1');
  assert.ok(MOD.piracy.message.length <= 150, "Discord's limit for a block message");
});

test('automod: every rule that alerts, alerts #mod-log (#mod-chat is for the mods talking)', () => {
  const alerts = automodRules({ ...ids, modchat: '2' }).flatMap((r) => r.actions.filter((a) => a.type === 2));
  assert.ok(alerts.length >= 5);
  for (const a of alerts) assert.equal(a.metadata.channel, '1');
});

test('automod: the Telegram rule blocks naming the rules, alerts #mod-log, times out for an hour, exempts staff', () => {
  const tg = automodRules(ids).find((r) => r.name === 'Kira · telegram links');
  assert.equal(tg.triggerType, 1, 'a keyword rule (the only kind that can time out besides mention spam)');
  assert.deepEqual(tg.triggerMetadata.regexPatterns, TELEGRAM_PATTERNS);
  assert.deepEqual(tg.exemptRoles, ['3', '4']);
  const [block, alert, timeout] = tg.actions;
  assert.equal(block.type, 1);
  assert.equal(block.metadata.customMessage, TELEGRAM_MESSAGE);
  assert.match(TELEGRAM_MESSAGE, /rule 2 and 4/);
  assert.ok(TELEGRAM_MESSAGE.length <= 150);
  assert.equal(alert.type, 2);
  assert.equal(alert.metadata.channel, '1');
  assert.equal(timeout.type, 3);
  assert.equal(timeout.metadata.durationSeconds, 3600);
  assert.ok(TELEGRAM_PATTERNS.length <= 10);
  for (const p of TELEGRAM_PATTERNS) {
    assert.ok(p.length <= 260 && p.startsWith('(?i)') && !/\(\?<?[=!]/.test(p), p);
  }
});

const TELEGRAM = [
  'join https://t.me/freestuff', 't.me/joinchat/AAAAAEj', 'http://t.me/+AbCdEf123', 'T.ME/somechannel', 'www.telegram.me/someone',
  'telegram.me/joinchat/xyz', 'https://telegram.dog/cheats', 'telegram.org/joinchat/abc', 'open tg://join?invite=abc',
  'tg://resolve?domain=x', 't . me/channel', 't .me/channel', 't[.]me/channel', 't(.)me/channel', 't [dot] me/channel',
  't dot me/channel', 't.me / channel', 'telegram . me/channel', 'telegram[.]org/x', 'go to (t.me/abc)',
];
const NOT_TELEGRAM = [
  'tme', 'telegraph', 'the telegraph article', 'meet.me/abc', 'https://meet.me/room', 'about.me/ludovic', 'it.me/x',
  'let me/us know', 'is t.me a thing?', 'I use telegram', 'telegram is blocked here', 'what time is it', 'art.me/gallery',
  'tg is short for telegram', 'the tgx file', 'https://playhorizon.dev/hub', 'just.me/abc', 'smart.me/x',
];

test('automod: the Telegram rule catches t.me, telegram.me/.dog/.org, tg:// and spaced or written-out dots', () => {
  for (const text of TELEGRAM) assert.ok(telegramMatch(text), `should block: ${text}`);
});

test('automod: the Telegram rule leaves "tme", "telegraph", meet.me and talk about Telegram alone', () => {
  for (const text of NOT_TELEGRAM) assert.equal(telegramMatch(text), null, `should pass: ${text}`);
});

test("automod: the piracy list fits Discord's limits and reads the same in Rust and JavaScript", () => {
  const { keywords, patterns } = MOD.piracy;
  assert.ok(keywords.length <= 1000 && patterns.length <= 10);
  for (const k of keywords) assert.ok(k.length <= 60 && k === k.toLowerCase(), k);
  for (const p of patterns) {
    assert.ok(p.length <= 260, p);
    assert.ok(p.startsWith('(?i)'), `case-insensitive: ${p}`);
    assert.ok(!/\(\?<?[=!]/.test(p), `Rust's regex has no lookaround: ${p}`);
    patternRegex(p); // compiles
  }
});

test("automod: keywords match like Discord's (whole word, prefix, anywhere)", () => {
  assert.ok(keywordRegex('warez').test('any WAREZ sites?'));
  assert.ok(!keywordRegex('warez').test('warezland'));
  assert.ok(keywordRegex('tlauncher*').test('TLauncherLegacy works'));
  assert.ok(keywordRegex('tlauncher*').test('get it on tlauncher.org'));
  assert.ok(!keywordRegex('tlauncher*').test('notlauncher'));
  assert.ok(keywordRegex('*nazi*').test('xnazix'));
  assert.ok(keywordRegex('пиратк*').test('Есть пиратка?'));
  assert.ok(!keywordRegex('пиратк*').test('пиратский корабль'));
});

const PIRACY = [
  'where do I download tlauncher', 'TLauncher works fine with it', 'just use SKlauncher', 'TL Legacy?', 'try UltimMC',
  'pollymc lets you', 'any warez site', 'get a cracked minecraft', 'is there a cracked version of horizon',
  'crack for minecraft?', 'does it work with a cracked account', 'cracked launcher link pls', 'minecraft cracked',
  'Minecraft cracked version download', 'mc crack?', 'offline mode bypass', 'can I play in offline mode without buying the game',
  'offline-mode for free?', 'how to bypass the license check', 'bypass premium', 'is there a way to get around authentication',
  'free minecraft accounts here', 'mc alt generator', 'minecraft pirata funciona?', 'versión pirata', 'tem launcher pirata?',
  'minecraft no premium', 'скачал тлаунчер', 'а пиратка работает?',
];
const FINE = [
  'I love crackers', 'cracked deepslate bricks look great', 'minecraft cracked deepslate tiles', 'my screen cracked', 'crackling sound in the nether',
  'I cracked the code', 'the crack in the wall', 'does horizon support offline mode for LAN?', 'offline mode works when the wifi is down',
  'my launcher crashed', 'is Horizon free?', 'premium account?', 'pirates of the caribbean', 'пиратский корабль', 'tl;dr it works',
  'bypass the nether portal', 'online mode servers need Microsoft sign-in', 'Do I need to buy minecraft?', 'the Java version',
  'cracked stone bricks in minecraft', 'Minecraft crack ice', 'crack open a cold one',
];

test('automod: the piracy rule catches piracy', () => {
  for (const text of PIRACY) assert.ok(piracyMatch(text), `should block: ${text}`);
});

test('automod: the piracy rule leaves ordinary talk alone ("crack" alone, cracked blocks, offline mode for LAN)', () => {
  for (const text of FINE) assert.equal(piracyMatch(text), null, `should pass: ${text}`);
});
