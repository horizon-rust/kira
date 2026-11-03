// /team: a team's managers give and take back their team's role, and only it (fake Discord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PermissionFlagsBits as P } from 'discord.js';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-teams-')), 'state.json');
const { OWNER_ID, TEAMS, ORG } = await import('../src/config.js');
const core = await import('../src/core.js');
const t = await import('../src/features/teamroles.js');
const kit = await import('../src/team-roles-kit.js');

const HEX = '1567230973094002818';
const AZETECH = '1308764088444260455';
const QUARANTINED = '1566489487654002763';
const OTHER = { key: 'other', name: 'other-team', role: 'R-OTHER', managers: ['leader2'] };

// A fake guild: members with their roles, the roles, and every role change recorded.
const changes = [];
const roles = new Map();
const members = new Map();
const addRole = (id, o = {}) => roles.set(id, { id, editable: true, permissions: { bitfield: P.SendMessages | P.ViewChannel }, ...o, get members() { return new Map([...members].filter(([, m]) => m.roles.cache.has(id))); } });
const addMember = (id, roleIds = [], bot = false) => {
  const set = new Set(roleIds);
  const cache = new Map([...set].map((r) => [r, {}]));
  members.set(id, {
    id, user: { id, bot },
    roles: {
      cache,
      add: async (r, why) => { changes.push(['add', id, r, why]); cache.set(r, {}); },
      remove: async (r, why) => { changes.push(['remove', id, r, why]); cache.delete(r); },
    },
  });
};
const guild = {
  members: { fetch: async (id) => members.get(id) ?? Promise.reject(new Error('Unknown Member')) },
  roles: { cache: roles, fetch: async (id) => roles.get(id) ?? null },
};
const logged = [];
core.client.channels.cache.set('LOG', { send: async (m) => logged.push(m.embeds[0].data) });
core.state.channels.modlog = 'LOG';

const run = async (actorId, sub, { member, team } = {}, actorRoles = []) => {
  const out = [];
  await t.handlers.team({
    user: { id: actorId, tag: `${actorId}#0` }, member: { roles: { cache: new Map(actorRoles.map((r) => [r, {}])) } }, guild,
    options: { getSubcommand: () => sub, getUser: () => (member ? { id: member } : null), getString: (k) => (k === 'team' ? team ?? null : null) },
    deferReply: async (o) => assert.equal(o.flags, 64, 'ephemeral'),
    editReply: async (m) => { assert.equal(m.flags, 64, 'ephemeral'); assert.deepEqual(m.allowedMentions, { parse: [] }); out.push(m.content); },
  });
  return out.at(-1);
};
const reset = () => {
  changes.length = 0; logged.length = 0; roles.clear(); members.clear();
  addRole(HEX); addRole(QUARANTINED);
  addMember(AZETECH, [HEX]); addMember('friend'); addMember('mate', [HEX]); addMember('stranger');
  addMember('kirabot', [], true); addMember('jailed', [QUARANTINED]);
  addMember('mod', [ORG.roles.mod]); addMember('chief', [ORG.roles.chiefmod]);
  t._test.limiter.prune(Date.now() + 10 * 3_600_000);
};

test('the config: hexforge-horizons, managed by azetech; mods, the Chief of Mods and Ludovic are the staff', () => {
  const hex = TEAMS.list.find((x) => x.key === 'hexforge');
  assert.deepEqual(hex, { key: 'hexforge', name: 'hexforge-horizons', role: HEX, managers: [AZETECH] });
  assert.deepEqual(TEAMS.staffRoles, ['1559242168864997537', '1566825954792181864', '1559251767860920370']);
  assert.equal(TEAMS.quarantinedRole, QUARANTINED);
  assert.equal(t.commands[0].toJSON().default_member_permissions ?? null, null, 'everyone sees /team; Kira decides who may use it');
});

