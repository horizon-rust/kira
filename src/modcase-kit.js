// Mod cases, quarantine, appeals and mod-mail statuses: the rules, with no Discord and no network
// (src/features/modcases.js does the talking). Asked by the mods (pointofpressure, bunchy7s, dezer-x) and Ludovic on
// 2026-11-01, after a day of disputed bans:
//
// - every timeout, timeout removal, quarantine, ban, unban and kick, by a human or by Kira, is one numbered case
//   (#123) in one format in #mod-actions: the user and id, the action, the length, who did it, the reason, the evidence;
// - most bans become a quarantine (a role that hides every channel but #appeal); real bans stay for the worst cases;
// - an appeal is a form (fixed questions, no back-and-forth), decided by a mod other than the one who acted; one
//   appeal per action, another one 7 days after a decision; an open appeal pings the mods after 24 hours;
// - each mod-mail thread is Open (the member wrote last), Waiting (a mod answered) or Closed.
//
// `mc` is state.modcases: { next, cases, appeals, tokens, quarantined, modmail }.
import { randomBytes, createHash } from 'node:crypto';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
export const APPEAL = {
  cooldownMs: 7 * DAY,     // a second appeal of the same action, 7 days after the first one's decision
  windowMs: 30 * DAY,      // an action can be appealed for 30 days
  remindMs: DAY,           // an open appeal older than this pings the mods in its thread, then again every day
  linkMs: 30 * DAY,        // a web appeal link (banned users) works for 30 days, also to read the outcome
  max: { what: 1000, why: 1000, more: 1000, ign: 16, banText: 300, evidence: 1000, note: 500 },
};
// The form's questions (a Discord modal, and the web page for banned users): fixed, answered once.
export const QUESTIONS = [
  { id: 'what', label: 'What happened?', max: APPEAL.max.what, required: true },
  { id: 'why', label: 'Why should it be lifted?', max: APPEAL.max.why, required: true },
  { id: 'more', label: 'Anything else the mods should know?', max: APPEAL.max.more, required: false },
];
export const MODMAIL = { staleMs: 12 * HOUR };
// The official Minecraft server's ops decide its appeals (Ludovic, 2026-10-30: luzW, his own account, and bunchy7s).
export const MC_OPS = ['622720516779802630', '1372615310946992188'];

// Audit log action types (Discord's AuditLogEvent).
const AUDIT = { kick: 20, ban: 22, unban: 23, memberUpdate: 24, roleUpdate: 25 };
export const ACTIONS = {
  timeout: { label: 'Timeout', emoji: '⏳', color: 0xffb020, appealable: true, lengthy: true },
  untimeout: { label: 'Timeout removed', emoji: '🔈', color: 0x2ecc71 },
  quarantine: { label: 'Quarantine', emoji: '🔒', color: 0xe67e22, appealable: true, lengthy: true },
  unquarantine: { label: 'Quarantine lifted', emoji: '🔓', color: 0x2ecc71 },
  ban: { label: 'Ban', emoji: '🔨', color: 0xff4d4d, appealable: true, lengthy: true },
  unban: { label: 'Unban', emoji: '🔓', color: 0x2ecc71 },
  kick: { label: 'Kick', emoji: '👢', color: 0xff7a45 },
  mcban: { label: 'Minecraft ban', emoji: '⛏️', color: 0xff4d4d, appealable: true },
};
export const KIRA = 'kira';

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const fail = (message) => Object.assign(new Error(message), { expose: true });
const text = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);

export function blank(mc = {}) {
  mc.next ??= 1;
  mc.cases ??= {};
  mc.appeals ??= {};
  mc.tokens ??= {};
  mc.quarantined ??= {};
  mc.modmail ??= {};
  return mc;
}

// ── Cases ───────────────────────────────────────────────────────────────────

