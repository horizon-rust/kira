// #contributors: everyone reads, only 🛠️ Contributor, mods and Kira write; and the role is no longer a button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits as P } from 'discord.js';
import { LAYOUT, ROLES, DEFAULT_CHANNELS, CHANNEL_MODS } from '../src/config.js';
import { overwrites } from '../src/permissions.js';
import { rolesMessage } from '../src/texts.js';

const specs = LAYOUT.flatMap((g) => g.channels);
const spec = specs.find((c) => c.key === 'contributors');
const ids = { everyone: 'EVERYONE', mod: 'MOD', kira: 'KIRA', owner: 'OWNER', roles: { contributor: 'CONTRIB', mod: 'MOD', team: 'TEAM' } };

// What a member holding `roles` can do in the channel, from @everyone's base permissions (as setup gives them) and
// the overwrites, in Discord's order: @everyone's overwrite, then the member's roles (all denies, then all allows).
const BASE = [P.ViewChannel, P.SendMessages, P.SendMessagesInThreads, P.AddReactions, P.ReadMessageHistory];
function can(roles, perm, ow) {
  let allowed = BASE.includes(perm);
  const mine = (id) => ow.find((o) => o.id === id && o.type === 0);
  const every = mine('EVERYONE');
  if (every?.deny?.includes(perm)) allowed = false;
  if (every?.allow?.includes(perm)) allowed = true;
  const rs = roles.map(mine).filter(Boolean);
  if (rs.some((o) => o.deny?.includes(perm))) allowed = false;
  if (rs.some((o) => o.allow?.includes(perm))) allowed = true;
  return allowed;
}

test('#contributors leads 🛠️ contributing (with #horizon-team), with its topic, and is a default channel', () => {
  const contributing = LAYOUT.find((g) => g.key === 'contributing').channels.map((c) => c.key);
  assert.deepEqual(contributing, ['contributors', 'horizonteam']);
  assert.equal(spec.type, 'text');
  assert.deepEqual(spec.writers, ['contributor', 'team']);
  assert.equal(spec.topic, "Where Horizon's contributors talk. Everyone can read. To write: have a merged PR, then `/link-github` + `/verify-github`.");
  assert.ok(DEFAULT_CHANNELS.includes('contributors'));
});

test('a member without the role reads and reacts but cannot write, open threads or write in threads', () => {
  const ow = overwrites(ids, spec, false);
  for (const perm of [P.ViewChannel, P.ReadMessageHistory, P.AddReactions]) assert.equal(can([], perm, ow), true, String(perm));
  for (const perm of [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads]) assert.equal(can([], perm, ow), false, String(perm));
});

test('with 🛠️ Contributor, or as a mod, a member writes, opens threads and writes in them', () => {
  const ow = overwrites(ids, spec, false);
  for (const roles of [['CONTRIB'], ['MOD'], ['CONTRIB', 'MOD']]) {
    for (const perm of [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads]) assert.equal(can(roles, perm, ow), true, `${roles} ${perm}`);
  }
  assert.equal(can(['CONTRIB'], P.CreatePrivateThreads, ow), false, 'private threads stay closed');
  const kira = ow.find((o) => o.id === 'KIRA');
  assert.ok(kira.allow.includes(P.SendMessages) && kira.allow.includes(P.ManageThreads));
});

test('the other kinds of channel keep their overwrites', () => {
  const chat = specs.find((c) => c.key === 'horizonchat');
  assert.equal(overwrites(ids, chat, false).length, 1, 'a normal channel: only Kira');
  const rules = specs.find((c) => c.key === 'rules');
  assert.deepEqual(overwrites(ids, rules, false).slice(1).map((o) => o.id), ['EVERYONE', 'TEAM', 'OWNER']);
  const staff = specs.find((c) => c.key === 'modlog');
  assert.deepEqual(overwrites(ids, staff, true).slice(1).map((o) => o.id), ['EVERYONE', 'MOD', 'TEAM']);
  assert.deepEqual(overwrites(ids, specs.find((c) => c.key === 'ludovic'), false).slice(1).map((o) => o.id), ['EVERYONE', 'OWNER']);
});

test('🛠️ Contributor is not a self role any more: no button, no Onboarding answer', () => {
  const role = ROLES.find((r) => r.key === 'contributor');
  assert.equal(role.self, false);
  assert.equal(role.name, '🛠️ Contributor');
  const ids = rolesMessage().components.flatMap((row) => row.components.map((b) => b.data.custom_id));
  assert.deepEqual(ids, ['role:horizon', 'role:releases', 'role:newvideos', 'role:modder']);
  assert.match(rolesMessage().embeds[0].data.description, /not a button.*merged pull request.*\/verify-github/s);
});

test('#horizon-team: only the 🌌 Horizon Team (and Kira) see it; the team also writes in #contributors', () => {
  const team = specs.find((c) => c.key === 'horizonteam');
  const ow = overwrites(ids, team, false);
  assert.equal(can([], P.ViewChannel, ow), false);
  assert.equal(can(['CONTRIB'], P.ViewChannel, ow), false);
  for (const perm of [P.ViewChannel, P.SendMessages, P.CreatePublicThreads]) assert.equal(can(['TEAM'], perm, ow), true, String(perm));
  assert.equal(can(['TEAM'], P.SendMessages, overwrites(ids, spec, false)), true);
  const order = ROLES.map((r) => r.key);
  assert.ok(order.indexOf('team') > order.indexOf('contributor') && order.indexOf('team') > order.indexOf('sponsor') && order.indexOf('team') > order.indexOf('mod'));
});

