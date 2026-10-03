import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { aircraftTelemetrySchema, passengerProfileSchema, type ServerSnapshot } from '@pax/shared';
import { flightContext, passengerWeather } from '../apps/server/src/flight-context';
import { buildPassengerContext, ConversationStore } from '../apps/server/src/conversation';
import { FlightSessionStore, generatePassenger } from '../apps/server/src/passenger';
import { VoiceStore } from '../apps/server/src/voice';

function snapshot(): ServerSnapshot {
  const now = Date.now(), generation = randomUUID();
  return { version: 1, type: 'snapshot', bridgeConnected: true, simulatorConnected: true, telemetryState: 'live',
    lastReceivedAt: now, simulation: { active: true, aircraftId: 'Test aircraft', generation },
    flight: { status: 'tracking', phase: 'ground', generation, aircraftId: 'Test aircraft', events: [] },
    telemetry: { timestamp: now, latitude: 40, longitude: -3, altitudeMslFeet: 2345, altitudeAglFeet: 4,
      indicatedAirspeedKnots: 0, verticalSpeedFpm: 0, onGround: true, headingTrueDegrees: 90,
      gearExtensionPercent: 100, flapsLeftExtensionPercent: 0, flapsRightExtensionPercent: 0 } };
}
const session = () => new FlightSessionStore().start({ passenger: generatePassenger(), expectedDurationMinutes: 45 })!;
const payload = (instructions: string) => JSON.parse(instructions.split('\n').at(-1)!);

test('passenger knows ground/motion without instrument readings, aircraft identity or coordinates', () => {
  const state = snapshot();
  const data = payload(buildPassengerContext(session(), state)).currentFlight;
  assert.equal(data.motion, 'on the ground'); assert.equal(data.location, 'unknown');
  assert.deepEqual(Object.keys(data).sort(), ['available', 'location', 'motion', 'weather']);
  assert.doesNotMatch(JSON.stringify(data), /\d/); // Includes the reported four-foot regression.
  state.telemetry!.onGround = false; state.telemetry!.verticalSpeedFpm = 800;
  assert.equal(flightContext(state).motion, 'climbing');
  state.telemetry!.verticalSpeedFpm = -800;
  assert.equal(flightContext(state).motion, 'descending');
});

test('weather is optional on older agents; bad fields do not break core telemetry or become clear weather', () => {
  const sample = snapshot().telemetry!;
  assert.equal(aircraftTelemetrySchema.safeParse(sample).success, true);
  assert.equal(passengerWeather(sample).available, false);
  const malformed = aircraftTelemetrySchema.parse({ ...sample, weather: { timestamp: sample.timestamp,
    visibilityMeters: -1, windSpeedKnots: Infinity, inCloud: 'false', precipitation: 'sunshine' } });
  assert.equal(malformed.onGround, true);
  assert.equal(passengerWeather(malformed).available, false);
  assert.equal(passengerWeather(malformed).visibility, 'unknown');
  assert.equal(aircraftTelemetrySchema.parse({ ...sample, weather: { timestamp: 'bad' } }).weather, null);
});

test('weather interpretation respects cloud/visibility limits and does not equate wind with turbulence', () => {
  const sample = snapshot().telemetry!;
  sample.weather = { timestamp: sample.timestamp, visibilityMeters: 100000, inCloud: true, precipitation: 'rain', windSpeedKnots: 25 };
  const rainy = passengerWeather(sample);
  assert.equal(rainy.precipitation, 'rain'); assert.equal(rainy.visibility, 'obscured by cloud');
  assert.equal(rainy.skyCoverage, 'unknown'); assert.equal(rainy.wind, 'strong wind around the aircraft');
  assert.doesNotMatch(JSON.stringify(rainy), /turbulence|storm|danger|\d/);
  sample.weather.inCloud = false; sample.weather.precipitation = 'none';
  assert.match(passengerWeather(sample).visibility, /overall visibility unknown/);
  assert.equal(passengerWeather(sample).skyCoverage, 'unknown');
  sample.weather.visibilityMeters = 500;
  assert.match(passengerWeather(sample).visibility, /very limited/);
  for (const precipitation of ['snow', 'rain-and-snow'] as const) {
    sample.weather.precipitation = precipitation; assert.equal(passengerWeather(sample).precipitation, precipitation);
  }
});