test('the manager adds and removes their team role; each change is one #mod-log line', async () => {
  reset();
  assert.match(await run(AZETECH, 'add', { member: 'friend' }), /Gave \*\*hexforge-horizons\*\* to <@friend>/);
  assert.deepEqual(changes.map((c) => c.slice(0, 3)), [['add', 'friend', HEX]]);
  assert.match(changes[0][3], /Kira \/team add: by 1308764088444260455#0/, 'the audit log names who asked');
  assert.equal(logged.length, 1);
  assert.equal(logged[0].description, `<@${AZETECH}> gave **hexforge-horizons** to <@friend>`);
  assert.match(await run(AZETECH, 'remove', { member: 'friend' }), /Took \*\*hexforge-horizons\*\* back from <@friend>/);
  assert.deepEqual(changes[1].slice(0, 3), ['remove', 'friend', HEX]);
  assert.equal(logged.length, 2);
  assert.equal(logged[1].description, `<@${AZETECH}> took back **hexforge-horizons** from <@friend>`);
});

test('nobody else may use it: a member of the team is not a manager', async () => {
  reset();
  assert.match(await run('stranger', 'add', { member: 'friend' }), /don't manage a team role/);
  assert.match(await run('mate', 'remove', { member: AZETECH }, [HEX]), /don't manage a team role/);
  assert.equal(changes.length, 0);
  assert.equal(logged.length, 0);
});

test('refused: bots, quarantined members, people not in the server, no-op changes', async () => {
  reset();
  assert.match(await run(AZETECH, 'add', { member: 'kirabot' }), /Bots never/);
  assert.match(await run(AZETECH, 'add', { member: 'jailed' }), /quarantined/);
  assert.match(await run(AZETECH, 'add', { member: 'gone' }), /not in the server/);
  assert.match(await run(AZETECH, 'add', { member: 'mate' }), /already has/);
  assert.match(await run(AZETECH, 'remove', { member: 'friend' }), /doesn't have/);
  assert.equal(changes.length, 0);
  assert.equal(logged.length, 0);
});

test('refused: a role Kira cannot manage, a role with moderation permissions, a deleted role', async () => {
  reset();
  addRole(HEX, { editable: false });
  assert.match(await run(AZETECH, 'add', { member: 'friend' }), /can't manage/);
  for (const perm of [P.Administrator, P.ManageRoles, P.ManageChannels, P.ModerateMembers, P.MentionEveryone]) {
    addRole(HEX, { permissions: { bitfield: P.SendMessages | perm } });
    assert.match(await run(AZETECH, 'add', { member: 'friend' }), /moderation permissions/, String(perm));
  }
  roles.delete(HEX);
  assert.match(await run(AZETECH, 'add', { member: 'friend' }), /doesn't exist/);
  assert.equal(changes.length, 0);
});

test('a manager reaches only their own team; the staff reach every team', () => {
  const list = [...TEAMS.list, OTHER];
  const staff = TEAMS.staffRoles;
  const pick = (id, key, r = []) => kit.pickTeam(list, { id, roles: r }, key, staff, OWNER_ID);
  assert.equal(pick(AZETECH).team.key, 'hexforge');
  assert.match(pick(AZETECH, 'other').why, /isn't your team/);
  assert.match(pick(AZETECH, 'nope').why, /No such team/);
  assert.equal(pick('leader2').team.key, 'other');
  for (const [id, r] of [['mod', [ORG.roles.mod]], ['chief', [ORG.roles.chiefmod]], ['lu', [ORG.roles.owner]], [OWNER_ID, []]]) {
    assert.equal(pick(id, 'other', r).team.key, 'other', id);
    assert.equal(pick(id, 'hexforge', r).team.key, 'hexforge', id);
    assert.match(pick(id, null, r).why, /Pick the team: `hexforge`, `other`/, id);
  }
  assert.match(pick('stranger', 'hexforge', [ORG.roles.support]).why, /don't manage/);
});

test('mods run it on any team role through the command', async () => {
  reset();
  assert.match(await run('mod', 'add', { member: 'friend' }, [ORG.roles.mod]), /Gave/);
  assert.match(await run('chief', 'remove', { member: 'friend' }, [ORG.roles.chiefmod]), /Took/);
  assert.match(await run(OWNER_ID, 'add', { member: 'stranger', team: 'hexforge' }), /Gave/);
  assert.equal(logged.length, 3);
  assert.equal(logged[0].description, '<@mod> gave **hexforge-horizons** to <@friend>');
});

test('list shows who has the role, without pinging', async () => {
  reset();
  const out = await run(AZETECH, 'list');
  assert.match(out, /\*\*hexforge-horizons\*\* \(2\): /);
  assert.match(out, new RegExp(`<@${AZETECH}>`));
  assert.match(out, /<@mate>/);
  assert.equal(changes.length, 0);
});

test('a manager is limited to TEAMS.perHour changes an hour', async () => {
  reset();
  for (let n = 0; n < TEAMS.perHour; n++) {
    const id = `m${n}`;
    addMember(id);
    assert.match(await run(AZETECH, 'add', { member: id }), /Gave/);
  }
  addMember('late');
  assert.match(await run(AZETECH, 'add', { member: 'late' }), /a lot of changes/);
  assert.equal(changes.length, TEAMS.perHour);
});
