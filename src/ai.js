// Kira's answers with the Claude API: the sources she answers from, and the call itself.
//
// Sources: the FAQ and server guide, and Horizon main's README, docs/*.md and docs/modding/src/**/*.md (daily),
// plus the notes of the latest published releases (hourly). They are read through github.js's makePublicGitHub (the
// GitHub App, else no token; never Ludovic's token); unchanged files cost nothing (a doc is fetched again only when its
// blob sha changes, and conditional GETs answered 304 aren't counted). A failed refresh keeps the last good copy, and
// every good copy is saved to `file` (data/ai-sources.json on the volume): after a restart during a GitHub outage or a
// held-back hour, Kira answers from it. A failure is logged once, until that part loads again.
//
// The call: Claude Haiku 5.5 first; Claude Sonnet 5.5 when Haiku says it's unsure, or straight away for a long
// thread. The model's only tool is read_doc (read one doc in full): it can look things up, never act.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { FAQ, FAQ_MORE, GITHUB, WORK, RULES } from './config.js';
import { serverGuideText } from './texts.js';
import * as kit from './ai-kit.js';
import * as batchKit from './batch-kit.js';
import * as imageKit from './image-kit.js';

const REPO = `${GITHUB.owner}/${WORK.repo}`;
export const DOCS_EVERY_MS = 24 * 60 * 60_000;
export const RELEASES_EVERY_MS = 60 * 60_000;
const RELEASE_CHARS = 16_000; // newest game releases' notes, up to this much (about the last dozen)
const LAUNCHER_RELEASES = 2;
const DOC_CHARS = 40_000; // one read_doc answer at most
const MAX_DOCS = 512;
const MAX_DOC_BYTES = 1_000_000;
const MAX_DOCS_BYTES = 8_000_000;
const MODDING = 'docs/modding/src/';
const docUrl = (name) => `https://github.com/${REPO}/blob/main/${name}`;
const docPath = (name) => typeof name === 'string'
  && (/^docs\/[^/]+\.md$/i.test(name) || (name.startsWith(MODDING) && /\.md$/i.test(name)))
  && name.split('/').every((p) => /^[\w.-]+$/.test(p) && p !== '.' && p !== '..');
// Model calls per answer: Haiku may look things up twice, then must answer; Sonnet (the expensive one) once.
const ROUNDS = { fast: 3, careful: 2 };
const LONG_CONTEXT = { messages: 4, chars: 3_000 }; // a thread this long goes to the careful model

