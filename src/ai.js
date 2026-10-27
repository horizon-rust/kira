// Kira's answers with the Claude API: the sources she answers from, and the call itself.
//
// Sources: the FAQ (config.js), and from horizon-rust/horizon's main branch the README and docs/*.md (refreshed daily),
// plus the notes of the latest published releases (hourly). Every GitHub read goes through github.js, so it comes out
// of the shared budget; unchanged files cost nothing (a doc is fetched again only when its blob sha changes, and
// conditional GETs answered 304 aren't counted). A failed refresh keeps the last good copy.
//
// The call: Claude Haiku 5.5 first; Claude Sonnet 5.5 when Haiku says it's unsure, or straight away for a long
// thread. The model's only tool is read_doc (read one doc in full): it can look things up, never act.
import { FAQ, GITHUB, WORK } from './config.js';
import * as kit from './ai-kit.js';

const REPO = `${GITHUB.owner}/${WORK.repo}`;
export const DOCS_EVERY_MS = 24 * 60 * 60_000;
export const RELEASES_EVERY_MS = 60 * 60_000;
const RELEASE_CHARS = 16_000; // newest game releases' notes, up to this much (about the last dozen)
const LAUNCHER_RELEASES = 2;
const DOC_CHARS = 40_000; // one read_doc answer at most
// Model calls per answer: Haiku may look things up twice, then must answer; Sonnet (the expensive one) once.
const ROUNDS = { fast: 3, careful: 2 };
const LONG_CONTEXT = { messages: 4, chars: 3_000 }; // a thread this long goes to the careful model

const decode = (blob) => (blob?.content ? Buffer.from(blob.content, blob.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8') : null);
const isGame = (r) => /^v\d/.test(r.tag_name);
const isLauncher = (r) => /^launcher[@-]v?\d/.test(r.tag_name);

export function makeSources({ gh, faq = FAQ, log = console.error }) {
  const docs = new Map(); // 'docs/x.md' → { sha, text, summary }
  let readme = null;
  let releases = [];
  const at = { docs: 0, releases: 0 };

  async function refreshDocs() {
    const list = await gh.get(`/repos/${REPO}/contents/docs?ref=main`);
    if (!Array.isArray(list)) throw new Error('docs: no listing');
    const files = list.filter((f) => f.type === 'file' && /\.md$/i.test(f.name));
    for (const f of files) {
      if (docs.get(f.path)?.sha === f.sha) continue;
      const text = decode(await gh.get(`/repos/${REPO}/git/blobs/${f.sha}`, { cache: false }));
      if (text != null) docs.set(f.path, { sha: f.sha, text, summary: kit.docSummary(f.path, text) });
    }
    for (const name of [...docs.keys()]) if (!files.some((f) => f.path === name)) docs.delete(name);
    readme = decode(await gh.get(`/repos/${REPO}/readme?ref=main`)) ?? readme;
  }

  async function refreshReleases() {
    const list = (await gh.get(`/repos/${REPO}/releases?per_page=100`)) ?? [];
    const published = list.filter((r) => !r.draft && !r.prerelease && r.published_at)
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
  }

  // Refreshes what is stale; false when nothing could ever be loaded. A call during a refresh waits for it (right after
  // a deploy the first questions arrive while the sources are still loading). `force` retries what never loaded, even
  // inside the retry delay of a failed refresh.
  let inflight = null;
  async function load(now, force) {
    if (now - at.docs >= DOCS_EVERY_MS || (force && !readme)) {
      at.docs = now;
      await refreshDocs().catch((e) => { at.docs = now - DOCS_EVERY_MS + 15 * 60_000; log('ai sources: docs', e.message); });
    }
    if (now - at.releases >= RELEASES_EVERY_MS || (force && !releases.length)) {
      at.releases = now;
      await refreshReleases().catch((e) => { at.releases = now - RELEASES_EVERY_MS + 5 * 60_000; log('ai sources: releases', e.message); });
    }
    return ready();
  }
  async function refresh(now = Date.now(), { force = false } = {}) {
    if (inflight) await inflight.catch(() => {});
    const p = load(now, force).finally(() => { if (inflight === p) inflight = null; });
    inflight = p;
    return p;
  }
  const ready = () => !!readme && releases.length > 0;

  return {
    refresh,
    ready,
    names: () => [...docs.keys()].sort(),
    text: () => kit.sourcesBlock({
      faq,
      readme,
      knownIssues: docs.get('docs/known-issues.md')?.text ?? null,
      releases,
      docs: [...docs.keys()].sort().map((k) => docs.get(k).summary),
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

// `client`: an Anthropic client (or a fake with messages.create). answer() never throws for a model problem: it
// returns status 'pass' with the reason, so the member always hears back.
export function makeAnswerer({ client, sources, models = kit.MODELS }) {
  // One model's attempt; what it costs is added to `spent` as it goes, so a failure halfway still counts.
  async function ask(model, turn, spent) {
    const careful = model === models.careful;
    // The rules are the system prompt; the sources are the user turn's first block, cached for an hour (answers come
    // minutes to hours apart); the question comes after the breakpoint.
    const system = kit.RULES;
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
    const turn = kit.userTurn(question);
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
