// What people read on the server describes the system as it is (the hub, #updates, the verbs) and stays true:
// no channel that no longer exists, no dates, only what works in a release, and every text fits where it goes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-texts-')), 'state.json');
const cfg = await import('../src/config.js');
const texts = await import('../src/texts.js');
const core = await import('../src/core.js');
const community = await import('../src/features/community.js');

const specs = cfg.LAYOUT.flatMap((g) => g.channels);
const names = new Set(specs.map((c) => c.name));
Object.assign(core.state.channels, Object.fromEntries(specs.map((c, i) => [c.key, String(100000000000000000n + BigInt(i))])));

let help;
await community.handlers.help({ reply: (m) => { help = m.embeds[0].data; } });
const guide = readFileSync(new URL('../src/setup.js', import.meta.url), 'utf8').match(/message: "(.*?)",/)[1];
const forumTexts = specs.filter((c) => c.type === 'forum').flatMap((c) => [c.topic, c.guide ?? '']);
const READ = {
  about: cfg.SERVER.about, welcome: cfg.WELCOME.description, rules: cfg.RULES.flat().join('\n'), footer: cfg.RULES_FOOTER,
  faq: cfg.FAQ.flat().join('\n'), official: Object.values(cfg.OFFICIAL_SERVER).join('\n'), horizon: `${cfg.HORIZON.description}\n${cfg.HORIZON.get}`, pins: Object.values(cfg.PINS).join('\n'),
  topics: specs.map((c) => c.topic ?? '').join('\n'), forums: forumTexts.join('\n'), help: help.description, guide,
  roles: texts.rolesMessage(core.state).embeds[0].data.description,
  newmember: texts.welcomeMessage(['1'], 10, core.state).embeds[0].data.description,
};

test('no text names a channel that is gone (#work-board, #dev-log) or one that does not exist', () => {
  for (const [where, text] of Object.entries(READ)) {
    assert.doesNotMatch(text, /work-board|dev-log|<#undefined>/, where);
    for (const [, name] of text.matchAll(/(?<![\w/&])#([\p{Ll}\p{Lo}][\p{Ll}\p{Lo}\p{N}-]+)/gu)) assert.ok(names.has(name), `${where}: #${name}`);
  }
});

test('no dates, and what is not out yet says "coming soon"', () => {
  for (const [where, text] of Object.entries(READ)) {
    assert.doesNotMatch(text, /\b20\d\d\b|\b(January|February|March|April|June|July|August|September|October|November|December)\b|next (week|month)/, where);
  }
  const faq = cfg.FAQ.find(([q]) => /Microsoft/.test(q));
  assert.match(faq[0], /CurseForge/);
  assert.match(faq[1], /coming soon/i);
  for (const [where, text] of Object.entries(READ)) if (where !== 'faq') assert.doesNotMatch(text, /Microsoft (sign-in|account)|CurseForge/, where);
});

test('the new system is described where people look: the hub, the verbs, #updates, ideas not issues', () => {
  for (const where of ['about', 'welcome', 'faq', 'help']) assert.match(READ[where], /playhorizon\.dev\/hub|LINKS\.hub/, where);
  for (const verb of ['/report', '/roadmap', '/claim', '/status', '@Kira']) assert.ok(READ.help.includes(verb), verb);
  for (const [where, text] of Object.entries(READ)) assert.doesNotMatch(text, /\/suggest|@Kira suggest/, where);
  assert.match(READ.help, /\/report-member/);
  assert.match(READ.faq, /What happens to my idea\?[\s\S]*not GitHub issues/);
  const ideas = specs.find((c) => c.key === 'horizonideas');
  assert.doesNotMatch(ideas.guide, /becomes a GitHub issue/);
  assert.match(ideas.guide, /suggestion queue/);
  assert.match(READ.welcome + READ.faq, /#updates/);
});

test('every text fits where Discord puts it', () => {
  assert.ok(cfg.SERVER.about.length <= 400);
  assert.ok(cfg.SERVER.description.length <= 120);
  assert.ok(cfg.FAQ.map(([q, a]) => `**${q}**\n${a}`).join('\n\n').length <= 4096, 'the FAQ embed would be cut');
  assert.ok(cfg.WELCOME.description.length <= 4096);
  assert.ok(help.description.length <= 4096);
  assert.ok(guide.length <= 300, `the Server Guide welcome is ${guide.length} characters`);
  for (const c of specs.filter((s) => s.topic && s.type !== 'forum')) assert.ok(c.topic.length <= 1024, c.key);
  assert.ok(cfg.WELCOME.links.length <= 5);
});

test('#official-server says what the server runs: horizon-server, not Pumpkin', () => {
  assert.match(cfg.OFFICIAL_SERVER.description, /horizon-server/);
  assert.doesNotMatch(`${cfg.OFFICIAL_SERVER.description} ${cfg.OFFICIAL_SERVER.problems}`, /Pumpkin/);
});

test('#faq: two messages, each under Discord\'s limits with real channel ids, nothing cut', () => {
  const ids = Object.fromEntries(specs.map((c) => [c.key, '1559227979002028052']));
  const msgs = texts.faqMessages({ channels: ids });
  assert.equal(msgs.length, 2);
  for (const [i, m] of msgs.entries()) {
    assert.equal(m.embeds.length, 1);
    const e = m.embeds[0].data;
    assert.ok(e.description.length <= 4096, `faq ${i}: ${e.description.length}`);
    assert.ok(e.description.length + e.title.length <= 6000);
    const list = i ? cfg.FAQ_MORE : cfg.FAQ;
    assert.ok(e.description.endsWith(texts.linkify(list.at(-1)[1], { channels: ids })), 'the last answer is whole');
  }
});