// A discord.js audit log entry → { action, userId, by, reason, ms, until } (null: not a mod action we log).
// A timeout is a member update whose communication_disabled_until gets a future date; clearing it is a removal.
// A quarantine is the Quarantined role (`quarantineRole`, its id) added; taking it away lifts it.
export function auditAction(entry, { quarantineRole = null, now = Date.now() } = {}) {
  const base = { userId: entry.targetId ?? entry.target?.id ?? null, by: entry.executorId ?? entry.executor?.id ?? null, reason: entry.reason?.trim() || null };
  if (!base.userId) return null;
  if (entry.action === AUDIT.kick) return { ...base, action: 'kick' };
  if (entry.action === AUDIT.ban) return { ...base, action: 'ban' };
  if (entry.action === AUDIT.unban) return { ...base, action: 'unban' };
  const changes = entry.changes ?? [];
  if (entry.action === AUDIT.roleUpdate && quarantineRole) {
    const has = (key) => changes.some((c) => c.key === key && (c.new ?? []).some((r) => r.id === quarantineRole));
    if (has('$add')) return { ...base, action: 'quarantine' };
    if (has('$remove')) return { ...base, action: 'unquarantine' };
    return null;
  }
  if (entry.action !== AUDIT.memberUpdate) return null;
  const change = changes.find((c) => c.key === 'communication_disabled_until');
  if (!change) return null;
  const at = entry.createdTimestamp ?? now;
  const until = change.new ? Date.parse(change.new) : NaN;
  if (Number.isFinite(until) && until > at) return { ...base, action: 'timeout', until, ms: Math.round((until - at) / 1000) * 1000 };
  if (change.old && !change.new) return { ...base, action: 'untimeout' };
  return null;
}

// What Kira itself is about to do (a command a mod ran, an automatic action, an appeal's decision): the audit entry
// that follows has Kira as its executor, so this says who really acted, why, and with what evidence. Matched by
// user and action, for a minute.
export function expectations() {
  const list = [];
  const live = (now) => { for (let i = list.length - 1; i >= 0; i--) if (list[i].expires <= now) list.splice(i, 1); };
  return {
    add(userId, action, meta = {}, now = Date.now()) { live(now); const e = { userId, action, meta, expires: now + MIN }; list.push(e); return e; },
    take(userId, action, now = Date.now()) {
      live(now);
      const i = list.findIndex((e) => e.userId === userId && e.action === action);
      return i < 0 ? null : list.splice(i, 1)[0].meta;
    },
    drop(e) { const i = list.indexOf(e); if (i >= 0) list.splice(i, 1); },
    get size() { return list.length; },
  };
}

// A new numbered case. `by`: a Discord id, KIRA for Kira's automatic actions, null when nobody is known.
export function openCase(mc, { action, userId, tag = null, by, reason = null, ms = null, until = null, evidence = null, ign = null, banText = null, about = null }, now = Date.now()) {
  blank(mc);
  const n = mc.next++;
  const c = { n, action, userId, tag, by: by ?? null, reason: reason || null, ms, until, at: now, evidence: evidence ?? null, appeals: [] };
  if (ign) c.ign = ign;
  if (banText) c.banText = banText;
  if (about) c.about = about; // the case an appeal's decision came from
  mc.cases[n] = c;
  return c;
}

const stamp = (ms) => `<t:${Math.floor(ms / 1000)}:f>`;
export const human = (ms) => {
  const units = [['w', 6048e5], ['d', 864e5], ['h', 36e5], ['min', 6e4], ['s', 1e3]];
  const out = [];
  for (const [u, v] of units) if (ms >= v) { out.push(`${Math.floor(ms / v)} ${u}`); ms %= v; }
  return out.slice(0, 2).join(' ') || '0 s';
};
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const isLink = (s) => /^https?:\/\/[^\s<>]+$/i.test(String(s ?? '').trim());
export const who = (by) => (by === KIRA ? 'Kira (automatic)' : by ? `<@${by}>` : 'unknown');

