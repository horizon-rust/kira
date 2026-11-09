// Applications with the governance on (GOVERNANCE.md, section 2): no veto for Ludovic. A passed Mod vote opens the
// council's 24-hour objection window in #council; two objections send it to a council poll, whose result decides it;
// a role of trust then waits for the 18+ declaration. Against a fake Discord. The rules alone, and the switch-off flow
// (Ludovic's veto), are in test/application-votes.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collection } from 'discord.js';

const dir = mkdtempSync(join(tmpdir(), 'kira-appcouncil-'));
process.env.KIRA_STATE = join(dir, 'state.json');
process.env.KIRA_DECISIONS = join(dir, 'decisions.json');
process.env.GITHUB_TOKEN = 'test-token-not-used';
process.env.KIRA_GOVERNANCE = 'on';
process.env.KIRA_AGE_DECLARATION = 'on';
const { GUILD_ID, GOVERNANCE, OWNER_ID } = await import('../src/config.js');
const core = await import('../src/core.js');
const { openStaffStore } = await import('../src/staff-store.js');
const v = await import('../src/application-votes.js');
const poll = await import('../src/features/poll.js');
const age = await import('../src/features/age.js');
const { applicationRoutes } = await import('../src/features/staff-apply.js');

const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 10, 9);
const COUNCIL = Object.keys(GOVERNANCE.founding);
const MODS = ['200000000000000001', '200000000000000002', '200000000000000003'];

const posted = [];
const channel = { id: GOVERNANCE.channels.council, send: async (m) => { posted.push(m); return { id: `M${posted.length}`, channelId: GOVERNANCE.channels.council, startThread: async () => {} }; }, messages: { fetch: async () => null } };
core.client.channels.cache.set(GOVERNANCE.channels.council, channel);
core.client.guilds.cache.set(GUILD_ID, { members: { cache: new Collection(), fetch: async () => new Collection() } });
const dms = [];
core.client.users.fetch = async (id) => ({ send: async (m) => { dms.push([id, m]); } });

const store = openStaffStore(join(dir, 'staff.json'));
const logs = [];
const routes = applicationRoutes({ store, site: 'https://playhorizon.dev', log: (l) => logs.push(l), deps: { holders: (k) => new Set(k === 'mod' ? MODS : []) } });
const route = (path) => routes.find((r) => r.path === path).handler;
const add = (id, user, role = 'mod') => {
  store.update((d) => {
    d.applications[id] = { id, user, role, name: user, answers: { why: 'I moderate elsewhere.' }, status: 'open', vote: v.newVote(T0), submittedAt: T0 };
    d.activity = Object.fromEntries(MODS.map((m) => [m, T0]));
  });
  return store.data.applications[id];
};
const voteAll = async (id, now, choice = 'for') => { for (const m of MODS) await route('mod/applications/vote')({ user: m, body: { id, choice }, now }); };
const lastPoll = () => Object.values(core.state.polls ?? {}).at(-1);

