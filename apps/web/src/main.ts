import { serverSnapshotSchema, type AircraftTelemetry } from '@pax/shared';
import './style.css';
import { debugEvent } from './debug-console';
import './session';
import './conversation';
import './voice';
import './reactions';
import { renderFlightDebug } from './flight-debug';
const element = (id: string) => document.getElementById(id)!;
const fields: [Exclude<keyof AircraftTelemetry, 'weather'>, string, string, number][] = [
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
function clear() { element('weather-status').textContent = 'Simulator weather: unavailable'; for (const [key] of fields) element(key).textContent = '—'; }
let lastMessage = 0;
let socket: WebSocket;
let reconnectDelay = 1000;
function connect() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/telemetry`);
  socket.onopen = () => { debugEvent('WEB', 'Telemetry socket connected'); lastMessage = Date.now(); element('server').textContent = 'Server: CONNECTED'; element('server').dataset.state = 'online'; };
  socket.onmessage = event => {
    let value: unknown;
    try { value = JSON.parse(event.data); } catch { return; }
    const parsed = serverSnapshotSchema.safeParse(value);
    if (!parsed.success) return;
    lastMessage = Date.now();
    reconnectDelay = 1000;
    const state = parsed.data;
    document.dispatchEvent(new CustomEvent('pax-flight', { detail: state }));
    renderFlightDebug(state.flight);
    element('bridge').dataset.state = state.bridgeConnected ? 'online' : 'offline';
    element('sim').dataset.state = state.simulatorConnected ? 'online' : 'offline';
    element('bridge').textContent = `Bridge: ${state.bridgeConnected ? 'CONNECTED' : 'DISCONNECTED'}`;
    element('sim').textContent = `MSFS: ${state.simulatorConnected ? 'CONNECTED' : 'DISCONNECTED'}`;
    element('freshness').textContent = `Telemetry: ${state.telemetryState.toUpperCase()}${state.telemetry ? ' · captured ' + new Date(state.telemetry.timestamp).toLocaleTimeString() : ''}`;
    element('values').classList.toggle('stale', state.telemetryState === 'stale');
    if (!state.telemetry) { clear(); return; }
    const weather = state.telemetry.weather;
    const weatherAge = weather ? state.telemetry.timestamp - weather.timestamp : -1;
    element('weather-status').textContent = state.telemetryState !== 'live' || !state.simulation?.active || !weather || weatherAge < 0 || weatherAge > 2500
      ? 'Simulator weather: unavailable (older agent, inactive flight or missing readings)'
      : `Simulator weather · Precipitation: ${weather.precipitation ?? 'unknown'} · In cloud: ${weather.inCloud === null ? 'unknown' : weather.inCloud ? 'yes' : 'no'} · Particle visibility: ${weather.visibilityMeters === null ? 'unknown' : Math.round(weather.visibilityMeters) + ' m'} · Wind: ${weather.windSpeedKnots === null ? 'unknown' : Math.round(weather.windSpeedKnots) + ' kt'}. These readings do not establish clear skies.`;

    for (const [key, , unit, decimals] of fields) {
      const value = state.telemetry[key];
      element(key).textContent = typeof value === 'boolean' ? (value ? 'YES' : 'NO') : `${value.toFixed(decimals)} ${unit}`;
    }
  };
  socket.onclose = event => {
    debugEvent('WEB', 'Telemetry socket disconnected', {}, 'warn');
    if (event.code === 1008) { location.reload(); return; }
    for (const id of ['server', 'bridge', 'sim']) element(id).dataset.state = 'offline';
    element('server').textContent = 'Server: DISCONNECTED · reconnecting';
    element('bridge').textContent = 'Bridge: UNKNOWN';
    element('sim').textContent = 'MSFS: UNKNOWN';
    element('freshness').textContent = 'No server connection';
    document.dispatchEvent(new CustomEvent('pax-flight', { detail: null }));
    renderFlightDebug();
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
