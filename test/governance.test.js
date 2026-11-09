// Governance: the council registry, isCouncil and who holds each former owner power; off by default, and while it is
// off nothing answers differently from before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-governance-')), 'state.json');
process.env.GITHUB_TOKEN = 'test-token-not-used';
delete process.env.KIRA_GOVERNANCE;
const { GOVERNANCE, OWNER_ID, TEAMS } = await import('../src/config.js');
const kit = await import('../src/governance-kit.js');
const core = await import('../src/core.js');
const tv = await import('../src/features/teamvote.js');
const teamroles = await import('../src/features/teamroles.js');

const KACPER = '437262688930889730';
const OUTSIDER = '111111111111111111';
const gov = (on, extra = {}) => ({ ...GOVERNANCE, on, ...extra });

test('off by default: no one is on the council and every power is the owner\'s, as before', () => {
  assert.equal(GOVERNANCE.on, false);
  assert.equal(kit.isCouncil(KACPER, { state: {}, gov: GOVERNANCE }), false);
  for (const power of Object.keys(kit.POWERS)) {
    assert.equal(kit.may(power, OWNER_ID, { state: {}, gov: GOVERNANCE, ownerId: OWNER_ID }), true, power);
    assert.equal(kit.may(power, KACPER, { state: {}, gov: GOVERNANCE, ownerId: OWNER_ID }), false, power);
  }
});

test('on: the founding six, the founder included, are the council; nobody else', () => {
  const g = gov(true);
  assert.equal(Object.keys(GOVERNANCE.founding).length, 6);
  assert.ok(Object.hasOwn(GOVERNANCE.founding, OWNER_ID), 'the founder sits on the council like the others');
  for (const id of Object.keys(GOVERNANCE.founding)) assert.equal(kit.isCouncil(id, { state: {}, gov: g }), true, id);
  assert.equal(kit.isCouncil(OUTSIDER, { state: {}, gov: g }), false);
  assert.equal(kit.isCouncil(undefined, { state: {}, gov: g }), false);
});

test('on: council powers go to any council member; the account holder keeps his own', () => {
  const ctx = { state: {}, gov: gov(true), ownerId: OWNER_ID };
  assert.equal(kit.may('team-vote', KACPER, ctx), true);
  assert.equal(kit.may('team-vote', OWNER_ID, ctx), true, 'the founder as one of the council');
  assert.equal(kit.may('team-vote', OUTSIDER, ctx), false);
  assert.equal(kit.may('kira-ai', KACPER, ctx), false, "Kira's AI budget is the account holder's");
  assert.equal(kit.may('kira-ai', OWNER_ID, ctx), true);
  assert.equal(kit.may('org-chart-owner', KACPER, ctx), false, 'the Founder tier stays his, with no power');
  assert.throws(() => kit.may('no-such-power', OWNER_ID, ctx), /unknown power/);
  for (const [name, p] of Object.entries(kit.POWERS)) assert.ok(['council', 'account', 'unchanged'].includes(p.kind), name);
});

test('the registry changes only through change(): a stored council wins over the founding list', () => {
  const g = gov(true);
  const added = kit.change({}, g, { id: OUTSIDER, login: 'someone', add: true });
  assert.equal(Object.keys(added.council).length, 7);
  assert.equal(added.council[OUTSIDER], 'someone');
  assert.equal(Object.keys(GOVERNANCE.founding).length, 6, 'the config list is never written');
  const state = { council: added.council };
  assert.equal(kit.isCouncil(OUTSIDER, { state, gov: g }), true);
  const removed = kit.change(state, g, { id: KACPER, add: false });
  assert.equal(kit.isCouncil(KACPER, { state: { council: removed.council }, gov: g }), false);
  assert.match(kit.change(state, g, { id: OUTSIDER, add: true }).why, /Already/);
  assert.match(kit.change({}, g, { id: OUTSIDER, add: false }).why, /Not on the council/);
  assert.match(kit.change({}, g, { id: 'abc', add: true }).why, /Discord member id/);
  const full = Object.fromEntries(Array.from({ length: 9 }, (_, n) => [`10000000000000000${n}`, '']));
  assert.match(kit.change({ council: full }, g, { id: OUTSIDER, add: true }).why, /full \(9 seats\)/);
});

test('/team-vote: refused once governance is on, pointing at /poll; unchanged while off', async () => {
  const run = async () => {
    let out;
    await tv.handlers['team-vote']({
      user: { id: OWNER_ID }, member: null, guild: { members: { fetch: async () => null } }, channelId: 'elsewhere', channel: {},
      options: { getSubcommand: () => 'propose', getUser: () => ({ id: OUTSIDER }) },
      deferReply: async () => {}, editReply: async (m) => { out = m; },
    });
    return out.content;
  };
  assert.doesNotMatch(await run(), /council/, 'off: the old rules answer (here: the member is not in the server)');
  GOVERNANCE.on = true;
  try {
    assert.equal(await run(), tv.GOVERNED);
    assert.match(tv.GOVERNED, /\/poll/);
  } finally { GOVERNANCE.on = false; }
});

test('team roles: 🏛️ Council may manage every team once governance is on', () => {
  assert.deepEqual(teamroles.staffRoles(), TEAMS.staffRoles);
  GOVERNANCE.on = true;
  try {
    assert.deepEqual(teamroles.staffRoles(), [...TEAMS.staffRoles, GOVERNANCE.roles.council]);
    core.state.roles.council = 'R-COUNCIL';
    assert.equal(teamroles.staffRoles().at(-1), 'R-COUNCIL', "setup's id wins over the config fallback");
  } finally { GOVERNANCE.on = false; delete core.state.roles.council; }
});
