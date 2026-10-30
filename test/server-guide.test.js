// The server guide (src/texts.js): one of the sources Kira's AI answers from, built from config.js with no GitHub call,
// and /help's short tour of the server. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-guide-')), 'state.json');
const ai = await import('../src/ai.js');
const { serverGuideText, helpText } = await import('../src/texts.js');
const { LAYOUT, RULES, FAQ_MORE, ROLES } = await import('../src/config.js');

// A GitHub that fails every call and counts them.
const deadGitHub = () => { const gh = { calls: 0, async get() { gh.calls++; throw new Error('HTTP 500'); } }; return gh; };

test('server guide: part of the AI sources from the start, with no GitHub call, right after the FAQ', async () => {
  const gh = deadGitHub();
  const s = ai.makeSources({ gh, log: () => {}, info: () => {} });
  const text = s.text();
  assert.equal(gh.calls, 0, 'built locally');
  const guide = text.indexOf('<source name="Server guide');
  assert.ok(guide > text.indexOf('<source name="FAQ">') && guide < text.indexOf('<source name="README.md">'), 'after the FAQ, before the README');
  assert.ok(text.includes(serverGuideText()));
  // Still there when GitHub is down.
  await s.refresh(Date.now(), { force: true });
  assert.ok(s.text().includes(serverGuideText()));
});

test('server guide: the second FAQ (how to become a mod, where to get help) is in the AI sources too', () => {
  const text = ai.makeSources({ gh: deadGitHub(), log: () => {}, info: () => {} }).text();
  for (const [q] of FAQ_MORE) assert.ok(text.includes(`Q: ${q}`), q);
});

test('server guide: every channel the members see and what it is for, the roles, the rules, help, bugs, ideas, /apply', () => {
  const g = serverGuideText();
  for (const group of LAYOUT) {
    assert.ok(g.includes(group.category), group.category);
    for (const c of group.channels) {
      assert.ok(g.includes(c.type === 'voice' ? c.name : `#${c.name}`), c.name);
      if (c.topic && !group.staff) assert.ok(g.includes(c.topic.replace(/([^.!?])$/, '$1.')), `topic of #${c.name}`);
      if (c.guide) assert.ok(g.includes(c.guide), `how to post in #${c.name}`);
    }
  }
  for (const r of ROLES) assert.ok(g.includes(r.name), r.name);
  RULES.forEach(([title, text], i) => assert.ok(g.includes(`${i + 1}. ${title}: ${text}`), title));
  for (const piece of ['#horizon-support', '#horizon-bugs', 'reproducible', '#horizon-ideas', '/apply', '/verify-github', '🤝 Support', '🛡️ Mod', '🌌 Horizon Team', '/report', 'DM']) {
    assert.ok(g.toLowerCase().includes(piece.toLowerCase()), piece);
  }
  assert.ok(!/<#\d+>/.test(g), 'channels as #names, not mentions');
  assert.ok(g.length < 25_000, `kept short for the cached prompt (${g.length} characters)`);
});

test('/help: starts with a short tour of the server, channels as mentions, under the embed limit', () => {
  const channels = Object.fromEntries(LAYOUT.flatMap((g) => g.channels).map((c, i) => [c.key, String(1000 + i)]));
  const h = helpText({ channels });
  const tour = h.split('\n\n')[0];
  assert.match(tour, /The server in short/);
  for (const key of ['welcome', 'rules', 'faq', 'horizoninfo', 'horizonsupport', 'horizonbugs', 'horizonideas', 'horizonchat', 'general', 'updates', 'releases']) {
    assert.ok(tour.includes(`<#${channels[key]}>`), key);
  }
  assert.ok(h.includes('/apply') && h.includes('/verify-github'));
  assert.ok(h.length <= 4096, `an embed description is 4096 characters at most (${h.length})`);
  // Before setup made the channels, the names stay readable.
  assert.ok(helpText({ channels: {} }).includes('#horizon-support'));
});
