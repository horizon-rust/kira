// The vote on an application, then Ludovic's veto window (the orchestrator's rules, 2026-10-30). No Discord, no
// network: `ctx` brings who holds which role, who was active, and the hooks to the Discord side.
//
// - Voters: 🛡️ Mod holders vote on Mod and Support applications, 🌌 Horizon Team holders on Team and Support ones. The
//   applicant never votes, and neither does the owner (he has the veto). A voter can recuse themselves.
// - Ballot: For, Against (a comment is required) or Abstain; blind (only the count shows) and changeable until the vote
//   closes.
// - Active voters: eligible, not recused, and logged in to a dashboard or acted there in the last 30 days.
//   Quorum: max(2, ceil(40% of the active voters)), counting every ballot cast (abstentions included).
// - The vote closes 72 hours after the first ballot, or as soon as every active voter has voted. An application
//   nobody votes on within 72 hours counts as a vote without quorum.
// - At close: with quorum, it passes when at least 2/3 of the For and Against ballots are For, else it is declined (at
//   once). Without quorum: extended once by 48 hours, then 'stalled', for the owner to decide. Fewer than 2 active
//   voters at close: the owner decides ('owner').
// - A pass opens a 12-hour veto window and Ludovic gets exactly one DM. Doing nothing accepts it when the window ends;
//   he can veto (a decline) or approve at once. He can also veto while the vote is open, decide 'stalled' and 'owner'
//   ones, and take the role back later. Every action goes to the append-only audit log (staff.json's `audit`).
import { DECLINE_COOLDOWN_DAYS, DECISION_TEXTS } from './staff-hooks.js';

const H = 3_600_000;
export const VOTE = { windowMs: 72 * H, extendMs: 48 * H, vetoMs: 12 * H, activeMs: 30 * 24 * H, passShare: 2 / 3, minQuorum: 2, quorumShare: 0.4 };
export const FINAL = ['accepted', 'declined'];
export const CHOICES = ['for', 'against', 'abstain'];
const refuse = (message) => Object.assign(new Error(message), { expose: true });

// The voters' roles per application role.
export const VOTER_ROLES = { mod: ['mod'], support: ['mod', 'team'], team: ['team'] };

export const newVote = (now) => ({ ballots: {}, recused: [], firstBallotAt: null, closesAt: now + VOTE.windowMs, extended: false });

// ctx: { holders: { mod: Set, team: Set }, lastActive: { [id]: ms }, owner, now }
export function eligible(app, ctx) {
  const out = new Set();
  for (const r of VOTER_ROLES[app.role]) for (const id of ctx.holders[r] ?? []) out.add(id);
  out.delete(app.user);
  out.delete(ctx.owner);
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
  if (app.status === 'veto-window' && ctx.now >= app.veto.until) {
    await finalize(store, app, 'accept', 'vote', ctx);
    return 'accepted';
  }
  if (app.status !== 'open') return null;
  const c = count(app, ctx);
  const due = ctx.now >= app.vote.closesAt || (c.allVoted && c.active >= VOTE.minQuorum);
  if (!due) return null;
  const tally = { for: c.for, against: c.against, abstain: c.abstain, quorum: c.quorum, active: c.active };
  if (c.active < VOTE.minQuorum) {
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
    store.update(() => Object.assign(app, { status: 'stalled', tally }));
    audit(store, { at: ctx.now, by: 'vote', app: app.id, action: 'stalled', tally });
    return 'stalled';
  }
  store.update(() => { app.tally = tally; });
  if (c.for + c.against > 0 && c.for / (c.for + c.against) >= VOTE.passShare) {
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

// The owner's actions: veto (any time before final), approve (veto window, stalled, owner), decline (stalled, owner),
// revoke (an accepted one: the role is taken back, logged).
export async function ownerAct(store, app, action, ctx) {
  const open = !FINAL.includes(app.status);
  if (action === 'veto' && open) {
    audit(store, { at: ctx.now, by: ctx.owner, app: app.id, action: 'veto' });
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

// What a dashboard shows of the vote to `viewer`: blind while open (the count, and their own ballot), everything once
// it closed.
export function voteView(app, viewer, ctx) {
  const c = count(app, ctx);
  const closed = app.status !== 'open';
  return {
    closesAt: app.vote.closesAt, firstBallotAt: app.vote.firstBallotAt, extended: app.vote.extended,
    cast: c.cast, quorum: c.quorum, active: c.active, eligible: c.eligible,
    canVote: app.status === 'open' && eligible(app, ctx).has(viewer),
    mine: app.vote.ballots[viewer] ?? null,
    recused: app.vote.recused.includes(viewer),
    ballots: closed ? Object.entries(app.vote.ballots).map(([by, b]) => ({ by, ...b })) : null,
    tally: closed ? app.tally ?? null : null,
  };
}

// The audit lines of an application, ballots' choices hidden while the vote is open.
export function auditView(store, app) {
  const open = app.status === 'open';
  return (store.data.audit ?? []).filter((e) => e.app === app.id).map((e) => (open && e.choice ? { ...e, choice: null, comment: null } : e));
}
