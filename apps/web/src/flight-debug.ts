import type { FlightDebug } from '@pax/shared';
const status = document.getElementById('detector-status')!;
const identity = document.getElementById('aircraft-identity')!;
const generation = document.getElementById('flight-generation')!;
const events = document.getElementById('flight-events')!;
let previousEvents = '';
const labels: Record<FlightDebug['status'], string> = {
  disconnected: 'Waiting for the agent and simulator', 'legacy-agent': 'Update the Windows runtime package to enable detection',
  inactive: 'Suppressed — paused, loading, stopped or in slew mode', waiting: 'Waiting for aircraft identity and a fresh sample',
  stale: 'Suppressed — telemetry is stale', tracking: 'Tracking fresh telemetry',
};
export function renderFlightDebug(flight?: FlightDebug) {
  status.textContent = flight ? `${labels[flight.status]} · Phase: ${flight.phase.toUpperCase()}` : 'Detector connection unavailable';
  identity.textContent = `Aircraft: ${flight?.aircraftId ?? '—'}`;
  generation.textContent = `Generation: ${flight?.generation ?? '—'}`;
  const current = JSON.stringify(flight?.events ?? []);
  if (current === previousEvents) return;
  previousEvents = current;
  events.replaceChildren(...(flight?.events ?? []).slice().reverse().map(item => {
    const row = document.createElement('li');
    const { event } = item;
    row.textContent = `${new Date(event.timestamp).toLocaleTimeString()} · ${event.type} · ${event.priority} · ${item.forward ? 'ACCEPTED' : 'SUPPRESSED'} (${item.reason}) · ${Math.round(event.facts.altitudeAglFeet)} ft AGL · ${Math.round(event.facts.indicatedAirspeedKnots)} kt`;
    return row;
  }));
}
