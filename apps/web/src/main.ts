import { serverSnapshotSchema, type AircraftTelemetry } from '@pax/shared';
import './style.css';
import './session';
const element = (id: string) => document.getElementById(id)!;
const fields: [keyof AircraftTelemetry, string, string, number][] = [
  ['altitudeMslFeet', 'Altitude MSL', 'ft', 0], ['altitudeAglFeet', 'AGL', 'ft', 0],
  ['indicatedAirspeedKnots', 'Indicated airspeed', 'kt', 1], ['verticalSpeedFpm', 'Vertical speed', 'ft/min', 0],
  ['headingTrueDegrees', 'Heading (true)', '°', 1], ['gearExtensionPercent', 'Gear', '%', 1],
  ['flapsLeftExtensionPercent', 'Flaps (left)', '%', 1], ['flapsRightExtensionPercent', 'Flaps (right)', '%', 1],
  ['onGround', 'On ground', '', 0], ['latitude', 'Latitude', '°', 6], ['longitude', 'Longitude', '°', 6],
];
for (const [key, label] of fields) {
  const row = document.createElement('tr');
  const heading = document.createElement('th'); heading.scope = 'row'; heading.textContent = label;
  const cell = document.createElement('td'); cell.id = key; cell.textContent = '—';
  row.append(heading, cell); element('values').append(row);
}
function clear() { for (const [key] of fields) element(key).textContent = '—'; }
let lastMessage = 0;
let socket: WebSocket;
let reconnectDelay = 1000;
function connect() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/telemetry`);
  socket.onopen = () => { lastMessage = Date.now(); element('server').textContent = 'Server: CONNECTED'; };
  socket.onmessage = event => {
    let value: unknown;
    try { value = JSON.parse(event.data); } catch { return; }
    const parsed = serverSnapshotSchema.safeParse(value);
    if (!parsed.success) return;
    lastMessage = Date.now();
    reconnectDelay = 1000;
    const state = parsed.data;
    element('bridge').textContent = `Bridge: ${state.bridgeConnected ? 'CONNECTED' : 'DISCONNECTED'}`;
    element('sim').textContent = `MSFS: ${state.simulatorConnected ? 'CONNECTED' : 'DISCONNECTED'}`;
    element('freshness').textContent = `Telemetry: ${state.telemetryState.toUpperCase()}${state.telemetry ? ' · captured ' + new Date(state.telemetry.timestamp).toLocaleTimeString() : ''}`;
    element('values').classList.toggle('stale', state.telemetryState === 'stale');
    if (!state.telemetry) { clear(); return; }
    for (const [key, , unit, decimals] of fields) {
      const value = state.telemetry[key];
      element(key).textContent = typeof value === 'boolean' ? (value ? 'YES' : 'NO') : `${value.toFixed(decimals)} ${unit}`;
    }
  };
  socket.onclose = event => {
    if (event.code === 1008) { location.reload(); return; }
    element('server').textContent = 'Server: DISCONNECTED · reconnecting';
    element('bridge').textContent = 'Bridge: UNKNOWN';
    element('sim').textContent = 'MSFS: UNKNOWN';
    element('freshness').textContent = 'No server connection';
    clear();
    setTimeout(connect, reconnectDelay + Math.random() * 500);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  };
  socket.onerror = () => socket.close();
}
setInterval(() => {
  if (socket.readyState === WebSocket.OPEN && Date.now() - lastMessage > 5000) socket.close();
}, 1000);
connect();
