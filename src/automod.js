// Discord AutoMod rules, applied by setup and by scripts/apply-moderation.js (each rule found again by its name),
// and a copy of Discord's matching so the piracy and Telegram lists can be tested without Discord. Every rule alerts
// #mod-log; #mod-chat stays for the mods talking (Ludovic, 2026-10-30).
import {
  AutoModerationRuleTriggerType as T, AutoModerationRuleEventType, AutoModerationActionType as A,
  AutoModerationRuleKeywordPresetType as Preset,
} from 'discord.js';
import { MOD } from './config.js';

// Server invites and gift scams (the "invites and scams" rule; Kira's game chat answers check them too).
export const SCAM_PATTERNS = [
  'discord(?:app)?\\.(?:gg|com/invite|io|me|li)/\\S+',
  '(?i)free\\s*nitro', '(?i)nitro\\s*(?:for\\s*)?free', '(?i)steam\\s*gift',
  'd[il1][sz]c[o0]r[dcl][a-z]*\\.(?:gift|ru|xyz|top|click|link)',
];

// Telegram links (napkinwastaken in #mod-chat, Ludovic, 2026-10-30): t.me, telegram.me, telegram.dog and telegram.org
// links, tg:// links, and the dot written out or spaced ("t . me/", "t[.]me/", "t dot me/"). A path is needed after the
// domain, so "t.me" in a sentence, "tme", "telegraph" and "meet.me/…" pass. Rust regexes (no lookaround); the
// JavaScript copy reads them the same (test/automod.test.js).
const DOT = '\\s*(?:\\.|\\[\\s*\\.\\s*\\]|\\(\\s*\\.\\s*\\)|\\[\\s*dot\\s*\\]|\\(\\s*dot\\s*\\)|\\bdot\\b)\\s*';
export const TELEGRAM_PATTERNS = [
  `(?i)\\bt${DOT}me\\s*/`,
  `(?i)\\btelegram${DOT}(?:me|dog|org)\\s*/`,
  '(?i)\\btg\\s*:\\s*//',
];
export const TELEGRAM_MESSAGE = 'Telegram links are not allowed here (rule 2 and 4).';

// ids: { modlog (channel), mod, team (roles) }.
export function automodRules(ids) {
  const alert = { type: A.SendAlertMessage, metadata: { channel: ids.modlog } };
  const block = (msg) => ({ type: A.BlockMessage, metadata: { customMessage: msg } });
  const exempt = { exemptRoles: [ids.mod, ids.team].filter(Boolean) };
  return [
    { name: 'Kira · spam', triggerType: T.Spam, actions: [block('Kira blocked this as spam.'), alert], ...exempt },
    { name: 'Kira · slurs and sexual content', triggerType: T.KeywordPreset, triggerMetadata: { presets: [Preset.Slurs, Preset.SexualContent] }, actions: [block('That word is not allowed here (rule 1 and 5).'), alert], ...exempt },
    { name: 'Kira · mention spam', triggerType: T.MentionSpam, triggerMetadata: { mentionTotalLimit: 5, mentionRaidProtectionEnabled: true }, actions: [block('Too many mentions.'), alert, { type: A.Timeout, metadata: { durationSeconds: 600 } }], ...exempt },
    {
      name: 'Kira · invites and scams', triggerType: T.Keyword,
      triggerMetadata: {
        regexPatterns: SCAM_PATTERNS,
      },
      actions: [block('Server invites and gift links are not allowed (rule 2 and 4).'), alert], ...exempt,
    },
    // Blocked, and the sender is timed out for an hour.
    {
      name: 'Kira · telegram links', triggerType: T.Keyword,
      triggerMetadata: { regexPatterns: TELEGRAM_PATTERNS },
      actions: [block(TELEGRAM_MESSAGE), alert, { type: A.Timeout, metadata: { durationSeconds: 3600 } }], ...exempt,
    },
    // Rule 3. Its alert went to #mod-chat from 2026-10-28; since 2026-10-30 it goes to #mod-log with the others.
    {
      name: 'Kira · piracy', triggerType: T.Keyword,
      triggerMetadata: { keywordFilter: MOD.piracy.keywords, regexPatterns: MOD.piracy.patterns },
      actions: [block(MOD.piracy.message), alert], ...exempt,
    },
    { name: 'Kira · bad names', triggerType: T.MemberProfile, triggerMetadata: { keywordFilter: ['*nigg*', '*fagg*', '*hitler*', '*nazi*', '*discord.gg*'] }, actions: [{ type: A.BlockMemberInteraction }], ...exempt },
  ];
}

// `update: false` makes the missing rules only and leaves existing ones as they are (setup without --apply-layout).
export async function applyAutomod(guild, ids, log = console.log, { update = true } = {}) {
  const existing = await guild.autoModerationRules.fetch();
  for (const r of automodRules(ids)) {
    const data = { ...r, eventType: r.triggerType === T.MemberProfile ? AutoModerationRuleEventType.MemberUpdate : AutoModerationRuleEventType.MessageSend, enabled: true };
    const found = existing.find((e) => e.name === r.name);
    try {
      if (found) { if (update) await found.edit(data); }
      else { await guild.autoModerationRules.create(data); log('automod rule', r.name); }
    } catch (e) { log('automod', r.name, e.message); }
  }
}

// Discord's keyword matching: case-insensitive; `word` the whole word, `word*` a word starting with it, `*word` a word
// ending with it, `*word*` anywhere. A word is letters and digits; anything else separates words.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function keywordRegex(keyword) {
  const core = escape(keyword.replace(/^\*|\*$/g, ''));
  const start = keyword.startsWith('*') ? '' : '(?<![\\p{L}\\p{N}])';
  const end = keyword.endsWith('*') ? '' : '(?![\\p{L}\\p{N}])';
  return new RegExp(start + core + end, 'iu');
}
// One of Discord's regex patterns, read by JavaScript: a leading (?i) becomes the `i` flag.
export function patternRegex(pattern) {
  const i = pattern.startsWith('(?i)');
  return new RegExp(i ? pattern.slice(4) : pattern, i ? 'i' : '');
}

// What the piracy rule catches in a message: the first keyword or pattern that matches, or null.
export function piracyMatch(text, { keywords, patterns } = MOD.piracy) {
  return keywords.find((k) => keywordRegex(k).test(text)) ?? patterns.find((p) => patternRegex(p).test(text)) ?? null;
}

// What the Telegram rule catches in a message: the first pattern that matches, or null.
export const telegramMatch = (text) => TELEGRAM_PATTERNS.find((p) => patternRegex(p).test(text)) ?? null;