function lengthText(c) {
  if (c.action === 'timeout' && c.ms) return `${human(c.ms)}${c.until ? ` (until ${stamp(c.until)})` : ''}`;
  if (c.action === 'quarantine' || c.action === 'ban') return c.until ? `until ${stamp(c.until)}, then Kira lifts it` : 'until a mod lifts it';
  return null;
}

// The case's #mod-actions embed, as plain data: { title, color, description, fields }.
export function caseView(c) {
  const a = ACTIONS[c.action] ?? { label: c.action, emoji: '•', color: 0x888888 };
  const length = lengthText(c);
  const fields = [
    { name: 'Action', value: a.label, inline: true },
    ...(length ? [{ name: 'Length', value: length, inline: true }] : []),
    { name: 'By', value: who(c.by), inline: true },
    { name: 'Reason', value: clip(c.reason || 'none given', 1000) },
  ];
  if (c.action === 'mcban') {
    fields.push({ name: 'In-game name', value: c.ign ? `\`${c.ign}\`` : 'not given', inline: true });
    fields.push({ name: 'Ban reason (banned-players.json)', value: c.banText ? clip(c.banText, 500) : 'Kira can\'t read the server\'s files: an op adds it with **Add evidence**' });
  }
  const ev = c.evidence;
  const evidence = !ev ? (c.by && c.by !== KIRA ? `none yet: <@${c.by}> can add it with **Add evidence**` : 'none')
    : [ev.url ? `[${ev.label || 'log entry'}](${ev.url})` : '', ev.text ? clip(ev.text, 900) : ''].filter(Boolean).join('\n') + (ev.by && ev.by !== c.by ? ` (added by <@${ev.by}>)` : '');
  if (a.appealable || c.evidence || c.action === 'kick') fields.push({ name: 'Evidence', value: evidence || 'none' });
  if (c.about) fields.push({ name: 'From', value: `the appeal of case #${c.about}` });
  if (c.appealNote) fields.push({ name: 'Appeal', value: clip(c.appealNote, 1000) });
  return {
    title: `${a.emoji} Case #${c.n} · ${a.label}`,
    color: a.color,
    description: `<@${c.userId}>${c.tag ? ` (${c.tag})` : ''} · \`${c.userId}\`${c.ign ? ` · in game \`${c.ign}\`` : ''}`,
    fields,
  };
}

// Only the mod who acted adds evidence to a human action (and an op, on a Minecraft case).
export function evidenceRefusal(c, userId) {
  if (!c) return 'No such case.';
  if (c.action === 'mcban') return MC_OPS.includes(userId) ? null : 'Only the server\'s ops add evidence to a Minecraft case.';
  if (!c.by || c.by === KIRA) return 'Kira\'s own actions carry their evidence already.';
  return c.by === userId ? null : `Only <@${c.by}>, who acted, adds evidence to case #${c.n}.`;
}

export function addEvidence(c, { value, by }, now = Date.now()) {
  const v = text(value, APPEAL.max.evidence);
  if (!v) throw fail('Give a link or a few words.');
  if (c.action === 'mcban' && !isLink(v)) { c.banText = v; return c; }
  c.evidence = isLink(v) ? { url: v, label: 'evidence', by, at: now } : { text: v, by, at: now };
  return c;
}

// ── Quarantine ──────────────────────────────────────────────────────────────

// The roles a quarantine takes away (kept to give back): every role but @everyone, the Quarantined role and the
// ones Discord manages (Booster, bots' roles), which can't be removed.
export function rolesToStrip(roles, { everyone, quarantineRole }) {
  return roles.filter((r) => r.id !== everyone && r.id !== quarantineRole && !r.managed).map((r) => r.id);
}

export function quarantineSet(mc, userId, { roles = [], until = null, caseNo = null }, now = Date.now()) {
  blank(mc);
  const old = mc.quarantined[userId];
  mc.quarantined[userId] = { roles: [...new Set([...(old?.roles ?? []), ...roles])], at: old?.at ?? now, until, case: caseNo ?? old?.case ?? null };
  return mc.quarantined[userId];
}

