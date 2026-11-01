// The honeypot channel (MOD.honeypot): scam bots post in every channel they can write in, so one channel exists only to
// catch them. Anyone who posts there is soft-banned (banned with the last day of their messages deleted, then unbanned
// at once so a real person can rejoin). Pure decisions here, no Discord connection, so test/honeypot.test.js can run them;
// the handler is in src/features/moderation.js.

// Who is never soft-banned: bots, and the same people AutoMod exempts (mods and the Horizon Team), Ludovic, and anyone
// with Manage Messages (isStaff). Their messages in the channel are only deleted.
export function honeypotExempt({ isBot, isStaff, userId, ownerId, roleIds = [], exemptRoleIds = [] }) {
  if (isBot || isStaff) return true;
  if (ownerId && userId === ownerId) return true;
  return exemptRoleIds.some((id) => id && roleIds.includes(id));
}

// What to do with one message in the honeypot: 'ignore' (not the channel, or the feature is off), 'delete' (an exempt
// member's), 'drop' (a burst: this user is already being, or was just, soft-banned; the message is removed with the
// rest) or 'softban'.
export function honeypotAction({ enabled, channelId, honeypotId, exempt, handled }) {
  if (!enabled || !honeypotId || channelId !== honeypotId) return 'ignore';
  if (exempt) return 'delete';
  return handled ? 'drop' : 'softban';
}

// One soft-ban per user per window, however many messages arrive meanwhile (a bot posts the same text in a burst, and
// the gateway delivers those before the ban lands; a ban that failed is logged once, not once per message). `claim` is true once per user per window.
export function makeHandled(windowMs = 10 * 60_000, now = Date.now) {
  const seen = new Map(); // userId → time of the soft-ban
  const prune = () => { const t = now(); for (const [id, at] of seen) if (t - at > windowMs) seen.delete(id); };
  return {
    claim(userId) { prune(); if (seen.has(userId)) return false; seen.set(userId, now()); return true; },
    has(userId) { prune(); return seen.has(userId); },
    size: () => seen.size,
  };
}

// "2 days", "5 hours", "12 minutes": the account's age, for the log line.
export function accountAge(createdTimestamp, at = Date.now()) {
  const ms = Math.max(0, at - createdTimestamp);
  const unit = (n, name) => `${n} ${name}${n === 1 ? '' : 's'}`;
  const minutes = Math.floor(ms / 60_000), hours = Math.floor(ms / 3_600_000), days = Math.floor(ms / 86_400_000);
  if (days >= 365) return unit(Math.floor(days / 365), 'year');
  if (days >= 1) return unit(days, 'day');
  if (hours >= 1) return unit(hours, 'hour');
  return unit(minutes, 'minute');
}

// The log line for #mod-log. `outcome`: 'ok', or what went wrong (the ban failed, or the unban did and they are still banned).
export function honeypotLog({ userId, tag, createdTimestamp, content, outcome = 'ok', clipText, at }) {
  const text = clipText(content, 300);
  const lines = [`<@${userId}> (${tag}) posted in the honeypot · account age ${accountAge(createdTimestamp, at)}`, `Message: ${text}`];
  if (outcome === 'ok') return { title: '🍯 honeypot soft-ban', description: lines.join('\n'), failed: false };
  return { title: `🍯 honeypot: ${outcome.title}`, description: [...lines, outcome.detail].join('\n'), failed: true };
}
