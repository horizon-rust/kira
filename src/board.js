// Horizon's kanban board, as data: no Discord, no network. Five columns (Backlog, To do, In progress,
// Review, Done); every open issue, every open pull request that fixes no open issue, and what was closed or
// merged in the last days is a card. GitHub's state places each card (the auto rules below); a maintainer
// can move a card by hand, and that move holds until GitHub's state of the card changes.
//
// src/features/workboard.js fetches GitHub, calls build(), renders the snapshot in #work-board and writes
// it to data/board.json. Anything else (an MCP server for contributors' agents, scripts) reads that JSON or
// calls these functions; the snapshot's shape is described by SNAPSHOT_VERSION and the comments below.

export const SNAPSHOT_VERSION = 1;

export const COLUMNS = [
  { key: 'backlog', name: 'Backlog', emoji: '🗃️', color: 0x7f8c8d, about: 'Not planned yet: parked by a maintainer, or labelled "backlog" on GitHub.' },
  { key: 'todo', name: 'To do', emoji: '📥', color: 0x5aa9ff, about: 'Open and free: nobody is on it. Pick one and /claim it.' },
  { key: 'progress', name: 'In progress', emoji: '🔨', color: 0xf2a33a, about: 'Claimed, assigned, a branch, or a draft pull request.' },
  { key: 'review', name: 'Review', emoji: '👀', color: 0x9b7bff, about: 'A pull request is ready for review.' },
  { key: 'done', name: 'Done', emoji: '✅', color: 0x2ecc71, about: 'Closed or merged in the last days.' },
];
const KEYS = COLUMNS.map((c) => c.key);

