// Mod cases, quarantine, appeals and mod-mail statuses (src/modcase-kit.js, src/features/modcases.js): the rules, then
// the Discord side with a fake client (no connection, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-cases-')), 'state.json');
const { GUILD_ID } = await import('../src/config.js');
const core = await import('../src/core.js');
const kit = await import('../src/modcase-kit.js');
const f = await import('../src/features/modcases.js');
f.setup(); // the listeners (its timers are unref'd)

const H = kit.HOUR, D = kit.DAY;
const T0 = Date.parse('2026-11-01T12:00:00Z');

test('the audit log: timeouts, their removal, bans, unbans, kicks and the Quarantined role', () => {
  const e = (action, changes = [], extra = {}) => ({ action, targetId: 'u', executorId: 'm', reason: ' spam ', changes, createdTimestamp: T0, ...extra });
  assert.deepEqual(kit.auditAction(e(24, [{ key: 'communication_disabled_until', new: new Date(T0 + H).toISOString() }])), { userId: 'u', by: 'm', reason: 'spam', action: 'timeout', until: T0 + H, ms: H });
  assert.equal(kit.auditAction(e(24, [{ key: 'communication_disabled_until', old: new Date(T0 + H).toISOString() }])).action, 'untimeout');
  assert.equal(kit.auditAction(e(24, [{ key: 'nick', new: 'x' }])), null, 'a nickname is not a mod action');
  assert.equal(kit.auditAction(e(22)).action, 'ban');
  assert.equal(kit.auditAction(e(23)).action, 'unban');
  assert.equal(kit.auditAction(e(20)).action, 'kick');
  assert.equal(kit.auditAction(e(22, [], { reason: '' })).reason, null);
  const q = { quarantineRole: 'Q' };
  assert.equal(kit.auditAction(e(25, [{ key: '$add', new: [{ id: 'Q' }] }, { key: '$remove', new: [{ id: 'r1' }] }]), q).action, 'quarantine');
  assert.equal(kit.auditAction(e(25, [{ key: '$remove', new: [{ id: 'Q' }] }, { key: '$add', new: [{ id: 'r1' }] }]), q).action, 'unquarantine');
  assert.equal(kit.auditAction(e(25, [{ key: '$remove', new: [{ id: 'r1' }] }]), q), null, 'other roles: not a case');
});

test('expectations: what Kira is about to do, matched once by user and action, for a minute', () => {
  const x = kit.expectations();
  x.add('u', 'timeout', { by: 'mod1' }, T0);
  assert.equal(x.take('u', 'ban', T0), null);
  assert.deepEqual(x.take('u', 'timeout', T0 + 1000), { by: 'mod1' });
  assert.equal(x.take('u', 'timeout', T0 + 1000), null, 'once');
  x.add('u', 'kick', {}, T0);
  assert.equal(x.take('u', 'kick', T0 + kit.MIN + 1), null, 'expired');
});

