import type { FlightEvent, FlightSession, ReactionDecision, ServerSnapshot } from '@pax/shared';
import { flightContext } from './flight-context';

const eventId = (event: FlightEvent) => `${event.generation}:${event.timestamp}:${event.type}`;
export function perceive(event: FlightEvent, session: FlightSession) {
  return {
    observation: event.type === 'TAKEOFF' ? 'The aircraft has taken off.' : 'The aircraft has landed.',
    guidance: ({ calm: 'Acknowledge the moment quietly and briefly.', curious: 'Express brief, natural curiosity without demanding an answer.',
      nervous: 'Express mild nerves or relief without inventing danger.', enthusiastic: 'Express restrained excitement or appreciation.' })[session.passenger.flightDisposition],
  };
}

// Deterministic policy; never invokes an AI. One pending event, bounded history, no replay.
export class ReactionCoordinator {
  private sessionId: string | null = null;
  private enabled = false;
  private decisions: ReactionDecision[] = [];
  private history: ReactionDecision[] = [];
  private seen = new Set<string>();
  private pending?: { event: FlightEvent; expires: number; decision: ReactionDecision; perception: ReturnType<typeof perceive> };
  private lastDispatch = -Infinity;
  private identity = '';
  private initialized = false;
  constructor(private readonly now = Date.now, private readonly log: (decision: ReactionDecision) => void = () => {}) {}
  reset(sessionId: string | null) {
    this.sessionId = sessionId; this.enabled = false; this.decisions = []; this.history = []; this.seen.clear();
    this.pending = undefined; this.lastDispatch = -Infinity; this.identity = ''; this.initialized = false;
  }
  private copy(d: ReactionDecision): ReactionDecision { return { ...d, ...(d.diagnostics ? { diagnostics: { ...d.diagnostics } } : {}) }; }
  snapshot() { return { sessionId: this.sessionId, enabled: this.enabled, decisions: this.decisions.map(d => this.copy(d)), history: this.history.map(d => this.copy(d)) }; }
  configure(enabled: boolean) {
    if (enabled !== this.enabled) this.discard('Automatic reactions setting changed');
    this.enabled = enabled;
  }
  private update(decision: ReactionDecision, status: ReactionDecision['status'], reason: string) {
    if (decision.status === status && decision.reason === reason) return;
    decision.status = status; decision.reason = reason;
    if (decision.diagnostics) {
      decision.diagnostics.evaluatedAt = this.now();
      decision.diagnostics.eventAgeMs = this.now() - decision.diagnostics.eventTimestamp;
      decision.diagnostics.detectionAgeMs = decision.diagnostics.detectedAt == null ? null : this.now() - decision.diagnostics.detectedAt;
    }
    this.history.push(this.copy(decision)); this.history = this.history.slice(-100);
    this.log(this.copy(decision));
  }
  discard(reason: string) {
    if (this.pending) this.update(this.pending.decision, 'discarded', reason);
    this.pending = undefined;
  }
  observe(session: FlightSession | null, snapshot: ServerSnapshot) {
    if (!session || session.id !== this.sessionId) return;
    const now = this.now(), flight = flightContext(snapshot, now);
    const identity = JSON.stringify([snapshot.simulation?.generation, snapshot.simulation?.aircraftId]);
    const events = snapshot.flight?.events ?? [];
    if (!this.initialized) {
      // Starting a passenger session never replays earlier events.
      this.initialized = true; this.identity = identity;
      events.forEach(({ event }) => this.seen.add(eventId(event))); return;
    }
    if (identity !== this.identity) { this.discard('Aircraft or simulation changed'); this.identity = identity; }
    if (!flight.available) this.discard('Flight context unavailable, paused or stale');
    if (this.pending && now >= this.pending.expires) this.discard('Event expired while waiting');
    for (const item of events) {
      const event = item.event, id = eventId(event);
      if (this.seen.has(id)) continue;
      this.seen.add(id);
      if (this.seen.size > 100) this.seen.delete(this.seen.values().next().value!);
      const perception = perceive(event, session);
      const decision: ReactionDecision = { id, timestamp: now, event: event.type, observation: perception.observation, status: 'suppressed', reason: '', diagnostics: {
        eventTimestamp: event.timestamp, evaluatedAt: now, eventAgeMs: now - event.timestamp,
        detectedAt: item.detectedAt ?? null, detectionAgeMs: item.detectedAt == null ? null : now - item.detectedAt,
        receiptAgeMs: snapshot.lastReceivedAt === null ? null : now - snapshot.lastReceivedAt,
        gateForward: item.forward, gateReason: item.reason, detectorStatus: snapshot.flight?.status ?? 'unavailable',
        telemetryState: snapshot.telemetryState, simulationActive: snapshot.simulation?.active === true,
        generationMatches: event.generation === snapshot.simulation?.generation,
        aircraftMatches: event.aircraftId === snapshot.simulation?.aircraftId,
      } };
      this.decisions.push(decision); this.decisions = this.decisions.slice(-20);
      if (!flight.available)
        this.update(decision, 'suppressed', `Flight context unavailable (detector: ${snapshot.flight?.status ?? 'unavailable'}, telemetry: ${snapshot.telemetryState})`);
      else if (!decision.diagnostics!.generationMatches || !decision.diagnostics!.aircraftMatches)
        this.update(decision, 'suppressed', 'Event aircraft or generation does not match current flight');
      else if (!item.forward)
        this.update(decision, 'suppressed', `Event gate rejected: ${item.reason}`);
      else if (item.detectedAt == null || item.detectedAt > now)
        this.update(decision, 'suppressed', 'Missing or invalid backend detection time');
      else if (now - item.detectedAt >= 15000)
        this.update(decision, 'suppressed', `Event too old: ${now - item.detectedAt} ms since backend detection (limit: 15000 ms)`);
      else if (now - this.lastDispatch < 30000)
        this.update(decision, 'suppressed', '30-second passenger reaction cooldown');
      else if (!this.enabled) this.update(decision, 'preview', `Silent preview · ${session.passenger.flightDisposition} passenger`);
      else {
        this.discard('Replaced by a newer event');
        this.update(decision, 'queued', `Eligible · ${session.passenger.flightDisposition} passenger`);
        this.pending = { event, expires: item.detectedAt + 15000, decision, perception };
      }
    }
  }
  claim(idle: boolean) {
    if (!this.pending || !this.enabled) return null;
    if (this.now() >= this.pending.expires) { this.discard('Event expired while waiting'); return null; }
    if (!idle) { this.update(this.pending.decision, 'deferred', 'Waiting for the pilot / current reply to finish'); return null; }
    const pending = this.pending; this.pending = undefined; this.lastDispatch = this.now();
    this.update(pending.decision, 'dispatched', 'Handed to voice once; playback is not yet confirmed');
    return { id: pending.decision.id, perception: pending.perception, expires: pending.expires };
  }
}
