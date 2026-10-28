// Unit tests for the AutoMod rules (src/automod.js): the piracy list catches piracy and leaves ordinary talk alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { automodRules, keywordRegex, patternRegex, piracyMatch } from '../src/automod.js';
import { MOD } from '../src/config.js';

const ids = { modlog: '1', modchat: '2', mod: '3', team: '4' };

test('automod: the piracy rule blocks, alerts #mod-chat and exempts the mods and the Horizon Team', () => {
  const rules = automodRules(ids);
  assert.equal(new Set(rules.map((r) => r.name)).size, rules.length, 'names are how setup finds a rule again');
  const piracy = rules.find((r) => r.name === 'Kira · piracy');
  assert.deepEqual(piracy.exemptRoles, ['3', '4']);
  assert.equal(piracy.actions[0].metadata.customMessage, MOD.piracy.message);
  assert.equal(piracy.actions[1].metadata.channel, '2');
  assert.ok(MOD.piracy.message.length <= 150, "Discord's limit for a block message");
  // The other rules still alert #mod-log.
  assert.equal(rules.find((r) => r.name === 'Kira · spam').actions[1].metadata.channel, '1');
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
