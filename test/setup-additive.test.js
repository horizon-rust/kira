// `npm run setup` is additive: it makes what is missing and never changes what exists unless --apply-layout --yes.
// (2026-11-01: a plain run applied a stale LAYOUT to the live server.) The decisions live in src/layout-diff.js, texts.js
// and automod.js, with no Discord connection so they can be tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-additive-')), 'state.json');
const { LAYOUT, ROLES, GUILD_ID, OWNER_ID } = await import('../src/config.js');
const { parseArgs, findChannel, findCategory, layoutDiff, rolesDiff, overwriteLines, TYPE_OF } = await import('../src/layout-diff.js');
const { linkify, handles, plain, channelTopic } = await import('../src/texts.js');
const { applyAutomod, automodRules } = await import('../src/automod.js');
const { overwrites } = await import('../src/permissions.js');

const live = JSON.parse(readFileSync(new URL('./fixtures/live-channels-2026-11-01.json', import.meta.url), 'utf8'));
const specs = LAYOUT.flatMap((g) => g.channels);
const spec = (key) => specs.find((c) => c.key === key);
const group = (key) => LAYOUT.find((g) => g.key === key);
const structure = (lines) => lines.filter((l) => /^(rename|retype|move|bitrate)/.test(l) || / category /.test(l));

test('arguments: nothing is additive; --apply-layout prints the diff; it only acts with --yes too', () => {
  assert.equal(parseArgs([]).mode, 'additive');
  assert.equal(parseArgs(['--apply-layout']).mode, 'diff');
  assert.equal(parseArgs(['--apply-layout', '--yes']).mode, 'apply');
  assert.equal(parseArgs(['--yes', '--apply-layout']).mode, 'apply');
  assert.throws(() => parseArgs(['--yes']), /--yes only goes with --apply-layout/); // alone it would silently do nothing
  assert.throws(() => parseArgs(['--apply']), /unknown option --apply/);
});

test('setup.js refuses a bad command line before it touches anything', () => {
  for (const args of [['--yes'], ['--force']]) {
    const r = spawnSync(process.execPath, ['src/setup.js', ...args], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, DISCORD_TOKEN: '' }, timeout: 20_000 });
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /--yes only goes with|unknown option/);
  }
});

test('LAYOUT agrees with the live server of 2026-11-01: no rename, retype, move or bitrate to apply', () => {
  const state = { channels: {}, roles: {} };
  assert.deepEqual(structure(layoutDiff({ layout: LAYOUT, live, state })), []);
  // …found by name alone, with an empty state, and not one of them would be created
  assert.deepEqual(layoutDiff({ layout: LAYOUT, live, state }).filter((l) => l.startsWith('create')), []);
});

test('the names and types the live server has today', () => {
  const name = (key) => spec(key).name;
  assert.equal(name('general'), 'general-chat');
  assert.equal(name('horizonchat'), '💬│horizon-chat');
  assert.equal(name('updates'), '📰│updates');
  assert.equal(name('releases'), '📰│releases');
  assert.equal(name('announcements'), '📢│announcements');
  assert.equal(name('officialserver'), '🗝️│join-server');
  assert.equal(name('welcome'), 'ping-roles');
  assert.equal(name('sponsors'), 'sponsors');
  assert.equal(name('ludovicvideos'), 'ludovic-videos');
  assert.equal(name('honeypot'), '🚫│no-text');
  assert.equal(name('serverchat'), '🌐│server-chat');
  assert.equal(spec('welcome').type, 'announcement');
  assert.equal(spec('ludovicvideos').type, 'announcement');
  assert.deepEqual(LAYOUT.map((g) => g.category).slice(0, 4), ['PLAYHORIZON.DEV', 'HORIZON-GENERAL', 'HORIZONSMP', '🛠️ CONTRIBUTORS']);
  assert.equal(group('general').category, 'GENERAL');
  assert.ok(spec('lounge').bitrate > 0, 'voice bitrates are LAYOUT\'s, not "the most the boosts allow"');
});

test('#server-chat: the existing channel is found, with or without state, so setup never makes a second one', () => {
  const chat = spec('serverchat');
  assert.equal(chat.id, '1566146381931094148');
  assert.equal(findChannel(chat, live, { channels: {} }).id, chat.id);                       // empty state: LAYOUT's id
  assert.equal(findChannel({ ...chat, id: undefined }, live, { channels: {} }).id, chat.id); // …or its name
  assert.equal(findChannel({ ...chat, id: undefined, name: 'x', aka: ['server-chat'] }, [{ id: '5', name: 'server-chat', type: 0 }], { channels: {} }).id, '5'); // the old name
  assert.equal(findChannel(chat, live, { channels: { serverchat: '1559242412121919620' } }).id, '1559242412121919620', 'the state wins');
  const stateWithMissing = { channels: { serverchat: 'deleted' } };
  assert.equal(findChannel(chat, live, stateWithMissing).id, chat.id, 'a stale id falls back to the name');
  assert.ok(group('smp').channels.includes(chat), 'its category is HORIZONSMP, where it is');
});

