import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { aircraftTelemetrySchema, bridgeMessageSchema, type AircraftTelemetry, type ServerSnapshot } from '@pax/shared';
import { TelemetryStore } from '@pax/telemetry';
import { createTelemetryServer } from '../apps/server/src/server';

const sample: AircraftTelemetry = {
  timestamp: 1000, latitude: 41.2, longitude: -3.1, altitudeMslFeet: 2500,
  altitudeAglFeet: 800, indicatedAirspeedKnots: 110, verticalSpeedFpm: -500,
  headingTrueDegrees: 359.9, onGround: false, gearExtensionPercent: 100,
  flapsLeftExtensionPercent: 25, flapsRightExtensionPercent: 25,
};
const frame = (telemetry: AircraftTelemetry | null = sample, simulatorConnected = true) => ({
  version: 1 as const, type: 'bridgeSnapshot' as const, simulatorConnected, telemetry,
});

test('contract rejects invalid data and impossible disconnected snapshots', () => {
  assert.equal(aircraftTelemetrySchema.safeParse(sample).success, true);
  for (const bad of [{ latitude: 100 }, { headingTrueDegrees: 360 }, { altitudeMslFeet: NaN },
    { gearExtensionPercent: 101 }, { onGround: 1 }, { timestamp: -1 }]) {
    assert.equal(aircraftTelemetrySchema.safeParse({ ...sample, ...bad }).success, false);
  }
  assert.equal(bridgeMessageSchema.safeParse(frame(sample, false)).success, false);
});

test('heartbeats do not make repeated samples fresh; disconnect clears values', () => {
  const store = new TelemetryStore();
  store.connect();
  assert.equal(store.snapshot().telemetryState, 'waiting');
  store.receive(frame(), 1000);
  assert.equal(store.snapshot(2000).telemetryState, 'live');
  store.receive(frame(), 5000);
  assert.equal(store.snapshot(5000).telemetryState, 'stale');
  store.receive(frame({ ...sample, timestamp: 2000 }), 6000);
  assert.equal(store.snapshot(6000).telemetryState, 'live');
  store.receive(frame(null, false), 7000);
  assert.equal(store.snapshot().telemetry, null);
  assert.equal(store.snapshot().simulatorConnected, false);
  store.disconnect();
  assert.equal(store.snapshot().bridgeConnected, false);
});

function waitFor(socket: WebSocket, predicate: (state: ServerSnapshot) => boolean): Promise<ServerSnapshot> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off('message', onMessage); reject(new Error('Snapshot timeout')); }, 8000);
    const onMessage = (data: unknown) => {
      const state = JSON.parse(String(data)) as ServerSnapshot;
      if (predicate(state)) { clearTimeout(timeout); socket.off('message', onMessage); resolve(state); }
    };
    socket.on('message', onMessage);
  });
}

async function setup(t: TestContext) {
  const server = createTelemetryServer(() => {});
  const sockets: WebSocket[] = [];
  t.after(async () => { for (const socket of sockets) socket.terminate(); await server.close(); });
  server.http.listen(0, '127.0.0.1');
  await once(server.http, 'listening');
  const url = `ws://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  const viewer = new WebSocket(`${url}/telemetry`); sockets.push(viewer);
  const initial = waitFor(viewer, s => !s.bridgeConnected);
  await once(viewer, 'open'); await initial;
  async function connectBridge() {
    const socket = new WebSocket(`${url}/bridge`); sockets.push(socket);
    await once(socket, 'open'); return socket;
  }
  return { viewer, connectBridge, url, sockets };
}

test('real WebSockets forward telemetry, clear on disconnect and recover', { timeout: 15000 }, async t => {
  const { viewer, connectBridge } = await setup(t);
  const bridge = await connectBridge();
  const live = waitFor(viewer, s => s.telemetryState === 'live');
  bridge.send(JSON.stringify(frame()));
  assert.deepEqual((await live).telemetry, sample);
  const disconnected = waitFor(viewer, s => !s.simulatorConnected);
  bridge.send(JSON.stringify(frame(null, false)));
  assert.equal((await disconnected).telemetry, null);
  const gone = waitFor(viewer, s => !s.bridgeConnected);
  bridge.close(); await gone;
  const replacement = await connectBridge();
  const recovered = waitFor(viewer, s => s.telemetryState === 'live');
  replacement.send(JSON.stringify(frame({ ...sample, altitudeMslFeet: 3000 })));
  assert.equal((await recovered).telemetry?.altitudeMslFeet, 3000);
  const rejected = once(replacement, 'close');
  replacement.send('{bad json');
  await rejected;
});

test('silent bridge times out and clears telemetry', { timeout: 12000 }, async t => {
  const { viewer, connectBridge } = await setup(t);
  const bridge = await connectBridge();
  const live = waitFor(viewer, s => s.telemetryState === 'live');
  bridge.send(JSON.stringify(frame())); await live;
  const expired = await waitFor(viewer, s => !s.bridgeConnected);
  assert.equal(expired.telemetry, null);
  assert.equal(expired.simulatorConnected, false);
});

test('new viewers get latest state; duplicate and browser-origin producers are rejected', { timeout: 10000 }, async t => {
  const { viewer, connectBridge, url, sockets } = await setup(t);
  const bridge = await connectBridge();
  const live = waitFor(viewer, s => s.telemetryState === 'live');
  bridge.send(JSON.stringify(frame())); await live;
  const lateViewer = new WebSocket(`${url}/telemetry`); sockets.push(lateViewer);
  assert.deepEqual((await waitFor(lateViewer, s => s.telemetryState === 'live')).telemetry, sample);
  async function rejected(origin?: string) {
    const socket = new WebSocket(`${url}/bridge`, origin ? { origin } : {});
    sockets.push(socket);
    const error = await new Promise<Error>((resolve, reject) => {
      socket.once('error', resolve);
      socket.once('open', () => reject(new Error('Producer should have been rejected')));
    });
    assert.match(error.message, /403/);
  }
  await rejected();
  const gone = waitFor(viewer, s => !s.bridgeConnected);
  bridge.close(); await gone;
  await rejected('http://127.0.0.1:5173');
});
