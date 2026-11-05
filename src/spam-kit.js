// Which recent messages make a flood, a copy-paste or a link flood (src/features/moderation.js). Pure: no Discord.
//
// Short replies said again ("no", "sim", "omfg", "you're wrong", a ping) are how people talk, not spam: the mods lifted
// every timeout they caused on appeal (cases #10, #39, #48, #53, 2026-11-01..05). So a short message with no link
// counts as a copy-paste only at MOD.shortRepeatCount. Longer messages, links and markdown headings (the "# check my
// bio" ads) keep MOD.repeatCount.
//
// The same announcement posted once in each of a few channels is how people share news, not spam (cases #61 and #63,
// 2026-11-05: a Fabric beta announcement in 3 channels, timed out, lifted by the mods). Copies in one channel keep
// MOD.repeatCount; copies spread over channels count only at MOD.crossPostChannels distinct channels.

/** True when a message is short talk: under MOD.shortChars characters (a ping counts as one), no link, no heading. */
export function isShortTalk(content, links, MOD) {
  const text = content.replace(/<@[!&]?\d+>/g, '@');
  return !links && text.length < MOD.shortChars && !/^#{1,3}\s/.test(text);
}

/**
 * `list`: this author's recent messages, oldest first, each {id, channelId, at, content (trimmed, lower case), links}.
 * Returns [why, offending] when the newest one tips it over, or [] when nothing does.
 */
export function spamVerdict(list, now, MOD) {
  const last = list.at(-1);
  const burst = list.filter((x) => now - x.at < MOD.floodWindowMs);
  const same = last?.content ? list.filter((x) => x.content === last.content && now - x.at < MOD.repeatWindowMs) : [];
  const repeatAt = last && isShortTalk(last.content, last.links, MOD) ? MOD.shortRepeatCount : MOD.repeatCount;
  const linked = list.filter((x) => x.links && now - x.at < MOD.linkWindowMs);
  if (burst.length >= MOD.floodMessages) return [`${burst.length} messages in ${MOD.floodWindowMs / 1000} s`, burst];
  const inChannel = last ? same.filter((x) => x.channelId === last.channelId) : [];
  const channels = new Set(same.map((x) => x.channelId)).size;
  if (inChannel.length >= repeatAt) return [`the same message ${inChannel.length} times`, same];
  if (channels >= MOD.crossPostChannels) return [`the same message in ${channels} channels`, same];
  if (linked.length >= MOD.linkFloodMessages) return [`${linked.length} messages with links in ${MOD.linkWindowMs / 1000} s`, linked];
  return [];
}

/**
 * `strikes`: a member's spam strike times. A mod lifted the automatic timeout opened at `timeoutAt`: returns the list
 * without that timeout's strike (the one nearest before it, within `windowMs`), so a lifted timeout does not make the
 * next one longer (case #63: "strike 3 today" after two lifted timeouts).
 */
export function liftStrike(strikes, timeoutAt, windowMs = 5 * 60_000) {
  let at = -1;
  for (let i = 0; i < strikes.length; i++) {
    if (strikes[i] <= timeoutAt + windowMs && strikes[i] >= timeoutAt - windowMs && (at < 0 || Math.abs(strikes[i] - timeoutAt) < Math.abs(strikes[at] - timeoutAt))) at = i;
  }
  return at < 0 ? strikes : strikes.filter((_, i) => i !== at);
}
