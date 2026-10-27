// Bug reports read by the model before they're filed (KIRA_AI_BUGS, src/features/github.js + src/features/ai.js):
// the duplicate check against open issues, the reporter's yes or no, the drafted title, the version and OS copied
// from the report, one ask for what's missing. A fake model and a fake GitHub; no Discord connection, no network.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-ai-bugs-')), 'state.json');
process.env.KIRA_AI = 'mentions';
process.env.KIRA_AI_BUGS = '1';
process.env.ANTHROPIC_API_KEY = 'test-key-not-used';
process.env.GITHUB_TOKEN = 'test-token-not-used';
const { AI } = await import('../src/config.js');
const core = await import('../src/core.js');
const ai = await import('../src/features/ai.js');
const github = await import('../src/features/github.js');
const kit = await import('../src/ai-kit.js');

core.client.user = { id: 'kira' };
core.state.channels.horizonbugs = 'bugs';
const logs = [];
core.state.channels.modlog = 'ml';
core.client.channels.cache.set('ml', { send: async (m) => { logs.push(m); return m; } });

const OPEN = { number: 40, title: 'Water renders black on AMD', body: 'Water is black on an RX 7600.', html_url: 'https://github.com/ludovic111/horizon/issues/40', state: 'open' };
let writes = [];
let searches = [];
github._test.setGitHub({
  get: async (p) => {
    if (p.startsWith('/search/issues')) { searches.push(decodeURIComponent(p)); return { items: [OPEN] }; }
    if (p.endsWith('/issues/40')) return OPEN;
    return {}; // labels exist
  },
  write: async (method, path, body) => {
    writes.push({ method, path, body });
    if (path.endsWith('/issues')) return { number: 77, html_url: 'https://github.com/ludovic111/horizon/issues/77' };
    if (path.endsWith('/comments')) return { id: 9001 };
    return {};
  },
});

// The model's raw output for the next report; `asked` keeps what it was shown.
let raw;
const asked = [];
ai._test.set({ reviewer: async (report) => { asked.push(report); return { draft: kit.checkBugDraft(raw, report), cost: 0.0004, model: 'claude-haiku-5-5', input: 900, output: 80 }; } });

let n = 0;
function post(text, { title = 'water is black', files = 0, user = 'u1' } = {}) {
  const said = [];
  const thread = {
    id: `t${++n}`, parentId: 'bugs', name: title, appliedTags: [], ownerId: user,
    parent: { name: 'horizon-bugs', availableTags: [] },
    send: async (m) => { said.push(m.content ?? m); return m; },
  };
  core.client.channels.cache.set(thread.id, thread);
  const starter = { content: text, author: { id: user, username: 'sam' }, member: { displayName: 'Sam' }, attachments: new Map(Array.from({ length: files }, (_, i) => [String(i), { name: `shot${i}.png`, url: `https://cdn.discordapp.com/${i}.png` }])), reactions: { cache: new Map() } };
  return { thread, starter, said };
}
const reply = (thread, content, user = 'u1') => ({ channelId: thread.id, channel: thread, id: `r${++n}`, content, author: { id: user }, attachments: new Map() });
const created = () => writes.filter((w) => w.method === 'POST' && w.path.endsWith('/issues'));
const commented = () => writes.filter((w) => w.path.endsWith('/issues/40/comments'));
const REPORT = 'What I did: opened a world near the ocean\nWhat happened: the water is black\nWhat I expected: blue water\nHorizon 0.2.60 on Windows 11, RX 6700';

beforeEach(() => {
  writes = []; searches = []; asked.length = 0; logs.length = 0;
  core.state.github.created = [];
  ai._test.store.on = true;
  ai._test.store.days = {};
});

