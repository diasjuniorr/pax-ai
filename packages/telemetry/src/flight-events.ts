import type { AircraftTelemetry, FlightEvent } from '@pax/shared';
export type { FlightEvent } from '@pax/shared';
export type DetectionFrame = {
  generation: string; aircraftId: string; fresh: boolean; telemetry: AircraftTelemetry | null;
};
export type FlightWorldState = {
  phase: 'unknown' | 'ground' | 'airborne'; fresh: boolean;
  generation: string | null; aircraftId: string | null;
};

// Initial fixed-wing heuristics for 1 Hz samples. Synthetic verification only:
// Wired through FlightIntelligence; aircraft-specific live tuning is still required.
export class FlightEventDetector {
  private world: FlightWorldState = { phase: 'unknown', fresh: false, generation: null, aircraftId: null };
  private samples: AircraftTelemetry[] = [];
  private candidate?: { onGround: boolean; since: number; approach: boolean };
  reset() {
    this.world = { phase: 'unknown', fresh: false, generation: null, aircraftId: null };
    this.samples = []; this.candidate = undefined;
  }
  snapshot(): FlightWorldState { return { ...this.world }; }
  receive(frame: DetectionFrame): FlightEvent[] {
    const sample = frame.telemetry;
    if (!frame.fresh || !sample || !frame.generation || !frame.aircraftId) { this.reset(); return []; }
    if (frame.generation !== this.world.generation || frame.aircraftId !== this.world.aircraftId) this.reset();
    const previous = this.samples.at(-1);
    if (previous && sample.timestamp === previous.timestamp) return []; // Replayed heartbeats never advance evidence.
    if (previous) {
      const seconds = (sample.timestamp - previous.timestamp) / 1000;
      if (seconds <= 0 || seconds > 2.5 || Math.abs(sample.altitudeMslFeet - previous.altitudeMslFeet) > seconds * 300
        || Math.abs(sample.latitude - previous.latitude) > seconds * 0.01 || Math.abs(sample.longitude - previous.longitude) > seconds * 0.01) this.reset();
    }
    if (sample.indicatedAirspeedKnots < 0 || sample.indicatedAirspeedKnots > 500 || sample.altitudeAglFeet < -20) { this.reset(); return []; }
    this.world = { ...this.world, fresh: true, generation: frame.generation, aircraftId: frame.aircraftId };
    const history = this.samples;
    this.samples = [...history, { ...sample }].slice(-12);
    if (!this.candidate || this.candidate.onGround !== sample.onGround) {
      const approach = history.slice(-4).filter(s => !s.onGround && s.altitudeAglFeet <= 120
        && s.indicatedAirspeedKnots >= 25 && s.verticalSpeedFpm <= -100);
      this.candidate = { onGround: sample.onGround, since: sample.timestamp,
        approach: approach.length >= 2 && approach.at(-1)!.altitudeAglFeet < approach[0]!.altitudeAglFeet };
    }
    const candidate = this.candidate;
    if (sample.timestamp - candidate.since < 2000) return [];
    if (this.world.phase === 'unknown') {
      // Establish the first baseline silently, including spawn-in-air/load/reconnect.
      if (sample.onGround && sample.altitudeAglFeet < 15) this.world.phase = 'ground';
      else if (!sample.onGround && sample.altitudeAglFeet >= 15) this.world.phase = 'airborne';
      return [];
    }
    let type: FlightEvent['type'] | undefined;
    if (this.world.phase === 'ground' && !sample.onGround) {
      const airborne = this.samples.filter(s => !s.onGround && s.timestamp >= candidate.since);
      if (sample.timestamp - candidate.since <= 15000 && airborne.length >= 3
        && airborne.every(s => s.indicatedAirspeedKnots >= 35)
        && sample.altitudeAglFeet >= 15 && sample.altitudeAglFeet - airborne[0]!.altitudeAglFeet >= 8
        && airborne.slice(-2).every(s => s.verticalSpeedFpm >= 150)) type = 'TAKEOFF';
      // A sustained transition with insufficient evidence establishes a silent baseline.
      else if (sample.timestamp - candidate.since > 15000) this.world.phase = 'airborne';
    }
    if (this.world.phase === 'airborne' && sample.onGround && sample.altitudeAglFeet <= 10) {
      if (candidate.approach && sample.indicatedAirspeedKnots >= 15 && sample.indicatedAirspeedKnots <= 250) type = 'LANDING';
      else this.world.phase = 'ground';
    }
    if (!type) return [];
    this.world.phase = type === 'TAKEOFF' ? 'airborne' : 'ground';
    return [{ type, priority: 'HIGH', timestamp: sample.timestamp, source: 'telemetry',
      generation: frame.generation, aircraftId: frame.aircraftId,
      facts: { altitudeAglFeet: sample.altitudeAglFeet, indicatedAirspeedKnots: sample.indicatedAirspeedKnots, verticalSpeedFpm: sample.verticalSpeedFpm } }];
  }
}

// Objective freshness/repetition gate only. Passenger perception/salience is a later step.
export class FlightEventGate {
  private identity = '';
  private last = new Map<FlightEvent['type'], number>();
  reset() { this.identity = ''; this.last.clear(); }
  accept(event: FlightEvent, sampleTimestamp: number): { forward: boolean; reason: 'accepted' | 'stale' | 'cooldown' } {
    const identity = JSON.stringify([event.generation, event.aircraftId]);
    if (identity !== this.identity) { this.identity = identity; this.last.clear(); }
    if (event.timestamp > sampleTimestamp || sampleTimestamp - event.timestamp > 3000) return { forward: false, reason: 'stale' };
    const last = this.last.get(event.type);
    if (last !== undefined && event.timestamp - last < 15000) return { forward: false, reason: 'cooldown' };
    this.last.set(event.type, event.timestamp);
    return { forward: true, reason: 'accepted' };
  }
}
