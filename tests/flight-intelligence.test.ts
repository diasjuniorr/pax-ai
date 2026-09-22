import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlightIntelligence, TelemetryStore } from '@pax/telemetry';
import { bridgeMessageSchema, serverSnapshotSchema, type BridgeMessage } from '@pax/shared';
const generation = '00000000-0000-4000-8000-000000000001';
function frame(second: number, airborne = false): BridgeMessage {
  return { version: 1, type: 'bridgeSnapshot', simulatorConnected: true,
    simulation: { generation, aircraftId: 'Test aircraft', active: true }, telemetry: {
      timestamp: 1000 + second * 1000, latitude: 40, longitude: -3, altitudeMslFeet: 1000,
      altitudeAglFeet: airborne ? (second - 2) * 10 : 0, indicatedAirspeedKnots: 60,
      verticalSpeedFpm: airborne ? 500 : 0, headingTrueDegrees: 100, onGround: !airborne,
      gearExtensionPercent: 100, flapsLeftExtensionPercent: 0, flapsRightExtensionPercent: 0,
    } };
}
test('v1 accepts old agents but strictly validates new continuity metadata', () => {
  const legacy = frame(0); delete legacy.simulation;
  assert.equal(bridgeMessageSchema.safeParse(legacy).success, true);
  for (const simulation of [{ generation: 'bad', aircraftId: 'A', active: true }, { generation, aircraftId: '', active: true }, { generation, aircraftId: 'A' }])
    assert.equal(bridgeMessageSchema.safeParse({ ...legacy, simulation }).success, false);
});
test('live store-to-detector pipeline produces bounded wire-valid debug events and restores late-viewer state', () => {
  const store = new TelemetryStore(), intelligence = new FlightIntelligence();
  let now = 0;
  for (let i = 0; i < 6; i++) {
    now = 1000 + i * 1000; store.receive(frame(i, i >= 3), now);
    intelligence.update(store.snapshot(now));
  }
  const flight = intelligence.update(store.snapshot(now));
  assert.equal(flight.status, 'tracking'); assert.equal(flight.phase, 'airborne');
  assert.deepEqual(flight.events.map(item => item.event.type), ['TAKEOFF']);
  assert.equal(flight.events[0]!.forward, true);
  assert.equal(serverSnapshotSchema.safeParse({ ...store.snapshot(now), flight }).success, true);
  flight.events[0]!.event.type = 'LANDING';
  assert.equal(intelligence.update(store.snapshot(now)).events[0]!.event.type, 'TAKEOFF');
});
test('legacy, pause, stale and disconnect states suppress detection; resume learns silently', () => {
  for (const reason of ['legacy-agent', 'inactive', 'stale', 'disconnected'] as const) {
    const store = new TelemetryStore(), intelligence = new FlightIntelligence();
    for (let i = 0; i < 3; i++) { store.receive(frame(i), 1000 + i * 1000); intelligence.update(store.snapshot(1000 + i * 1000)); }
    const interruption = frame(3, true);
    if (reason === 'legacy-agent') delete interruption.simulation;
    if (reason === 'inactive') interruption.simulation!.active = false;
    if (reason === 'disconnected') { interruption.simulatorConnected = false; interruption.telemetry = null; }
    store.receive(interruption, 4000);
    assert.equal(intelligence.update(store.snapshot(reason === 'stale' ? 8000 : 4000)).status, reason);
    for (let i = 4; i < 8; i++) {
      store.receive(frame(i, true), 1000 + i * 1000);
      assert.equal(intelligence.update(store.snapshot(1000 + i * 1000)).events.length, 0);
    }
  }
});
test('same timestamp in a new generation is accepted; disconnect clears identity and current-generation history', () => {
  const store = new TelemetryStore(), intelligence = new FlightIntelligence();
  for (let i = 0; i < 6; i++) { store.receive(frame(i, i >= 3), 1000 + i * 1000); intelligence.update(store.snapshot(1000 + i * 1000)); }
  const next = frame(5, true); next.simulation!.generation = '00000000-0000-4000-8000-000000000002';
  next.telemetry!.altitudeMslFeet = 2000;
  store.receive(next, 7000);
  assert.equal(store.snapshot(7000).telemetry!.altitudeMslFeet, 2000);
  const state = intelligence.update(store.snapshot(7000)); assert.equal(state.events.length, 0); assert.equal(state.phase, 'unknown');
  store.disconnect(); assert.equal(store.snapshot().simulation, null);
  assert.equal(intelligence.update(store.snapshot()).aircraftId, null);
});
test('repeated status publication does not flood detector logs', () => {
  const logs: string[] = [];
  const intelligence = new FlightIntelligence((_, message) => logs.push(message));
  const store = new TelemetryStore();
  for (let i = 0; i < 10; i++) intelligence.update(store.snapshot());
  assert.equal(logs.length, 0);
  store.receive(frame(0), 1000);
  for (let i = 0; i < 10; i++) intelligence.update(store.snapshot(1000));
  assert.deepEqual(logs, ['tracking']);
});
