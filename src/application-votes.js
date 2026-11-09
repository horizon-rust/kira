// The vote on an application, then Ludovic's veto window (the orchestrator's rules, 2026-10-30). No Discord, no
// network: `ctx` brings who holds which role, who was active, and the hooks to the Discord side.
//
// - Voters: 🛡️ Mod holders vote on Mod and Support applications, 🌌 Horizon Team holders on Team and Support ones. The
//   applicant never votes, and neither does the owner (he has the veto). A voter can recuse themselves.
// - Ballot: For, Against (a comment is required) or Abstain, changeable until the vote closes. Blind until you vote:
//   the others' ballots and comments show once you cast yours, or once the vote closes (Ludovic, who never votes,
//   sees them all along). A recused voter stays blind.
// - Active voters: eligible, not recused, and logged in to a dashboard or acted there in the last 30 days.
//   Quorum: max(2, ceil(40% of the active voters)), counting every ballot cast (abstentions included).
// - The vote closes 72 hours after the first ballot, or as soon as every active voter has voted. An application
//   nobody votes on within 72 hours counts as a vote without quorum.
// - At close: with quorum, it passes when at least 2/3 of the For and Against ballots are For, else it is declined (at
//   once). Without quorum: extended once by 48 hours, then 'stalled', for the owner to decide. Fewer than 2 active
//   voters at close: the owner decides ('owner').
// - A pass opens a 12-hour veto window and Ludovic gets exactly one DM. Doing nothing accepts it when the window ends;
//   he can veto (a decline, with an optional note only he sees) or approve at once. He can also veto while the vote is
//   open, decide 'stalled' and 'owner' ones, and take the role back later. Every action goes to the append-only audit
//   log (staff.json's `audit`), which voters and the owner see; the applicant's DM never tells the votes.
//
// With the governance on (horizon-rust/horizon GOVERNANCE.md, live since 2026-11-09), `ctx.gov` is set and `ctx.owner`
// is null: Ludovic has no veto and no special view any more. Instead:
// - A passed Mod vote opens a 24-hour council objection window, announced in #council. Two council objections send it
//   to a council poll; otherwise it is accepted when the window ends.
// - A passed Support vote is accepted at once (Support has no council step). A passed Team vote goes to a council poll
//   at two thirds (Team applications are closed today; this covers any still open).
// - 'stalled' and 'owner' (too few votes or voters) go to a council poll instead of Ludovic.
// - The council poll's result accepts or declines the application, citing the decision id (pollClosed).
// - Accepting a role of trust waits for the applicant's 18+ declaration ('age-wait'), when that switch is on.
// ctx.gov: { isCouncil(id), announce(app, until) → message ref, openPoll(app, reason) → { id } or null,
//            needsDeclaration(app) → bool, askDeclaration(app) → result }.
import { DECLINE_COOLDOWN_DAYS, DECISION_TEXTS } from './staff-hooks.js';

const H = 3_600_000;
export const VOTE = { windowMs: 72 * H, extendMs: 48 * H, vetoMs: 12 * H, objectMs: 24 * H, objections: 2, activeMs: 30 * 24 * H, passShare: 2 / 3, minQuorum: 2, quorumShare: 0.4 };
export const FINAL = ['accepted', 'declined'];
export const CHOICES = ['for', 'against', 'abstain'];
// Why an application went to a council poll: the poll's threshold for each.
export const TO_COUNCIL = { objections: 'simple', stalled: 'simple', owner: 'simple', team: 'two-thirds' };
const refuse = (message) => Object.assign(new Error(message), { expose: true });

// The voters' roles per application role.
export const VOTER_ROLES = { mod: ['mod'], support: ['mod', 'team'], team: ['team'] };

export const newVote = (now) => ({ ballots: {}, recused: [], firstBallotAt: null, closesAt: now + VOTE.windowMs, extended: false });

// ctx: { holders: { mod: Set, team: Set }, lastActive: { [id]: ms }, owner, now }
export function eligible(app, ctx) {
  const out = new Set();
  for (const r of VOTER_ROLES[app.role]) for (const id of ctx.holders[r] ?? []) out.add(id);
  out.delete(app.user);
  if (ctx.owner) out.delete(ctx.owner);
  return out;
}