// "To do", "todo", "in progress", "review"… → the column key (null if it isn't one).
export function columnKey(text) {
  const t = String(text ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return COLUMNS.find((c) => c.key === t || c.name.toLowerCase().replace(/[^a-z]/g, '') === t)?.key ?? null;
}

// Card ids: "issue#40", "pr#56". `ref` may be one, a number, "#40" or "pr 56".
export const cardId = (kind, number) => `${kind}#${number}`;
export function parseRef(ref) {
  const m = String(ref).trim().toLowerCase().match(/^(?:(issue|pr|pull)\s*)?#?\s*(\d+)$/);
  if (!m) return null;
  return { kind: m[1] === 'pr' || m[1] === 'pull' ? 'pr' : m[1] ? 'issue' : null, number: Number(m[2]) };
}

// The issues a pull request closes when merged: "Fixes #12", "closes #3, resolves #4".
export function fixesIn(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(/\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\s*:?\s+((?:#\d+(?:\s*(?:,|and)\s*)?)+)/gi)) {
    for (const n of m[1].matchAll(/#(\d+)/g)) out.add(Number(n[1]));
  }
  return [...out].sort((a, b) => a - b);
}

// The issue a branch is for, from its name: GitHub's "Create a branch" (`40-water-renders-black`), `issue-40`,
// `issues/40`, `fix/40-…`. Other numbers (`launcher-0.1.2`, `v2026…`) don't count.
export function branchIssue(name) {
  const m = String(name).match(/(?:^|\/)(?:(?:issues?|gh)[-_/]?)?(\d+)(?:-[a-z]|$)/i);
  return m && !/\d\.\d/.test(name) ? Number(m[1]) : null;
}

// Where GitHub's state puts a card.
// Issue: an open pull request that fixes it and is ready for review → review; a draft one, a claim, an
// assignee or a branch → progress; the "backlog" label → backlog; else → todo. Closed → done.
// Pull request of its own (it fixes no open issue): draft → progress, ready → review; merged → done.
export function autoColumn(card) {
  if (card.state !== 'open') return 'done';
  if (card.kind === 'pr') return card.draft ? 'progress' : 'review';
  if (card.prs.some((p) => p.state === 'open' && !p.draft)) return 'review';
  if (card.prs.some((p) => p.state === 'open') || card.claim || card.assignees.length || card.branches.length) return 'progress';
  if (card.labels.some((l) => l.toLowerCase() === 'backlog')) return 'backlog';
  return 'todo';
}

// Builds the board from what GitHub said.
// gh: {
//   repo: 'owner/name',
//   issues: open issues and those closed in the last `doneDays` (REST objects, pull requests filtered out),
//   pulls: open pull requests and those merged in the last `doneDays`, each { number, title, html_url, user,
//          draft, state, merged_at, updated_at, body, labels, assignees, status } (status: a short text),
//   branches: branch names,
// }
// work: { claims: { [issueNumber]: { user, who, since, activity } }, moves: { [cardId]: { column, by, at, auto } } }
// person(login) → { login, discordId, name } (the Discord side when it is linked; else just the login).
// hide: labels whose issues and pull requests stay off the board (Kira's own test issues).
// Returns { snapshot, stale }: `stale` are ids of manual moves GitHub has overtaken (the caller drops them).
export function build(gh, work, { now = Date.now(), doneDays = 7, expireDays = 14, hide = ['test'], person = (login) => ({ login, discordId: null, name: login }) } = {}) {
  const since = now - doneDays * 86_400_000;
  const recent = (t) => t && Date.parse(t) >= since;
  const pulls = gh.pulls.map((p) => ({
    number: p.number, title: p.title, url: p.html_url, author: p.user?.login ?? null, draft: !!p.draft,
    state: p.merged_at ? 'merged' : p.state, mergedAt: p.merged_at ?? null, updatedAt: p.updated_at ?? null,
    status: p.status ?? null, fixes: fixesIn(`${p.title}\n${p.body ?? ''}`),
    labels: (p.labels ?? []).map((l) => l.name), assignees: (p.assignees ?? []).map((a) => a.login),
  })).filter((p) => (p.state === 'open' || (p.state === 'merged' && recent(p.mergedAt))) && !p.labels.some((l) => hide.includes(l)));
  const issues = gh.issues.filter((i) => !i.pull_request && (i.state === 'open' || recent(i.closed_at)) && !(i.labels ?? []).some((l) => hide.includes(typeof l === 'string' ? l : l.name)));
  const shownIssues = new Set(issues.map((i) => i.number));
  const branchesOf = new Map();
  for (const b of gh.branches ?? []) {
    const n = branchIssue(b);
    if (n) branchesOf.set(n, [...(branchesOf.get(n) ?? []), b]);
  }

  const cards = [];
  for (const i of issues) {
    const c = work.claims?.[i.number];
    const prs = pulls.filter((p) => p.fixes.includes(i.number) && (i.state === 'open' ? p.state === 'open' : true));
    cards.push({
      id: cardId('issue', i.number), kind: 'issue', number: i.number, title: i.title, url: i.html_url,
      state: i.state, closedAs: i.state === 'closed' ? (i.state_reason ?? 'completed') : null,
      author: i.user?.login ?? null, labels: (i.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)),
      assignees: (i.assignees ?? []).map((a) => a.login),
      claim: c ? { discordId: c.user, name: c.who, since: new Date(c.since).toISOString(), lapses: new Date(Math.max(c.since, c.activity ?? 0) + expireDays * 86_400_000).toISOString() } : null,
      branches: i.state === 'open' ? branchesOf.get(i.number) ?? [] : [],
      prs: prs.map((p) => ({ number: p.number, url: p.url, state: p.state, draft: p.draft, status: p.status })),
      updatedAt: i.state === 'closed' ? i.closed_at : i.updated_at,
    });
  }
  // A pull request is its own card unless it fixes an issue that is on the board.
  for (const p of pulls) {
    if (p.fixes.some((n) => shownIssues.has(n))) continue;
    cards.push({
      id: cardId('pr', p.number), kind: 'pr', number: p.number, title: p.title, url: p.url,
      state: p.state, closedAs: null, author: p.author, labels: p.labels, assignees: p.assignees, claim: null,
      branches: [], prs: [], draft: p.draft, status: p.status, fixes: p.fixes, updatedAt: p.mergedAt ?? p.updatedAt,
    });
  }

  const stale = [];
  for (const card of cards) {
    // Who works on it: the Discord claim first, then GitHub's assignees, then the pull request authors.
    const logins = [...new Set([...card.assignees, ...(card.kind === 'pr' ? [card.author] : pulls.filter((p) => card.prs.some((x) => x.number === p.number)).map((p) => p.author))].filter(Boolean))];
    card.people = [
      ...(card.claim ? [{ login: null, discordId: card.claim.discordId, name: card.claim.name, claimed: true }] : []),
      ...logins.map((l) => ({ ...person(l), claimed: false })).filter((p) => !card.claim || p.discordId !== card.claim.discordId),
    ];
    card.auto = autoColumn(card);
    const move = work.moves?.[card.id];
    if (move && move.auto !== card.auto) stale.push(card.id);
    card.moved = move && move.auto === card.auto ? { column: move.column, by: move.by, at: new Date(move.at).toISOString() } : null;
    card.column = card.moved?.column ?? card.auto;
  }
  for (const id of Object.keys(work.moves ?? {})) if (!cards.some((c) => c.id === id)) stale.push(id);

  const order = (a, b) => (a.column === 'done' ? Date.parse(b.updatedAt ?? 0) - Date.parse(a.updatedAt ?? 0) : a.number - b.number);
  return {
    snapshot: {
      version: SNAPSHOT_VERSION, repo: gh.repo, generatedAt: new Date(now).toISOString(), doneDays,
      columns: COLUMNS.map((col) => ({ key: col.key, name: col.name, cards: cards.filter((c) => c.column === col.key).sort(order) })),
    },
    stale,
  };
}

// ── Reading a snapshot ───────────────────────────────────────────────────────

export const cards = (snapshot) => snapshot.columns.flatMap((c) => c.cards);

// A card by ref ("#40", 40, "pr#56"). A bare number finds the issue first, then the pull request.
export function find(snapshot, ref) {
  const r = typeof ref === 'object' ? ref : parseRef(ref);
  if (!r) return null;
  const all = cards(snapshot);
  return (r.kind ? all.find((c) => c.kind === r.kind && c.number === r.number)
    : all.find((c) => c.kind === 'issue' && c.number === r.number) ?? all.find((c) => c.kind === 'pr' && c.number === r.number)) ?? null;
}

// Cards matching { column, person (a login, a Discord id or a name), kind }.
export function list(snapshot, { column, person, kind } = {}) {
  const who = person && String(person).toLowerCase();
  return cards(snapshot).filter((c) => (!column || c.column === column) && (!kind || c.kind === kind)
    && (!who || c.people.some((p) => [p.login, p.discordId, p.name].some((x) => x && String(x).toLowerCase() === who))));
}

// ── Changing it by hand ──────────────────────────────────────────────────────
// These change `work` (Kira's state) only; the caller saves it, tells GitHub if needed, and rebuilds.

// Moves a card to `column` by hand. Moving it back to where GitHub puts it clears the manual move.
export function move(work, snapshot, ref, column, by, now = Date.now()) {
  const key = columnKey(column);
  if (!key) throw new Error(`"${column}" isn't a column: ${COLUMNS.map((c) => c.name).join(', ')}.`);
  const card = find(snapshot, ref);
  if (!card) throw new Error(`#${parseRef(ref)?.number ?? ref} isn't on the board.`);
  work.moves ??= {};
  if (key === card.auto) delete work.moves[card.id];
  else work.moves[card.id] = { column: key, by, at: now, auto: card.auto };
  return { card, from: card.column, to: key };
}

// Assigns an issue to a Discord member (a claim): { user, who }. Returns the claim.
export function assign(work, number, { user, who }, now = Date.now()) {
  work.claims ??= {};
  const mine = work.claims[number];
  if (mine && mine.user !== user) throw new Error(`#${number} is already claimed by ${mine.who}.`);
  return (work.claims[number] = mine ? { ...mine, activity: now } : { user, who, since: now, activity: 0, reminded: 0 });
}

export function unassign(work, number) {
  const c = work.claims?.[number];
  if (c) delete work.claims[number];
  return c ?? null;
}
