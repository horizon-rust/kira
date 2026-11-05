// The Team dashboard's own data, in staff.json: the decisions log, the Team kanban (coordination that is not a GitHub
// issue), and the roadmap's Team layer: Team-only items, and Team notes on the public items. Team-only items never
// leave this file by themselves: publishing one gives the roadmap.toml entry for a person (or an agent) to propose
// in a pull request to the public repo; once the website's roadmap.json lists its id, it is marked public.
// No Discord and no network here.
import { randomBytes } from 'node:crypto';

const refuse = (message) => Object.assign(new Error(message), { expose: true });
const newId = (prefix) => `${prefix}-${randomBytes(4).toString('hex')}`;
export const CARD_COLUMNS = ['todo', 'doing', 'done'];
export const STATUSES = ['now', 'next', 'later', 'help-wanted', 'shipped']; // roadmap.toml's
export const DONE_SHOWN_DAYS = 30;
const DAY = 86_400_000;

const text = (v, max, label, required = false) => {
  const s = String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (required && !s) throw refuse(`${label} is required.`);
  if ([...s].length > max) throw refuse(`${label}: at most ${max} characters.`);
  return s;
};
const line = (v, max, label, required) => text(v, max, label, required).replace(/\s+/g, ' ');
// Links: https on github.com or playhorizon.dev, "#123" (an issue or pull request of horizon), or a path in the
// horizon repo (as roadmap.toml's links).
export function link(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^#\d{1,7}$/.test(s)) return s;
  if ((/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)+$/.test(s) || /^[A-Z][A-Za-z0-9_-]*\.md$/.test(s)) && !s.includes('..') && s.length <= 200) return s;
  let u;
  try { u = new URL(s); } catch { throw refuse(`Not a link: ${s.slice(0, 80)}`); }
  if (u.protocol !== 'https:' || !['github.com', 'playhorizon.dev', 'www.playhorizon.dev'].includes(u.hostname)) throw refuse('Links: https on github.com or playhorizon.dev, or #123.');
  return u.href.slice(0, 300);
}
const userId = (v) => { const s = String(v ?? '').trim(); if (s && !/^\d{5,25}$/.test(s)) throw refuse('Unknown member.'); return s || null; };

// ── Decisions: append-only; an edit keeps the previous version, a withdrawn decision stays listed ─────────────

export function addDecision(store, { by, title, body, link: l, item }, now = Date.now()) {
  const d = { id: newId('d'), at: now, by, title: line(title, 200, 'The decision', true), body: text(body, 4000, 'The details'), link: link(l), item: line(item, 80, 'The roadmap item'), status: 'active', history: [] };
  store.update((data) => { data.decisions.push(d); });
  return d;
}

export function editDecision(store, { id, by, title, body, link: l, item, withdraw = false }, now = Date.now()) {
  const d = store.data.decisions.find((x) => x.id === id);
  if (!d) throw refuse('No such decision.');
  const next = withdraw ? {} : { title: line(title, 200, 'The decision', true), body: text(body, 4000, 'The details'), link: link(l), item: line(item, 80, 'The roadmap item') };
  store.update(() => {
    d.history.push({ at: now, by, title: d.title, body: d.body, link: d.link, item: d.item, status: d.status });
    Object.assign(d, next, withdraw ? { status: 'withdrawn' } : {});
  });
  return d;
}

export const decisions = (store) => [...store.data.decisions].sort((a, b) => b.at - a.at);

// ── The Team kanban ───────────────────────────────────────────────────────────

export function saveCard(store, { id, by, title, note, column, owner, link: l }, now = Date.now()) {
  const fields = { title: line(title, 200, 'The title', true), note: text(note, 2000, 'The note'), owner: userId(owner), link: link(l) };
  const col = column ?? 'todo';
  if (!CARD_COLUMNS.includes(col)) throw refuse('Column: todo, doing or done.');
  return store.update((data) => {
    if (id) {
      const c = data.cards[id];
      if (!c) throw refuse('No such card.');
      return Object.assign(c, fields, { column: col, updatedAt: now, by });
    }
    const c = { id: newId('c'), ...fields, column: col, createdBy: by, createdAt: now, updatedAt: now, by };
    data.cards[c.id] = c;
    return c;
  });
}

export function moveCard(store, { id, column, by }, now = Date.now()) {
  if (!CARD_COLUMNS.includes(column)) throw refuse('Column: todo, doing or done.');
  return store.update((data) => {
    const c = data.cards[id];
    if (!c) throw refuse('No such card.');
    return Object.assign(c, { column, updatedAt: now, by });
  });
}

export function deleteCard(store, { id }) {
  if (!store.data.cards[id]) throw refuse('No such card.');
  store.update((data) => { delete data.cards[id]; });
}