test('the Horizon Team moderates: the mods\' permissions plus kick and ban, the staff channels, and it shows above the mods', () => {
  const team = ROLES.find((r) => r.key === 'team');
  const mod = ROLES.find((r) => r.key === 'mod');
  // Only the Team kicks and bans (dezer-x, 2026-10-29): mods time out and delete.
  // The live server also gives the Team @everyone mentions (2026-11-01: LAYOUT follows the live server).
  assert.deepEqual(team.permissions.filter((p) => !['KickMembers', 'BanMembers', 'MentionEveryone'].includes(p)), mod.permissions);
  for (const p of ['KickMembers', 'BanMembers', 'MentionEveryone']) { assert.ok(team.permissions.includes(p)); assert.ok(!mod.permissions.includes(p)); }
  // /slowmode is the mods' tool: both bypass it, and both start voice Activities (Ludovic, 2026-10-28). Every name is a real flag (setup maps P[name]).
  for (const r of [mod, team]) for (const p of ['BypassSlowmode', 'UseEmbeddedActivities', 'UseExternalApps']) assert.ok(r.permissions.includes(p), `${r.key} ${p}`);
  for (const r of ROLES) for (const p of r.permissions ?? []) assert.equal(typeof P[p], 'bigint', `${r.key}: ${p}`);
  assert.ok(ROLES.indexOf(team) > ROLES.indexOf(mod), 'later in ROLES = higher in the list');
  const staff = LAYOUT.find((g) => g.channels.some((c) => c.key === 'modchat') || g.key === 'staff');
  const ow = overwrites(ids, staff.channels[0], true);
  assert.equal(can(['TEAM'], P.ViewChannel, ow), true);
  assert.equal(can(['MOD'], P.ViewChannel, ow), true);
  assert.equal(can([], P.ViewChannel, ow), false);
});

test('read-only channels: everyone reads, only Kira, Ludovic and the Team post; the mods only where staffPost is set', () => {
  const readonly = specs.filter((c) => c.readonly);
  assert.ok(readonly.some((c) => c.key === 'rules') && readonly.some((c) => c.key === 'announcements'));
  for (const spec of readonly) {
    const ow = overwrites(ids, spec, false);
    assert.equal(can([], P.SendMessages, ow), false, spec.key);
    assert.equal(can([], P.ViewChannel, ow), true, spec.key);
    assert.equal(can(['MOD'], P.SendMessages, ow), !!spec.staffPost, spec.key);
    assert.equal(can(['TEAM'], P.SendMessages, ow), true, spec.key);
    // Ludovic has his own overwrite, except where the mods post too (#join-server, #server-chat: the live server has none).
    assert.equal(ow.some((o) => o.id === ids.owner && o.allow?.includes(P.SendMessages)), !spec.staffPost, spec.key);
  }
  assert.equal(readonly.find((c) => c.key === 'announcements').staffPost, undefined);
});

test('#official-server: everyone reads, only the mods, the Horizon Team and Kira write', () => {
  const ow = overwrites(ids, specs.find((c) => c.key === 'officialserver'), false);
  assert.equal(can([], P.ViewChannel, ow), true);
  for (const perm of [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads]) assert.equal(can([], perm, ow), false, String(perm));
  for (const roles of [['MOD'], ['TEAM']]) assert.equal(can(roles, P.SendMessages, ow), true, String(roles));
  assert.equal(can(['CONTRIB'], P.SendMessages, ow), false, 'a contributor reads only');
  assert.ok(ow.find((o) => o.id === 'KIRA').allow.includes(P.SendMessages));
});

test('a channel moderator (CHANNEL_MODS): deletes messages, manages threads and pins in that channel only', () => {
  assert.deepEqual(CHANNEL_MODS.dutch, ['1308764088444260455'], 'yn4p moderates #nederlands');
  for (const key of Object.keys(CHANNEL_MODS)) assert.ok(specs.some((c) => c.key === key), key);
  const dutch = specs.find((c) => c.key === 'dutch');
  const ow = overwrites(ids, dutch, false, CHANNEL_MODS.dutch);
  assert.equal(ow.length, 2, 'Kira and the moderator');
  const yn4p = ow.find((o) => o.id === '1308764088444260455');
  assert.equal(yn4p.type, 1, 'a member overwrite');
  assert.equal(yn4p.allow.reduce((a, b) => a | b, 0n), P.ManageMessages | P.ManageThreads | P.PinMessages);
  assert.equal(String(yn4p.allow.reduce((a, b) => a | b, 0n)), '2251816993562624', 'the bits the channel has on Discord');
  assert.equal(yn4p.deny, undefined);
  assert.equal(overwrites(ids, specs.find((c) => c.key === 'italian'), false).length, 1, 'no moderator elsewhere');
  assert.deepEqual(overwrites(ids, spec, false, ['X']).at(-1).id, 'X', 'added after the channel kind\'s own overwrites');
});