const decode = (blob) => (blob?.content ? Buffer.from(blob.content, blob.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8') : null);
const isGame = (r) => /^v\d/.test(r.tag_name) || /^nightly(?:-|$)/.test(r.tag_name);
const isLauncher = (r) => /^launcher[@-]v?\d/.test(r.tag_name);

export function makeSources({ gh, faq = [...FAQ, ...FAQ_MORE], guide = serverGuideText(), file = null, log = console.error, info = console.log }) {
  const docs = new Map(); // repo-relative chapter path → { sha, text, summary }
  const pending = new Map(); // bounded staging only; failed refreshes never expose these as knowledge
  let readme = null;
  let releases = [];
  const at = { docs: 0, releases: 0 };
  const failing = { docs: false, releases: false }; // logged once per failure streak

  // The last good copy on disk: { at, docs: [{ path, sha, text }], readme, releases }. Summaries are made again.
  if (file) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      for (const d of saved.docs ?? []) if (typeof d?.path === 'string' && docPath(d.path) && d.sha && typeof d.text === 'string') docs.set(d.path, { sha: d.sha, text: d.text, summary: kit.docSummary(d.path, d.text) });
      readme = typeof saved.readme === 'string' ? saved.readme : null;
      releases = Array.isArray(saved.releases) ? saved.releases.filter((r) => r?.name && typeof r.body === 'string') : [];
      at.docs = Number(saved.at?.docs) || 0;
      at.releases = Number(saved.at?.releases) || 0;
      info(`ai sources: from ${file}: ${docs.size} docs, ${readme ? 'the README' : 'no README'}, ${releases.length} releases (saved ${new Date(Number(saved.savedAt) || 0).toISOString()})`);
    } catch (e) {
      if (e.code !== 'ENOENT') log('ai sources: saved copy not read', e.message);
    }
  }
  function persist(now) {
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const data = { savedAt: now, at, readme, releases, docs: [...docs].map(([path, d]) => ({ path, sha: d.sha, text: d.text })) };
      writeFileSync(file + '.tmp', JSON.stringify(data));
      renameSync(file + '.tmp', file);
    } catch (e) {
      log('ai sources: not saved', e.message);
    }
  }
  function failed(part, e) {
    if (!failing[part]) log(`ai sources: ${part}`, e.message, ready() ? '(answering from the last good copy; logged once until it loads again)' : '(nothing loaded yet; logged once until it loads)');
    failing[part] = true;
  }
  function loaded(part, what) {
    info(`ai sources: ${part} loaded${failing[part] ? ' again' : ''}: ${what}`);
    failing[part] = false;
  }

  async function refreshDocs() {
    const list = await gh.get(`/repos/${REPO}/contents/docs?ref=main`);
    if (!Array.isArray(list)) throw new Error('docs: no listing');
    const files = list.filter((f) => f.type === 'file' && docPath(f.path));
    const modding = list.find((f) => f.type === 'dir' && f.path === 'docs/modding');
    if (modding) {
      // One bounded subtree request, not a walk through all repository directories.
      const tree = await gh.get(`/repos/${REPO}/git/trees/${modding.sha}?recursive=1`);
      if (!Array.isArray(tree?.tree) || tree.truncated) throw new Error('docs: incomplete modding tree');
      for (const f of tree.tree) {
        const path = `docs/modding/${f.path}`;
        if (f.type === 'blob' && docPath(path)) files.push({ ...f, path });
      }
    }
    if (files.length > MAX_DOCS) throw new Error(`docs: over ${MAX_DOCS} chapters`);
    for (const [name, d] of pending) if (!files.some((f) => f.path === name && f.sha === d.sha)) pending.delete(name);
    // Commit a complete snapshot only. A failed late blob must not replace working chapters,
    // or delete a chapter from the on-disk last-good copy when releases refresh successfully.
    const next = new Map();
    let bytes = 0;
    for (const f of files) {
      if (f.size > MAX_DOC_BYTES) throw new Error(`docs: ${f.path} too large`);
      let doc = docs.get(f.path)?.sha === f.sha ? docs.get(f.path) : pending.get(f.path);
      if (doc?.sha !== f.sha) {
        const text = decode(await gh.get(`/repos/${REPO}/git/blobs/${f.sha}`, { cache: false }));
        if (text == null) throw new Error(`docs: missing blob ${f.path}`);
        doc = { sha: f.sha, text, summary: kit.docSummary(f.path, text) };
      }
      const size = Buffer.byteLength(doc.text);
      if (size > MAX_DOC_BYTES || (bytes += size) > MAX_DOCS_BYTES) throw new Error('docs: content size limit');
      pending.set(f.path, doc);
      next.set(f.path, doc);
    }
    const nextReadme = decode(await gh.get(`/repos/${REPO}/readme?ref=main`));
    if (nextReadme == null) throw new Error('docs: missing README');
    docs.clear();
    for (const [name, doc] of next) docs.set(name, doc);
    pending.clear();
    readme = nextReadme;
    return `${docs.size} docs${readme ? ' and the README' : ''}`;
  }

  async function refreshReleases() {
    const list = (await gh.get(`/repos/${REPO}/releases?per_page=100`)) ?? [];
    // The Nightly is Horizon's release since 2026-10-28: its pre-releases count, the old Alpha ones don't.
    const published = list.filter((r) => !r.draft && (!r.prerelease || /^nightly(?:-|$)/.test(r.tag_name)) && r.published_at)
      .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
    const out = [];
    let size = 0;
    for (const r of published.filter(isGame)) {
      const body = kit.releaseNotes(r.body);
      if (size + body.length > RELEASE_CHARS && out.length) break;
      size += body.length;
      out.push({ name: `${r.name || r.tag_name} (${r.tag_name})`, body });
    }
    for (const r of published.filter(isLauncher).slice(0, LAUNCHER_RELEASES)) out.push({ name: `Launcher: ${r.name || r.tag_name} (${r.tag_name})`, body: kit.releaseNotes(r.body) });
    if (out.length) releases = out;
    return `${releases.length} releases`;
  }

  // Refreshes what is stale; false when nothing could ever be loaded. A call during a refresh waits for it (right after
  // a deploy the first questions arrive while the sources are still loading). `force` retries what never loaded, even
  // inside the retry delay of a failed refresh.
  let inflight = null;
  async function load(now, force) {
    let changed = false;
    if (now - at.docs >= DOCS_EVERY_MS || (force && !readme)) {
      at.docs = now;
      await refreshDocs().then((what) => { changed = true; loaded('docs', what); }, (e) => { at.docs = now - DOCS_EVERY_MS + 15 * 60_000; failed('docs', e); });
    }
    if (now - at.releases >= RELEASES_EVERY_MS || (force && !releases.length)) {
      at.releases = now;
      const before = JSON.stringify(releases);
      await refreshReleases().then((what) => {
        if (JSON.stringify(releases) !== before) changed = true;
        if (failing.releases || before === '[]') loaded('releases', what); // the first load and a recovery, not every hour
      },(e) => { at.releases = now - RELEASES_EVERY_MS + 5 * 60_000; failed('releases', e); });
    }
    if (changed) persist(now);
    return ready();
  }
  async function refresh(now = Date.now(), { force = false } = {}) {
    if (inflight) await inflight.catch(() => {});
    const p = load(now, force).finally(() => { if (inflight === p) inflight = null; });
    inflight = p;
    return p;
  }
  // Ready once anything was ever loaded (here or from the saved copy); the FAQ and the server guide are always there.
  const ready = () => !!readme || releases.length > 0 || docs.size > 0;

  // Local retrieval over the same last-good chapters used by read_doc. Distinct query
  // words select an actual paragraph, not just the chapter's often generic introduction.
  function searchDocs(query) {
    const terms = kit.searchTerms(query, 24).filter((term) => !/^(how|what|why|where|which|who|whom|whose|do|i|me|use|using)$/.test(term)).slice(0, 12);
    if (!terms.length) return [];
    const words = (text) => new Set(text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []);
    const frequency = new Map(terms.map((term) => [term, 0]));
    for (const doc of docs.values()) {
      const tokens = words(doc.text);
      for (const term of terms) if (tokens.has(term)) frequency.set(term, frequency.get(term) + 1);
    }
    // Rare words distinguish the specific SDK check from generic download/build guidance.
    const weight = new Map(terms.map((term) => [term, Math.log(1 + docs.size / (1 + frequency.get(term)))]));
    const matches = (text) => {
      const tokens = words(text);
      return terms.reduce((n, term) => n + (tokens.has(term) ? weight.get(term) : 0), 0);
    };
    const hits = [];
    for (const [name, doc] of docs) {
      let excerpt = '';
      let best = 0;
      for (const para of doc.text.split(/\n\s*\n/)) {
        if (/^#{1,6}\s+[^\n]+$/.test(para.trim())) continue; // headings locate a chapter, but don't answer it
        for (let start = 0; start < para.length; start += 800) {
          const window = para.slice(start, start + 1000);
          const score = matches(window);
          if (score > best) { best = score; excerpt = window.trim(); }
        }
      }
      if (best) hits.push({ name, url: docUrl(name), title: doc.summary.title, excerpt, score: 3 * best + matches(doc.summary.title) });
    }
    return hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 3);
  }

  return {
    refresh,
    ready,
    searchDocs,
    // GitHub's webhook said it changed (a push to main, a release): the next question reloads that part.
    stale(part) { if (part in at) at[part] = 0; },
    names: () => [...docs.keys()].sort(),
    text: () => kit.sourcesBlock({
      faq,
      guide,
      readme,
      knownIssues: docs.get('docs/known-issues.md')?.text ?? null,
      releases,
      docs: [...docs.keys()].sort().map((k) => ({ ...docs.get(k).summary, url: docUrl(k) })),
    }),
    readDoc(name) {
      const text = name === 'README.md' ? readme : docs.get(name)?.text;
      if (text == null) return `No doc called ${name}.`;
      return text.length > DOC_CHARS ? `${text.slice(0, DOC_CHARS)}\n\n[… cut at ${DOC_CHARS} characters]` : text;
    },
  };
}