test('weather expires independently and disappears on pause/disconnect/stale flight', () => {
  const state = snapshot(), sample = state.telemetry!;
  sample.weather = { timestamp: sample.timestamp - 2501, visibilityMeters: 500, inCloud: true, precipitation: 'snow', windSpeedKnots: 20 };
  assert.equal(flightContext(state).weather.available, false);
  sample.weather.timestamp = sample.timestamp + 1;
  assert.equal(flightContext(state).weather.available, false);
  sample.weather.timestamp = sample.timestamp;
  assert.equal(flightContext(state).weather.available, true);
  for (const changed of [{ ...state, telemetryState: 'stale' as const }, { ...state, bridgeConnected: false },
    { ...state, simulation: { ...state.simulation!, active: false } }]) {
    assert.equal(flightContext(changed).weather.available, false);
    assert.doesNotMatch(JSON.stringify(flightContext(changed)), /snow/);
  }
});

test('direct weather and exact-height questions reach text provider with explicit unknowns and no raw readings', async () => {
  const state = snapshot(), current = session();
  const questions = ['How is the weather?', 'Is visibility good?', 'Where are we?', 'How many feet above ground are we?'];
  let requests = 0;
  const store = new ConversationStore({ flightSnapshot: () => state, provider: async (instructions, messages) => {
    assert.equal(messages.at(-1)!.content, questions[requests++]);
    const context = payload(instructions).currentFlight;
    assert.equal(context.weather.precipitation, 'unknown');
    assert.equal(context.weather.visibility, 'unknown');
    assert.equal(context.motion, 'on the ground');
    assert.doesNotMatch(JSON.stringify(context), /\d/);
    assert.match(instructions, /Never quote or invent numerical altitude/);
    assert.match(instructions, /If asked about missing weather or visibility/);
    return { text: 'Fixture response; actual model adherence requires live testing.' };
  } });
  store.reset(current.id);
  for (const message of questions) await store.send(current, { sessionId: current.id, requestId: randomUUID(), message });
  assert.equal(requests, questions.length);
});

test('selected voice reaches provider; initial voice context marks observations unknown and rejects arbitrary voices', async () => {
  const current = session(); current.passenger.voice = 'ash';
  let called = false;
  const voice = new VoiceStore({ provider: async (_, instructions, selected) => {
    called = true; assert.equal(selected, 'ash');
    assert.equal(payload(instructions).currentFlight.weather.available, false);
    assert.match(instructions, /If asked about missing weather or visibility/);
    return { sdp: 'v=0', close: async () => {} };
  } });
  await voice.start(current, { sessionId: current.id, connectionId: randomUUID(), sdp: 'v=0' }, false);
  assert.equal(called, true); await voice.stop();
  assert.equal(passengerProfileSchema.safeParse({ ...current.passenger, voice: 'arbitrary' }).success, false);
  const { voice: ignored, ...legacy } = current.passenger;
  assert.equal(passengerProfileSchema.parse(legacy).voice, 'marin');
});

test('dispositions change delivery guidance without changing the facts passengers receive', () => {
  const current = session(), state = snapshot(), prompts: string[] = [];
  for (const flightDisposition of ['calm', 'curious', 'nervous', 'enthusiastic'] as const) {
    current.passenger.flightDisposition = flightDisposition;
    prompts.push(buildPassengerContext(current, state));
  }
  assert.match(prompts[0]!, /understated warmth/); assert.match(prompts[1]!, /thoughtful and interested/);
  assert.match(prompts[2]!, /mild nerves/); assert.match(prompts[3]!, /lively but believable/);
  for (const prompt of prompts) assert.deepEqual(payload(prompt).currentFlight, payload(prompts[0]!).currentFlight);
});
