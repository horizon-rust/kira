// #horizon-support's rules, with no Discord connection so they can be tested (src/features/support.js does the talking).

// Who may write in a post: its poster, the forum's helpers (🤝 Support), the staff, and Kira.
export const mayReply = ({ isOwner, isHelper, isStaff, isBot }) => !!(isOwner || isHelper || isStaff || isBot);

// The note for 🤝 Support on a new post. Pings the role when the last ping is at least `everyMs` old, and then names
// the posts that came since without one (`waiting`, oldest first, at most 5). Returns { content, ping, waiting }:
// `waiting` is the list to keep for the next ping.
export function supportNote({ roleId, threadId, lastPing = 0, waiting = [], now = Date.now(), everyMs }) {
  if (!roleId) return { content: '🤝 A Support member will answer here.', ping: false, waiting: [] };
  if (now - lastPing < everyMs) return { content: '🤝 A Support member will answer here.', ping: false, waiting: [...waiting, threadId].slice(-20) };
  const others = waiting.filter((id) => id !== threadId).slice(-5);
  const also = others.length ? `\nAlso waiting: ${others.map((id) => `<#${id}>`).join(' ')}` : '';
  return { content: `🤝 <@&${roleId}> a new question.${also}`, ping: true, waiting: [] };
}

// What Kira says under a reply she removed from someone else's post.
export const replyNote = (userId, supportRoleName = '🤝 Support') =>
  `<@${userId}> only the person who asked and ${supportRoleName} write in #horizon-support posts, so answers stay clear. Want to help people here? \`/apply\` for ${supportRoleName}.`;