const readDocTool = (names) => ({
  name: 'read_doc',
  description: "Read one of Horizon's docs in full (the docs index in the sources lists them). Read-only.",
  strict: true,
  input_schema: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', enum: names.length ? names : ['README.md'] } } },
});

// `client`: an Anthropic client (or a fake with messages.create); `rules`: the system prompt (game chat has its own,
// src/game-kit.js). answer() never throws for a model problem: it
// returns status 'pass' with the reason, so the member always hears back.
export function makeAnswerer({ client, sources, models = kit.MODELS, rules = kit.RULES }) {
  // One model's attempt; what it costs is added to `spent` as it goes, so a failure halfway still counts.
  async function ask(model, turn, spent) {
    const careful = model === models.careful;
    // The rules are the system prompt; the sources are the user turn's first block, cached for an hour (answers come
    // minutes to hours apart); the question comes after the breakpoint.
    const system = rules;
    const tools = [readDocTool(sources.names())];
    const messages = [{ role: 'user', content: [{ type: 'text', text: sources.text(), cache_control: { type: 'ephemeral', ttl: '1h' } }, { type: 'text', text: turn }] }];
    const read = new Set();
    for (let round = 0, rounds = careful ? ROUNDS.careful : ROUNDS.fast; round < rounds; round++) {
      const r = await client.messages.create({
        model, max_tokens: 8000, system, tools, messages,
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: kit.REPLY_SCHEMA } },
      });
      const u = r.usage ?? {};
      spent.cost += kit.costOf(model, u);
      spent.input += u.input_tokens ?? 0;
      spent.output += u.output_tokens ?? 0;
      spent.cacheRead += u.cache_read_input_tokens ?? 0;
      spent.cacheWrite += u.cache_creation_input_tokens ?? 0;
      if (r.stop_reason === 'tool_use') {
        const calls = r.content.filter((b) => b.type === 'tool_use');
        messages.push({ role: 'assistant', content: r.content });
        messages.push({
          role: 'user',
          content: calls.map((c) => {
            const name = String(c.input?.name);
            if (c.name !== 'read_doc') return { type: 'tool_result', tool_use_id: c.id, content: `No tool called ${c.name}.`, is_error: true };
            if (read.has(name)) return { type: 'tool_result', tool_use_id: c.id, content: `${name} is already above.` };
            read.add(name);
            spent.lookups.push(name);
            return { type: 'tool_result', tool_use_id: c.id, content: sources.readDoc(name) };
          }),
        });
        continue;
      }
      if (r.stop_reason !== 'end_turn') return { status: 'pass', reason: `stop: ${r.stop_reason}` };
      try {
        const out = JSON.parse(r.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
        if (!['answer', 'pass', 'unsure', 'ignore'].includes(out.status) || typeof out.reply !== 'string') throw new Error('bad shape');
        return { status: out.status, reply: out.reply, language: out.language };
      } catch (e) {
        return { status: 'pass', reason: `unreadable answer: ${e.message}` };
      }
    }
    return { status: 'pass', reason: 'too many lookups' };
  }

  // { author, channel, text, context: [{ author, text }] } → { status: 'answer' | 'pass', reply, reason?, models,
  // cost, input, output, cacheRead, cacheWrite, lookups }.
  return async function answer(question) {
    const context = question.context ?? [];
    const long = context.length >= LONG_CONTEXT.messages || context.reduce((n, m) => n + String(m.text ?? '').length, 0) >= LONG_CONTEXT.chars;
    const found = sources.searchDocs(question.text);
    const retrieved = found.length ? `<sources>\n${found.map((d) => `<source name="${d.name}" url="${d.url}" status="development documentation, not release evidence">\n${kit.asData(d.excerpt)}\n</source>`).join('\n')}\n</sources>\n\n` : '';
    const turn = retrieved + kit.userTurn(question);
    const spent = { models: [], cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, lookups: [] };
    const run = (model) => {
      spent.models.push(model);
      return ask(model, turn, spent).catch((e) => ({ status: 'pass', reason: `API: ${e.status ?? ''} ${e.message}`.slice(0, 200) }));
    };
    let r = await run(long ? models.careful : models.fast);
    if (r.status === 'unsure' && !long) r = await run(models.careful);
    if (r.status === 'unsure') r = { status: 'pass', reason: 'unsure' }; // an unsure draft is never posted
    const result = { status: r.status, reason: r.reason, language: r.language, ...spent };
    const checked = r.reply != null ? kit.checkReply(r.reply) : { ok: false, reason: r.reason ?? 'no reply' };
    if (r.status === 'ignore') return { ...result, reply: '' }; // chatter or a jailbreak: no reply, no hand-off
    if (r.status === 'answer' && checked.ok) return { ...result, reply: checked.text };
    if (r.status === 'answer') return { ...result, status: 'pass', reason: `filtered: ${checked.reason}`, reply: kit.PASSED };
    return { ...result, status: 'pass', reply: checked.ok ? checked.text : kit.PASSED };
  };
}