// Quarantines whose length ran out.
export const quarantinesDue = (mc, now = Date.now()) => Object.entries(blank(mc).quarantined).filter(([, q]) => q.until && q.until <= now).map(([userId]) => userId);

// ── Web appeal links (banned users, who can't see the server) ──────────────
// Kira DMs the link before /ban bans; the website's Discord sign-in makes one too. Only the SHA-256 is kept.

export function issueToken(mc, userId, now = Date.now()) {
  blank(mc);
  for (const [h, l] of Object.entries(mc.tokens)) if (l.expiresAt <= now || l.user === userId) delete mc.tokens[h];
  const token = randomBytes(32).toString('base64url');
  mc.tokens[sha(token)] = { user: userId, createdAt: now, expiresAt: now + APPEAL.linkMs };
  return { token, expiresAt: now + APPEAL.linkMs };
}

export function tokenUser(mc, token, now = Date.now()) {
  if (!TOKEN.test(String(token ?? ''))) return null;
  const l = blank(mc).tokens[sha(token)];
  return l && l.expiresAt > now ? l.user : null;
}

// ── Appeals ─────────────────────────────────────────────────────────────────

const appealsOf = (mc, n) => Object.values(mc.appeals).filter((a) => a.case === n);
const live = (c, now) => !c.liftedAt && !c.ended && (!c.until || c.until > now);

// Whether `userId` may appeal case `c` now: { ok } or { ok: false, why, retryAt? }.
export function canAppeal(mc, c, userId, now = Date.now()) {
  if (!c || c.userId !== userId) return { ok: false, why: 'not-yours' };
  if (!ACTIONS[c.action]?.appealable) return { ok: false, why: 'not-appealable' };
  if (!live(c, now)) return { ok: false, why: 'over' };
  if (now - c.at > APPEAL.windowMs) return { ok: false, why: 'too-old' };
  const mine = appealsOf(mc, c.n);
  if (mine.some((a) => a.status !== 'decided')) return { ok: false, why: 'open' };
  const last = Math.max(0, ...mine.map((a) => a.outcome?.at ?? 0));
  if (last && now - last < APPEAL.cooldownMs) return { ok: false, why: 'cooldown', retryAt: last + APPEAL.cooldownMs };
  return { ok: true };
}
export const WHY = {
  'not-yours': 'That case is not yours.',
  'not-appealable': 'Only timeouts, quarantines and bans can be appealed.',
  over: 'That action is over or was lifted already.',
  'too-old': 'That action is more than 30 days old.',
  open: 'Your appeal of it is still open: the mods will decide, and Kira tells you.',
  cooldown: 'It was appealed already: another appeal is possible 7 days after the first decision.',
  none: 'You have nothing to appeal right now.',
};

// The case a member appeals when they press "Open appeal" or run /appeal: their newest live quarantine, timeout or
// ban that can be appealed. Returns { case } or { why, retryAt? }.
export function appealTarget(mc, userId, now = Date.now(), kinds = ['quarantine', 'timeout', 'ban']) {
  const mine = Object.values(blank(mc).cases).filter((c) => c.userId === userId && kinds.includes(c.action) && live(c, now)).sort((x, y) => y.at - x.at);
  for (const c of mine) if (canAppeal(mc, c, userId, now).ok) return { case: c };
  if (!mine.length) return { why: 'none' };
  const r = canAppeal(mc, mine[0], userId, now);
  return { why: r.why, retryAt: r.retryAt };
}