test('findChannel: state, then LAYOUT id, then the only match by name; copies stop setup; temporary rooms are skipped', () => {
  const text = (id, name, type = 0) => ({ id, name, type });
  const s = { key: 'k', name: '💬│chat', type: 'text' };
  assert.equal(findChannel(s, [text('1', 'chat')], { channels: {} }).id, '1', 'the name without its decoration');
  assert.equal(findChannel(s, [text('1', 'chat'), text('2', 'other')], { channels: { k: '2' } }).id, '2');
  assert.equal(findChannel(s, [text('1', 'other')], { channels: {} }), null, 'missing → setup creates it');
  assert.equal(findChannel(s, [text('1', '💬│chat', 2)], { channels: {} }), null, 'a voice channel is not a text channel');
  assert.equal(findChannel(s, [text('1', 'chat', 5)], { channels: {} }).id, '1', 'text and announcement channels stand for each other');
  assert.throws(() => findChannel(s, [text('1', 'chat'), text('2', '💬│chat')], { channels: {} }), /2 copies of channel/);
  assert.equal(findChannel({ key: 'v', name: 'Lounge', type: 'voice' }, [text('1', 'Lounge', 2), text('2', 'Lounge', 2)], { channels: {} }, { skip: (c) => c.id === '2' }).id, '1');
});

test('findCategory: by state, else by its name or the name it had', () => {
  const g = group('start');
  assert.equal(findCategory(g, live, { channels: {} }).name, 'PLAYHORIZON.DEV');
  assert.equal(findCategory(g, [{ id: '9', name: '👋 start here', type: 4 }], { channels: {} }).id, '9', 'old name (aka)');
  assert.equal(findCategory(g, live, { channels: { 'cat:start': '1559242413732536381' } }).name, 'HORIZON-GENERAL', 'the state wins');
  assert.equal(findCategory(g, [{ id: '9', name: 'nothing', type: 4 }], { channels: {} }), null);
});

