// Exercise the exact compiled entrypoint used by Render, with disposable test keys.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

const base = { ...process.env, NODE_ENV: 'production', RENDER_EXTERNAL_URL: 'https://pax-test.onrender.com', PAX_PUBLIC_ORIGIN: '' };
delete base.PAX_PUBLIC_ORIGIN;
const invalid = spawn(process.execPath, ['dist/server/index.cjs'], {
  env: { ...base, PAX_BRIDGE_TOKEN: '', PAX_DASHBOARD_TOKEN: '' }, stdio: 'ignore',
});
assert.notEqual((await once(invalid, 'exit'))[0], 0, 'Production must reject missing keys');
const allocator = createServer();
allocator.listen(0, '127.0.0.1'); await once(allocator, 'listening');
const port = allocator.address().port;
await new Promise(resolve => allocator.close(resolve));
const token = randomBytes(32).toString('hex');
const child = spawn(process.execPath, ['dist/server/index.cjs'], {
  env: { ...base, PORT: String(port), PAX_BRIDGE_TOKEN: randomBytes(32).toString('hex'), PAX_DASHBOARD_TOKEN: token },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const exited = once(child, 'exit');
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Compiled server startup timeout')), 10000);
    child.stdout.on('data', data => { if (String(data).includes('Listening')) { clearTimeout(timeout); resolve(); } });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Compiled server exited before startup')); });
    child.once('error', reject);
  });
  const url = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${url}/health`)).status, 200);
  assert.match(await (await fetch(url)).text(), /Dashboard access key/);
  const login = await fetch(`${url}/login`, {
    method: 'POST', redirect: 'manual', headers: { Origin: base.RENDER_EXTERNAL_URL }, body: new URLSearchParams({ token }),
  });
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const page = await (await fetch(url, { headers: { Cookie: cookie } })).text();
  assert.match(page, /Telemetry debug/);
  const asset = page.match(/src="([^"]+\.js)"/)[1];
  const response = await fetch(`${url}${asset}`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  console.log('Compiled production server: fail-closed startup, health, login, dashboard and JS asset passed.');
} finally {
  child.kill('SIGTERM');
  await exited;
}