// Submits an appeal; throws an exposed error when it is refused. A Minecraft appeal opens its own case.
export function submitAppeal(mc, { userId, tag = null, caseNo = null, kind = 'discord', answers = {}, ign = null, banText = null, via = 'discord' }, now = Date.now()) {
  blank(mc);
  const a = { what: text(answers.what, APPEAL.max.what), why: text(answers.why, APPEAL.max.why), more: text(answers.more, APPEAL.max.more) };
  if (!a.what || !a.why) throw fail('Say what happened and why it should be lifted.');
  let c;
  if (kind === 'minecraft') {
    const name = text(ign, APPEAL.max.ign);
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw fail('Give your in-game name (3 to 16 letters, digits or _).');
    c = Object.values(mc.cases).find((x) => x.action === 'mcban' && x.userId === userId && x.ign?.toLowerCase() === name.toLowerCase() && live(x, now));
    if (c) {
      const can = canAppeal(mc, c, userId, now);
      if (!can.ok) throw fail(WHY[can.why]);
    } else {
      c = openCase(mc, { action: 'mcban', userId, tag, by: null, reason: 'from the player\'s appeal (Kira doesn\'t know who banned them)', ign: name, banText: text(banText, APPEAL.max.banText) || null }, now);
    }
  } else {
    c = mc.cases[Number(caseNo)];
    const can = canAppeal(mc, c, userId, now);
    if (!can.ok) throw fail(WHY[can.why]);
  }
  const id = `${now.toString(36)}${randomBytes(3).toString('hex')}`;
  const appeal = { id, case: c.n, userId, kind: c.action === 'mcban' ? 'minecraft' : 'discord', via, answers: a, at: now, status: 'open', remindedAt: null };
  mc.appeals[id] = appeal;
  c.appeals.push(id);
  return { appeal, case: c };
}

// Who may decide: a mod (an op, for Minecraft cases), never the one who acted.
export function decideRefusal(c, deciderId, { isMod = false } = {}) {
  if (!c) return 'No such case.';
  if (c.action === 'mcban') {
    if (!MC_OPS.includes(deciderId)) return 'Minecraft appeals are decided by the server\'s ops.';
  } else if (!isMod) return 'Only the mods decide appeals.';
  if (c.by && c.by !== KIRA && c.by === deciderId) return `You acted on case #${c.n}: another mod decides its appeal.`;
  return null;
}

// The buttons a case's appeal gets. Uphold on a quarantine can turn it into a real ban.
export function decisionsFor(c) {
  const out = ['uphold'];
  if (c.action === 'quarantine') out.push('ban');
  if (['timeout', 'quarantine', 'ban', 'mcban'].includes(c.action)) out.push('shorten');
  out.push('lift');
  return out;
}
export const DECISIONS = { uphold: 'upheld', ban: 'upheld and turned into a ban', shorten: 'shortened', lift: 'lifted' };

// Records a decision. `ms` (shorten): the new length, counted from the action. What it means for Discord (a new
// timeout, an unban, the role given back) is the feature's.
export function decide(mc, a, { decision, by, ms = null, note = null }, now = Date.now()) {
  if (a.status === 'decided') throw fail('This appeal was decided already.');
  const c = mc.cases[a.case];
  if (!decisionsFor(c).includes(decision)) throw fail('That decision doesn\'t apply to this case.');
  let until = null;
  if (decision === 'shorten') {
    if (!ms || ms <= 0) throw fail('Give the new length, like 2h or 3d.');
    until = c.at + ms;
    if (until <= now) throw fail(`That ends in the past: case #${c.n} started <t:${Math.floor(c.at / 1000)}:R>. Lift it instead.`);
    if (c.until && until >= c.until) throw fail('That is not shorter than it is now.');
    if (c.action === 'timeout' && until - now > 28 * DAY) throw fail('A timeout lasts 28 days at most.');
  }
  a.status = 'decided';
  a.outcome = { decision, by, at: now, ...(ms ? { ms, until } : {}), ...(note ? { note: text(note, APPEAL.max.note) } : {}) };
  if (decision === 'lift') c.liftedAt = now;
  if (decision === 'shorten') { c.until = until; if (c.action === 'timeout') c.ms = ms; }
  if (decision === 'ban') c.ended = now; // the quarantine ends in a ban: a new case
  c.appealNote = `${DECISIONS[decision]} by <@${by}> <t:${Math.floor(now / 1000)}:R>${until ? `: now until <t:${Math.floor(until / 1000)}:f>` : ''}.`;
  return { case: c, until };
}

