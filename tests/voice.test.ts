import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createVoiceProvider, VoiceStore, type VoiceCall } from '../apps/server/src/voice';
import { FlightSessionStore, generatePassenger } from '../apps/server/src/passenger';
import { VoiceLifecycle } from '../apps/web/src/voice/lifecycle';

function session() { return new FlightSessionStore().start({ passenger: generatePassenger(), expectedDurationMinutes: 30 })!; }
function owner(id: string) { return { sessionId: id, connectionId: randomUUID(), sdp: 'v=0\r\n' }; }

test('voice adapter creates a bounded manual-turn call with server credentials and hangs up by validated call ID', async () => {
  let calls = 0;
  const provider = createVoiceProvider('test-secret', 'gpt-realtime', async (url, options) => {
    assert.equal((options!.headers as Record<string, string>).Authorization, 'Bearer test-secret');
    if (++calls === 1) {
      assert.equal(url, 'https://api.openai.com/v1/realtime/calls');
      const body = options!.body as FormData;
      assert.equal(body.get('sdp'), 'v=0\r\n');
      const config = JSON.parse(String(body.get('session')));
      assert.equal(config.instructions, 'Test profile');
      assert.equal(config.model, 'gpt-realtime');
      assert.equal(config.audio.input.turn_detection, null);
      assert.equal(config.truncation.token_limits.post_instructions, 6000);
      assert.equal(config.max_output_tokens, 512);
      assert.deepEqual(config.output_modalities, ['audio']);
      return new Response('v=0\r\nanswer', { status: 201, headers: { Location: '/v1/realtime/calls/rtc_test' } });
    }
    assert.equal(url, 'https://api.openai.com/v1/realtime/calls/rtc_test/hangup');
    return new Response(null, { status: 200 });
  })!;
  const call = await provider('v=0\r\n', 'Test profile');
  assert.equal(call.sdp, 'v=0\r\nanswer');
  await call.close(); assert.equal(calls, 2);
  assert.equal(createVoiceProvider(''), undefined);
});

test('voice adapter sanitizes errors, rejects missing call IDs and closes malformed answers', async () => {
  for (const response of [new Response('secret internals', { status: 401 }), new Response('v=0\r\n', { status: 201 })]) {
    const provider = createVoiceProvider('secret', undefined, async () => response)!;
    await assert.rejects(provider('v=0', ''), error => error instanceof Error && !error.message.includes('secret internals'));
  }
  let calls = 0;
  const provider = createVoiceProvider('secret', undefined, async () => ++calls === 1
    ? new Response('bad answer', { headers: { Location: '/v1/realtime/calls/rtc_bad' } }) : new Response(null))!;
  await assert.rejects(provider('v=0', ''), /invalid connection answer/);
  assert.equal(calls, 2);
});

test('voice enforces one owner, rejects stale control, expires leases and allows recovery', async () => {
  let now = 1000, closes = 0;
  const current = session(), input = owner(current.id);
  const store = new VoiceStore({ now: () => now, provider: async (_, instructions) => {
    assert.match(instructions, /plannedFlight/); return { sdp: 'v=0', close: async () => { closes++; } };
  } });
  await assert.rejects(store.start(null, input, false), /Start a flight/);
  await assert.rejects(store.start(current, input, true), /already active/);
  await store.start(current, input, false);
  await assert.rejects(store.start(current, owner(current.id), false), /already active/);
  await assert.rejects(store.control(owner(current.id), true), /Unrecognized key|no longer active/);
  const control = { sessionId: input.sessionId, connectionId: input.connectionId };
  now += 10000; await store.control(control, false);
  now += 10000; await store.expire(); assert.equal(store.snapshot().active, true);
  now += 6000; await store.expire(); assert.equal(store.snapshot().active, false); assert.equal(closes, 1);
  await assert.rejects(store.control(control, false), /no longer active/);
  await store.start(current, owner(current.id), false); await store.stop(); assert.equal(closes, 2);
  const disabled = new VoiceStore(); await assert.rejects(disabled.start(current, input, false), /OPENAI_API_KEY/);
});