// Cards by column; Done keeps the last DONE_SHOWN_DAYS days.
export function cards(store, now = Date.now()) {
  const out = Object.fromEntries(CARD_COLUMNS.map((c) => [c, []]));
  for (const c of Object.values(store.data.cards)) {
    if (c.column === 'done' && c.updatedAt < now - DONE_SHOWN_DAYS * DAY) continue;
    out[c.column].push(c);
  }
  for (const list of Object.values(out)) list.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

// ── The roadmap's Team layer ──────────────────────────────────────────────────

const ROADMAP_ID = /^[a-z0-9][a-z0-9-]{1,60}$/;

export function saveItem(store, { id, by, title, area, status, owner, note, plain, dev, links = [] }, { publicIds = new Set() } = {}, now = Date.now()) {
  const fields = {
    title: line(title, 120, 'The title', true), area: line(area, 40, 'The area', true), status: STATUSES.includes(status) ? status : refuse_('Status: now, next, later, help-wanted or shipped.'),
    owner: userId(owner), note: text(note, 2000, 'The note'), plain: text(plain, 240, 'The players\' text'), dev: text(dev, 1500, 'The contributors\' text'),
    links: (Array.isArray(links) ? links : String(links).split(/[\s,]+/)).filter(Boolean).slice(0, 12).map(link),
  };
  return store.update((data) => {
    if (id && data.roadmap.items[id]) return Object.assign(data.roadmap.items[id], fields, { updatedAt: now, by });
    const slug = String(id || fields.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    if (!ROADMAP_ID.test(slug)) throw refuse('Give the item an id: a-z, 0-9 and dashes.');
    if (data.roadmap.items[slug] || publicIds.has(slug)) throw refuse(`The id "${slug}" is taken.`);
    const item = { id: slug, ...fields, visibility: 'team', createdBy: by, createdAt: now, updatedAt: now, by, publishRequested: null };
    data.roadmap.items[slug] = item;
    return item;
  });
}
function refuse_(message) { throw refuse(message); }

export function deleteItem(store, { id }) {
  const it = store.data.roadmap.items[id];
  if (!it) throw refuse('No such Team item.');
  if (it.visibility === 'public') throw refuse('This item is public: remove it from roadmap.toml in a pull request instead.');
  store.update((data) => { delete data.roadmap.items[id]; });
}

// A Team note on a public item: owner, priority, note.
export function saveNote(store, { id, by, owner, priority, note }, { publicIds }, now = Date.now()) {
  if (!publicIds.has(id)) throw refuse('No such public item.');
  const fields = { owner: userId(owner), priority: ['', 'high', 'normal', 'low'].includes(priority ?? '') ? priority ?? '' : refuse_('Priority: high, normal or low.'), note: text(note, 2000, 'The note') };
  return store.update((data) => (data.roadmap.notes[id] = { ...fields, updatedAt: now, by }));
}

const toml = (s) => JSON.stringify(String(s)); // a TOML basic string is a JSON string for these characters
// The roadmap.toml entry for a Team item, for a pull request to the public repo. Asks for the public texts first.
export function publishSnippet(store, { id, by }, now = Date.now()) {
  const it = store.data.roadmap.items[id];
  if (!it) throw refuse('No such Team item.');
  if (!it.plain || !it.dev) throw refuse('Write the players\' text and the contributors\' text first: they are what the public sees.');
  const lines = ['[[item]]', `id = ${toml(it.id)}`, `title = ${toml(it.title)}`, `status = ${toml(it.status)}`, `area = ${toml(it.area)}`, `plain = ${toml(it.plain)}`, `dev = ${toml(it.dev)}`];
  if (it.links.length) lines.push(`links = [${it.links.map(toml).join(', ')}]`);
  store.update(() => { it.publishRequested = { at: now, by }; });
  return { snippet: lines.join('\n'), file: 'roadmap/roadmap.toml', edit: 'https://github.com/horizon-rust/horizon/edit/main/roadmap/roadmap.toml', then: 'python3 tools/roadmap.py build' };
}

// The public roadmap (the website's roadmap.json) with the Team layer, and the Team-only items. A Team item whose id
// is now public is marked public (its pull request merged).
export function roadmapView(store, publicRoadmap, now = Date.now()) {
  const pub = publicRoadmap?.items ?? [];
  const ids = new Set(pub.map((i) => i.id));
  const merged = Object.values(store.data.roadmap.items).filter((i) => i.visibility === 'team' && ids.has(i.id));
  if (merged.length) store.update(() => { for (const i of merged) Object.assign(i, { visibility: 'public', publishedAt: now }); });
  return {
    areas: publicRoadmap?.areas ?? [],
    public: pub.map((i) => ({ id: i.id, title: i.title, area: i.area, status: i.status, links: i.links ?? [], focus: !!i.focus, team: store.data.roadmap.notes[i.id] ?? null })),
    team: Object.values(store.data.roadmap.items).filter((i) => i.visibility === 'team').sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || b.updatedAt - a.updatedAt),
    available: !!publicRoadmap,
  };
}
