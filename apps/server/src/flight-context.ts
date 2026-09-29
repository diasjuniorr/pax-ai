import type { ServerSnapshot } from '@pax/shared';

// Small allowlist: no coordinates, scenery, weather or inferred approach phase.
export function flightContext(snapshot?: ServerSnapshot, now = Date.now()) {
  const sample = snapshot?.telemetry;
  const valid = snapshot?.bridgeConnected && snapshot.simulatorConnected && snapshot.simulation?.active
    && snapshot.simulation.aircraftId && snapshot.flight?.status === 'tracking' && snapshot.telemetryState === 'live'
    && snapshot.lastReceivedAt !== null && now - snapshot.lastReceivedAt >= 0 && now - snapshot.lastReceivedAt <= 3000;
  if (!valid || !sample) return { available: false as const };
  return {
    available: true as const, observedAt: sample.timestamp, generation: snapshot.simulation!.generation,
    aircraft: snapshot.simulation!.aircraftId, phase: snapshot.flight!.phase,
    motion: sample.onGround ? 'on ground' : sample.verticalSpeedFpm > 150 ? 'climbing'
      : sample.verticalSpeedFpm < -150 ? 'descending' : 'approximately level',
    altitudeFeetMsl: Math.round(sample.altitudeMslFeet), heightFeetAgl: Math.round(sample.altitudeAglFeet),
    airspeedKnots: Math.round(sample.indicatedAirspeedKnots), verticalSpeedFeetPerMinute: Math.round(sample.verticalSpeedFpm),
    onGround: sample.onGround,
  };
}
