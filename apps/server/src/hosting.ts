import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface HostedOptions {
  publicOrigin: string;
  bridgeToken: string;
  dashboardToken: string;
  staticDirectory: string;
}

const cookieName = '__Host-pax_session';
const lifetime = 12 * 60 * 60 * 1000;
const loginPage = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PAX sign in</title><body><main><h1>PAX dashboard</h1><form method="post" action="/login"><label>Dashboard access key <input type="password" name="token" required autocomplete="current-password" maxlength="256"></label> <button>Sign in</button></form></main></body></html>`;

export function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validateHostedOptions(options: HostedOptions) {
  const origin = new URL(options.publicOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== options.publicOrigin)
    throw new Error('PAX_PUBLIC_ORIGIN must be an HTTPS origin without a trailing slash');
  for (const token of [options.bridgeToken, options.dashboardToken]) {
    if (!/^[\x21-\x7e]{32,256}$/.test(token)) throw new Error('PAX access keys must contain 32–256 non-space ASCII characters');
  }
  if (sameSecret(options.bridgeToken, options.dashboardToken)) throw new Error('Use different agent and dashboard access keys');
}

export function createHostedAccess(options: HostedOptions) {
  validateHostedOptions(options);
  // Serve only files found inside the built web directory at startup.
  const files = new Map<string, { body: Buffer; type: string }>();
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  function collect(directory: string, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) collect(join(directory, entry.name), name);
      else if (entry.isFile()) files.set(name, { body: readFileSync(join(directory, entry.name)), type: types[extname(entry.name)] ?? 'application/octet-stream' });
    }
  }
  collect(options.staticDirectory);
  if (!files.has('/index.html')) throw new Error('Dashboard build missing; run npm run build');
  const sign = (value: string) => createHmac('sha256', options.dashboardToken).update(value).digest('hex');
  function viewerAuthorized(req: IncomingMessage, now = Date.now()) {
    const cookie = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!cookie) return false;
    const [expiry, signature, extra] = cookie.split('.');
    if (!expiry || !signature || extra || !/^\d{13}$/.test(expiry)) return false;
    return Number(expiry) > now && Number(expiry) <= now + lifetime && sameSecret(signature, sign(expiry));
  }
  function bridgeAuthorized(req: IncomingMessage) {
    return sameSecret(req.headers.authorization ?? '', `Bearer ${options.bridgeToken}`);
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Native form POSTs can send Origin: null under no-referrer, breaking CSRF validation.
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return;
    }
    if (req.url === '/login' && req.method === 'POST') {
      if (req.headers.origin !== options.publicOrigin || req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      let body = '', size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > 4096) { res.writeHead(413); res.end('Request too large'); return; }
        body += chunk.toString();
      }
      if (!sameSecret(new URLSearchParams(body).get('token') ?? '', options.dashboardToken)) {
        res.writeHead(401, { 'Content-Type': 'text/plain' }); res.end('Incorrect access key. Go back and try again.'); return;
      }
      const expiry = String(Date.now() + lifetime);
      res.writeHead(303, { Location: '/', 'Set-Cookie': `${cookieName}=${expiry}.${sign(expiry)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${lifetime / 1000}` });
      res.end(); return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    if (!viewerAuthorized(req)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : loginPage); return;
    }
    const path = (req.url ?? '').split('?')[0];
    const file = files.get(path === '/' ? '/index.html' : path!);
    if (!file) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': file.type }); res.end(req.method === 'HEAD' ? undefined : file.body);
  }
  return { viewerAuthorized, bridgeAuthorized, handle };
}