// A bug report read before it's filed (#horizon-bugs, /report): one call to the fast model, no tools. Returns
// { draft, cost, model, input, output, reason? }: draft is checkBugDraft's (null when the model gave nothing usable,
// and the report is then filed as it is). Throws only for an API error.
export function makeBugReviewer({ client, model = kit.MODELS.fast }) {
  return async function review(report) {
    const r = await client.messages.create({
      model, max_tokens: 2000, system: kit.BUG_RULES,
      messages: [{ role: 'user', content: kit.bugTurn(report) }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: kit.BUG_SCHEMA } },
    });
    const u = r.usage ?? {};
    const spent = { cost: kit.costOf(model, u), model, input: u.input_tokens ?? 0, output: u.output_tokens ?? 0 };
    if (r.stop_reason !== 'end_turn') return { ...spent, draft: null, reason: `stop: ${r.stop_reason}` };
    try {
      const out = JSON.parse(r.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
      return { ...spent, draft: kit.checkBugDraft(out, report) };
    } catch (e) {
      return { ...spent, draft: null, reason: `unreadable answer: ${e.message}` };
    }
  };
}

// Moderation in every language (src/features/moderation.js): one call to the fast model for a batch of messages, no
// tools. The rules (the same for every call) are the user turn's first block, cached; the batch comes after the
// breakpoint. A breakpoint on the system prompt is never read back on this account (measured again 2026-10-28: 0 of
// the rules' ~1,500 tokens read; as the first user block, all of them). Returns { results, cost, model, input, output,
// cacheRead, cacheWrite, reason? }: results is checkModeration's (null when the output can't be trusted, and then
// nothing happens). Throws only for an API error.
export function makeModerator({ client, model = kit.MODELS.fast, rules = RULES }) {
  const block = { type: 'text', text: kit.modRules(rules), cache_control: { type: 'ephemeral' } };
  return async function moderate(batch) {
    const r = await client.messages.create({
      model, max_tokens: 600 + 500 * batch.length, system: kit.MOD_SYSTEM,
      messages: [{ role: 'user', content: [block, { type: 'text', text: kit.modTurn(batch) }] }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: kit.MOD_SCHEMA } },
    });
    const u = r.usage ?? {};
    const spent = {
      cost: kit.costOf(model, u), model, input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0,
    };
    if (r.stop_reason !== 'end_turn') return { ...spent, results: null, reason: `stop: ${r.stop_reason}` };
    try {
      const checked = kit.checkModeration(JSON.parse(r.content.filter((b) => b.type === 'text').map((b) => b.text).join('')), batch.length, rules.length);
      return checked.ok ? { ...spent, results: checked.results } : { ...spent, results: null, reason: checked.reason };
    } catch (e) {
      return { ...spent, results: null, reason: `unreadable answer: ${e.message}` };
    }
  };
}

