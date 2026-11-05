// Unit tests for the honeypot channel: who is exempt, what happens to a message, one soft-ban per burst, the log line,
// the layout, and the handler against a fake guild (ban with a day of messages deleted, then unban; failures logged).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { honeypotExempt, honeypotAction, makeHandled, accountAge, honeypotLog } from '../src/honeypot-kit.js';
import { LAYOUT, MOD, PINS, DEFAULT_CHANNELS, OWNER_ID } from '../src/config.js';
import { overwrites } from '../src/permissions.js';
import { state, client } from '../src/core.js';
import { honeypot } from '../src/features/moderation.js';

const exempt = (o = {}) => honeypotExempt({ isBot: false, isStaff: false, userId: 'u1', ownerId: OWNER_ID, roleIds: [], exemptRoleIds: ['mod', 'team'], ...o });

test('honeypot: bots, staff, mods, the Horizon Team and Ludovic are exempt; everyone else is not', () => {
  assert.equal(exempt(), false);
  assert.equal(exempt({ isBot: true }), true);
  assert.equal(exempt({ isStaff: true }), true);
  assert.equal(exempt({ userId: OWNER_ID }), true);
  assert.equal(exempt({ roleIds: ['x', 'team'] }), true);
  assert.equal(exempt({ roleIds: ['mod'] }), true);
  assert.equal(exempt({ roleIds: ['support', 'lvl5'] }), false);
  assert.equal(exempt({ roleIds: ['x'], exemptRoleIds: [undefined] }), false); // a role that does not exist yet exempts nobody
});

test('honeypot: the action for a message', () => {
  const base = { enabled: true, channelId: 'hp', honeypotId: 'hp', exempt: false, handled: false };
  assert.equal(honeypotAction(base), 'softban');
  assert.equal(honeypotAction({ ...base, handled: true }), 'drop');
  assert.equal(honeypotAction({ ...base, exempt: true }), 'delete');
  assert.equal(honeypotAction({ ...base, exempt: true, handled: true }), 'delete');
  assert.equal(honeypotAction({ ...base, channelId: 'general' }), 'ignore');
  assert.equal(honeypotAction({ ...base, enabled: false }), 'ignore');       // the off switch
  assert.equal(honeypotAction({ ...base, honeypotId: undefined }), 'ignore'); // setup has not made the channel yet
});

test('honeypot: a burst from one user is one soft-ban, and it can happen again after the window', () => {
  let t = 1_000_000;
  const h = makeHandled(10 * 60_000, () => t);
  assert.equal(h.claim('a'), true);
  assert.equal(h.claim('a'), false);
  assert.equal(h.has('a'), true);
  assert.equal(h.claim('b'), true);
  t += 9 * 60_000;
  assert.equal(h.claim('a'), false);
  t += 2 * 60_000;
  assert.equal(h.has('a'), false);
  assert.equal(h.claim('a'), true);
  assert.equal(h.size(), 1); // b was pruned
});

test('honeypot: account age and the log line', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  assert.equal(accountAge(now - 20 * 60_000, now), '20 minutes');
  assert.equal(accountAge(now - 3_600_000, now), '1 hour');
  assert.equal(accountAge(now - 2 * 86_400_000, now), '2 days');
  assert.equal(accountAge(now - 800 * 86_400_000, now), '2 years');
  const clipText = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const ok = honeypotLog({ userId: '5', tag: 'bot#0', createdTimestamp: now - 86_400_000, content: 'x'.repeat(500), clipText, at: now });
  assert.equal(ok.title, '🍯 honeypot soft-ban');
  assert.match(ok.description, /<@5> \(bot#0\)/);
  assert.match(ok.description, /account age 1 day/);
  assert.ok(ok.description.length < 500);
  assert.equal(ok.failed, false);
  const bad = honeypotLog({ userId: '5', tag: 'bot#0', createdTimestamp: now, content: 'hi', outcome: { title: 'soft-ban failed', detail: 'Missing Permissions' }, clipText, at: now });
  assert.equal(bad.failed, true);
  assert.match(bad.description, /Missing Permissions/);
});

test('honeypot: the layout — everyone sees and writes in it, near the top, pinned warning, on by default', () => {
  const group = LAYOUT.find((g) => g.channels.some((c) => c.key === 'honeypot'));
  assert.equal(group.key, 'start');
  assert.ok(group.channels.findIndex((c) => c.key === 'honeypot') < 8, 'near the top');
  const spec = group.channels.find((c) => c.key === 'honeypot');
  assert.equal(spec.type, 'text');
  assert.ok(!spec.readonly && !spec.staff && !spec.members && !spec.writers, 'open to everyone');
  const ids = { everyone: 'ev', mod: 'mod', kira: 'kira', owner: OWNER_ID, roles: {} };
  assert.deepEqual(overwrites(ids, spec, undefined).filter((o) => o.id === 'ev'), []); // no @everyone overwrite: the default is see and write
  assert.match(spec.topic, /DO NOT POST/);
  assert.match(spec.topic, /removed from the server instantly/);
  assert.match(spec.topic, /scam bots/);
  assert.ok(spec.topic.length <= 1024);
  assert.match(PINS[spec.pin], /Do not post in this channel/);
  assert.match(PINS[spec.pin], /removed from the server instantly/);
  assert.ok(DEFAULT_CHANNELS.includes('honeypot'));
  assert.equal(MOD.honeypot, true);
  assert.equal(MOD.honeypotDeleteSeconds, 86_400);
});

// A fake Discord: records bans, unbans, deletions and #mod-log posts.
function fake({ banFails = false, unbanFailsTimes = 0 } = {}) {
  const calls = { ban: [], unban: [], deleted: [], logs: [] };
  let unbanFails = unbanFailsTimes;
  const guild = {
    members: { ban: async (id, o) => { if (banFails) throw new Error('Missing Permissions'); calls.ban.push([id, o]); } },
    bans: { remove: async (id, reason) => { if (unbanFails-- > 0) throw new Error('Unknown Ban'); calls.unban.push([id, reason]); } },
  };
  const msg = (id, userId, extra = {}) => ({
    id, channelId: 'hp-channel', channel: {}, guild, content: 'FREE $1000 from MrBeast https://scam.example', guildId: '1',
    author: { id: userId, tag: `${userId}#0`, bot: false, createdTimestamp: Date.now() - 3_600_000 },
    member: { permissions: { has: () => false }, roles: { cache: new Map() } },
    delete: async () => { calls.deleted.push(id); },
    ...extra,
  });
  return { calls, guild, msg };
}

async function withFake(opts, fn) {
  const f = fake(opts);
  const before = { hp: state.channels.honeypot, modlog: state.channels.modlog, roles: state.roles };
  const sent = [];
  state.channels.honeypot = 'hp-channel';
  state.channels.modlog = 'log-channel';
  state.roles = { mod: 'mod', team: 'team', owner: 'owner' };
  client.channels.cache.set('log-channel', { send: async (m) => { sent.push(m.embeds[0].data); } });
  try { await fn(f, sent); } finally {
    client.channels.cache.delete('log-channel');
    Object.assign(state.channels, { honeypot: before.hp, modlog: before.modlog }); state.roles = before.roles;
    if (before.hp === undefined) delete state.channels.honeypot;
  }
}

test('honeypot handler: a member who posts is banned with a day of messages deleted, then unbanned, and logged', async () => {
  await withFake({}, async ({ calls, msg }, sent) => {
    assert.equal(await honeypot(msg('m1', 'scammer1')), true);
    assert.equal(calls.ban.length, 1);
    assert.equal(calls.ban[0][0], 'scammer1');
    assert.equal(calls.ban[0][1].deleteMessageSeconds, 86_400);
    assert.equal(calls.unban.length, 1);
    assert.equal(calls.unban[0][0], 'scammer1');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].title, '🍯 honeypot soft-ban');
    assert.match(sent[0].description, /FREE \$1000/);
    assert.match(sent[0].description, /account age 1 hour/);
  });
});

