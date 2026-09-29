import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FlightEvent, ServerSnapshot } from '@pax/shared';
import { FlightSessionStore, generatePassenger } from '../apps/server/src/passenger';
import { buildPassengerContext, ConversationStore } from '../apps/server/src/conversation';
import { ReactionCoordinator, perceive } from '../apps/server/src/reactions';
import { flightContext } from '../apps/server/src/flight-context';
import { VoiceLifecycle, type VoiceCommand } from '../apps/web/src/voice/lifecycle';
import { setTimeout as delay } from 'node:timers/promises';

function fixture() {
  let now = Date.now();
  const session = new FlightSessionStore().start({ passenger: { ...generatePassenger(), flightDisposition: 'nervous' }, expectedDurationMinutes: 45 })!;
  const generation = randomUUID();
  const snapshot: ServerSnapshot = { version: 1, type: 'snapshot', bridgeConnected: true, simulatorConnected: true,
    telemetryState: 'live', lastReceivedAt: now, simulation: { generation, aircraftId: 'Cessna', active: true },
    telemetry: { timestamp: now, latitude: 40, longitude: -3, altitudeMslFeet: 3000, altitudeAglFeet: 200,
      indicatedAirspeedKnots: 80, verticalSpeedFpm: 650, headingTrueDegrees: 90, onGround: false,
      gearExtensionPercent: 0, flapsLeftExtensionPercent: 0, flapsRightExtensionPercent: 0 },
    flight: { status: 'tracking', phase: 'airborne', aircraftId: 'Cessna', generation, events: [] } };
  const policy = new ReactionCoordinator(() => now); policy.reset(session.id); policy.observe(session, snapshot);
  function event(type: FlightEvent['type'] = 'TAKEOFF') {
    snapshot.flight!.events.push({ forward: true, reason: 'accepted', event: { type, priority: 'HIGH', source: 'telemetry', timestamp: now,
      aircraftId: 'Cessna', generation: snapshot.simulation!.generation, facts: { altitudeAglFeet: 200, indicatedAirspeedKnots: 80, verticalSpeedFpm: 650 } } });
    policy.observe(session, snapshot);
  }
  return { session, snapshot, policy, event, advance(ms: number) { now += ms; snapshot.lastReceivedAt = now; snapshot.telemetry!.timestamp = now; }, now: () => now };
}

test('flight context allows bounded fresh facts and fails closed for stale, paused, disconnected and legacy snapshots', () => {
  const f = fixture();
  assert.equal(flightContext(f.snapshot, f.now()).available, true);
  const context = buildPassengerContext(f.session, f.snapshot);
  assert.match(context, /climbing/); assert.match(context, /3000/);
  assert.doesNotMatch(context, /"latitude"|"longitude"|"headingTrueDegrees"/);
  for (const snapshot of [ { ...f.snapshot, telemetryState: 'stale' as const }, { ...f.snapshot, bridgeConnected: false },
    { ...f.snapshot, simulation: { ...f.snapshot.simulation!, active: false } }, { ...f.snapshot, simulation: undefined },
    { ...f.snapshot, lastReceivedAt: f.now() - 3001 }, { ...f.snapshot, lastReceivedAt: f.now() + 100 } ]) {
    assert.deepEqual(flightContext(snapshot, f.now()), { available: false });
    assert.match(buildPassengerContext(f.session, snapshot), /"available":false/);
  }
});

test('text samples flight context per request and does not reuse old observations after pause', async () => {
  const f = fixture(), contexts: string[] = [];
  const store = new ConversationStore({ flightSnapshot: () => f.snapshot, provider: async instructions => { contexts.push(instructions); return { text: 'Reply' }; } });
  store.reset(f.session.id);
  await store.send(f.session, { sessionId: f.session.id, requestId: randomUUID(), message: 'Are we climbing?' });
  f.snapshot.simulation!.active = false;
  await store.send(f.session, { sessionId: f.session.id, requestId: randomUUID(), message: 'And now?' });
  assert.match(contexts[0]!, /climbing/); assert.match(contexts[1]!, /"available":false/);
  assert.doesNotMatch(contexts[1]!, /"verticalSpeedFeetPerMinute"/);
});

test('silent preview perceives events, uses passenger disposition and never replays when enabled later', () => {
  const f = fixture(); f.event();
  assert.equal(f.policy.snapshot().decisions[0]!.status, 'preview');
  assert.match(perceive(f.snapshot.flight!.events[0]!.event, f.session).guidance, /mild nerves/);
  f.policy.configure(true); f.policy.observe(f.session, f.snapshot);
  assert.equal(f.policy.claim(true), null);
  f.policy.reset(f.session.id); f.policy.configure(true); f.policy.observe(f.session, f.snapshot);
  assert.equal(f.policy.claim(true), null); assert.equal(f.policy.snapshot().decisions.length, 0);
});

test('automatic events defer behind conversation, dispatch once and enforce cooldown', () => {
  const f = fixture(); f.policy.configure(true); f.event();
  assert.equal(f.policy.claim(false), null); assert.equal(f.policy.snapshot().decisions[0]!.status, 'deferred');
  const claim = f.policy.claim(true); assert.ok(claim); assert.equal(f.policy.claim(true), null);
  f.policy.observe(f.session, f.snapshot); assert.equal(f.policy.claim(true), null);
  f.advance(1000); f.event('LANDING');
  assert.match(f.policy.snapshot().decisions.at(-1)!.reason, /cooldown/);
  const copy = f.policy.snapshot(); copy.decisions[0]!.reason = 'changed';
  assert.notEqual(f.policy.snapshot().decisions[0]!.reason, 'changed');
});

