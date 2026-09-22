import type { BridgeMessage, ServerSnapshot } from '@pax/shared';
export { FlightEventDetector, FlightEventGate, type FlightEvent, type DetectionFrame, type FlightWorldState } from './flight-events';
export { FlightIntelligence } from './flight-intelligence';

// Transport-independent latest-value store. Flight event detection is a separate module.
export class TelemetryStore {
  private state: ServerSnapshot = {
    version: 1, type: 'snapshot', bridgeConnected: false, simulatorConnected: false,
    telemetryState: 'waiting', lastReceivedAt: null, telemetry: null,
  };
  connect() { this.disconnect(); this.state.bridgeConnected = true; }
  disconnect() {
    this.state = { ...this.state, bridgeConnected: false, simulatorConnected: false,
      telemetryState: 'waiting', lastReceivedAt: null, telemetry: null, simulation: null };
  }
  receive(message: BridgeMessage, now = Date.now()) {
    const previousContext = this.state.simulation;
    const context = message.simulatorConnected ? message.simulation ?? null : null;
    if (previousContext?.generation !== context?.generation || previousContext?.aircraftId !== context?.aircraftId || previousContext?.active !== context?.active) {
      this.state.telemetry = null; this.state.lastReceivedAt = null;
    }
    this.state.simulation = context;
    this.state.bridgeConnected = true;
    this.state.simulatorConnected = message.simulatorConnected;
    if (!message.simulatorConnected || !message.telemetry) {
      this.state.telemetry = null;
      this.state.lastReceivedAt = null;
    } else if (message.telemetry.timestamp !== this.state.telemetry?.timestamp) {
      this.state.telemetry = message.telemetry;
      this.state.lastReceivedAt = now;
    }
  }
  snapshot(now = Date.now()): ServerSnapshot {
    const received = this.state.lastReceivedAt;
    return { ...this.state, telemetryState: received === null ? 'waiting'
      : now - received > 3000 ? 'stale' : 'live' };
  }
}