// What the person is told.
export function outcomeText(c, a) {
  const what = ACTIONS[c.action].label.toLowerCase();
  const d = a.outcome;
  const note = d.note ? `\nThe mods' note: ${d.note}` : '';
  if (d.decision === 'lift') return `✅ Your appeal of case #${c.n} (${what}) was accepted: it is lifted.${c.action === 'mcban' ? ` An op unbans \`${c.ign}\` on the server.` : ''}${note}`;
  if (d.decision === 'shorten') return `⏱️ Your appeal of case #${c.n} (${what}) was partly accepted: it now ends <t:${Math.floor(d.until / 1000)}:f>.${note}`;
  if (d.decision === 'ban') return `⛔ Your appeal of case #${c.n} (${what}) was refused, and the quarantine became a ban.${note}`;
  return `❌ Your appeal of case #${c.n} (${what}) was refused: it stays. You may appeal again in 7 days.${note}`;
}

// Open appeals older than a day whose thread had no reminder in the last day.
export function dueReminders(mc, now = Date.now()) {
  return Object.values(blank(mc).appeals).filter((a) => a.status === 'open' && now - a.at >= APPEAL.remindMs && now - (a.remindedAt ?? 0) >= APPEAL.remindMs);
}

// The web page's view for a banned user: their bans and Minecraft cases, and their appeals with the outcome.
export function personView(mc, userId, now = Date.now()) {
  blank(mc);
  const cases = Object.values(mc.cases).filter((c) => c.userId === userId && ['ban', 'mcban'].includes(c.action) && now - c.at <= APPEAL.windowMs)
    .sort((x, y) => y.at - x.at)
    .map((c) => {
      const can = canAppeal(mc, c, userId, now);
      return { n: c.n, action: c.action, label: ACTIONS[c.action].label, at: c.at, until: c.until, reason: c.reason, ign: c.ign ?? null, canAppeal: can.ok, why: can.ok ? null : WHY[can.why] };
    });
  const appeals = Object.values(mc.appeals).filter((a) => a.userId === userId).sort((x, y) => y.at - x.at).map((a) => {
    const c = mc.cases[a.case];
    return { id: a.id, case: a.case, label: ACTIONS[c.action].label, at: a.at, status: a.status, outcome: a.outcome ? outcomeText(c, a).replace(/<t:(\d+):[a-zA-Z]>/g, (_, s) => new Date(Number(s) * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC') : null };
  });
  return { cases, appeals, questions: QUESTIONS };
}

// What the Moderation dashboard lists: the newest cases and appeals, with their status. No answers' text.
export function staffView(mc, { limit = 200 } = {}) {
  blank(mc);
  const cases = Object.values(mc.cases).sort((x, y) => y.n - x.n).slice(0, limit).map((c) => {
    const a = mc.appeals[c.appeals.at(-1)];
    return {
      n: c.n, action: c.action, label: ACTIONS[c.action]?.label ?? c.action, userId: c.userId, tag: c.tag, by: c.by, reason: c.reason, ms: c.ms, until: c.until,
      at: c.at, ign: c.ign ?? null, evidence: c.evidence?.url ?? (c.evidence?.text ? 'text' : null), lifted: !!c.liftedAt, url: c.url ?? null,
      appeal: a ? { id: a.id, status: a.status, decision: a.outcome?.decision ?? null, url: a.url ?? null } : null,
    };
  });
  const appeals = Object.values(mc.appeals).sort((x, y) => y.at - x.at).slice(0, limit).map((a) => ({
    id: a.id, case: a.case, label: ACTIONS[mc.cases[a.case]?.action]?.label ?? '?', kind: a.kind, via: a.via, userId: a.userId, at: a.at, status: a.status,
    url: a.url ?? null, decision: a.outcome?.decision ?? null, decidedBy: a.outcome?.by ?? null, decidedAt: a.outcome?.at ?? null,
  }));
  return { cases, appeals };
}

// ── Mod-mail statuses ────────────────────────────────────────────────────────
// Open: the member wrote last (the mods owe an answer). Waiting: a mod answered. Closed: //close or /close.

export const MAIL = { open: { label: 'Open', mark: '🟢' }, waiting: { label: 'Waiting', mark: '🟡' }, closed: { label: 'Closed', mark: '⚪' } };
export const MAIL_MARK = /^(🟢|🟡|⚪)\s*/u;

// The status after a message: 'member' → open, 'mod' → waiting.
export const mailAfter = (current, speaker) => (speaker === 'member' ? 'open' : speaker === 'mod' ? 'waiting' : current ?? 'open');

// "🟢 name": #mod-mail is a text channel's threads, not a forum, so the status leads the thread's name.
export function markedName(name, mark) {
  return `${mark} ${String(name ?? '').replace(MAIL_MARK, '').replace(/^⚖️\s*/u, '')}`.slice(0, 100);
}
export const mailName = (name, status) => markedName(name, MAIL[status]?.mark ?? MAIL.open.mark);
// Appeals live in #mod-mail too: "⚖️ 🟢 Appeal #12 · name" while open, "⚖️ ⚪ …" once decided.
export const appealName = (c, name, status) => `⚖️ ${status === 'decided' ? '⚪' : '🟢'} Appeal · case #${c.n} · ${String(name ?? '').slice(0, 60)}`.slice(0, 100);

export function mailSet(mc, threadId, { status, userId = null }, now = Date.now()) {
  blank(mc);
  const t = (mc.modmail[threadId] ??= { status: null, since: now, userId });
  if (userId) t.userId = userId;
  if (t.status !== status) { t.status = status; t.since = now; }
  if (status === 'closed') t.closedAt = now;
  return t;
}

// Threads Open for more than 12 hours, oldest first.
export function staleMail(mc, now = Date.now()) {
  return Object.entries(blank(mc).modmail).filter(([, t]) => t.status === 'open' && now - t.since > MODMAIL.staleMs)
    .sort(([, x], [, y]) => x.since - y.since).map(([threadId, t]) => ({ threadId, ...t }));
}

// A thread's name may change twice in 10 minutes (Discord): renames come at most every 5 minutes, the last wins.
export function renamer({ gapMs = 5 * MIN, rename, now = () => Date.now(), later = (fn, ms) => setTimeout(fn, ms) }) {
  const last = new Map(), want = new Map(), timers = new Map();
  const run = (id) => {
    timers.delete(id);
    const name = want.get(id);
    want.delete(id);
    last.set(id, now());
    return Promise.resolve(rename(id, name)).catch((e) => console.error('rename', id, e.message));
  };
  return (id, name) => {
    want.set(id, name);
    if (timers.has(id)) return null;
    const wait = (last.get(id) ?? -Infinity) + gapMs - now();
    if (wait <= 0) return run(id);
    const t = later(() => run(id), wait);
    t?.unref?.();
    timers.set(id, t);
    return null;
  };
}

// Forgets closed threads after 30 days, decided appeals' answers after 90 (the case and the outcome stay).
export function prune(mc, now = Date.now()) {
  blank(mc);
  for (const [id, t] of Object.entries(mc.modmail)) if (t.status === 'closed' && now - (t.closedAt ?? t.since) > 30 * DAY) delete mc.modmail[id];
  for (const a of Object.values(mc.appeals)) {
    if (a.status === 'decided' && !a.pruned && now - a.outcome.at > 90 * DAY) { a.answers = {}; a.pruned = true; }
  }
}
