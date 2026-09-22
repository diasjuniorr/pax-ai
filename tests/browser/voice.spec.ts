import { test, expect } from '@playwright/test';

test('voice preview holds/mutes microphone, waits for playback, and releases resources (stubbed WebRTC/provider)', async ({ page }) => {
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
  let active = false, stopped = 0;
  await page.context().route('https://pax.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/voice')) {
      if (url.pathname.endsWith('/start')) {
        expect(route.request().postDataJSON().sessionId).toBe((await start.json()).session.id);
        active = true; await route.fulfill({ json: { sdp: 'v=0\r\nfixture' } }); return;
      }
      if (url.pathname.endsWith('/stop')) { active = false; stopped++; }
      await route.fulfill({ json: { configured: true, active } }); return;
    }
    const response = await route.fetch({ url: `http://127.0.0.1:31847${url.pathname}${url.search}`, maxRedirects: 0 });
    await route.fulfill({ response });
  });
  // No microphone hardware or paid API: exercise UI/lifecycle with explicit test-only transports.
  await page.addInitScript(() => {
    const fixture = { enabled: false, stopped: false, closed: false, sent: [] as string[], emit: (_event: unknown) => {},
      deferMicrophone: false, resolveMicrophone: () => {} };
    Object.assign(window, { voiceFixture: fixture });
    const track = { get enabled() { return fixture.enabled; }, set enabled(value: boolean) { fixture.enabled = value; },
      stop() { fixture.stopped = true; fixture.enabled = false; }, onended: null };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      fixture.stopped = false;
      if (fixture.deferMicrophone) await new Promise<void>(resolve => { fixture.resolveMicrophone = resolve; });
      return stream;
    } });
    class Peer {
      connectionState = 'new'; ontrack = null; onconnectionstatechange = null;
      channel = { readyState: 'connecting', onopen: (() => {}) as () => void, onclose: () => {}, onerror: () => {},
        onmessage: (_event: { data: string }) => {},
        send: (value: string) => { const event = JSON.parse(value); fixture.sent.push(event.type);
          if (event.type === 'input_audio_buffer.clear') setTimeout(() => fixture.emit({ type: 'input_audio_buffer.cleared' }), 0); },
        close: () => { this.channel.readyState = 'closed'; },
      };
      createDataChannel() { fixture.emit = event => this.channel.onmessage({ data: JSON.stringify(event) }); return this.channel; }
      addTrack() {}
      async createOffer() { return { type: 'offer', sdp: 'v=0\r\nfixture' }; }
      async setLocalDescription() {}
      async setRemoteDescription() { this.channel.readyState = 'open'; fixture.closed = false; this.channel.onopen(); }
      close() { fixture.closed = true; this.connectionState = 'closed'; }
    }
    Object.defineProperty(window, 'RTCPeerConnection', { value: Peer });
  });
  const read = () => page.evaluate(() => (window as unknown as { voiceFixture: { enabled: boolean; stopped: boolean; closed: boolean; sent: string[] } }).voiceFixture);
  await page.goto(`${origin}/`);
  await page.getByRole('button', { name: 'Connect voice', exact: true }).click();
  await expect(page.locator('#voice-status')).toContainText('Ready');
  expect((await read()).enabled).toBe(false);
  const talk = page.getByRole('button', { name: 'Hold to talk' });
  await talk.focus(); await page.keyboard.down('Space');
  await expect.poll(async () => (await read()).enabled).toBe(true);
  await page.waitForTimeout(300); await page.keyboard.up('Space');
  await expect.poll(async () => (await read()).sent).toContain('response.create');
  expect((await read()).enabled).toBe(false);
  await page.evaluate(() => {
    const f = (window as unknown as { voiceFixture: { emit: (event: unknown) => void } }).voiceFixture;
    f.emit({ type: 'output_audio_buffer.started' });
    f.emit({ type: 'response.done', response: { status: 'completed', usage: { input_tokens: 12, output_tokens: 5 } } });
    f.emit({ type: 'response.output_audio_transcript.done', transcript: 'Hello, pilot.' });
  });
  await expect(page.locator('#voice-status')).toContainText('speaking');
  await expect(talk).toBeDisabled();
  await page.evaluate(() => (window as unknown as { voiceFixture: { emit: (event: unknown) => void } }).voiceFixture.emit({ type: 'output_audio_buffer.stopped' }));
  await expect(talk).toBeEnabled();
  await expect(page.locator('#voice-transcript')).toHaveText('Hello, pilot.');
  await expect(page.locator('#voice-usage')).toContainText('12 input tokens');
  await page.getByRole('button', { name: 'Disconnect voice', exact: true }).click();
  expect((await read()).stopped).toBe(true); expect((await read()).closed).toBe(true);
  await expect.poll(() => stopped).toBe(1);
  // A microphone permission result arriving after Cancel must release the new track too.
  await page.evaluate(() => { (window as unknown as { voiceFixture: { deferMicrophone: boolean } }).voiceFixture.deferMicrophone = true; });
  await page.getByRole('button', { name: 'Connect voice', exact: true }).click();
  await expect(page.locator('#voice-status')).toContainText('Connecting');
  await page.getByRole('button', { name: 'Disconnect voice', exact: true }).click();
  await page.evaluate(() => { (window as unknown as { voiceFixture: { resolveMicrophone: () => void } }).voiceFixture.resolveMicrophone(); });
  await expect.poll(async () => (await read()).stopped).toBe(true);
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page.locator('#voice-status')).toContainText('Start a flight session');
});
