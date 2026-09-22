import type { FlightDebug, ServerSnapshot } from '@pax/shared';
import { FlightEventDetector, FlightEventGate } from './flight-events';

// Read-only debug pipeline. No coupling to passenger sessions or AI requests.
export class FlightIntelligence {
  private readonly detector = new FlightEventDetector();
  private readonly gate = new FlightEventGate();
  private identity = '';
  private state: FlightDebug = { status: 'disconnected', phase: 'unknown', aircraftId: null, generation: null, events: [] };
  constructor(private readonly log: (component: string, message: string, details?: Record<string, unknown>) => void = () => {}) {}
  update(snapshot: ServerSnapshot): FlightDebug {
    const context = snapshot.simulation;
    const identity = JSON.stringify([context?.generation, context?.aircraftId]);
    const disconnected = !snapshot.bridgeConnected || !snapshot.simulatorConnected;
    if (identity !== this.identity || disconnected) {
      this.detector.reset(); this.gate.reset(); this.state.events = []; this.identity = identity;
    }
    const status: FlightDebug['status'] = disconnected ? 'disconnected' : !context ? 'legacy-agent'
      : !context.active ? 'inactive' : snapshot.telemetryState === 'stale' ? 'stale'
      : !context.aircraftId || !snapshot.telemetry || snapshot.telemetryState !== 'live' ? 'waiting' : 'tracking';
    const events = this.detector.receive({ generation: context?.generation ?? '', aircraftId: context?.aircraftId ?? '',
      fresh: status === 'tracking', telemetry: snapshot.telemetry });
    if (status !== 'tracking') this.gate.reset();
    for (const event of events) {
      const decision = this.gate.accept(event, snapshot.telemetry!.timestamp);
      this.state.events.push({ event, ...decision });
      this.state.events = this.state.events.slice(-20);
      this.log('EVENT', event.type, { generation: event.generation, timestamp: event.timestamp, ...event.facts });
      this.log('GATE', decision.reason, { event: event.type, forward: decision.forward });
    }
    if (this.state.status !== status || this.state.generation !== (context?.generation ?? null))
      this.log('DETECTOR', status, { generation: context?.generation ?? null });
    this.state = { ...this.state, status, phase: this.detector.snapshot().phase,
      aircraftId: disconnected ? null : context?.aircraftId ?? null, generation: disconnected ? null : context?.generation ?? null };
    return { ...this.state, events: this.state.events.map(item => ({ ...item, event: { ...item.event, facts: { ...item.event.facts } } })) };
  }
}