test('a case: numbered, one format, "none given", evidence only from the mod who acted', () => {
  const mc = kit.blank({});
  const c = kit.openCase(mc, { action: 'timeout', userId: 'u', tag: 'joe', by: 'mod1', ms: H, until: T0 + H }, T0);
  const d = kit.openCase(mc, { action: 'ban', userId: 'v', by: kit.KIRA, reason: 'scam links', evidence: { url: 'https://discord.com/channels/1/2/3', label: 'the removed message' } }, T0);
  assert.deepEqual([c.n, d.n, mc.next], [1, 2, 3]);
  const v = kit.caseView(c);
  assert.equal(v.title, '⏳ Case #1 · Timeout');
  assert.match(v.description, /<@u> \(joe\) · `u`/);
  const field = (view, name) => view.fields.find((x) => x.name === name)?.value;
  assert.equal(field(v, 'Reason'), 'none given');
  assert.match(field(v, 'Length'), /^1 h \(until <t:\d+:f>\)$/);
  assert.equal(field(v, 'By'), '<@mod1>');
  assert.match(field(v, 'Evidence'), /<@mod1> can add it with \*\*Add evidence\*\*/);
  assert.equal(field(kit.caseView(d), 'By'), 'Kira (automatic)');
  assert.equal(field(kit.caseView(d), 'Evidence'), '[the removed message](https://discord.com/channels/1/2/3)');
  assert.match(kit.evidenceRefusal(c, 'mod2'), /Only <@mod1>/);
  assert.equal(kit.evidenceRefusal(c, 'mod1'), null);
  assert.match(kit.evidenceRefusal(d, 'mod1'), /Kira's own actions/);
  kit.addEvidence(c, { value: 'https://imgur.com/a/x', by: 'mod1' }, T0);
  assert.equal(c.evidence.url, 'https://imgur.com/a/x');
  kit.addEvidence(c, { value: 'said it in VC with minors there', by: 'mod1' }, T0);
  assert.equal(field(kit.caseView(c), 'Evidence'), 'said it in VC with minors there');
  assert.throws(() => kit.addEvidence(c, { value: '  ', by: 'mod1' }), /link or a few words/);
});

test('quarantine: the roles kept aside (not managed ones), a length that runs out', () => {
  const roles = [{ id: 'G' }, { id: 'Q' }, { id: 'lvl5' }, { id: 'boost', managed: true }, { id: 'tester' }];
  assert.deepEqual(kit.rolesToStrip(roles, { everyone: 'G', quarantineRole: 'Q' }), ['lvl5', 'tester']);
  const mc = kit.blank({});
  kit.quarantineSet(mc, 'u', { roles: ['lvl5'], until: T0 + D, caseNo: 4 }, T0);
  kit.quarantineSet(mc, 'u', { roles: ['tester'] }, T0 + 1);
  assert.deepEqual(mc.quarantined.u.roles, ['lvl5', 'tester'], 'a second strip keeps the first roles');
  assert.equal(mc.quarantined.u.case, 4);
  assert.deepEqual(kit.quarantinesDue(mc, T0), []);
  kit.quarantineSet(mc, 'u', { until: T0 + D }, T0);
  assert.deepEqual(kit.quarantinesDue(mc, T0 + D), ['u']);
});

test('appeals (pointofpressure\'s spec): the person\'s own live action, one open per member, one new per 7 days', () => {
  const mc = kit.blank({});
  const c = kit.openCase(mc, { action: 'quarantine', userId: 'u', by: 'mod1', reason: 'slurs' }, T0);
  kit.openCase(mc, { action: 'kick', userId: 'u', by: 'mod1' }, T0);
  assert.equal(kit.canAppeal(mc, c, 'other', T0).why, 'not-yours');
  assert.equal(kit.canAppeal(mc, mc.cases[2], 'u', T0).why, 'not-appealable');
  assert.equal(kit.appealTarget(mc, 'u', T0).case, c);
  assert.equal(kit.appealTarget(mc, 'nobody', T0).why, 'none');
  assert.throws(() => kit.submitAppeal(mc, { userId: 'u', caseNo: 1, answers: { what: 'x' } }, T0), /why it should be lifted/);
  const { appeal } = kit.submitAppeal(mc, { userId: 'u', caseNo: 1, answers: { what: 'I joked', why: 'it was a joke', more: '' } }, T0 + H);
  assert.equal(appeal.status, 'open');
  assert.throws(() => kit.submitAppeal(mc, { userId: 'u', caseNo: 1, answers: { what: 'a', why: 'b' } }, T0 + H), /appeal open already/);
  // the reviewer rule
  assert.match(kit.decideRefusal(c, 'mod1', { isMod: true }), /You acted on case #1: another mod decides/);
  assert.match(kit.decideRefusal(c, 'mod2', { isMod: false }), /Only the mods/);
  assert.equal(kit.decideRefusal(c, 'mod2', { isMod: true }), null);
  assert.deepEqual(kit.decisionsFor(c), ['uphold', 'ban', 'shorten', 'lift'], 'uphold on a quarantine can turn it into a ban');
  // another of their cases waits too: one open appeal per member
  const t = kit.openCase(mc, { action: 'timeout', userId: 'u', by: 'mod3', ms: D, until: T0 + D }, T0 + H);
  assert.equal(kit.canAppeal(mc, t, 'u', T0 + H).why, 'open');
  assert.throws(() => kit.decide(mc, appeal, { decision: 'uphold', by: 'mod2', note: ' ' }, T0 + 2 * H), /one-line reason/);
  kit.decide(mc, appeal, { decision: 'uphold', by: 'mod2', note: 'Rule 1:\nslurs.' }, T0 + 2 * H);
  assert.match(kit.outcomeText(c, appeal), /refused: it stays\.\nWhy: Rule 1: slurs\./);
  assert.throws(() => kit.decide(mc, appeal, { decision: 'lift', by: 'mod3', note: 'x' }), /decided already/);
  const again = kit.canAppeal(mc, t, 'u', T0 + 3 * H);
  assert.equal(again.why, 'cooldown', 'one new appeal per 7 days, whatever the case');
  assert.equal(again.retryAt, T0 + H + 7 * D);
  assert.equal(kit.appealTarget(mc, 'u', T0 + 3 * H).why, 'cooldown');
  assert.ok(kit.canAppeal(mc, c, 'u', T0 + H + 7 * D).ok);
});

test('decisions: shorten sets a new end from the action, lift ends it, Kira\'s own actions any mod decides', () => {
  const mc = kit.blank({});
  const c = kit.openCase(mc, { action: 'timeout', userId: 'u', by: kit.KIRA, ms: D, until: T0 + D }, T0);
  assert.equal(kit.decideRefusal(c, 'mod1', { isMod: true }), null);
  const { appeal: a } = kit.submitAppeal(mc, { userId: 'u', caseNo: c.n, answers: { what: 'a', why: 'b' } }, T0);
  const r = 'ok';
  assert.throws(() => kit.decide(mc, a, { decision: 'shorten', by: 'mod1', ms: 2 * D, note: r }, T0 + H), /not shorter/);
  assert.throws(() => kit.decide(mc, a, { decision: 'shorten', by: 'mod1', ms: H / 2, note: r }, T0 + H), /in the past/);
  assert.throws(() => kit.decide(mc, a, { decision: 'ban', by: 'mod1', note: r }, T0 + H), /doesn't apply/);
  const { until } = kit.decide(mc, a, { decision: 'shorten', by: 'mod1', ms: 2 * H, note: r }, T0 + H);
  assert.equal(until, T0 + 2 * H);
  assert.equal(c.ms, 2 * H);
  assert.match(c.appealNote, /^shortened by <@mod1>/);
  const b = kit.openCase(mc, { action: 'ban', userId: 'w', by: 'mod1' }, T0);
  const { appeal: ab } = kit.submitAppeal(mc, { userId: 'w', caseNo: b.n, answers: { what: 'a', why: 'b' }, via: 'web' }, T0);
  kit.decide(mc, ab, { decision: 'lift', by: 'mod2', note: 'it was a mistake' }, T0 + H);
  assert.ok(b.liftedAt);
  assert.equal(kit.canAppeal(mc, b, 'w', T0 + 9 * D).why, 'over');
  assert.match(kit.outcomeText(b, ab), /accepted: it is lifted/);
});

test('Minecraft appeals: their own case, decided by the ops only', () => {
  const mc = kit.blank({});
  assert.throws(() => kit.submitAppeal(mc, { userId: 'u', kind: 'minecraft', ign: 'no spaces!', answers: { what: 'a', why: 'b' } }), /in-game name/);
  const { case: c } = kit.submitAppeal(mc, { userId: 'u', kind: 'minecraft', ign: 'Steve_1', banText: 'xray', answers: { what: 'a', why: 'b' } }, T0);
  assert.equal(c.action, 'mcban');
  assert.equal(c.ign, 'Steve_1');
  assert.equal(c.banText, 'xray');
  assert.match(kit.decideRefusal(c, 'mod1', { isMod: true }), /ops/);
  assert.equal(kit.decideRefusal(c, kit.MC_OPS[0], { isMod: false }), null);
  assert.throws(() => kit.submitAppeal(mc, { userId: 'u', kind: 'minecraft', ign: 'steve_1', answers: { what: 'a', why: 'b' } }, T0), /appeal open already/, 'the same name: the same case');
  assert.match(kit.caseView(c).fields.find((x) => x.name.startsWith('Ban reason')).value, /xray/);
});

test('reminders after 24 h, then daily; the web link; the views', () => {
  const mc = kit.blank({});
  const c = kit.openCase(mc, { action: 'ban', userId: 'u', by: 'mod1', reason: 'raid' }, T0);
  const { appeal: a } = kit.submitAppeal(mc, { userId: 'u', caseNo: c.n, answers: { what: 'a', why: 'b' } }, T0);
  assert.deepEqual(kit.dueReminders(mc, T0 + 23 * H), []);
  assert.deepEqual(kit.dueReminders(mc, T0 + D), [a]);
  a.remindedAt = T0 + D;
  assert.deepEqual(kit.dueReminders(mc, T0 + D + H), []);
  assert.deepEqual(kit.dueReminders(mc, T0 + 2 * D), [a]);
  assert.deepEqual(kit.staleAppeals(mc, T0 + 11 * H), []);
  assert.deepEqual(kit.staleAppeals(mc, T0 + 13 * H), [a], 'the daily list: not decided after 12 h');
  kit.setWaiting(a, true);
  assert.equal(kit.appealName(c, 'joe', a.status), `⚖️ 🟡 Appeal · case #${c.n} · joe`);
  assert.deepEqual(kit.dueReminders(mc, T0 + 3 * D), [a], 'waiting still reminds');
  const { token } = kit.issueToken(mc, 'u', T0);
  assert.equal(kit.tokenUser(mc, token, T0 + D), 'u');
  assert.equal(kit.tokenUser(mc, token, T0 + 31 * D), null);
  assert.equal(kit.tokenUser(mc, 'nope', T0), null);
  assert.ok(!JSON.stringify(mc.tokens).includes(token), 'only the hash is kept');
  const p = kit.personView(mc, 'u', T0 + H);
  assert.equal(p.cases[0].n, c.n);
  assert.equal(p.cases[0].canAppeal, false);
  assert.equal(p.appeals[0].status, 'waiting');
  const s = kit.staffView(mc);
  assert.equal(s.cases[0].appeal.status, 'waiting');
  assert.equal(s.appeals[0].case, c.n);
  assert.ok(!JSON.stringify(s).includes('"what"'), 'no answers on the dashboard list');
});

test('mod-mail statuses: who spoke last, the name, the 12-hour list, renames spaced out', async () => {
  assert.equal(kit.mailAfter(null, 'member'), 'open');
  assert.equal(kit.mailAfter('open', 'mod'), 'waiting');
  assert.equal(kit.mailName('joe', 'open'), '🟢 joe');
  assert.equal(kit.mailName('🟢 joe', 'waiting'), '🟡 joe');
  assert.equal(kit.appealName({ n: 7 }, 'joe', 'decided'), '⚖️ 🔒 Appeal · case #7 · joe');
  const mc = kit.blank({});
  kit.mailSet(mc, 't1', { status: 'open', userId: 'a' }, T0);
  kit.mailSet(mc, 't2', { status: 'waiting', userId: 'b' }, T0);
  kit.mailSet(mc, 't3', { status: 'open', userId: 'c' }, T0 + 6 * H);
  assert.deepEqual(kit.staleMail(mc, T0 + 13 * H).map((t) => t.threadId), ['t1']);
  kit.mailSet(mc, 't1', { status: 'open' }, T0 + 13 * H);
  assert.equal(mc.modmail.t1.since, T0, 'the member writing again keeps the time it opened');
  let now = 0;
  const done = [];
  const timers = [];
  const r = kit.renamer({ gapMs: 300, now: () => now, rename: (id, name) => done.push([id, name]), later: (fn, ms) => { timers.push([fn, ms]); return {}; } });
  r('t', 'a');
  r('t', 'b');
  r('t', 'c');
  assert.deepEqual(done, [['t', 'a']]);
  assert.equal(timers.length, 1);
  now = 300;
  await timers[0][0]();
  assert.deepEqual(done, [['t', 'a'], ['t', 'c']], 'the last name wins');
});

// ── The Discord side, with fakes ─────────────────────────────────────────────

test('a mod\'s timeout from the audit log: one case in #mod-actions, a DM with the appeal button; the form; the decision by another mod', async () => {
  const posted = [], dms = [], threads = [], timeouts = [];
  const sendTo = (list) => async (m) => { const msg = { ...m, id: `p${list.length}`, url: `https://discord.com/channels/${GUILD_ID}/c/p${list.length}`, channelId: 'ma', edit: async (x) => Object.assign(msg, x) }; list.push(msg); return msg; };
  Object.assign(core.state.channels, { modactions: 'ma', modlog: 'ml', modmail: 'mm' });
  core.state.roles.mod = 'MOD';
  core.client.channels.cache.set('ma', { send: sendTo(posted), messages: { fetch: async (id) => posted.find((p) => p.id === id) } });
  core.client.channels.cache.set('ml', { send: sendTo(posted) });
  const thread = { id: 'th1', name: '', sent: [], send: async (m) => { const msg = { ...m, id: 'tm1', url: 'https://discord.com/channels/g/th1/tm1', edit: async () => {} }; thread.sent.push(m); return msg; }, messages: { fetch: async () => ({ edit: async () => {} }) }, edit: async (x) => Object.assign(thread, x) };
  core.client.channels.cache.set('mm', { threads: { create: async (o) => { thread.name = o.name; threads.push(o); return thread; } } });
  const user = { id: 'u9', tag: 'joe', username: 'joe', send: async (m) => { dms.push(m); } };
  core.client.users.fetch = async (id) => (id === 'u9' ? user : { id, tag: id, username: id, send: async () => {} });
  core.client.channels.fetch = async (id) => (id === 'th1' ? thread : null);
  const member = { id: 'u9', communicationDisabledUntilTimestamp: Date.now() + H, timeout: async (ms) => { timeouts.push(ms); } };
  core.client.guilds.cache.set(GUILD_ID, { id: GUILD_ID, members: { fetch: async () => member }, bans: { remove: async () => {} } });

  const until = new Date(Date.now() + H).toISOString();
  await f._test.onAudit({ action: 24, targetId: 'u9', executorId: 'mod1', reason: null, changes: [{ key: 'communication_disabled_until', new: until }], createdTimestamp: Date.now() }, { id: GUILD_ID });
  const c = Object.values(f._test.mc.cases).at(-1);
  assert.equal(c.action, 'timeout');
  assert.equal(c.by, 'mod1');
  const embed = posted.at(-1).embeds[0].toJSON();
  assert.equal(embed.title, `⏳ Case #${c.n} · Timeout`);
  assert.equal(embed.fields.find((x) => x.name === 'Reason').value, 'none given');
  assert.equal(posted.at(-1).components[0].toJSON().components[0].custom_id, `case:evidence:${c.n}`);
  assert.match(dms.at(-1).content, /timed out in \*\*Horizon\*\* for 1 h \(case #\d+\)/);
  assert.equal(dms.at(-1).components[0].toJSON().components[0].custom_id, `appeal:open:${c.n}`);

  // A command run through Kira: the audit entry's executor is Kira; the case names the mod, and isn't posted twice.
  f.expect('u9', 'kick', { by: 'mod2', reason: 'spam', noDm: true });
  const before = posted.length;
  core.client.user = { id: 'KIRA' };
  await f._test.onAudit({ action: 20, targetId: 'u9', executorId: 'KIRA', reason: 'mod2: spam', changes: [], createdTimestamp: Date.now() }, { id: GUILD_ID });
  assert.equal(posted.length, before + 1);
  assert.equal(Object.values(f._test.mc.cases).at(-1).by, 'mod2');
  f.expect('u9', 'ban', { skip: true });
  await f._test.onAudit({ action: 22, targetId: 'u9', executorId: 'KIRA', changes: [] }, { id: GUILD_ID });
  assert.equal(posted.length, before + 1, 'a honeypot soft-ban is skipped');

  // The form, as a modal submit.
  const replies = [];
  const modal = {
    customId: `appeal:form:${c.n}`, user, fields: { getTextInputValue: (k) => ({ case: `#${c.n}`, what: 'I streamed a wallpaper', why: 'not explicit', more: '' })[k] ?? '' },
    deferReply: async () => { modal.deferred = true; }, editReply: async (x) => replies.push(x), reply: async (x) => replies.push(x),
    isButton: () => false, isModalSubmit: () => true,
  };
  core.client.emit('interactionCreate', modal);
  await new Promise((r) => setTimeout(r, 30));
  assert.match(String(replies.at(-1)), /Sent: appeal of case #/);
  assert.match(threads.at(-1).name, /^⚖️ 🟢 Appeal · case #\d+ · joe$/);
  assert.match(thread.sent[0].content, /<@&MOD> appeal of case #\d+ by <@u9>\. A mod other than <@mod1> decides/);
  const a = Object.values(f._test.mc.appeals).at(-1);

  // The acting mod is refused; another one lifts it: the timeout ends, the person is told, the thread closes.
  const press = (by) => {
    const out = [];
    const i = { customId: `appeal:d:lift:${a.id}`, user: { id: by }, member: { permissions: { has: () => true } }, reply: async (x) => out.push(x), showModal: async (m) => out.push(m), isButton: () => true, isModalSubmit: () => false };
    core.client.emit('interactionCreate', i);
    return out;
  };
  const refused = press('mod1');
  await new Promise((r) => setTimeout(r, 10));
  assert.match(refused[0].content, /You acted on case #\d+: another mod decides/);
  await f._test.applyDecision(a, c, { decision: 'lift', by: 'mod3', note: 'the wallpaper was not explicit' });
  assert.deepEqual(timeouts, [null]);
  assert.match(dms.at(-1).content, /was accepted: it is lifted\.\nWhy: the wallpaper was not explicit/);
  assert.equal(a.outcome.told, 'dm');
  assert.match(thread.name, /^⚖️ 🔒 Appeal/);
  assert.equal(thread.locked, true);
  assert.match(posted.at(-1).embeds[0].toJSON().title, /^⚖️ Case #\d+ · appeal lifted$/);
});

test('the website\'s routes: a link to see one\'s bans, the form, the Moderation list', async () => {
  const routes = f._test.routes();
  const route = (path) => routes.find((r) => r.path === path);
  const mc = f._test.mc;
  const c = kit.openCase(mc, { action: 'ban', userId: 'b1', by: 'mod1', reason: 'raid' });
  const t = kit.openCase(mc, { action: 'timeout', userId: 'b1', by: 'mod1', ms: H, until: Date.now() + H });
  const { token } = kit.issueToken(mc, 'b1');
  const ctx = (body) => ({ body, ip: '1.2.3.4', now: Date.now(), query: {} });
  assert.equal((await route('appeal/peek').handler(ctx({ token: 'x'.repeat(43) }))).status, 404);
  const peek = await route('appeal/peek').handler(ctx({ token }));
  assert.deepEqual(peek.body.cases.map((x) => x.n), [c.n], 'only bans: a timeout is appealed on Discord');
  assert.equal((await route('appeal/submit').handler(ctx({ token, case: t.n, answers: { what: 'a', why: 'b' } }))).status, 400);
  const sent = await route('appeal/submit').handler(ctx({ token, case: c.n, answers: { what: 'a', why: 'b' } }));
  assert.equal(sent.body.case, c.n);
  assert.equal(mc.appeals[mc.cases[c.n].appeals[0]].via, 'web');
  const list = route('mod/cases').handler();
  assert.ok(list.body.cases.some((x) => x.n === c.n && x.appeal?.status === 'open'));
  assert.equal(route('mod/cases').role, 'mod');
  assert.deepEqual((await route('appeal/config').handler()).body.signIn, false, 'no client secret: no sign-in button');
});

test('a mod lifting Kira\'s spam timeout takes its strike back; Kira\'s own Undo and a mod\'s own timeout leave strikes alone', async () => {
  Object.assign(core.state.channels, { modactions: 'ma', modlog: 'ml' });
  const posted = [];
  const chan = { send: async (m) => { const msg = { ...m, id: `s${posted.length}`, url: 'https://discord.com/channels/g/c/m', channelId: 'ma', edit: async () => {} }; posted.push(msg); return msg; }, messages: { fetch: async () => null } };
  core.client.channels.cache.set('ma', chan);
  core.client.channels.cache.set('ml', chan);
  core.client.users.fetch = async (id) => ({ id, tag: id, username: id, send: async () => {} });
  core.client.user = { id: 'KIRA' };
  const now = Date.now();
  const entry = (executorId, change) => ({ action: 24, targetId: 'u7', executorId, reason: null, changes: [change], createdTimestamp: Date.now() });
  const set = { key: 'communication_disabled_until', new: new Date(now + H).toISOString() };
  const cleared = { key: 'communication_disabled_until', old: new Date(now + H).toISOString() };

  // Kira's automatic timeout (the ladder gave strike 1 a moment ago) …
  core.state.spamStrikes = { u7: [now - 1_000] };
  f.expect('u7', 'timeout', { by: kit.KIRA, reason: 'spam (the same message 3 times)', noDm: true });
  await f._test.onAudit(entry('KIRA', set), { id: GUILD_ID });
  // … Kira's Undo lifts it itself and took the strike back already: the audit entry must not drop another.
  core.state.spamStrikes.u7 = [now - 1_000];
  await f._test.onAudit(entry('KIRA', cleared), { id: GUILD_ID });
  assert.deepEqual(core.state.spamStrikes.u7, [now - 1_000], 'Undo handles its own strike');
  // A mod lifts it in Discord: its strike goes.
  await f._test.onAudit(entry('mod1', cleared), { id: GUILD_ID });
  assert.deepEqual(core.state.spamStrikes.u7, []);

  // A mod's own timeout is not a Kira strike: lifting it leaves the strikes alone.
  core.state.spamStrikes = { u7: [now - 5_000] };
  await f._test.onAudit(entry('mod1', set), { id: GUILD_ID });
  await f._test.onAudit(entry('mod1', cleared), { id: GUILD_ID });
  assert.equal(core.state.spamStrikes.u7.length, 1);
});