test('a passed Mod vote opens the 24-hour objection window in #council, with no DM to Ludovic and no veto', async () => {
  const a = add('a1', '300000000000000001');
  await voteAll('a1', T0);
  assert.equal(a.status, 'objection-window');
  assert.equal(a.objection.until, T0 + 24 * H);
  assert.equal(a.veto, undefined);
  assert.ok(!dms.some(([id]) => id === OWNER_ID), 'no veto-window DM');
  const notice = posted.at(-1);
  assert.match(notice.content, /passed the mods' vote \(3 for, 0 against, 0 abstain\)/);
  assert.match(notice.content, /unless two council members object/);
  assert.deepEqual(notice.allowedMentions, { parse: [], roles: [GOVERNANCE.roles.council] });
  assert.equal(notice.components[0].components[0].custom_id, 'appobj:a1');
  const owner = await route('mod/applications/owner')({ user: OWNER_ID, body: { id: 'a1', action: 'veto' }, now: T0 });
  assert.equal(owner.status, 403);
  await assert.rejects(v.ownerAct(store, a, 'veto', { now: T0, owner: null, gov: {} }), /council decides/);
});

test('objections: council members only, once each; the second sends it to a council poll in #council', async () => {
  const a = store.data.applications.a1;
  assert.match(await routes.objectFrom(MODS[0], 'a1', T0 + H), /Only council members/);
  assert.match(await routes.objectFrom(COUNCIL[1], 'a1', T0 + H), /1 of 2/);
  assert.match(await routes.objectFrom(COUNCIL[1], 'a1', T0 + H), /already objected/);
  assert.equal(a.status, 'objection-window');
  assert.match(await routes.objectFrom(COUNCIL[2], 'a1', T0 + 2 * H), /opened a council poll/);
  assert.equal(a.status, 'council-poll');
  const p = lastPoll();
  assert.equal(a.council.poll, p.id);
  assert.deepEqual([p.kind, p.where, p.threshold, p.subject, p.outcome, p.openedBy], ['mod', 'council', 'simple', a.user, null, 'kira']);
  assert.deepEqual(p.ref, { application: 'a1' });
  assert.match(p.question, /two council members objected/);
  assert.match(posted.at(-1).content, /Council poll P\d+/);
  assert.match(await routes.objectFrom(COUNCIL[3], 'a1', T0 + 2 * H), /not in its objection window/);
});

test('the poll passes: the role waits for the 18+ declaration, then the application is accepted citing the decision', async () => {
  const a = store.data.applications.a1;
  const p = lastPoll();
  for (const id of COUNCIL) p.ballots[id] = 'yes';
  const d = await poll.close(p, T0 + 3 * H);
  assert.equal(d.ref.application, 'a1');
  assert.equal(a.status, 'age-wait');
  const [to, m] = dms.at(-1);
  assert.equal(to, a.user);
  assert.match(m.content, /Every important role on Horizon is 18\+/);
  assert.equal(m.components[0].components[0].custom_id, 'age:yes');
  await routes.tick(T0 + 4 * H);
  assert.equal(a.status, 'age-wait', 'nothing until they confirm');
  await age.onButton({ user: { id: a.user }, guildId: null, reply: async () => {} }, T0 + 5 * H);
  await routes.tick(T0 + 5 * H);
  assert.equal(a.status, 'accepted');
  assert.equal(a.decidedBy, d.id);
  const pub = (await import('../src/decisions-kit.js')).publicView([d])[0];
  assert.deepEqual([pub.kind, pub.question, pub.ballots, pub.ref], ['person', null, null, undefined], 'nothing public about who or why');
});

test('no objections: accepted when the window ends; a failed poll declines it', async () => {
  const b = add('b1', '300000000000000002');
  await age.onButton({ user: { id: b.user }, guildId: null, reply: async () => {} }, T0);
  await voteAll('b1', T0 + 10 * H);
  assert.equal(b.status, 'objection-window');
  assert.match(await routes.objectFrom(COUNCIL[1], 'b1', T0 + 11 * H), /1 of 2/);
  await routes.tick(T0 + 33 * H);
  assert.equal(b.status, 'objection-window');
  await routes.tick(T0 + 34 * H);
  assert.equal(b.status, 'accepted', 'one objection is not enough');
  assert.equal(b.decidedBy, 'vote');

  const c = add('c1', '300000000000000003');
  await voteAll('c1', T0 + 40 * H);
  await routes.objectFrom(COUNCIL[1], 'c1', T0 + 41 * H);
  await routes.objectFrom(COUNCIL[2], 'c1', T0 + 41 * H);
  const p = lastPoll();
  for (const id of COUNCIL) p.ballots[id] = 'no';
  const d = await poll.close(p, T0 + 42 * H);
  assert.equal(c.status, 'declined');
  assert.equal(c.decidedBy, d.id);
});

test('too few votes goes to a council poll, not to Ludovic; Support is accepted at once after its vote', async () => {
  const e = add('e1', '300000000000000004');
  await route('mod/applications/vote')({ user: MODS[0], body: { id: 'e1', choice: 'for' }, now: T0 + 50 * H });
  await routes.tick(T0 + 50 * H + 72 * H);
  assert.equal(e.vote.extended, true);
  await routes.tick(T0 + 50 * H + 120 * H);
  assert.equal(e.status, 'council-poll');
  assert.match(lastPoll().question, /didn't reach its quorum/);

  const f = add('f1', '300000000000000005', 'support');
  await voteAll('f1', T0 + 60 * H);
  assert.equal(f.status, 'accepted', 'Support: no council step and no 18+ rule');
});

test('a Team vote that passes goes to a council poll at two thirds', async () => {
  const fake = { isCouncil: () => true, announce: async () => null, openPoll: async () => ({ id: 'PX' }), needsDeclaration: () => false, askDeclaration: async () => null };
  const s = openStaffStore(join(dir, 'team.json'));
  const app = { id: 't1', user: 'u', role: 'team', answers: {}, status: 'open', vote: v.newVote(T0), submittedAt: T0 };
  s.update((d) => { d.applications.t1 = app; });
  const ctx = { now: T0, owner: null, gov: fake, holders: { team: new Set(['x', 'y']) }, lastActive: { x: T0, y: T0 }, url: () => '', hooks: {} };
  v.castBallot(s, app, { voter: 'x', choice: 'for' }, ctx);
  v.castBallot(s, app, { voter: 'y', choice: 'for' }, ctx);
  assert.equal(await v.advance(s, app, ctx), 'to-council');
  assert.deepEqual(app.council, { reason: 'team', at: T0, poll: 'PX' });
  const old = { id: 's1', user: 'w', role: 'mod', answers: {}, status: 'stalled', vote: v.newVote(T0), submittedAt: T0 };
  s.update((d) => { d.applications.s1 = old; });
  assert.equal(await v.advance(s, old, ctx), 'to-council', 'one left for Ludovic before the launch goes to the council');
  assert.equal(old.council.reason, 'stalled');
});
