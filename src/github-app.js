// Kira's own GitHub identity: the GitHub App kira-horizon (app 5514019, installed on horizon-rust). Its installation
// token has its own 5000 calls an hour, apart from Ludovic's token, whose hour every agent and merge script shares,
// and Kira's issues and comments show as kira-horizon[bot]. With GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY set,
// githubToken() returns a function the GitHub client calls before each request: it mints an installation token
// (valid an hour) and keeps it until 5 minutes before it expires. Without them it is GITHUB_TOKEN, as before.
// /sponsor keeps GITHUB_TOKEN: isSponsoredBy answers for ludovic111's sponsors only to his own token.
import { createSign } from 'node:crypto';

const ORG = 'horizon-rust';
const b64url = (data) => Buffer.from(data).toString('base64url');

export function makeAppToken({ appId, privateKey, org = ORG, fetchImpl = fetch, now = Date.now }) {
  let current = null; // { token, expires } (ms)
  let pending = null; // one mint at a time: concurrent callers wait for the same one
  let installation = null;

  // The app's own JWT (RS256, 10 minutes at most; iat a minute back for clock drift).
  function jwt() {
    const iat = Math.floor(now() / 1000) - 60;
    const body = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iat, exp: iat + 540, iss: String(appId) }))}`;
    return `${body}.${createSign('RSA-SHA256').update(body).sign(privateKey, 'base64url')}`;
  }
  async function call(method, path, bearer) {
    const res = await fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Kira', Authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`GitHub App ${method} ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
  async function mint() {
    const bearer = jwt();
    installation ??= (await call('GET', `/orgs/${org}/installation`, bearer)).id;
    const res = await call('POST', `/app/installations/${installation}/access_tokens`, bearer);
    current = { token: res.token, expires: Date.parse(res.expires_at) };
    return current.token;
  }
  return async function token() {
    if (current && current.expires - now() > 5 * 60_000) return current.token;
    pending ??= mint().finally(() => { pending = null; });
    return pending;
  };
}

let app = null; // one per process: every client shares the token and its hour
// The App's token function, or null when the App isn't set up (never GITHUB_TOKEN: Kira's AI sources use this).
export function appToken(env = process.env) {
  const id = env.GITHUB_APP_ID?.trim();
  const key = env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (id && key) return (app ??= makeAppToken({ appId: id, privateKey: key.replace(/\\n/g, '\n') }));
  return null;
}
export function githubToken(env = process.env) {
  return appToken(env) ?? env.GITHUB_TOKEN?.trim();
}
