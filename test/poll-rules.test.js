// Council polls without Discord: who may start which poll, the count (quorum, simple, two thirds with 3 Yes), early
// close, reminders, the 7-day rule, and the append-only decisions log with its public view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as kit from '../src/poll-kit.js';
import * as decisions from '../src/decisions-kit.js';

const council = { 1000000001: 'a', 1000000002: 'b', 1000000003: 'c', 1000000004: 'd', 1000000005: 'e', 1000000006: 'f' };
const [A, B, C, D, E, F] = Object.keys(council);
const OUT = '2000000001';
const NOW = Date.UTC(2026, 10, 12, 12);
const start = (p, log = []) => kit.check({ opener: A, question: 'Should we do the thing we talked about?', ...p }, { council, log, now: NOW });

test('who may start which poll', () => {
  assert.equal(start({ kind: 'decision' }).ok, true);
  assert.match(kit.check({ kind: 'decision', question: 'Should we do the thing?', opener: OUT }, { council, now: NOW }).why, /Only council members/);
  assert.match(start({ kind: 'nope' }).why, /Unknown kind/);
  assert.match(start({ kind: 'decision', question: 'yes?' }).why, /full sentence/);
  assert.match(start({ kind: 'decision', role: 'team', member: OUT, action: 'add' }).why, /changes no role/);
  assert.match(start({ kind: 'member-add' }).why, /give the member and the role/);
  assert.match(start({ kind: 'member-add', member: OUT, role: 'mod' }).why, /can't change that role/);
  assert.match(start({ kind: 'member-add', member: B, role: 'council' }).why, /already on the council/);
  assert.match(start({ kind: 'member-add', member: OUT, role: 'team', action: 'remove' }).why, /can only add/);
  assert.match(start({ kind: 'lead', member: OUT, role: 'lead-ui' }).why, /given or taken/);
  assert.match(start({ kind: 'member-remove', member: OUT, role: 'council' }).why, /not on the council/);
});

test('each kind has its threshold and place; removing someone runs in #council', () => {
  const add = start({ kind: 'member-add', member: OUT, role: 'team' }).poll;
  assert.deepEqual([add.threshold, add.where, add.subject], ['two-thirds', 'public', OUT]);
  assert.deepEqual(add.outcome, { member: OUT, role: 'team', action: 'add' });
  const lead = start({ kind: 'lead', member: OUT, role: 'lead-ui', action: 'add' }).poll;
  assert.deepEqual([lead.threshold, lead.where], ['simple', 'public']);
  const leadOff = start({ kind: 'lead', member: OUT, role: 'lead-ui', action: 'remove' }).poll;
  assert.equal(leadOff.where, 'council', 'a poll that takes a role is about a person');
  const remove = start({ kind: 'member-remove', member: B, role: 'council' }).poll;
  assert.deepEqual([remove.threshold, remove.where, remove.subject], ['two-thirds', 'council', B]);
  assert.equal(start({ kind: 'appeal', member: OUT }).poll.where, 'council');
  assert.equal(start({ kind: 'rule' }).poll.threshold, 'two-thirds');
  assert.equal(start({ kind: 'money' }).poll.threshold, 'two-thirds');
});

test('the count: quorum of half (abstain counts), simple majority, tie fails, outsiders ignored', () => {
  const ids = Object.keys(council);
  const r = (ballots, threshold = 'simple', e = ids) => kit.outcome({ ballots, eligible: e, threshold });
  assert.equal(r({ [A]: 'yes', [B]: 'yes' }).quorum, false, '2 of 6: no quorum');
  assert.equal(r({ [A]: 'yes', [B]: 'yes' }).why, 'no quorum');
  assert.equal(r({ [A]: 'yes', [B]: 'no', [C]: 'abstain' }).quorum, true, '3 of 6 with an abstain is quorum');
  assert.equal(r({ [A]: 'yes', [B]: 'no', [C]: 'abstain' }).why, 'tie');
  assert.equal(r({ [A]: 'yes', [B]: 'no', [C]: 'yes' }).passed, true);
  assert.equal(r({ [A]: 'yes', [B]: 'no', [C]: 'no' }).why, 'majority No');
  const outside = r({ [A]: 'yes', [OUT]: 'yes', [B]: 'no', [C]: 'no' });
  assert.deepEqual([outside.yes, outside.no, outside.voted], [1, 2, 3], 'an outsider ballot is left out');
  assert.equal(r({}, 'simple', []).passed, false, 'an empty electorate never passes');
});

test('two thirds needs 2/3 of Yes + No and at least 3 Yes', () => {
  const ids = Object.keys(council);
  const r = (ballots) => kit.outcome({ ballots, eligible: ids, threshold: 'two-thirds' });
  const lowTurnout = r({ [A]: 'yes', [B]: 'yes', [C]: 'no' });
  assert.equal(lowTurnout.passed, false, '2 Yes to 1 No is 2/3 but fewer than 3 Yes');
  assert.equal(lowTurnout.why, 'fewer than 3 Yes');
  assert.equal(r({ [A]: 'yes', [B]: 'yes', [C]: 'abstain' }).passed, false, 'quorum with abstain, still only 2 Yes');
  assert.equal(r({ [A]: 'yes', [B]: 'yes', [C]: 'yes', [D]: 'no', [E]: 'no' }).why, 'fewer than two thirds Yes');
  assert.equal(r({ [A]: 'yes', [B]: 'yes', [C]: 'yes', [D]: 'no' }).passed, true, '3 of 4 is above 2/3');
  assert.equal(r({ [A]: 'yes', [B]: 'yes', [C]: 'yes', [D]: 'no', [E]: 'abstain', [F]: 'abstain' }).passed, true, 'abstain is not in the 2/3');
  assert.equal(r({ [A]: 'abstain', [B]: 'abstain', [C]: 'abstain' }).passed, false, 'all abstain');
});

test('the member a poll is about, and anyone who recused, neither vote nor count', () => {
  const poll = { ...start({ kind: 'member-remove', member: B, role: 'council' }).poll, recused: [C] };
  const ids = kit.eligible(council, poll);
  assert.deepEqual(ids.sort(), [A, D, E, F].sort());
  assert.match(kit.mayVote(B, council, poll), /about you/);
  assert.match(kit.mayVote(C, council, poll), /recused/);
  assert.match(kit.mayVote(OUT, council, poll), /Only council members/);
  assert.equal(kit.mayVote(A, council, poll), null);
  assert.match(kit.mayVote(A, council, { ...poll, closedAt: NOW }), /closed/);
  const r = kit.outcome({ ballots: { [A]: 'yes', [D]: 'yes', [E]: 'yes', [B]: 'no' }, eligible: ids, threshold: 'two-thirds' });
  assert.deepEqual([r.size, r.needed, r.yes, r.no, r.passed], [4, 2, 3, 0, true]);
  assert.equal(kit.allVoted({ [A]: 'yes', [D]: 'no', [E]: 'yes' }, ids), false);
  assert.equal(kit.allVoted({ [A]: 'yes', [D]: 'no', [E]: 'yes', [F]: 'abstain' }, ids), true);
});

test('reminders at 12 h and 2 h before the end, once each, to those who have not voted', () => {
  const poll = { startedAt: NOW, endsAt: NOW + 24 * kit.HOUR, ballots: { [A]: 'yes' }, reminded: [] };
  const ids = Object.keys(council);
  assert.deepEqual(kit.remindersDue(poll, ids, NOW + 11 * kit.HOUR), []);
  const at12 = kit.remindersDue(poll, ids, NOW + 12 * kit.HOUR);
  assert.deepEqual(at12.map((x) => x.mark), [12]);
  assert.deepEqual(at12[0].ids, [B, C, D, E, F]);
  poll.reminded.push(12);
  assert.deepEqual(kit.remindersDue(poll, ids, NOW + 13 * kit.HOUR), []);
  assert.deepEqual(kit.remindersDue(poll, ids, NOW + 22 * kit.HOUR).map((x) => x.mark), [2]);
});

test('a failed poll blocks the same one for 7 days, unless two members sign a reopen', () => {
  const p = start({ kind: 'decision' }).poll;
  const log = [{ id: 'D1', type: 'poll', key: p.key, closedAt: NOW - kit.HOUR, result: { passed: false } }];
  assert.match(start({ kind: 'decision', question: 'should we do the THING we talked about' }, log).why, /failed on .*D1.*reopen/);
  assert.equal(start({ kind: 'decision' }, [{ ...log[0], result: { passed: true } }]).ok, true, 'a passed poll does not block');
  assert.equal(kit.check({ kind: 'decision', question: 'Should we do the thing we talked about?', opener: A }, { council, log, now: NOW + 8 * 24 * kit.HOUR }).ok, true, 'after 7 days');
  const signed = [...log, { type: 'reopen', of: 'D1', by: B }];
  assert.equal(start({ kind: 'decision' }, signed).ok, false, 'one signature is not enough');
  assert.equal(start({ kind: 'decision' }, [...signed, { type: 'reopen', of: 'D1', by: B }]).ok, false, 'the same member twice');
  assert.equal(start({ kind: 'decision' }, [...signed, { type: 'reopen', of: 'D1', by: C }]).ok, true);
  assert.equal(start({ kind: 'decision', question: 'Something else entirely, please?' }, log).ok, true, 'another question');
});

test('the decisions log only appends; person polls show no question or ballots in public', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'kira-decisions-')), 'decisions.json');
  const log = decisions.openLog(file);
  const a = log.append({ type: 'poll', where: 'public', kind: 'decision', key: 'k', question: 'Q?', ballots: { [A]: 'yes' }, result: { passed: true } }, 5);
  const b = log.append({ type: 'poll', where: 'council', kind: 'member-remove', key: 'k2', question: 'secret', ballots: { [A]: 'no' }, outcome: { member: B, role: 'council', action: 'remove' }, result: { passed: false } }, 6);
  log.append({ type: 'applied', of: a.id, member: OUT, role: 'team', action: 'add', ok: true }, 7);
  assert.deepEqual([a.id, b.id, a.at], ['D1', 'D2', 5]);
  assert.throws(() => log.append({ type: 'edit' }), /unknown decision type/);
  const again = decisions.openLog(file).all();
  assert.deepEqual(again.map((e) => e.id), ['D1', 'D2', 'D3'], 'kept on disk, in order');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).decisions.length, 3);
  const pub = decisions.publicView(again);
  assert.equal(pub[0].question, 'Q?');
  assert.deepEqual(pub[0].ballots, { [A]: 'yes' });
  assert.equal(pub[0].key, undefined);
  assert.equal(pub[1].question, null);
  assert.equal(pub[1].ballots, null);
  assert.equal(pub[1].kind, 'person', 'the kind of a person poll could tell the reason');
  assert.deepEqual(pub[1].outcome, { member: B, role: 'council', action: 'remove' }, 'the result and the role change are public');
  let head; let body;
  decisions.route({ log, now: () => 0 })({}, { writeHead: (s, h) => { head = [s, h]; }, end: (x) => { body = JSON.parse(x); } });
  assert.equal(head[0], 200);
  assert.equal(body.decisions.length, 3);
  assert.equal(body.decisions[1].question, null);
});

test('texts: the result line says the counts, the threshold and the kind', () => {
  const poll = { id: 'P3', kind: 'member-add' };
  const r = kit.outcome({ ballots: { [A]: 'yes', [B]: 'yes', [C]: 'no' }, eligible: Object.keys(council), threshold: 'two-thirds' });
  assert.match(kit.resultLine(poll, r), /❌ \*\*Not passed\*\* \(fewer than 3 Yes\): P3 · Adding a council or Horizon Team member \(2 Yes, 1 No, 0 Abstain; 3 of 6 voted, 3 needed; two thirds/);
  assert.equal(kit.outcomeText({ member: OUT, role: 'lead-ui', action: 'add' }), `give 🧭 UI lead to <@${OUT}>`);
});
