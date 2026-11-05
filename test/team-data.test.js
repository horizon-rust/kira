// The Team dashboard's data (src/team-data.js): decisions, the Team kanban, the roadmap's Team layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStaffStore } from '../src/staff-store.js';
import * as team from '../src/team-data.js';

const T0 = Date.UTC(2026, 9, 30, 12);
const DAY = 86_400_000;
const fresh = () => openStaffStore(join(mkdtempSync(join(tmpdir(), 'kira-team-')), 'staff.json'));
const PUBLIC = { areas: [{ id: 'performance', name: 'Performance' }], items: [{ id: 'smooth-frames', title: 'Steady frames', area: 'performance', status: 'now', links: ['#678'], plain: 'p', dev: 'd' }] };

test('links: github.com and playhorizon.dev over https, #123, repo paths; nothing else', () => {
  assert.equal(team.link('#678'), '#678');
  assert.equal(team.link('docs/benchmark.md'), 'docs/benchmark.md');
  assert.equal(team.link('README.md'), 'README.md');
  assert.equal(team.link('https://github.com/horizon-rust/horizon/pull/1'), 'https://github.com/horizon-rust/horizon/pull/1');
  for (const bad of ['http://github.com/x', 'https://evil.example/x', 'javascript:alert(1)', '../etc/passwd', 'evil.com/x']) assert.throws(() => team.link(bad), /link|Links/, bad);
});

test('decisions: recorded with who and when; edits keep history; withdrawn stays listed', () => {
  const store = fresh();
  assert.throws(() => team.addDecision(store, { by: '1', title: '' }, T0), /required/);
  const d = team.addDecision(store, { by: '1', title: 'Releases ship in batches of 5', body: 'or after 6 hours', link: '#2448', item: 'release-flow' }, T0);
  team.addDecision(store, { by: '2', title: 'Later one' }, T0 + 1);
  assert.deepEqual(team.decisions(store).map((x) => x.title), ['Later one', 'Releases ship in batches of 5']);
  team.editDecision(store, { id: d.id, by: '2', title: 'Releases ship in batches of 5 PRs', body: '', link: '#2448' }, T0 + 2);
  team.editDecision(store, { id: d.id, by: '3', withdraw: true }, T0 + 3);
  const now = store.data.decisions.find((x) => x.id === d.id);
  assert.equal(now.status, 'withdrawn');
  assert.equal(now.title, 'Releases ship in batches of 5 PRs');
  assert.deepEqual(now.history.map((h) => [h.by, h.title, h.status]), [['2', 'Releases ship in batches of 5', 'active'], ['3', 'Releases ship in batches of 5 PRs', 'active']]);
  assert.equal(team.decisions(store).length, 2);
});

test('the Team kanban: add, move, edit, delete; Done shows 30 days', () => {
  const store = fresh();
  const c = team.saveCard(store, { by: '1', title: 'Plan the 0.3 release', owner: '622720516779802630' }, T0);
  assert.equal(c.column, 'todo');
  assert.throws(() => team.saveCard(store, { by: '1', title: 'x', owner: 'bob' }, T0), /Unknown member/);
  assert.throws(() => team.moveCard(store, { id: c.id, column: 'later', by: '1' }, T0), /Column/);
  team.moveCard(store, { id: c.id, column: 'done', by: '2' }, T0);
  assert.equal(team.cards(store, T0 + 29 * DAY).done.length, 1);
  assert.equal(team.cards(store, T0 + 31 * DAY).done.length, 0);
  team.saveCard(store, { id: c.id, by: '1', title: 'Plan 0.3', column: 'doing' }, T0);
  assert.equal(team.cards(store, T0).doing[0].title, 'Plan 0.3');
  team.deleteCard(store, { id: c.id });
  assert.deepEqual(team.cards(store, T0), { todo: [], doing: [], done: [] });
});

test('roadmap: Team-only items, notes on public ones, publishing gives the roadmap.toml entry', () => {
  const store = fresh();
  const publicIds = new Set(['smooth-frames']);
  assert.throws(() => team.saveItem(store, { by: '1', id: 'smooth-frames', title: 'x', area: 'performance', status: 'now' }, { publicIds }, T0), /taken/);
  assert.throws(() => team.saveItem(store, { by: '1', title: 'x', area: 'performance', status: 'soon' }, { publicIds }, T0), /Status/);
  const it = team.saveItem(store, { by: '1', title: 'Hire a second release manager', area: 'platforms', status: 'next', links: '#12 docs/release-flow.md' }, { publicIds }, T0);
  assert.equal(it.id, 'hire-a-second-release-manager');
  assert.equal(it.visibility, 'team');
  assert.deepEqual(it.links, ['#12', 'docs/release-flow.md']);
  assert.throws(() => team.publishSnippet(store, { id: it.id, by: '1' }, T0), /players' text/);
  team.saveItem(store, { id: it.id, by: '1', title: 'A "quoted" title', area: 'platforms', status: 'next', plain: 'Players see this.', dev: 'Contributors see "this".', links: ['#12'] }, { publicIds }, T0);
  const pub = team.publishSnippet(store, { id: it.id, by: '2' }, T0);
  assert.equal(pub.snippet, '[[item]]\nid = "hire-a-second-release-manager"\ntitle = "A \\"quoted\\" title"\nstatus = "next"\narea = "platforms"\nplain = "Players see this."\ndev = "Contributors see \\"this\\"."\nlinks = ["#12"]');
  assert.equal(store.data.roadmap.items[it.id].visibility, 'team');
  assert.equal(store.data.roadmap.items[it.id].publishRequested.by, '2');
  // notes on public items only
  assert.throws(() => team.saveNote(store, { id: it.id, by: '1' }, { publicIds }, T0), /public item/);
  team.saveNote(store, { id: 'smooth-frames', by: '1', owner: '622720516779802630', priority: 'high', note: 'Top for 0.3' }, { publicIds }, T0);
  // the view: Team items apart; one the public roadmap now lists becomes public
  let v = team.roadmapView(store, PUBLIC, T0);
  assert.equal(v.public[0].team.priority, 'high');
  assert.deepEqual(v.team.map((i) => i.id), [it.id]);
  assert.ok(!JSON.stringify(v.public).includes('hire'));
  v = team.roadmapView(store, { ...PUBLIC, items: [...PUBLIC.items, { id: it.id, title: 't', area: 'platforms', status: 'next' }] }, T0 + 1);
  assert.equal(v.team.length, 0);
  assert.equal(store.data.roadmap.items[it.id].visibility, 'public');
  assert.throws(() => team.deleteItem(store, { id: it.id }), /pull request/);
  assert.equal(team.roadmapView(store, null, T0).available, false);
});