export function count(app, ctx) {
  const can = eligible(app, ctx);
  const recused = new Set(app.vote.recused);
  const voters = [...can].filter((id) => !recused.has(id));
  const active = voters.filter((id) => (ctx.lastActive[id] ?? 0) >= ctx.now - VOTE.activeMs);
  const cast = Object.entries(app.vote.ballots).filter(([id]) => can.has(id) && !recused.has(id));
  const n = (c) => cast.filter(([, b]) => b.choice === c).length;
  const quorum = Math.max(VOTE.minQuorum, Math.ceil(VOTE.quorumShare * active.length));
  return { eligible: voters.length, active: active.length, quorum, cast: cast.length, for: n('for'), against: n('against'), abstain: n('abstain'), allVoted: active.length > 0 && active.every((id) => app.vote.ballots[id]) };
}

export function audit(store, entry) {
  store.update((d) => { (d.audit ??= []).push(entry); });
}

export function castBallot(store, app, { voter, choice, comment = '' }, ctx) {
  if (app.status !== 'open') throw refuse('The vote on this application is closed.');
  if (!eligible(app, ctx).has(voter)) throw refuse('You don\'t vote on this application.');
  if (!CHOICES.includes(choice)) throw refuse('For, against or abstain.');
  const text = String(comment ?? '').trim().slice(0, 1000);
  if (choice === 'against' && !text) throw refuse('Say why when you vote against.');
  const changed = !!app.vote.ballots[voter];
  store.update(() => {
    app.vote.ballots[voter] = { choice, comment: text, at: ctx.now };
    app.vote.recused = app.vote.recused.filter((id) => id !== voter);
    if (!app.vote.firstBallotAt) Object.assign(app.vote, { firstBallotAt: ctx.now, closesAt: ctx.now + VOTE.windowMs });
  });
  audit(store, { at: ctx.now, by: voter, app: app.id, action: changed ? 'ballot-changed' : 'ballot', choice, comment: text });
}

export function recuse(store, app, voter, ctx) {
  if (app.status !== 'open') throw refuse('The vote on this application is closed.');
  if (!eligible(app, ctx).has(voter)) throw refuse('You don\'t vote on this application.');
  store.update(() => {
    delete app.vote.ballots[voter];
    if (!app.vote.recused.includes(voter)) app.vote.recused.push(voter);
  });
  audit(store, { at: ctx.now, by: voter, app: app.id, action: 'recused' });
}

// Final: recorded, then the Discord side grants the role (accept) and DMs the applicant.
export async function finalize(store, app, outcome, by, ctx) {
  const cooldownUntil = outcome === 'decline' ? ctx.now + DECLINE_COOLDOWN_DAYS * 24 * H : null;
  store.update(() => Object.assign(app, { status: outcome === 'accept' ? 'accepted' : 'declined', decidedBy: by, decidedAt: ctx.now }));
  const result = await ctx.hooks.decide({ applicationId: app.id, userId: app.user, role: app.role, outcome, decidedBy: by, cooldownUntil, url: ctx.url(app) });
  store.update(() => { app.result = result; });
  audit(store, { at: ctx.now, by, app: app.id, action: outcome === 'accept' ? 'accepted' : 'declined', result });
}

