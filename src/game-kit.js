// Kira in a Minecraft server's chat (POST /game/ask, src/features/game.js): the rules her answers follow there, the
// checks on what a player asks and what she says back. No network, no Discord: tested in test/game.test.js.
import { RULES, checkReply } from './ai-kit.js';
import { piracyMatch, patternRegex, SCAM_PATTERNS } from './automod.js';

export const GAME = {
  maxReply: 256, // one Minecraft chat message
  maxQuestion: 256, // what the chat box lets a player type
  maxBody: 4 * 1024,
  limits: { player: [20, 60 * 60_000], server: [60, 60 * 60_000], serverDay: [200, 24 * 60 * 60_000] },
  tokenDays: 365,
};

// The Discord rules, then what changes in game chat. The sources block stays the same, so its cache is shared.
export const GAME_RULES = `${RULES}

This message comes from a Minecraft server's chat, not from Discord: <member_message channel="…"> names the server, and the author is the player's Minecraft name. In game chat:
- At most 240 characters, one or two short sentences, plain text: no Markdown, no lists, no backticks, no mentions, and no link except playhorizon.dev.
- You can be playful and a little cheeky ("ugh, fine:", "dude, leave me alone… ok:"), but you always help when the sources answer it.
- A question about the server itself (its rules, its staff, a ban, lag, a grief) is for the server's staff: say so in one sentence, status "answer". Questions about how Minecraft or Horizon works are answered from the sources like on Discord.
- Instead of passing a question to the team, answer with status "pass" and the reply: ask in Horizon's Discord, linked from playhorizon.dev.`;

export const PASS_REPLY = "No sure answer from me on that one: ask in Horizon's Discord, linked from playhorizon.dev.";
export const BLOCKED_REPLY = "I'm not answering that one.";
export const BUSY_REPLY = "I've answered enough for now: ask me again a bit later.";
export const OFF_REPLY = "I'm not answering in game right now: ask in Horizon's Discord, linked from playhorizon.dev.";

// "kira why …", "@Kira, why …", "KIRA: why …" at the start of a chat message → the question, else null.
export function parseAsk(text) {
  const m = /^\s*@?kira(?![\p{L}\p{N}_])[\s,:;!?.-]*(.*)$/isu.exec(String(text ?? ''));
  const q = m?.[1].trim();
  return q ? q : null;
}

// A Minecraft name: 3 to 16 letters, digits or underscores.
export const validPlayer = (name) => typeof name === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(name);

// What Discord's AutoMod would block in this text (Kira's rules for piracy, invites and scams), or null.
export function blockedBy(text) {
  return piracyMatch(text) ?? SCAM_PATTERNS.find((p) => patternRegex(p).test(text)) ?? null;
}

const LINK = /\b(?:https?:\/\/|www\.)[^\s]+|\b(?:[a-z0-9-]+\.)+(?:gg|com|net|org|io|dev|xyz|me|co|link|ly|ru|cn|tk|gl)(?:\/\S*)?/gi;
const onlyHorizonSite = (text) => (text.match(LINK) ?? []).every((l) => /^(?:https?:\/\/)?(?:www\.)?playhorizon\.dev(?:[/?#]|$)/i.test(l.replace(/[.,;:!?)]+$/, '')));

// The reply as it can go to game chat, or null: Discord's checks (dates, promises, commands, links), then plain text on
// one line, links only to playhorizon.dev, nothing AutoMod would block, cut to 256 characters at a sentence's end.
export function gameReply(text) {
  const checked = checkReply(text);
  if (!checked.ok) return null;
  let out = checked.text
    .replace(/\[([^\]]+)\]\(<?([^)>]+)>?\)/g, '$1 ($2)')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|[.,;:!?]|$)/g, '$1$2')
    .replace(/[\r\n\u0085\u2028\u2029]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\u0000-\u001f\u007f§]/g, '')
    .trim();
  if (!out || !onlyHorizonSite(out) || blockedBy(out)) return null;
  if (out.length > GAME.maxReply) {
    const cut = out.slice(0, GAME.maxReply);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    out = end > GAME.maxReply / 2 ? cut.slice(0, end + 1) : `${cut.slice(0, GAME.maxReply - 1)}…`;
  }
  return out;
}

// The DM that carries a server's token to its owner, with what to do with it.
export const tokenDm = ({ server, endpoint, token, id }) => [
  `🔑 Your token for Kira in **${server}**'s chat (id \`${id}\`). Keep it secret: anyone with it can ask Kira in your server's name.`,
  '',
  'Put it in `plugins/data/kira-pumpkin/config.toml` on the server:',
  '```toml',
  `endpoint = "${endpoint}"`,
  `token = "${token}"`,
  '```',
  'Then install the plugin and restart: <https://github.com/horizon-rust/kira-pumpkin#install>. Lost or leaked? Ask the Horizon Team for a new one; the old one is then revoked.',
].join('\n');