test('honeypot handler: a burst of messages from one user is one soft-ban', async () => {
  await withFake({}, async ({ calls, msg }, sent) => {
    const results = await Promise.all(['b1', 'b2', 'b3', 'b4'].map((id) => honeypot(msg(id, 'scammer2'))));
    assert.deepEqual(results, [true, true, true, true]);
    assert.equal(calls.ban.length, 1);
    assert.equal(calls.unban.length, 1);
    assert.equal(sent.length, 1);
    assert.deepEqual(calls.deleted.sort(), ['b2', 'b3', 'b4']); // the rest of the burst is removed with it
  });
});

test('honeypot handler: exempt members only have their message deleted', async () => {
  await withFake({}, async ({ calls, msg }, sent) => {
    const staff = msg('s1', 'mod1', { member: { permissions: { has: () => true }, roles: { cache: new Map() } } });
    const team = msg('t1', 'dev1', { member: { permissions: { has: () => false }, roles: { cache: new Map([['team', {}]]) } } });
    const owner = msg('o1', OWNER_ID);
    const bot = msg('k1', 'kirabot', { author: { id: 'kirabot', tag: 'kira#0', bot: true, createdTimestamp: 0 } });
    for (const m of [staff, team, owner, bot]) assert.equal(await honeypot(m), true);
    assert.deepEqual(calls.deleted, ['s1', 't1', 'o1', 'k1']);
    assert.equal(calls.ban.length, 0);
    assert.equal(calls.unban.length, 0);
    assert.equal(sent.length, 0);
  });
});

test('honeypot handler: other channels are ignored, and so is everything when MOD.honeypot is off', async () => {
  await withFake({}, async ({ calls, msg }) => {
    assert.equal(await honeypot(msg('g1', 'someone', { channelId: 'general-channel' })), false);
    MOD.honeypot = false;
    try { assert.equal(await honeypot(msg('g2', 'someone')), false); } finally { MOD.honeypot = true; }
    assert.equal(calls.ban.length + calls.deleted.length, 0);
  });
});

test('honeypot handler: a missing permission is logged, once for a burst, and the message is deleted', async () => {
  await withFake({ banFails: true }, async ({ calls, msg }, sent) => {
    await Promise.all(['f1', 'f2', 'f3'].map((id) => honeypot(msg(id, 'scammer3'))));
    assert.equal(calls.ban.length, 0);
    assert.equal(calls.unban.length, 0);
    assert.equal(sent.length, 1);
    assert.match(sent[0].title, /soft-ban failed/);
    assert.match(sent[0].description, /Missing Permissions/);
    assert.match(sent[0].description, /Ban Members/);
    assert.deepEqual(calls.deleted.sort(), ['f1', 'f2', 'f3']);
  });
});

test('honeypot handler: if the unban fails it is retried once, and then the log says they are still banned', async () => {
  await withFake({ unbanFailsTimes: 1 }, async ({ calls, msg }, sent) => {
    await honeypot(msg('r1', 'scammer4'));
    assert.equal(calls.unban.length, 1); // the retry worked
    assert.equal(sent[0].title, '🍯 honeypot soft-ban');
  });
  await withFake({ unbanFailsTimes: 5 }, async ({ calls, msg }, sent) => {
    await honeypot(msg('r2', 'scammer5'));
    assert.equal(calls.unban.length, 0);
    assert.match(sent[0].title, /STILL BANNED/);
    assert.match(sent[0].description, /\/unban scammer5/);
  });
});