test('late voice creation after session end is disposed without overwriting a new connection', async () => {
  let resolve!: (call: VoiceCall) => void, closes = 0, calls = 0;
  const current = session(), input = owner(current.id);
  const store = new VoiceStore({ provider: async () => {
    if (++calls === 1) return new Promise(r => { resolve = r; });
    return { sdp: 'v=0', close: async () => {} };
  } });
  const pending = store.start(current, input, false);
  await store.stop();
  await store.start(current, owner(current.id), false);
  resolve({ sdp: 'v=0', close: async () => { closes++; } });
  await assert.rejects(pending, /ended while connecting/);
  assert.equal(closes, 1); assert.equal(store.snapshot().active, true); await store.stop();
});

function lifecycleFixture() {
  let now = 1000, microphone = false;
  const sent: string[] = [], failures: string[] = [];
  const state = new VoiceLifecycle({ send: event => sent.push(event.type), microphone: enabled => { microphone = enabled; },
    changed: () => {}, failed: message => failures.push(message), transcript: () => {}, usage: () => {} }, () => now);
  return { state, sent, failures, advance: () => { now += 500; }, microphone: () => microphone };
}
test('PTT gates microphone on clear acknowledgement, commits on release and waits for playback completion', async t => {
  const f = lifecycleFixture(); t.after(() => f.state.close());
  f.state.connecting(); f.state.ready();
  f.state.down(); assert.equal(f.microphone(), false);
  f.state.receive({ type: 'input_audio_buffer.cleared' }); assert.equal(f.microphone(), true);
  f.advance(); f.state.up(); assert.equal(f.microphone(), false); assert.equal(f.state.phase, 'processing');
  await delay(180);
  assert.deepEqual(f.sent, ['input_audio_buffer.clear', 'input_audio_buffer.commit', 'response.create']);
  f.state.down(); assert.equal(f.microphone(), false);
  f.state.receive({ type: 'output_audio_buffer.started' }); assert.equal(f.state.phase, 'speaking');
  f.state.receive({ type: 'response.done', response: { status: 'completed' } }); assert.equal(f.state.phase, 'speaking');
  f.state.receive({ type: 'output_audio_buffer.stopped' }); assert.equal(f.state.phase, 'idle');
});
test('quick taps/cancellation never commit and delayed acknowledgements cannot enable a cancelled microphone', async t => {
  const f = lifecycleFixture(); t.after(() => f.state.close());
  f.state.connecting(); f.state.ready(); f.state.down(); f.state.up();
  assert.equal(f.state.phase, 'idle');
  f.state.receive({ type: 'input_audio_buffer.cleared' }); assert.equal(f.microphone(), false);
  f.state.down(); // Two clear acknowledgements still outstanding.
  f.state.receive({ type: 'input_audio_buffer.cleared' }); assert.equal(f.microphone(), false);
  f.state.receive({ type: 'input_audio_buffer.cleared' }); assert.equal(f.microphone(), true);
  f.advance(); f.state.up(); f.state.close(); await delay(180);
  assert.ok(!f.sent.includes('response.create')); assert.equal(f.microphone(), false);
});
test('provider failure mutes input and late events after disconnect do nothing', () => {
  const f = lifecycleFixture(); f.state.connecting(); f.state.ready(); f.state.down();
  f.state.receive({ type: 'input_audio_buffer.cleared' });
  f.state.receive({ type: 'error' });
  assert.equal(f.microphone(), false); assert.equal(f.state.phase, 'disconnected'); assert.equal(f.failures.length, 1);
  f.state.receive({ type: 'output_audio_buffer.started' }); assert.equal(f.state.phase, 'disconnected');
});

test('a channel closing while sending cannot revive an idle/listening lifecycle', () => {
  let state: VoiceLifecycle;
  let failSend = false;
  state = new VoiceLifecycle({ send: () => { if (failSend) state.close(); }, microphone: () => {}, changed: () => {},
    failed: () => {}, transcript: () => {}, usage: () => {} });
  state.connecting(); state.ready(); failSend = true; state.down();
  assert.equal(state.phase, 'disconnected');
  failSend = false; state.connecting(); state.ready(); state.down(); failSend = true; state.cancel();
  assert.equal(state.phase, 'disconnected'); state.close();
});
