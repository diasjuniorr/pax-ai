import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.afterEach(async ({ context }) => { await context.unrouteAll({ behavior: 'wait' }); });
test('application console filters, copies full lines and exports only filtered events without HTML execution', async ({ page }) => {
  const origin = 'https://pax.test';
  const entries = [
    { id: 'fixture:1', timestamp: 1000, source: 'server', component: 'EVENT', level: 'info', message: 'TAKEOFF detected', details: { eventId: 'flight-1' } },
    { id: 'fixture:2', timestamp: 1001, source: 'server', component: 'PASSENGER', level: 'warn', message: '<script>bad()</script>', details: { eventId: 'flight-1', eventAgeMs: -250, reason: 'Future timestamp' } },
  ];
  await page.context().route('https://pax.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/debug-log') { await route.fulfill({ json: { entries } }); return; }
    await route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:31847${url.pathname}${url.search}`, maxRedirects: 0 }) });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { Object.assign(window, { copiedLog: text }); } } });
  });
  const login = await page.request.post('http://127.0.0.1:31847/login', {
    headers: { Origin: origin }, form: { token: 'browser-test-dashboard-key-not-a-real-secret' }, maxRedirects: 0,
  });
  await page.context().addCookies([{ name: '__Host-pax_session', value: login.headers()['set-cookie']!.split(';')[0]!.split('=')[1]!, url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);
  await page.goto(origin);
  await page.getByLabel('Search logs').fill('flight-1');
  await expect(page.locator('#debug-entries code')).toHaveCount(2);
  await expect(page.locator('#debug-entries script')).toHaveCount(0);
  await page.getByLabel('Severity', { exact: true }).selectOption('warn');
  await expect(page.locator('#debug-entries code')).toHaveCount(1);
  await page.locator('#debug-entries button').click();
  expect(await page.evaluate(() => (window as unknown as { copiedLog: string }).copiedLog)).toContain('eventAgeMs=-250');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download filtered JSON' }).click();
  const artifact = await downloaded;
  const json = JSON.parse(await readFile((await artifact.path())!, 'utf8'));
  expect(json.entries).toEqual([entries[1]]);
  await page.getByLabel('Auto-scroll').uncheck();
  await page.getByLabel('Severity', { exact: true }).selectOption('');
  await page.getByLabel('Component', { exact: true }).selectOption('EVENT');
  await page.getByRole('button', { name: 'Copy filtered logs' }).click();
  expect(await page.evaluate(() => (window as unknown as { copiedLog: string }).copiedLog)).toContain('TAKEOFF detected');
});