test('pending reactions expire, reset on generation, pause, disabling and session end', () => {
  for (const action of ['expire', 'generation', 'pause', 'disable', 'end']) {
    const f = fixture(); f.policy.configure(true); f.event();
    if (action === 'expire') f.advance(15000);
    if (action === 'generation') f.snapshot.simulation!.generation = randomUUID();
    if (action === 'pause') f.snapshot.simulation!.active = false;
    if (action === 'disable') f.policy.configure(false);
    if (action === 'end') f.policy.reset(null);
    f.policy.observe(action === 'end' ? null : f.session, f.snapshot);
    assert.equal(f.policy.claim(true), null, action);
  }
});

test('new event replaces pending event; rejected and old events cannot cause speech', () => {
  const f = fixture(); f.policy.configure(true); f.event(); f.advance(1000); f.event('LANDING');
  assert.equal(f.policy.snapshot().decisions[0]!.status, 'discarded');
  assert.match(f.policy.claim(true)!.perception.observation, /landed/);
  const old = fixture(); old.policy.configure(true);
  old.snapshot.flight!.events.push({ event: { ...f.snapshot.flight!.events[0]!.event, timestamp: old.now() - 16000,
    generation: old.snapshot.simulation!.generation }, forward: true, reason: 'accepted' });
  old.policy.observe(old.session, old.snapshot); assert.equal(old.policy.claim(true), null);
});

function voiceFixture(prepareResponse?: () => Promise<string>) {
  let now = 1000, microphone = false;
  const sent: VoiceCommand[] = [], failures: string[] = [];
  const state = new VoiceLifecycle({ prepareResponse, send: event => sent.push(event), microphone: enabled => { microphone = enabled; },
    changed: () => {}, failed: message => failures.push(message), transcript: () => {}, usage: () => {} }, () => now);
  state.connecting(); state.ready();
  return { state, sent, failures, microphone: () => microphone, advance: () => { now += 500; } };
}
test('PTT interrupts automatic playback, waits for cancel/clear, and ignores late cancelled response events', t => {
  const f = voiceFixture(); t.after(() => f.state.close());
  assert.equal(f.state.react('Takeoff context'), true);
  assert.deepEqual(f.sent[0], { type: 'response.create', response: { instructions: 'Takeoff context' } });
  f.state.receive({ type: 'response.created', response: { id: 'auto-1' } });
  f.state.receive({ type: 'output_audio_buffer.started', response_id: 'auto-1' });
  f.state.down(); assert.equal(f.state.phase, 'interrupting'); assert.equal(f.microphone(), false);
  f.state.receive({ type: 'output_audio_buffer.cleared', response_id: 'auto-1' }); assert.equal(f.state.phase, 'interrupting');
  f.state.receive({ type: 'response.done', response: { id: 'auto-1', status: 'cancelled' } });
  assert.equal(f.state.phase, 'listening'); assert.equal(f.microphone(), false);
  f.state.receive({ type: 'input_audio_buffer.cleared' }); assert.equal(f.microphone(), true);
  f.state.receive({ type: 'response.done', response: { id: 'auto-1', status: 'cancelled' } });
  assert.equal(f.state.phase, 'listening'); assert.deepEqual(f.failures, []);
});

test('release during interruption never opens the microphone, and busy PTT cannot start a reaction', t => {
  const f = voiceFixture(); t.after(() => f.state.close());
  f.state.down(); assert.equal(f.state.react('Event'), false); f.state.cancel();
  f.state.receive({ type: 'input_audio_buffer.cleared' }); f.state.receive({ type: 'input_audio_buffer.cleared' });
  f.state.react('Event'); f.state.down(); f.state.up();
  f.state.receive({ type: 'response.done', response: { status: 'cancelled' } });
  f.state.receive({ type: 'output_audio_buffer.cleared' });
  assert.equal(f.state.phase, 'idle'); assert.equal(f.microphone(), false);
});

test('late per-turn context after disconnect cannot start a paid response', async t => {
  let resolve!: (s: string) => void;
  const f = voiceFixture(() => new Promise(r => { resolve = r; })); t.after(() => f.state.close());
  f.state.down(); f.state.receive({ type: 'input_audio_buffer.cleared' }); f.advance(); f.state.up();
  await delay(180); assert.ok(resolve); f.state.close(); resolve('Old context'); await delay(0);
  assert.ok(!f.sent.some(event => event.type === 'response.create'));
});

test('automatic expiry cancels pending generation and clearing failure closes rather than resuming speech', async t => {
  const f = voiceFixture(); t.after(() => f.state.close());
  f.state.react('Event', 10); await delay(25);
  assert.equal(f.state.phase, 'interrupting');
  assert.ok(f.sent.some(event => event.type === 'response.cancel'));
  f.state.receive({ type: 'error', error: { event_id: 'unrelated' } });
  assert.equal(f.state.phase, 'disconnected'); assert.equal(f.microphone(), false);
});

test('a cancelled input must drain before an automatic turn can start', t => {
  const f = voiceFixture(); t.after(() => f.state.close());
  f.state.down(); f.state.cancel();
  assert.equal(f.state.react('Event'), false);
  f.state.receive({ type: 'input_audio_buffer.cleared' });
  assert.equal(f.state.react('Event'), false);
  f.state.receive({ type: 'input_audio_buffer.cleared' });
  assert.equal(f.state.react('Event'), true);
});
