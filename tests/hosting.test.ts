import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createTelemetryServer } from '../apps/server/src/server';
import { validateHostedOptions } from '../apps/server/src/hosting';
import type { ConversationOptions } from '../apps/server/src/conversation';

const origin = 'https://pax-test.onrender.com';
const bridgeToken = 'b'.repeat(48), dashboardToken = 'd'.repeat(48);
async function setup(t: TestContext, conversation: ConversationOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'pax-hosting-'));
  writeFileSync(join(directory, 'index.html'), '<h1>Private dashboard</h1>');
  mkdirSync(join(directory, 'assets'));
  writeFileSync(join(directory, 'assets/app.js'), '/* private asset */');
  const server = createTelemetryServer(() => {}, { publicOrigin: origin, bridgeToken, dashboardToken, staticDirectory: directory }, conversation);
  const sockets: WebSocket[] = [];
  t.after(async () => { for (const socket of sockets) socket.terminate(); await server.close(); rmSync(directory, { recursive: true }); });
  server.http.listen(0, '127.0.0.1'); await once(server.http, 'listening');
  const url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  const ws = (path: string, headers = {}) => {
    const socket = new WebSocket(url.replace('http:', 'ws:') + path, { headers }); sockets.push(socket); return socket;
  };
  const login = (token: string, requestOrigin = origin) => fetch(`${url}/login`, {
    method: 'POST', redirect: 'manual', headers: { Origin: requestOrigin }, body: new URLSearchParams({ token }),
  });
  return { url, ws, login };
}

test('hosted configuration fails closed for missing keys, shared keys or insecure origin', () => {
  const options = { publicOrigin: origin, bridgeToken, dashboardToken, staticDirectory: '.' };
  validateHostedOptions(options);
  for (const invalid of [{ bridgeToken: '' }, { dashboardToken: '' }, { dashboardToken: bridgeToken },
    { publicOrigin: 'http://example.com' }, { publicOrigin: `${origin}/bad` }]) {
    assert.throws(() => validateHostedOptions({ ...options, ...invalid }));
  }
});