// Batch moderation (src/features/batchmod.js): one call to the fast model per window of one channel, no tools. The
// rules are the cached first block of the user turn (as for makeModerator), the window comes after the breakpoint.
// `win`: { channel, topic, context, fresh, users } (batch-kit's windowTurn), `exempt(userId)`: staff and the Team.
// Returns { incidents, dropped, cost, model, input, output, cacheRead, cacheWrite, reason? }: incidents is
// checkIncidents' (null when the output can't be trusted, and then nothing happens). Throws only for an API error.
export function makeBatchModerator({ client, model = kit.MODELS.fast, rules = RULES, cfg }) {
  const block = { type: 'text', text: batchKit.rulesBlock(rules), cache_control: { type: 'ephemeral' } };
  const schema = batchKit.SCHEMA(rules);
  return async function moderateWindow(win, { exempt = () => false } = {}) {
    const turn = batchKit.windowTurn(win, cfg);
    const r = await client.messages.create({
      model, max_tokens: 3000, system: batchKit.SYSTEM,
      messages: [{ role: 'user', content: [block, { type: 'text', text: turn.text }] }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    });
    const u = r.usage ?? {};
    const spent = {
      cost: kit.costOf(model, u), model, input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0,
    };
    if (r.stop_reason !== 'end_turn') return { ...spent, incidents: null, reason: `stop: ${r.stop_reason}` };
    try {
      const checked = batchKit.checkIncidents(JSON.parse(r.content.filter((b) => b.type === 'text').map((b) => b.text).join('')), turn, { rules, exempt });
      return checked.ok ? { ...spent, incidents: checked.incidents, dropped: checked.dropped } : { ...spent, incidents: null, reason: checked.reason };
    } catch (e) {
      return { ...spent, incidents: null, reason: `unreadable answer: ${e.message}` };
    }
  };
}

// The image lane of batch moderation (src/features/batchmod.js, rules in src/image-kit.js): one call to the fast model
// per image, the picture already downscaled (Discord's media proxy) and sent as base64, then the message's text as data.
// The instructions are the first block with an explicit 1-hour breakpoint, so every call reads them from the cache:
// this account caches each prompt for an hour on its own, and without the marker the whole prompt, unique image
// included, was written at 2x every time and never read (measured 2026-11-08: $0.00034 → $0.00014 a typical image).
// `img`: { data (base64), mediaType, name, text, channel }. Returns { verdict, cost, model, input, output, cacheRead,
// cacheWrite, reason? }: verdict is checkVerdict's (null when the output can't be trusted, and then nothing happens).
// Throws only for an API error. Nothing of the image is kept here.
export function makeImageClassifier({ client, model = kit.MODELS.fast }) {
  const block = { type: 'text', text: imageKit.INSTRUCTIONS, cache_control: { type: 'ephemeral', ttl: '1h' } };
  return async function classify(img) {
    const r = await client.messages.create({
      model, max_tokens: 1500, system: imageKit.SYSTEM, // ~90 tokens out; 300 cut 2% of answers mid-thought
      messages: [{ role: 'user', content: [
        block,
        { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } },
        { type: 'text', text: imageKit.messageBlock(img) },
      ] }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: imageKit.SCHEMA } },
    });
    const u = r.usage ?? {};
    const spent = {
      cost: kit.costOf(model, u), model, input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0,
    };
    if (r.stop_reason !== 'end_turn') return { ...spent, verdict: null, reason: `stop: ${r.stop_reason}` };
    try {
      const checked = imageKit.checkVerdict(JSON.parse(r.content.filter((b) => b.type === 'text').map((b) => b.text).join('')));
      return checked.ok ? { ...spent, verdict: checked } : { ...spent, verdict: null, reason: checked.reason };
    } catch (e) {
      return { ...spent, verdict: null, reason: `unreadable answer: ${e.message}` };
    }
  };
}
