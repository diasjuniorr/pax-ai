import { test, expect } from '@playwright/test';

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