test('dashboard requires login, protects assets, and rejects expired/tampered cookies', async t => {
  const { url, login } = await setup(t);
  assert.deepEqual(await (await fetch(`${url}/health`)).json(), { ok: true });
  assert.match(await (await fetch(url)).text(), /Dashboard access key/);
  assert.doesNotMatch(await (await fetch(`${url}/assets/app.js`)).text(), /private asset/);
  assert.equal((await login(bridgeToken)).status, 401);
  assert.equal((await login(dashboardToken, 'https://attacker.example')).status, 403);
  assert.equal((await login(dashboardToken, 'null')).status, 403);
  const response = await login(dashboardToken);
  assert.equal(response.status, 303);
  const setCookie = response.headers.get('set-cookie')!;
  for (const flag of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']) assert.ok(setCookie.includes(flag));
  const cookie = setCookie.split(';')[0]!;
  const dashboard = await fetch(url, { headers: { Cookie: cookie } });
  assert.match(await dashboard.text(), /Private dashboard/);
  assert.equal(dashboard.headers.get('cache-control'), 'no-store');
  assert.match(await (await fetch(`${url}/assets/app.js`, { headers: { Cookie: cookie } })).text(), /private asset/);
  assert.equal((await fetch(`${url}/package.json`, { headers: { Cookie: cookie } })).status, 404);
  const expiry = String(Date.now() - 1000);
  const expired = `__Host-pax_session=${expiry}.${createHmac('sha256', dashboardToken).update(expiry).digest('hex')}`;
  for (const invalid of [cookie + 'broken', expired]) {
    assert.match(await (await fetch(url, { headers: { Cookie: invalid } })).text(), /Dashboard access key/);
  }
});

test('hosted WebSockets require distinct agent credentials and an authenticated same-origin viewer', async t => {
  const { ws, login } = await setup(t);
  async function rejected(path: string, headers = {}) {
    const socket = ws(path, headers);
    const error = await new Promise<Error>((resolve, reject) => {
      socket.once('error', resolve);
      socket.once('open', () => reject(new Error('Unauthorized socket opened')));
    });
    assert.match(error.message, /403/);
  }
  await rejected('/bridge');
  await rejected('/bridge', { Authorization: `Bearer ${dashboardToken}` });
  await rejected('/bridge', { Authorization: `Bearer ${bridgeToken}`, Origin: origin });
  await rejected('/telemetry', { Origin: origin });
  await rejected(`/bridge?token=${bridgeToken}`);
  const cookie = (await login(dashboardToken)).headers.get('set-cookie')!.split(';')[0]!;
  await rejected('/telemetry', { Cookie: cookie, Origin: 'https://attacker.example' });
  await rejected('/telemetry', { Cookie: cookie });
  const viewer = ws('/telemetry', { Cookie: cookie, Origin: origin });
  const initial = once(viewer, 'message'); await once(viewer, 'open'); await initial;
  const connected = once(viewer, 'message');
  const bridge = ws('/bridge', { Authorization: `Bearer ${bridgeToken}` }); await once(bridge, 'open');
  assert.equal(JSON.parse(String((await connected)[0])).bridgeConnected, true);
  const snapshot = once(viewer, 'message');
  bridge.send(JSON.stringify({ version: 1, type: 'bridgeSnapshot', simulatorConnected: true, telemetry: null }));
  assert.equal(JSON.parse(String((await snapshot)[0])).simulatorConnected, true);
});

test('session API isolates agent credentials, validates input and prevents concurrent replacement', async t => {
  const { url, login } = await setup(t);
  const path = `${url}/api/session`;
  assert.equal((await fetch(path)).status, 401);
  assert.equal((await fetch(path, { headers: { Authorization: `Bearer ${bridgeToken}` } })).status, 401);
  const cookie = (await login(dashboardToken)).headers.get('set-cookie')!.split(';')[0]!;
  const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
  const post = (route: string, value: unknown, extra = {}) => fetch(`${url}${route}`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(value) });
  assert.deepEqual(await (await fetch(path, { headers })).json(), { session: null });
  assert.equal((await post('/api/passenger/random', {}, { Origin: 'https://attacker.example' })).status, 403);
  const generated = await (await post('/api/passenger/random', {})).json() as { passenger: Record<string, unknown> };
  const input = { passenger: { ...generated.passenger, name: 'Manual edit' }, expectedDurationMinutes: 30, origin: 'Madrid', destination: 'Barcelona' };
  assert.equal((await post('/api/session', { ...input, expectedDurationMinutes: 0 })).status, 400);
  const responses = await Promise.all([post('/api/session', input), post('/api/session', input)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  const current = await (await fetch(path, { headers })).json() as { session: { id: string; passenger: { name: string }; startedAt: number } };
  assert.equal(current.session.passenger.name, 'Manual edit');
  assert.ok(current.session.startedAt > 0);
  assert.equal((await post('/api/session/end', { id: '00000000-0000-4000-8000-000000000000' })).status, 409);
  assert.equal((await post('/api/session/end', { id: current.session.id })).status, 200);
  assert.deepEqual(await (await fetch(path, { headers })).json(), { session: null });
});

test('conversation HTTP API requires dashboard authorization, rejects stale sessions and clears transcript on end', async t => {
  let calls = 0;
  const { url, login } = await setup(t, { provider: async () => { calls++; return { text: 'I am visiting family.' }; } });
  const path = `${url}/api/conversation`;
  assert.equal((await fetch(path)).status, 401);
  assert.equal((await fetch(path, { headers: { Authorization: `Bearer ${bridgeToken}` } })).status, 401);
  const cookie = (await login(dashboardToken)).headers.get('set-cookie')!.split(';')[0]!;
  const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
  const post = (route: string, body: unknown, extra = {}) => fetch(`${url}${route}`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  const generated = await (await post('/api/passenger/random', {})).json() as { passenger: unknown };
  const { session } = await (await post('/api/session', { passenger: generated.passenger, expectedDurationMinutes: 30 })).json() as { session: { id: string } };
  const body = { sessionId: session.id, requestId: '00000000-0000-4000-8000-000000000001', message: 'Why are you traveling?' };
  assert.equal((await post('/api/conversation', body, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post('/api/conversation', { ...body, message: '' })).status, 400);
  assert.equal((await post('/api/conversation', { ...body, sessionId: body.requestId })).status, 409);
  assert.equal(calls, 0);
  const response = await post('/api/conversation', body);
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.deepEqual(await (await fetch(path, { headers })).json(), state);
  assert.equal((await post('/api/conversation', body)).status, 200);
  assert.equal(calls, 1);
  await post('/api/session/end', { id: session.id });
  assert.deepEqual(await (await fetch(path, { headers })).json(), { sessionId: null, configured: true, status: 'idle', messages: [] });
  assert.equal((await post('/api/conversation', body)).status, 409);
});
