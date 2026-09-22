import { test, expect } from '@playwright/test';

// Let in-flight dashboard polls finish before Playwright disposes their HTTP responses.
test.afterEach(async ({ context }) => { await context.unrouteAll({ behavior: 'wait' }); });

test('native browser form preserves its origin, signs in, and loads the protected dashboard', async ({ page }) => {
  // Keep the browser on an HTTPS origin while forwarding to the local test backend.
  // The browser itself supplies Origin, form encoding and secure session cookies.
  await page.context().route('https://pax.test/**', async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `http://127.0.0.1:31847${url.pathname}${url.search}`, maxRedirects: 0 });
    await route.fulfill({ response });
  });
  await page.goto('https://pax.test/');
  await page.getByLabel('Dashboard access key').fill('browser-test-dashboard-key-not-a-real-secret');
  const submitted = page.waitForRequest(req => req.url() === 'https://pax.test/login');
  const accepted = page.waitForResponse(res => res.url() === 'https://pax.test/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  expect((await submitted).headers().origin).toBe('https://pax.test');
  const response = await accepted;
  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe('/');
  // Playwright's HTTP routing does not intercept the redirected request in this chain.
  // Open the verified target in a new tab using the real browser's session cookie.
  const context = page.context();
  await page.close();
  const dashboard = await context.newPage();
  await dashboard.goto('https://pax.test/');
  await expect(dashboard.getByRole('heading', { name: 'Pax · Telemetry debug' })).toBeVisible();
  const cookie = (await context.cookies('https://pax.test')).find(c => c.name === '__Host-pax_session');
  expect(cookie).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Strict' });
  await dashboard.reload();
  await expect(dashboard.getByRole('heading', { name: 'Pax · Telemetry debug' })).toBeVisible();
});

test('passenger can be generated, edited, started, restored on reload and ended', async ({ page }) => {
  await page.context().route('https://pax.test/**', async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `http://127.0.0.1:31847${url.pathname}${url.search}`, maxRedirects: 0 });
    await route.fulfill({ response });
  });
  // Authentication itself is exercised with a real native form in the first test.
  const response = await page.request.post('http://127.0.0.1:31847/login', {
    headers: { Origin: 'https://pax.test' }, form: { token: 'browser-test-dashboard-key-not-a-real-secret' }, maxRedirects: 0,
  });
  const value = response.headers()['set-cookie']!.split(';')[0]!.split('=')[1]!;
  await page.context().addCookies([{ name: '__Host-pax_session', value, url: 'https://pax.test', secure: true, httpOnly: true, sameSite: 'Strict' }]);
  await page.goto('https://pax.test/');
  await page.getByRole('button', { name: 'Generate passenger' }).click();
  await expect(page.getByLabel('Name', { exact: true })).not.toHaveValue('');
  await page.getByLabel('Name', { exact: true }).fill('My passenger');
  await page.getByLabel('Expected duration').fill('90');
  await page.getByLabel('Origin (optional)').fill('Madrid');
  await page.getByLabel('Destination (optional)').fill('Lisbon');
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(page.locator('#session-status')).toHaveText('Session active');
  await expect(page.locator('#session-summary')).toContainText('My passenger · 90 minutes · Madrid → Lisbon');
  await page.reload();
  await expect(page.locator('#session-status')).toHaveText('Session active');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('My passenger');
  await expect(page.getByRole('button', { name: 'Start session', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page.locator('#session-status')).toHaveText('No active session');
});

test('text conversation renders safely, restores on reload, reports failures and clears on session end (stubbed AI)', async ({ page }) => {
  const origin = 'https://pax.test';
  const login = await page.request.post('http://127.0.0.1:31847/login', {
    headers: { Origin: origin }, form: { token: 'browser-test-dashboard-key-not-a-real-secret' }, maxRedirects: 0,
  });
  const cookie = login.headers()['set-cookie']!.split(';')[0]!;
  await page.context().addCookies([{ name: '__Host-pax_session', value: cookie.split('=')[1]!, url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);
  const headers = { Cookie: cookie, Origin: origin };
  const generated = await page.request.post('http://127.0.0.1:31847/api/passenger/random', { headers, data: {} });
  const start = await page.request.post('http://127.0.0.1:31847/api/session', { headers, data: { passenger: (await generated.json()).passenger, expectedDurationMinutes: 45 } });
  expect(start.status()).toBe(201);
  const session = (await start.json()).session;
  let state: { sessionId: string | null; configured: boolean; status: string; messages: { role: string; content: string }[] } = {
    sessionId: session.id, configured: true, status: 'idle', messages: [],
  };
  let fail = false;
  // Only the AI conversation HTTP seam is stubbed; session/auth/assets use the real built server.
  await page.context().route('https://pax.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/conversation') {
      if (route.request().method() === 'POST') {
        if (fail) { await route.fulfill({ status: 502, json: { error: 'Test provider unavailable.' } }); return; }
        const input = route.request().postDataJSON();
        expect(input.sessionId).toBe(session.id);
        expect(input.requestId).toMatch(/^[0-9a-f-]{36}$/);
        state.messages.push({ role: 'user', content: input.message }, { role: 'assistant', content: 'My trip is to see family. <script>bad()</script>' });
      }
      await route.fulfill({ json: state }); return;
    }
    const response = await route.fetch({ url: `http://127.0.0.1:31847${url.pathname}${url.search}`, maxRedirects: 0 });
    if (url.pathname === '/api/session/end' && response.ok()) state = { ...state, sessionId: null, messages: [] };
    await route.fulfill({ response });
  });
  await page.goto(`${origin}/`);
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
  await page.getByLabel('Message to passenger').fill('Why this trip?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('#conversation-messages')).toContainText('My trip is to see family. <script>bad()</script>');
  await expect(page.locator('#conversation-messages script')).toHaveCount(0);
  await expect(page.getByLabel('Message to passenger')).toHaveValue('');
  await page.reload();
  await expect(page.locator('#conversation-messages li')).toHaveCount(2);
  fail = true;
  await page.getByLabel('Message to passenger').fill('And tomorrow?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('#conversation-error')).toHaveText('Test provider unavailable.');
  await expect(page.getByLabel('Message to passenger')).toHaveValue('And tomorrow?');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page.locator('#conversation-messages li')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
});
