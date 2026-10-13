// A small GitHub REST client for Kira's issues feature. Writes are only logged in dry-run mode.
export function makeGitHub({ token, dryRun = false, fetchImpl = fetch, log = console.log } = {}) {
  async function call(method, path, body) {
    const res = await fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Kira (Discord bot of ludovic\'s server)',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? {} : res.json();
  }
  return {
    dryRun,
    get: (path) => call('GET', path),
    async write(method, path, body) {
      if (dryRun) {
        log(`github dry-run: ${method} ${path} ${body ? JSON.stringify(body).slice(0, 600) : ''}`);
        return null;
      }
      return call(method, path, body);
    },
  };
}
