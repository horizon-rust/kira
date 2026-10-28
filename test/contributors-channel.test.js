// #contributors: everyone reads, only 🛠️ Contributor, mods and Kira write; and the role is no longer a button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits as P } from 'discord.js';
import { LAYOUT, ROLES, DEFAULT_CHANNELS } from '../src/config.js';
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
  assert.deepEqual(overwrites(ids, rules, false).slice(1).map((o) => o.id), ['EVERYONE', 'MOD', 'TEAM']);
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

test('the Horizon Team moderates: the mods\' permissions, the staff channels, and it shows above the mods', () => {
  const team = ROLES.find((r) => r.key === 'team');
  const mod = ROLES.find((r) => r.key === 'mod');
  assert.deepEqual(team.permissions, mod.permissions);
  // /slowmode is the mods' tool: both bypass it (Ludovic, 2026-10-28). Every name is a real flag (setup maps P[name]).
  for (const r of [mod, team]) assert.ok(r.permissions.includes('BypassSlowmode'), r.key);
  for (const r of ROLES) for (const p of r.permissions ?? []) assert.equal(typeof P[p], 'bigint', `${r.key}: ${p}`);
  assert.ok(ROLES.indexOf(team) > ROLES.indexOf(mod), 'later in ROLES = higher in the list');
  const staff = LAYOUT.find((g) => g.channels.some((c) => c.key === 'modchat') || g.key === 'staff');
  const ow = overwrites(ids, staff.channels[0], true);
  assert.equal(can(['TEAM'], P.ViewChannel, ow), true);
  assert.equal(can(['MOD'], P.ViewChannel, ow), true);
  assert.equal(can([], P.ViewChannel, ow), false);
});

test('read-only channels: everyone reads, the mods and the 🌌 Horizon Team post (the Team has the mods\' permissions)', () => {
  const readonly = specs.filter((c) => c.readonly);
  assert.ok(readonly.some((c) => c.key === 'rules') && readonly.some((c) => c.key === 'releases'));
  for (const spec of readonly) {
    const ow = overwrites(ids, spec, false);
    assert.equal(can([], P.SendMessages, ow), false, spec.key);
    assert.equal(can([], P.ViewChannel, ow), true, spec.key);
    assert.equal(can(['MOD'], P.SendMessages, ow), true, spec.key);
    assert.equal(can(['TEAM'], P.SendMessages, ow), true, spec.key);
  }
  // Without a Team role yet (a first setup), the overwrite is the mods' alone.
  assert.equal(overwrites({ ...ids, roles: {} }, readonly[0], false).filter((o) => o.allow?.length === 1).length, 1);
});
