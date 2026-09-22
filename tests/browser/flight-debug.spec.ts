import { test, expect, type WebSocketRoute } from '@playwright/test';

test('flight-event debug shows identity, events and suppression, and clears on disconnect (synthetic snapshot)', async ({ page }) => {
  const origin = 'https://pax.test';
  await page.context().route('https://pax.test/**', async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:31847${url.pathname}${url.search}`, maxRedirects: 0 }) });
  });
  const login = await page.request.post('http://127.0.0.1:31847/login', {
    headers: { Origin: origin }, form: { token: 'browser-test-dashboard-key-not-a-real-secret' }, maxRedirects: 0,
  });
  const value = login.headers()['set-cookie']!.split(';')[0]!.split('=')[1]!;
  await page.context().addCookies([{ name: '__Host-pax_session', value, url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);
  let socket!: WebSocketRoute;
  const generation = '00000000-0000-4000-8000-000000000001';
  const event = { type: 'TAKEOFF', priority: 'HIGH', timestamp: 10000, source: 'telemetry', generation,
    aircraftId: 'Test <script>bad()</script>', facts: { altitudeAglFeet: 30, indicatedAirspeedKnots: 60, verticalSpeedFpm: 500 } };
  const snapshot = { version: 1, type: 'snapshot', bridgeConnected: true, simulatorConnected: true,
    telemetryState: 'waiting', lastReceivedAt: null, telemetry: null,
    flight: { status: 'tracking', phase: 'airborne', generation, aircraftId: event.aircraftId,
      events: [{ event, forward: true, reason: 'accepted' }] } };
  await page.routeWebSocket('**/telemetry', route => { socket = route; route.send(JSON.stringify(snapshot)); });
  await page.goto(`${origin}/`);
  await expect(page.locator('#detector-status')).toContainText('AIRBORNE');
  await expect(page.locator('#aircraft-identity')).toContainText(event.aircraftId);
  await expect(page.locator('#aircraft-identity script')).toHaveCount(0);
  await expect(page.locator('#flight-events')).toContainText('TAKEOFF · HIGH · ACCEPTED');
  socket.send(JSON.stringify({ ...snapshot, flight: { ...snapshot.flight, status: 'inactive', phase: 'unknown', events: [] } }));
  await expect(page.locator('#detector-status')).toContainText('Suppressed');
  await expect(page.locator('#flight-events li')).toHaveCount(0);
  socket.close();
  await expect(page.locator('#detector-status')).toContainText('unavailable');
  await expect(page.locator('#aircraft-identity')).toHaveText('Aircraft: —');
});