// Moves an application along when its time comes. Returns what happened (null: nothing).
export async function advance(store, app, ctx) {
  if (app.status === 'veto-window' && ctx.now >= app.veto.until) return accept(store, app, 'vote', ctx);
  if (app.status === 'objection-window' && ctx.now >= app.objection.until) return accept(store, app, 'vote', ctx);
  if (app.status === 'council-poll' && !app.council.poll) return toCouncil(store, app, app.council.reason, ctx); // posting failed: again
  if (app.status === 'age-wait') return ctx.gov?.needsDeclaration(app) ? null : accept(store, app, app.ageWait.by, ctx);
  if (app.status !== 'open') return null;
  const c = count(app, ctx);
  const due = ctx.now >= app.vote.closesAt || (c.allVoted && c.active >= VOTE.minQuorum);
  if (!due) return null;
  const tally = { for: c.for, against: c.against, abstain: c.abstain, quorum: c.quorum, active: c.active };
  if (c.active < VOTE.minQuorum) {
    if (ctx.gov) { store.update(() => { app.tally = tally; }); return toCouncil(store, app, 'owner', ctx); }
    store.update(() => Object.assign(app, { status: 'owner', tally }));
    audit(store, { at: ctx.now, by: 'vote', app: app.id, action: 'to-owner', tally });
    return 'owner';
  }
  if (c.cast < c.quorum) {
    if (!app.vote.extended) {
      store.update(() => Object.assign(app.vote, { extended: true, closesAt: ctx.now + VOTE.extendMs }));
      audit(store, { at: ctx.now, by: 'vote', app: app.id, action: 'extended', tally });
      return 'extended';
    }
    if (ctx.gov) { store.update(() => { app.tally = tally; }); return toCouncil(store, app, 'stalled', ctx); }
    store.update(() => Object.assign(app, { status: 'stalled', tally }));
    audit(store, { at: ctx.now, by: 'vote', app: app.id, action: 'stalled', tally });
    return 'stalled';
  }
  store.update(() => { app.tally = tally; });
  if (c.for + c.against > 0 && c.for / (c.for + c.against) >= VOTE.passShare) {
    if (ctx.gov) return governedPass(store, app, tally, ctx);
    const until = ctx.now + VOTE.vetoMs;
    store.update(() => Object.assign(app, { status: 'veto-window', veto: { from: ctx.now, until } }));
    const dm = await ctx.hooks.dm({ userId: ctx.owner, content: DECISION_TEXTS.vetoWindow({ userId: app.user, role: app.role, yes: c.for, no: c.against, url: ctx.url(app), until }) });
    store.update(() => { app.veto.dm = dm; });
    audit(store, { at: ctx.now, by: 'vote', app: app.id, action: 'passed', tally, ownerDm: dm });
    return 'passed';
  }
  await finalize(store, app, 'decline', 'vote', ctx);
  return 'declined';
}

// A passed vote with the governance on: Mod → the objection window, Support → accepted, Team → a council poll.
async function governedPass(store, app, tally, ctx) {
  audit(store, { at: ctx.now, by: 'vote', app: app.id, action: 'passed', tally });
  if (app.role === 'support') return accept(store, app, 'vote', ctx);
  if (app.role === 'team') return toCouncil(store, app, 'team', ctx);
  const until = ctx.now + VOTE.objectMs;
  store.update(() => Object.assign(app, { status: 'objection-window', objection: { from: ctx.now, until, by: [] } }));
  const message = await ctx.gov.announce(app, until);
  store.update(() => { app.objection.message = message ?? null; });
  audit(store, { at: ctx.now, by: 'vote', app: app.id, action: 'objection-window', until });
  return 'objection-window';
}

// Accepts, or waits for the applicant's 18+ declaration first when the role needs one (GOVERNANCE.md 9).
async function accept(store, app, by, ctx) {
  if (ctx.gov?.needsDeclaration(app)) {
    if (app.status === 'age-wait') return null;
    store.update(() => Object.assign(app, { status: 'age-wait', ageWait: { from: ctx.now, by } }));
    const result = await ctx.gov.askDeclaration(app);
    audit(store, { at: ctx.now, by: 'vote', app: app.id, action: 'age-wait', result });
    return 'age-wait';
  }
  await finalize(store, app, 'accept', by, ctx);
  return 'accepted';
}

// Sends an application to a council poll (`reason`: a key of TO_COUNCIL). If the poll can't be posted, the next tick
// tries again (advance).
export async function toCouncil(store, app, reason, ctx) {
  store.update(() => Object.assign(app, { status: 'council-poll', council: { reason, at: app.council?.at ?? ctx.now, poll: null } }));
  const poll = await ctx.gov.openPoll(app, reason);
  if (!poll?.id) return null;
  store.update(() => { app.council.poll = poll.id; });
  audit(store, { at: ctx.now, by: 'vote', app: app.id, action: 'to-council', reason, poll: poll.id });
  return 'to-council';
}

// A council member objects during the objection window; the second objection sends it to a council poll.
export async function object(store, app, member, ctx) {
  if (!ctx.gov) throw refuse('There is no objection window without the governance.');
  if (app.status !== 'objection-window') throw refuse('This application is not in its objection window any more.');
  if (!ctx.gov.isCouncil(member)) throw refuse('Only council members object.');
  if (app.objection.by.includes(member)) throw refuse('You already objected.');
  store.update(() => { app.objection.by.push(member); });
  audit(store, { at: ctx.now, by: member, app: app.id, action: 'objection' });
  if (app.objection.by.length >= VOTE.objections) return toCouncil(store, app, 'objections', ctx);
  return 'objection';
}

