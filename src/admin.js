// Moving Kira between hosts: GET /admin/backup returns state.json and agents.json, POST /admin/restore
// replaces them and restarts the process (the host starts it again on the new files). Both need the admin
// token: its secret is in 1Password (op://Agents/Kira admin token/credential), the host only has its SHA-256
// (KIRA_ADMIN_TOKEN_SHA256). No variable, no admin routes. Failed attempts count in the "auth" rate limit.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';

const MAX = 2 * 1024 * 1024;

// `save` writes what is in memory first; `freeze` stops all later writes; `exit` restarts.
export function adminRoutes({ hash, files, limiter, save, freeze, exit = () => process.exit(0) }) {
  if (!/^[0-9a-f]{64}$/.test(hash ?? '')) return {};
  const want = Buffer.from(hash, 'hex');
  const ok = (req) => {
    const auth = String(req.headers.authorization ?? '');
    const got = createHash('sha256').update(auth.startsWith('Bearer ') ? auth.slice(7).trim() : '').digest();
    return timingSafeEqual(got, want);
  };
  const deny = (req, res) => {
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    const limited = !limiter.take(ip, 'auth');
    res.writeHead(limited ? 429 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: limited ? 'too many attempts' : 'unauthorized' }));
  };
  return {
    'GET /admin/backup': (req, res) => {
      if (!ok(req)) return deny(req, res);
      save(); // what is in memory, first
      const out = {};
      for (const [name, file] of Object.entries(files)) out[name] = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(out));
    },
    'POST /admin/restore': (req, res) => {
      if (!ok(req)) { req.resume(); return deny(req, res); }
      const chunks = [];
      let size = 0;
      req.on('data', (c) => { size += c.length; if (size <= MAX) chunks.push(c); });
      req.on('end', () => {
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
        if (size > MAX || !body || typeof body.state !== 'object' || !body.state?.channels) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'expected { state, agents } with a real state' }));
        }
        freeze();
        for (const [name, file] of Object.entries(files)) {
          if (!body[name]) continue;
          writeFileSync(file + '.tmp', JSON.stringify(body[name], null, 2), { mode: 0o600 });
          renameSync(file + '.tmp', file);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ restored: Object.keys(files).filter((n) => body[n]), restarting: true }));
        // Restart without saving: the process's old state must not overwrite the restored files.
        setTimeout(exit, 500);
      });
    },
  };
}
