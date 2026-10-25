// X (Twitter) only broadcasts: releases, the weekly summary and the roadmap items the journal flags as shipped
// (`announce`), each once, in at most 240 characters from the entries' `post` or `plain` text and a link. Nothing is
// read from X and nothing is answered there. Off unless X credentials are set; X_DRY_RUN=1 prints instead of posting.
//
// Credentials (OAuth 2.0 user context, the account's own app, scope tweet.write + offline.access):
// X_ACCESS_TOKEN and/or X_REFRESH_TOKEN, X_CLIENT_ID, X_CLIENT_SECRET (confidential clients only). Access tokens last
// two hours: on a 401 Kira refreshes once and keeps the new pair (X rotates the refresh token) in a mode-600 file next
// to the state, which wins over the variables from then on.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { newEntries } from './journal.js';

export const MAX = 240;
const API = 'https://api.x.com/2';

// The entries X gets: releases, weekly summaries, shipped items flagged `announce`.
export const forX = (e) => e.kind === 'release' || e.kind === 'weekly' || (e.kind === 'shipped' && e.announce === true);

const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/@(\w)/g, '@​$1').trim(); // no mentions on X
// `text` cut at a word so that it and `link` fit in MAX characters (a link counts in full: safe whatever X shortens).
function fit(text, link) {
  const room = MAX - (link ? link.length + 1 : 0);
  let body = flat(text);
  if (body.length > room) {
    body = body.slice(0, room - 1);
    const cut = body.lastIndexOf(' ');
    body = `${(cut > room * 0.6 ? body.slice(0, cut) : body).replace(/[\s,;:.–-]+$/, '')}…`;
  }
  return link ? `${body}\n${link}` : body;
}

const safeLink = (u) => (/^https:\/\/(github\.com|playhorizon\.dev)\/\S*$/.test(String(u ?? '')) ? u : null);

// The post for one journal entry, or null if it isn't for X.
export function xText(e, hubUrl) {
  if (!forX(e)) return null;
  if (e.kind === 'release') return fit(`Horizon ${flat(e.tag ?? e.title)} is out${e.plain ? `: ${e.plain}` : '.'}`, safeLink(e.url) ?? hubUrl);
  if (e.kind === 'weekly') return fit(`${flat(e.title)}: ${e.post || e.plain || 'the week in Horizon.'}`, safeLink(e.url) ?? hubUrl);
  return fit(e.post || `Shipped: ${flat(e.title)}. ${e.plain ?? ''}`, safeLink(e.url) ?? (e.item ? `${hubUrl}#${encodeURIComponent(e.item)}` : hubUrl));
}

// What to post from a journal: the new entries for X, oldest first, at most `max`; the rest wait for the next round.
export function toPost(journal, seen, { max = 3 } = {}) {
  const { entries } = newEntries(journal, seen);
  const posts = entries.filter(forX).slice(0, max);
  const skipped = entries.filter((e) => !forX(e)).map((e) => e.id);
  return { posts, done: [...posts.map((e) => e.id), ...skipped] };
}

// The credentials: the file (refreshed ones) over the variables.
export function loadTokens(file, env = process.env) {
  let saved = {};
  try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch { /* none yet */ }
  const t = {
    access: saved.access ?? env.X_ACCESS_TOKEN?.trim() ?? null,
    refresh: saved.refresh ?? env.X_REFRESH_TOKEN?.trim() ?? null,
    clientId: env.X_CLIENT_ID?.trim() || null,
    clientSecret: env.X_CLIENT_SECRET?.trim() || null,
  };
  return t.access || t.refresh ? t : null;
}

// Posts with the user's token; refreshes it once on a 401 (or when there is only a refresh token).
export function makePoster({ tokens, file, dryRun = false, fetchImpl = fetch, log = console.log }) {
  async function refresh() {
    if (!tokens?.refresh || !tokens.clientId) throw new Error('X: the access token expired and there is no refresh token or client id');
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (tokens.clientSecret) headers.Authorization = `Basic ${Buffer.from(`${tokens.clientId}:${tokens.clientSecret}`).toString('base64')}`;
    const res = await fetchImpl(`${API}/oauth2/token`, { method: 'POST', headers, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh, client_id: tokens.clientId }).toString(), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`X token refresh: HTTP ${res.status}`); // never the body: it could echo a token
    const j = await res.json();
    tokens.access = j.access_token;
    tokens.refresh = j.refresh_token ?? tokens.refresh;
    if (file) {
      writeFileSync(file + '.tmp', JSON.stringify({ access: tokens.access, refresh: tokens.refresh, at: new Date().toISOString() }), { mode: 0o600 });
      renameSync(file + '.tmp', file);
    }
  }
  const send = (text) => fetchImpl(`${API}/tweets`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.access}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(15_000) });
  return {
    dryRun,
    async post(text) {
      if (text.length > MAX) throw new Error(`X post over ${MAX} characters`);
      if (dryRun) { log(`x dry-run: ${JSON.stringify(text)}`); return { dryRun: true }; }
      if (!tokens.access) await refresh();
      let res = await send(text);
      if (res.status === 401) { await refresh(); res = await send(text); }
      if (!res.ok) throw new Error(`X post: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      return (await res.json()).data ?? {};
    },
  };
}