// The council poll on an application closed: passed → accepted (or waiting for the 18+ declaration), else declined.
// `decision`: the decision id, recorded as who decided.
export async function pollClosed(store, app, { passed, decision }, ctx) {
  if (app.status !== 'council-poll') return null;
  if (passed) return accept(store, app, decision, ctx);
  await finalize(store, app, 'decline', decision, ctx);
  return 'declined';
}

// The owner's actions: veto (any time before final), approve (veto window, stalled, owner), decline (stalled, owner),
// revoke (an accepted one: the role is taken back, logged).
export async function ownerAct(store, app, action, ctx, { note = '' } = {}) {
  if (ctx.gov || !ctx.owner) throw refuse('The council decides applications now (GOVERNANCE.md): no veto, no owner decision.');
  const open = !FINAL.includes(app.status);
  if (action === 'veto' && open) {
    const text = String(note ?? '').trim().slice(0, 500);
    audit(store, { at: ctx.now, by: ctx.owner, app: app.id, action: 'veto', ...(text ? { note: text } : {}) });
    return finalize(store, app, 'decline', ctx.owner, ctx);
  }
  if (action === 'approve' && ['veto-window', 'stalled', 'owner'].includes(app.status)) return finalize(store, app, 'accept', ctx.owner, ctx);
  if (action === 'decline' && ['stalled', 'owner'].includes(app.status)) return finalize(store, app, 'decline', ctx.owner, ctx);
  if (action === 'revoke' && app.status === 'accepted' && !app.revoked) {
    const result = await ctx.hooks.revokeRole({ applicationId: app.id, userId: app.user, role: app.role, by: ctx.owner });
    store.update(() => { app.revoked = { at: ctx.now, by: ctx.owner, result }; });
    audit(store, { at: ctx.now, by: ctx.owner, app: app.id, action: 'role-revoked', result });
    return;
  }
  throw refuse(`Can't ${action} an application that is ${app.status}.`);
}

// Whether `viewer` sees the others' ballots: once they voted (not recused), or once the vote closed. The owner
// doesn't vote and sees no names while it runs: only the counts and the Against comments (voteView).
export function seesBallots(app, viewer, ctx) {
  if (app.status !== 'open') return true;
  if (viewer === ctx.owner) return false;
  return !!app.vote?.ballots[viewer] && !app.vote.recused.includes(viewer);
}

// What a dashboard shows of the vote to `viewer`: until they vote, the count and their own state; then the ballots and
// the running tally; everything once it closed. The owner, while it runs: the running tally and the Against comments,
// without names (sorted, so their order says nothing either).
export function voteView(app, viewer, ctx) {
  const c = count(app, ctx);
  const closed = app.status !== 'open';
  const sees = seesBallots(app, viewer, ctx);
  const ownerOpen = !closed && viewer === ctx.owner;
  return {
    closesAt: app.vote.closesAt, firstBallotAt: app.vote.firstBallotAt, extended: app.vote.extended,
    cast: c.cast, quorum: c.quorum, active: c.active, eligible: c.eligible,
    canVote: app.status === 'open' && eligible(app, ctx).has(viewer),
    mine: app.vote.ballots[viewer] ?? null,
    recused: app.vote.recused.includes(viewer),
    needed: Math.max(0, c.quorum - c.cast), // ballots still missing for the quorum
    seen: sees,
    ballots: sees ? Object.entries(app.vote.ballots).map(([by, b]) => ({ by, ...b })) : null,
    tally: closed ? app.tally ?? null : sees || ownerOpen ? { for: c.for, against: c.against, abstain: c.abstain, quorum: c.quorum } : null,
    againstComments: ownerOpen ? Object.entries(app.vote.ballots).filter(([id, b]) => b.choice === 'against' && b.comment && !app.vote.recused.includes(id)).map(([, b]) => b.comment).sort() : null,
  };
}

// The audit lines of an application for `viewer`: ballots' choices and comments hidden until they see the ballots
// (seesBallots), the owner's veto note shown to him only.
export function auditView(store, app, viewer, ctx) {
  const sees = !!ctx && seesBallots(app, viewer, ctx);
  return (store.data.audit ?? []).filter((e) => e.app === app.id).map((e) => {
    let out = !sees && e.choice ? { ...e, choice: null, comment: null } : e;
    if (out.note && viewer !== ctx?.owner) { out = { ...out }; delete out.note; }
    return out;
  });
}
