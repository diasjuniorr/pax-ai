# Flight-event detection foundation

`packages/telemetry/src/flight-events.ts` implements an isolated detector and objective gate. It is deliberately not connected to live telemetry or AI reactions yet. Tests use synthetic traces and make no claim of aircraft-specific accuracy.

The detector consumes normalized telemetry plus explicit aircraft identity, stream generation and freshness. It returns minimal WorldState (`unknown`, `ground`, `airborne`) independently of discrete HIGH-priority `TAKEOFF`/`LANDING` events. Event facts contain only AGL, IAS and vertical speed. No SimConnect structs, passenger state, network calls or model dependencies enter this module.

## Current heuristics

- Require an initial stable ground/air sequence lasting at least two seconds. Establish the first phase silently so spawning/loading into a flight cannot generate takeoff/landing.
- For takeoff, require previously established ground, at least three continuous airborne samples spanning two seconds, IAS of at least 35 knots, AGL reaching 15 ft and increasing at least 8 ft, and the final two samples climbing at least 150 ft/min.
- For landing, require previously established airborne state, at least two recent descending samples at or below 120 ft AGL and at least 25 knots, then two seconds of continuous ground contact, AGL at most 10 ft, and IAS between 15 and 250 knots.
- Freshness loss, missing identity, identity/generation changes, reversed timestamps, gaps over 2.5 seconds and large altitude/location discontinuities reset evidence. Duplicate timestamps do not advance it. A maximum twelve-sample window is retained.
- Sustained transitions without enough event evidence can establish a silent phase baseline. Ordinary sample changes never call an AI API.
- The separate objective gate rejects events older than three seconds and repeats of the same type within 15 seconds. It does not implement passenger perception/salience or autonomous scheduling.

These are initial fixed-wing test heuristics for nominal 1 Hz data, not universal thresholds for helicopters, gliders, high-performance aircraft or every landing. No gear-deployment/approach inference is implemented. A gear change alone will not be labeled an approach.

## Before live integration

1. Extend the normalized agent contract with reliable aircraft identity and a connection/session generation, including load/aircraft-change handling. Do not substitute the passenger session ID for simulator identity.
2. Wire freshness and explicit disconnect/loading resets into the detector. Define behavior for simulator pause/menu transitions and clock discontinuities using actual observations.
3. Surface emitted events and gate decisions in the dashboard without enabling autonomous speech yet.
4. Validate/tune with the stock retractable-gear aircraft chosen for Windows acceptance: taxi, takeoff, bounces, approach, landing, pause, aircraft change and reconnect.
5. Add the minimal additional approach-related event only when supported by evidence. Then connect objective gate → perception → salience → available conversation → voice reaction.

Tests currently cover valid transitions, initial airborne loading, brief ground-contact changes, low-speed glitches, stale/duplicate samples, identity/generation changes, gaps, rewind, teleport, snapshot isolation and gate cooldown/freshness.