test('layoutDiff lists every change --apply-layout --yes would make', () => {
  const state = { channels: {}, roles: {} };
  const stale = structuredClone(live);
  const by = (id) => stale.find((c) => c.id === id);
  by('1559227979559731353').name = 'general';              // renamed
  by('1563700249724461168').type = 0;                      // retyped
  by('1559242376747286549').parent_id = '1559242413732536381'; // moved
  by('1559227979559731354').bitrate = 384000;              // bitrate
  by('1559242374948061214').name = '👋 start here';        // category renamed
  stale.push({ id: '777', name: 'Extra', type: 2, parent_id: null, position: 0 });
  const lines = layoutDiff({ layout: LAYOUT, live: stale, state });
  assert.ok(lines.includes('rename #general → "general-chat"'), lines.join('\n'));
  assert.ok(lines.some((l) => /^retype #ludovic-videos: text → announcement/.test(l)));
  assert.ok(lines.some((l) => /^move #ping-roles to PLAYHORIZON.DEV/.test(l)));
  assert.ok(lines.includes('bitrate of #Lounge: 384000 → 256000'));
  assert.ok(lines.includes('rename category "👋 start here" → "PLAYHORIZON.DEV"'));
  assert.deepEqual(layoutDiff({ layout: LAYOUT, live, state }).filter((l) => l.startsWith('create')), []);
  // a channel that is missing is a creation; a changed topic and a changed order show
  const fewer = live.filter((c) => c.id !== '1566413848678895626');
  assert.ok(layoutDiff({ layout: LAYOUT, live: fewer, state }).includes('create #🚫│no-text in PLAYHORIZON.DEV'));
  const moved = structuredClone(live); moved.find((c) => c.id === '1559242378085146704').position = 0;
  assert.ok(layoutDiff({ layout: LAYOUT, live: moved, state }).includes('channel order in PLAYHORIZON.DEV differs'));
});

test('layoutDiff: topics (with their #mentions) and permission overwrites are compared too', () => {
  const state = { channels: {}, roles: {} };
  const topics = structuredClone(live);
  const chat = topics.find((c) => c.id === '1559242412121919620');
  const want = channelTopic(spec('horizonchat'), { channels: { horizonsupport: '1565697670901800980', horizonbugs: '1559242573552558210', horizonideas: '1559242571929354364' } });
  chat.topic = want;
  assert.ok(!layoutDiff({ layout: LAYOUT, live: topics, state }).some((l) => /topic of #💬│horizon-chat/.test(l)), 'the mentions resolve to the live ids');
  chat.topic = 'something else';
  assert.ok(layoutDiff({ layout: LAYOUT, live: topics, state }).includes('topic of #💬│horizon-chat differs'));

  const ids = { everyone: GUILD_ID, mod: 'MOD', kira: 'KIRA', owner: OWNER_ID, roles: { team: 'TEAM' } };
  const wanted = (s, g, kind) => (kind === 'category' ? [] : overwrites(ids, s, g.staff));
  const withOw = live.map((c) => ({ ...c, permission_overwrites: [] }));
  const lines = layoutDiff({ layout: LAYOUT, live: withOw, state, wantedOverwrites: wanted });
  assert.ok(lines.some((l) => /^permission overwrites of #rules differ: \+\[/.test(l)));
  assert.equal(overwriteLines([{ id: '1', type: 0, allow: '0', deny: '0' }]).length, 0, 'an empty overwrite is none');
  assert.deepEqual(overwriteLines([{ id: '1', type: 1, allow: '2048', deny: '0' }]), ['member:1 +2048 -0']);
});

test('rolesDiff: names, colours, hoist and permissions', () => {
  const roles = [{ id: 'r1', name: '🛡️ Mod', color: 0, hoist: false, mentionable: false, permissions: '0' }];
  const lines = rolesDiff({ roles: ROLES.filter((r) => r.key === 'mod'), live: roles, state: { roles: { mod: 'r1' } } });
  assert.ok(lines.some((l) => /^permissions of role/.test(l)));
  assert.ok(lines.some((l) => /^colour of role/.test(l)));
  assert.ok(rolesDiff({ roles: ROLES.filter((r) => r.key === 'mod'), live: [], state: { roles: {} } })[0].startsWith('create role'));
});

test('texts: mentions resolve by the name without its decoration and by the names a channel had', () => {
  assert.deepEqual(handles({ name: '💬│horizon-chat' }), ['💬│horizon-chat', 'horizon-chat']);
  assert.equal(plain('plain'), 'plain');
  const state = { channels: Object.fromEntries(specs.map((c, i) => [c.key, String(i + 1)])) };
  const id = (key) => `<#${state.channels[key]}>`;
  assert.equal(linkify('#horizon-chat #general-chat #general #sponsors #support-horizon #ping-roles #welcome #updates #join-server #official-server', state),
    [id('horizonchat'), id('general'), id('general'), id('sponsors'), id('sponsors'), id('welcome'), id('welcome'), id('updates'), id('officialserver'), id('officialserver')].join(' '));
  assert.equal(linkify('#no-text #do-not-post', state), `${id('honeypot')} ${id('honeypot')}`);
  // every handle of the layout belongs to one channel only
  const seen = new Map();
  for (const c of specs.filter((s) => s.type !== 'voice')) for (const h of handles(c)) { assert.ok(!seen.has(h) || seen.get(h) === c.key, `${h} names two channels`); seen.set(h, c.key); }
});

test('nothing at runtime finds a channel by its name: the bot uses the IDs in state', () => {
  const dir = new URL('../src/', import.meta.url);
  const files = [...readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => f), ...readdirSync(new URL('features/', dir)).map((f) => `features/${f}`)]
    .filter((f) => !['setup.js', 'layout-diff.js'].includes(f));
  for (const f of files) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(text, /(channels|channels\.cache)\.(find|filter|some)\([^\n]*\.name\b/, `${f} looks a channel up by its name`);
    assert.doesNotMatch(text, /channels\.cache\.find\(\([a-z]+\) => [a-z]+\.name/, `${f} looks a channel up by its name`);
  }
  // …and the honeypot is the ID setup stored under its LAYOUT key
  assert.match(readFileSync(new URL('features/moderation.js', dir), 'utf8'), /msg\.channelId !== state\.channels\.honeypot/);
});

test('#join-server and #server-chat: Ludovic has no overwrite of his own there, as on the live server', () => {
  const ids = { everyone: 'ev', mod: 'mod', kira: 'kira', owner: OWNER_ID, roles: { team: 'team' } };
  for (const key of ['officialserver', 'serverchat']) {
    assert.ok(!overwrites(ids, spec(key), false).some((o) => o.id === OWNER_ID), key);
  }
  assert.ok(overwrites(ids, spec('rules'), false).some((o) => o.id === OWNER_ID), 'other read-only channels keep it');
});

test('automod: existing rules are left alone unless update is asked; missing ones are made', async () => {
  const rules = automodRules({ modlog: '1', mod: '2', team: '3' });
  const calls = { edit: [], create: [] };
  const found = { name: rules[0].name, edit: async (d) => calls.edit.push(d.name) };
  const guild = { autoModerationRules: { fetch: async () => ({ find: (fn) => [found].find(fn) }), create: async (d) => calls.create.push(d.name) } };
  await applyAutomod(guild, { modlog: '1', mod: '2', team: '3' }, () => {}, { update: false });
  assert.deepEqual(calls.edit, []);
  assert.deepEqual(calls.create, rules.slice(1).map((r) => r.name));
  calls.create.length = 0;
  await applyAutomod(guild, { modlog: '1', mod: '2', team: '3' }, () => {}); // the default (scripts/apply-moderation.js) updates
  assert.deepEqual(calls.edit, [rules[0].name]);
});

test('every channel type LAYOUT uses is known', () => {
  for (const c of specs) assert.ok(c.type in TYPE_OF, c.key);
});