test('a new bug: the open issues found for its title are shown to the model; the issue gets its title, the version and OS it copied, the report unchanged, and one ask for what is missing', async () => {
  raw = { title: 'Water renders black near the ocean (0.2.60)', version: 'Horizon 0.2.60', os: 'Windows 11, RX 6700', missing: ['log or screenshot', 'steps'], match: 'none', match_number: 0 };
  const { thread, starter, said } = post(REPORT);
  const entry = await github._test.openIssue(thread, starter);
  assert.equal(entry.number, 77);
  assert.match(searches[0], /repo:ludovic111\/horizon is:issue is:open water OR black/);
  assert.deepEqual(asked[0].candidates.map((c) => c.number), [40]);
  const issue = created()[0].body;
  assert.equal(issue.title, 'Water renders black near the ocean (0.2.60)');
  assert.match(issue.body, /^\*\*Version:\*\* Horizon 0\.2\.60 · \*\*OS:\*\* Windows 11, RX 6700/);
  assert.ok(issue.body.includes('> What happened: the water is black'), 'the report itself, quoted as written');
  assert.match(said[0], /Sent to GitHub as horizon#77/);
  assert.match(said[0], /could you add: a screenshot, a video or the log file, the steps that make it happen\?/);
  assert.equal(said.length, 1, 'asked once, in the same message');
  const day = Object.values(ai._test.store.days)[0];
  assert.equal(day.bug_reviews, 1);
  assert.equal(day.answers, 0);
  assert.equal(logs[0].embeds[0].data.title, '🤖 Kira read a bug report');
});

test('what the report does not say never reaches the issue: an invented version or OS is dropped, a title with an invented number falls back to the post\'s', async () => {
  raw = { title: 'Black water since 0.2.58 on Linux', version: '0.2.58', os: 'Linux', missing: [], match: 'none', match_number: 0 };
  const { thread, starter } = post('What I did: swim\nWhat happened: the water is black\nWhat I expected: blue, on windows');
  await github._test.openIssue(thread, starter);
  const issue = created()[0].body;
  assert.equal(issue.title, 'water is black');
  assert.doesNotMatch(issue.body, /0\.2\.58|\*\*Version/);
});

test('clearly the same bug: the report goes on the open issue as a comment, no new issue, and the post follows that issue', async () => {
  raw = { title: 'Black water', version: 'Horizon 0.2.60', os: 'Windows 11, RX 6700', missing: [], match: 'same', match_number: 40 };
  const { thread, starter, said } = post(REPORT, { files: 1 });
  const entry = await github._test.openIssue(thread, starter);
  assert.equal(entry.number, 40);
  assert.equal(created().length, 0);
  const c = commented()[0].body.body;
  assert.match(c, /^Also reported on Discord by \*\*Sam\*\*/);
  assert.ok(c.includes('> What happened: the water is black') && c.includes('shot0.png') && c.includes('<!-- kira -->'));
  assert.match(said[0], /same bug as horizon#40 · <https:\/\/github.com\/ludovic111\/horizon\/issues\/40>: I added your report there/);
  assert.equal(github._test.store.issues[thread.id].number, 40);
});

test('maybe the same: Kira asks; "no" files a new issue, "yes" adds the report to the open one and keeps what else the reply says', async () => {
  raw = { title: 'Black water', version: '', os: '', missing: [], match: 'maybe', match_number: 40 };
  const a = post(REPORT);
  assert.equal(await github._test.openIssue(a.thread, a.starter), null);
  assert.match(a.said[0], /This looks like horizon#40 .*Water renders black on AMD.*Reply \*\*yes\*\*/s);
  assert.equal(writes.length, 0);
  await github._test.onMessage(reply(a.thread, 'hmm', 'someone-else'));
  await github._test.onMessage(reply(a.thread, 'not sure what you mean'));
  assert.equal(writes.length, 0, 'only the reporter\'s yes or no settles it');
  await github._test.onMessage(reply(a.thread, 'no'));
  assert.equal(created().length, 1);
  assert.doesNotMatch(created()[0].body.body, /might be related/);
  assert.equal(github._test.store.pending[a.thread.id], undefined);

  writes = [];
  const b = post(REPORT);
  await github._test.openIssue(b.thread, b.starter);
  await github._test.onMessage(reply(b.thread, 'oui, and it also happens in the Nether with lava'));
  assert.equal(created().length, 0);
  assert.equal(commented().length, 1);
  assert.equal(github._test.store.issues[b.thread.id].number, 40);
  assert.equal(github._test.store.issues[b.thread.id].followups?.length, 1, 'the rest of the reply goes to the issue');
});

test('maybe the same, and no answer: filed as new after the wait, naming the possible duplicate', async () => {
  raw = { title: 'Black water', version: '', os: '', missing: [], match: 'maybe', match_number: 40 };
  const { thread, starter } = post(REPORT);
  await github._test.openIssue(thread, starter);
  await github._test.tick(Date.now() + 60_000);
  assert.equal(created().length, 0);
  await github._test.tick(Date.now() + AI.pendingMs + 1);
  assert.equal(created().length, 1);
  assert.match(created()[0].body.body, /might be related: #40 \(the reporter didn't say\)/);
});

test('a match the search did not return is ignored', async () => {
  raw = { title: 'Black water', version: '', os: '', missing: [], match: 'same', match_number: 1 };
  const { thread, starter } = post(REPORT);
  await github._test.openIssue(thread, starter);
  assert.equal(created().length, 1);
  assert.equal(commented().length, 0);
});

test('without the model (/kira-ai off, the day\'s budget spent): filed as before, with the post\'s own title', async () => {
  raw = { title: 'Should not be used', version: '', os: '', missing: ['version'], match: 'same', match_number: 40 };
  ai._test.store.on = false;
  let p = post(REPORT);
  await github._test.openIssue(p.thread, p.starter);
  ai._test.store.on = true;
  ai._test.store.days[new Date().toISOString().slice(0, 10)] = { cost_usd: AI.dailyUsd, answers: 0, passed_to_team: 0, models: {} };
  p = post(REPORT);
  await github._test.openIssue(p.thread, p.starter);
  assert.equal(asked.length, 0);
  assert.deepEqual(created().map((w) => w.body.title), ['water is black', 'water is black']);
  assert.equal(commented().length, 0);
});

test('ideas and a mod\'s /issue are never read by the model', async () => {
  raw = { title: 'x', version: '', os: '', missing: [], match: 'none', match_number: 0 };
  const { thread, starter } = post(REPORT);
  await github._test.openIssue(thread, starter, { manual: true, target: { repo: 'horizon', kind: 'bug' } });
  assert.equal(asked.length, 0);
});
