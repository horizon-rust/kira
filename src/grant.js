// Gives a role to every member already on the server, once (scripts/grant-videos-role.js is its command line).
// Discord REST by hand, no gateway: sequential, honours 429 `retry_after` and the bucket headers, idempotent
// (members who have the role are skipped), skips bots. Nothing here prints a name, an id or the token.
const API = 'https://discord.com/api/v10';
const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A minimal Discord REST client: `request(method, path)` → parsed JSON (null for 204). A 429 waits
// `retry_after` and tries again; a bucket with no request left waits for its reset before the next one.
export function discordApi(token, { fetchImpl = fetch, sleep = sleepFor, retries = 8 } = {}) {
  return {
    async request(method, path) {
      for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetchImpl(`${API}${path}`, {
          method,
          headers: { Authorization: `Bot ${token}`, 'User-Agent': 'DiscordBot (https://github.com/horizon-rust/kira, 1)', 'X-Audit-Log-Reason': 'kira: Videos role for existing members' },
        });
        if (res.status === 429) {
          const body = await res.json().catch(() => ({}));
          const seconds = Number(body.retry_after ?? res.headers.get('retry-after') ?? 1);
          await sleep(Math.ceil((Number.isFinite(seconds) ? seconds : 1) * 1000) + 250);
          continue;
        }
        if (!res.ok) throw Object.assign(new Error(`${method} ${path.split('/')[1]}: HTTP ${res.status}`), { status: res.status });
        if (res.headers.get('x-ratelimit-remaining') === '0') {
          const wait = Number(res.headers.get('x-ratelimit-reset-after'));
          if (wait > 0) await sleep(Math.ceil(wait * 1000) + 100);
        }
        return res.status === 204 ? null : res.json();
      }
      throw new Error(`${method} ${path.split('/')[1]}: still rate limited after ${retries} retries`);
    },
  };
}

// The id of the one role called `name`. Throws when there are none or several (never guesses).
export async function findRole(api, guildId, name) {
  const found = (await api.request('GET', `/guilds/${guildId}/roles`)).filter((r) => r.name === name);
  if (found.length !== 1) throw new Error(`${found.length} roles are called "${name}" (run setup first?)`);
  return found[0].id;
}

// Every member of the guild, 1000 at a time.
export async function* members(api, guildId) {
  let after = '0';
  for (;;) {
    const page = await api.request('GET', `/guilds/${guildId}/members?limit=1000&after=${after}`);
    yield* page;
    if (page.length < 1000) return;
    after = page.at(-1).user.id;
  }
}

// Gives `roleId` to every human who lacks it. `dryRun`: counts only, nothing is changed. Returns the counts.
export async function grantRole({ api, guildId, roleId, dryRun = false, log = console.log }) {
  const count = { members: 0, bots: 0, had: 0, granted: 0, gone: 0, failed: 0 };
  const todo = [];
  for await (const m of members(api, guildId)) {
    count.members++;
    if (m.user?.bot) count.bots++;
    else if (m.roles?.includes(roleId)) count.had++;
    else todo.push(m.user.id);
  }
  if (dryRun) {
    count.wouldGrant = todo.length;
  } else {
    for (const [i, user] of todo.entries()) {
      try {
        await api.request('PUT', `/guilds/${guildId}/members/${user}/roles/${roleId}`);
        count.granted++;
      } catch (e) {
        if (e.status === 404) count.gone++; // left the server since the list
        else { count.failed++; log(`failed (${e.message})`); }
      }
      if ((i + 1) % 50 === 0) log(`${i + 1} / ${todo.length}`);
    }
  }
  return count;
}
