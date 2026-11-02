// The hub's org chart (playhorizon.dev/hub#people): who runs Horizon, as the Discord server shows it, top to bottom:
// 👑 ludovic → 🌌 Horizon Team → 🛡️ Chief of Mods → 🛡️ Mod → 🤝 Support. Served as GET /staff.json (src/bot.js):
// public and read-only, rebuilt from Kira's member cache at most once every TTL_MS, so a role given on Discord shows on
// the site within minutes, without a redeploy.
// Only what any member of the server already sees: the name, the username, the avatar (Discord's CDN) and the role.
// A GitHub login only when it is confirmed and meant to be shown: one a member made public with `/link-github
// credit:True`, or one the maintainers set in config.js (WORK.github, ORG.github). No ids, no emails.
// No Discord here: src/bot.js passes the members in.

export const TTL_MS = 5 * 60_000;

// Top to bottom. A person shows once, in the highest tier they hold.
export const TIERS = [
  { key: 'owner', role: '👑 ludovic', post: 'Owner' },
  { key: 'team', role: '🌌 Horizon Team', post: 'Horizon Team' },
  { key: 'chiefmod', role: '🛡️ Chief of Mods', post: 'Chief of Mods' },
  { key: 'mod', role: '🛡️ Mod', post: 'Mod' },
  { key: 'support', role: '🤝 Support', post: 'Support' },
];

const LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);

// members: [{ id, username, name, avatar, roles: [tier keys] }]; github: Discord id → login; jobs: Discord id → text.
// → { tiers: [{ key, role, post, people: [{ name, username, avatar, github, job }] }] }
export function orgChart({ members, github = {}, jobs = {} }) {
  const tiers = TIERS.map((t) => ({ ...t, people: [] }));
  for (const m of members) {
    const tier = tiers.find((t) => m.roles.includes(t.key));
    if (!tier) continue;
    const login = github[m.id];
    tier.people.push({
      name: clean(m.name, 64) || clean(m.username, 64),
      username: clean(m.username, 64),
      avatar: /^https:\/\/cdn\.discordapp\.com\//.test(m.avatar ?? '') ? m.avatar : null,
      github: login && LOGIN.test(login) ? login : null,
      job: clean(jobs[m.id], 80) || null,
    });
  }
  for (const t of tiers) t.people.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  return { tiers };
}

// The route. `read()` → the members (as orgChart takes them), or null while Discord isn't ready.
export function route({ read, github = () => ({}), jobs = {}, now = () => Date.now() }) {
  let kept = null; // { at, body }
  return (req, res) => {
    if (!kept || now() - kept.at >= TTL_MS) {
      const members = read();
      if (members) kept = { at: now(), body: JSON.stringify({ updated: new Date(now()).toISOString(), ...orgChart({ members, github: github(), jobs }) }) };
    }
    if (!kept) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end('{"error":"not ready"}');
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${TTL_MS / 1000}`, 'Access-Control-Allow-Origin': '*' });
    res.end(kept.body);
  };
}
