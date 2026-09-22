import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlightEventDetector, FlightEventGate, type DetectionFrame, type FlightEvent } from '../packages/telemetry/src/flight-events';
import type { AircraftTelemetry } from '@pax/shared';
const base: AircraftTelemetry = { timestamp: 0, latitude: 40, longitude: -3, altitudeMslFeet: 1000, altitudeAglFeet: 0,
  indicatedAirspeedKnots: 60, verticalSpeedFpm: 0, headingTrueDegrees: 100, onGround: true,
  gearExtensionPercent: 100, flapsLeftExtensionPercent: 0, flapsRightExtensionPercent: 0 };
function frame(second: number, changes: Partial<AircraftTelemetry> = {}, extra: Partial<DetectionFrame> = {}): DetectionFrame {
  return { generation: 'flight-1', aircraftId: 'stock-test-aircraft', fresh: true,
    telemetry: { ...base, timestamp: second * 1000, ...changes }, ...extra };
}
function ground(d: FlightEventDetector) { for (let i = 0; i <= 2; i++) assert.deepEqual(d.receive(frame(i)), []); }
function airborne(d: FlightEventDetector, offset = 3) {
  return [0, 1, 2].flatMap(i => d.receive(frame(offset + i, { onGround: false, altitudeAglFeet: 5 + i * 10, verticalSpeedFpm: 500 })));
}
test('takeoff needs established ground, sustained air, speed and climb; landing needs approach and stable touchdown', () => {
  const detector = new FlightEventDetector(); ground(detector);
  const takeoff = airborne(detector); assert.equal(takeoff.length, 1); assert.equal(takeoff[0]!.type, 'TAKEOFF');
  assert.deepEqual(airborne(detector, 6), []);
  for (let i = 9; i <= 11; i++) detector.receive(frame(i, { onGround: false, altitudeAglFeet: 80 - (i - 9) * 30, verticalSpeedFpm: -500 }));
  const landing = [12, 13, 14].flatMap(i => detector.receive(frame(i)));
  assert.deepEqual(landing.map(e => e.type), ['LANDING']);
  assert.equal(detector.snapshot().phase, 'ground');
  assert.deepEqual(detector.receive(frame(15)), []);
});
test('spawn in flight establishes silently, bounces and slow ground glitches do not emit transitions', () => {
  const detector = new FlightEventDetector();
  for (let i = 0; i <= 4; i++) assert.deepEqual(detector.receive(frame(i, { onGround: false, altitudeAglFeet: 1000 })), []);
  assert.equal(detector.snapshot().phase, 'airborne');
  assert.deepEqual(detector.receive(frame(5)), []);
  assert.deepEqual(detector.receive(frame(6, { onGround: false, altitudeAglFeet: 30 })), []);
  detector.reset(); ground(detector);
  for (let i = 3; i <= 7; i++) assert.deepEqual(detector.receive(frame(i, { onGround: false, altitudeAglFeet: 30, indicatedAirspeedKnots: 5 })), []);
});
test('stale data, identity changes, sample gaps, rewind and teleport reset the baseline without false takeoff', () => {
  for (const disruption of [
    frame(3, {}, { fresh: false }), frame(3, {}, { generation: 'new-flight' }), frame(3, {}, { aircraftId: 'other-aircraft' }),
    frame(10), frame(1), frame(3, { altitudeMslFeet: 10000 }), frame(3, {}, { aircraftId: '' }),
  ]) {
    const detector = new FlightEventDetector(); ground(detector);
    assert.deepEqual(detector.receive(disruption), []);
    const start = (disruption.telemetry?.timestamp ?? 3000) / 1000 + 1;
    assert.deepEqual(airborne(detector, start), []);
  }
});
test('duplicate samples never confirm a transition and a snapshot cannot mutate detector state', () => {
  const detector = new FlightEventDetector(); ground(detector);
  const sample = frame(3, { onGround: false, altitudeAglFeet: 25, verticalSpeedFpm: 500 });
  for (let i = 0; i < 10; i++) assert.deepEqual(detector.receive(sample), []);
  const state = detector.snapshot(); state.phase = 'airborne'; assert.equal(detector.snapshot().phase, 'ground');
});
test('objective gate rejects stale, duplicate and repeated events, independently of passenger salience', () => {
  const detector = new FlightEventDetector(); ground(detector);
  const event = airborne(detector)[0] as FlightEvent;
  const gate = new FlightEventGate();
  assert.equal(gate.accept(event, event.timestamp + 4000).reason, 'stale');
  assert.equal(gate.accept(event, event.timestamp).forward, true);
  assert.equal(gate.accept(event, event.timestamp).reason, 'cooldown');
  assert.equal(gate.accept({ ...event, timestamp: event.timestamp + 16000 }, event.timestamp + 16000).forward, true);
  assert.equal(gate.accept({ ...event, generation: 'next-flight' }, event.timestamp).forward, true);
});
