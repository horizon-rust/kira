// Applications for 🛡️ Mod, 🤝 Support and 🌌 Horizon Team, sent with the website's form (playhorizon.dev/apply)
// and decided on the staff dashboards: Mod and Support on /staff/mod, Team on /staff/team. The member opens the form
// with a one-time link /apply DMs them (src/staff-auth.js, purpose 'apply'); granting the role and the DMs are the
// Discord side's (src/staff-hooks.js, docs/staff-api.md). No Discord and no network here: `deps` brings them.
import { randomBytes } from 'node:crypto';
import * as auth from './staff-auth.js';
import { APPLY_ROLES, DECLINE_COOLDOWN_DAYS } from './staff-hooks.js';
import { newVote, voteView, auditView, FINAL } from './application-votes.js';

export const RETENTION_DAYS = 90;
// Where an application lives (its link), and the dashboards that show it: Support ones also on the Team's, whose members
// vote on them too.
export const DASHBOARD_OF = { mod: 'mod', support: 'mod', team: 'team' };
export const SHOWN_ON = { mod: ['mod'], support: ['mod', 'team'], team: ['team'] };
export const ROLE_NAMES = { mod: '🛡️ Mod', support: '🤝 Support', team: '🌌 Horizon Team' };
const refuse = (message) => Object.assign(new Error(message), { expose: true });

// The form, per role: { id, label, max, required, short? }. The website shows what peek returns.
const COMMON = [
  { id: 'why', label: 'Why do you want this role?', max: 1500, required: true },
  { id: 'experience', label: 'What have you done that prepares you for it (here, other communities, projects)?', max: 1500, required: true },
  { id: 'hours', label: 'About how many hours a week can you give?', max: 40, required: true, short: true },
  { id: 'timezone', label: 'Your timezone', max: 60, required: true, short: true },
  { id: 'languages', label: 'The languages you speak', max: 120, required: false, short: true },
];
const BY_ROLE = {
  mod: [{ id: 'situation', label: 'Two members are arguing in #horizon-chat and it is getting personal. What do you do?', max: 1500, required: true }],
  support: [{ id: 'situation', label: 'A player says Horizon crashes at start. How do you help them?', max: 1500, required: true }],
  team: [{ id: 'work', label: 'What would you work on in Horizon, and what have you already done (pull requests, issues)?', max: 1500, required: true }],
};
export const questions = (role) => [...COMMON, ...BY_ROLE[role], { id: 'other', label: 'Anything else?', max: 1000, required: false }];

// deps: { hasRole(userId, role) → bool, site: 'https://playhorizon.dev' }
export function canApply(store, userId, role, hasRole, now = Date.now()) {
  if (!APPLY_ROLES.includes(role)) return { ok: false, why: 'role' };
  if (hasRole) return { ok: false, why: 'has-role' };
  const mine = Object.values(store.data.applications).filter((a) => a.user === userId && a.role === role);
  if (mine.some((a) => !FINAL.includes(a.status))) return { ok: false, why: 'open' };
  const until = Math.max(0, ...mine.filter((a) => a.status === 'declined').map((a) => a.decidedAt + DECLINE_COOLDOWN_DAYS * auth.DAY));
  if (until > now) return { ok: false, why: 'cooldown', retryAt: until };
  return { ok: true };
}

export function issueApplyLink(store, userId, role, hasRole, site, now = Date.now()) {
  const can = canApply(store, userId, role, hasRole, now);
  if (!can.ok) return can;
  const { token, expiresAt } = auth.issueLink(store, { user: userId, purpose: 'apply', role }, now);
  return { ok: true, url: `${site}/apply#${token}`, expiresAt };
}

// The answers, checked against the role's form: trimmed, capped, required ones present. Throws a refusal.
export function cleanAnswers(role, raw) {
  const out = {};
  for (const q of questions(role)) {
    const v = String(raw?.[q.id] ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
    if (q.required && !v) throw refuse(`Please answer: ${q.label}`);
    if ([...v].length > q.max) throw refuse(`At most ${q.max} characters for: ${q.label}`);
    if (v) out[q.id] = q.short ? v.replace(/\s+/g, ' ') : v;
  }
  return out;
}

// Records an application sent with a link. `contributor`: what GitHub says about the member (see submit's caller).
export function submit(store, { token, answers, name, contributor = null, hasRole }, now = Date.now()) {
  const link = auth.peekLink(store, token, 'apply', now);
  if (!link) throw refuse('This link is unknown, used or expired. Ask Kira for a new one with /apply.');
  const can = canApply(store, link.user, link.role, hasRole, now);
  if (!can.ok) throw refuse({ 'has-role': 'You already have this role.', open: 'You already have an application open for this role.', cooldown: 'You can apply again later.' }[can.why] ?? 'Applications are closed.');
  const clean = cleanAnswers(link.role, answers);
  if (!auth.useLink(store, token, 'apply', now)) throw refuse('This link was just used.');
  const id = randomBytes(6).toString('hex');
  const app = { id, user: link.user, name: String(name ?? '').slice(0, 64), role: link.role, answers: clean, contributor, submittedAt: now, status: 'open', vote: newVote(now), decidedBy: null, decidedAt: null, result: null };
  store.update((d) => { d.applications[id] = app; });
  return app;
}

// Applications older than RETENTION_DAYS after their decision keep only what the cooldown needs.
export function sweep(store, now = Date.now()) {
  const old = Object.values(store.data.applications).filter((a) => FINAL.includes(a.status) && a.decidedAt < now - RETENTION_DAYS * auth.DAY && a.answers);
  if (!old.length) return 0;
  store.update((d) => {
    const ids = new Set(old.map((a) => a.id));
    for (const a of old) d.applications[a.id] = { id: a.id, user: a.user, role: a.role, status: a.status, decidedAt: a.decidedAt };
    // The audit log keeps every entry, but a ballot's comment goes with the answers (the privacy page says so).
    for (const e of d.audit ?? []) if (ids.has(e.app) && 'comment' in e) delete e.comment;
  });
  return old.length;
}

const contributes = (a) => (a.contributor?.verified ? a.contributor.merged ?? 0 : 0);
// A dashboard's applications for `viewer`: not final first (verified contributors with merged pull requests first, most
// merged first, then oldest first), then final ones, newest decision first. ctx: application-votes.js's.
export function list(store, dashboard, viewer, ctx) {
  sweep(store, ctx.now);
  const mine = Object.values(store.data.applications).filter((a) => SHOWN_ON[a.role].includes(dashboard) && a.answers);
  const open = mine.filter((a) => !FINAL.includes(a.status)).sort((a, b) => contributes(b) - contributes(a) || a.submittedAt - b.submittedAt);
  const done = mine.filter((a) => FINAL.includes(a.status)).sort((a, b) => b.decidedAt - a.decidedAt);
  return [...open, ...done].map(({ vote, ...a }) => ({
    ...a, questions: questions(a.role).map(({ id, label }) => ({ id, label })), githubManual: a.role === 'team',
    vote: voteView({ ...a, vote }, viewer, ctx), audit: auditView(store, a), owner: viewer === ctx.owner,
  }));
}
