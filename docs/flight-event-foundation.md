# Flight-event detection foundation

`packages/telemetry/src/flight-events.ts` implements the detector and objective gate. `FlightIntelligence` now connects them to the telemetry stream and dashboard for debug validation; there is still no connection to AI reactions. Tests use synthetic traces and make no claim of aircraft-specific accuracy.

The detector consumes normalized telemetry plus explicit aircraft identity, stream generation and freshness. It returns minimal WorldState (`unknown`, `ground`, `airborne`) independently of discrete HIGH-priority `TAKEOFF`/`LANDING` events. Event facts contain only AGL, IAS and vertical speed. No SimConnect structs, passenger state, network calls or model dependencies enter this module.

## Current heuristics

- Require an initial stable ground/air sequence lasting at least two seconds. Establish the first phase silently so spawning/loading into a flight cannot generate takeoff/landing.
- For takeoff, require previously established ground, at least three continuous airborne samples spanning two seconds, IAS of at least 35 knots, AGL reaching 15 ft and increasing at least 8 ft, and the final two samples climbing at least 150 ft/min.
- For landing, require previously established airborne state, at least two recent descending samples at or below 120 ft AGL and at least 25 knots, then two seconds of continuous ground contact, AGL at most 10 ft, and IAS between 15 and 250 knots.
- Freshness loss, missing identity, identity/generation changes, reversed timestamps, gaps over 2.5 seconds and large altitude/location discontinuities reset evidence. Duplicate timestamps do not advance it. A maximum twelve-sample window is retained.
- Sustained transitions without enough event evidence can establish a silent phase baseline. Ordinary sample changes never call an AI API.
- The separate objective gate rejects events older than three seconds and repeats of the same type within 15 seconds. It does not implement passenger perception/salience or autonomous scheduling.

These are initial fixed-wing test heuristics for nominal 1 Hz data, not universal thresholds for helicopters, gliders, high-performance aircraft or every landing. No gear-deployment/approach inference is implemented. A gear change alone will not be labeled an approach.

## Current integration and next acceptance

The optional v1 `simulation` object carries `generation` (UUID), `aircraftId` (TITLE or null), and `active`. TITLE and slew are sampled atomically with the numeric telemetry. Native Sim and Pause_EX1 notifications establish activity; unknown, stopped, paused and slew states suppress detection. Aircraft/flight load, position change, crash reset, pause/run transitions and reconnect invalidate old samples. Replacement request IDs ignore queued responses from the previous subscription, and callback guards reject disposed SimConnect connections.

The backend suppresses legacy agents lacking metadata, inactive simulation, missing identity/samples, and stale/disconnected input. It republishes detector status and phase plus at most 20 current-generation event/gate records. Generation/identity changes and disconnect clear the event history; stale data resets detector evidence. Events are debug facts and never trigger an AI request. The pipeline does not require a passenger session.

Native TITLE identifies the aircraft container, not a unique physical aircraft instance; generation separates load/reconnect boundaries, including reloading the same title. Neither the title nor generation proves that every MSFS menu/pause behavior has been covered. Validate the actual callback ordering tonight.

1. Use the new personal runtime and verify identity, generation and running/paused/slew behavior using [tonight-test.md](tonight-test.md).
2. Validate/tune with the chosen stock fixed-wing aircraft: taxi, takeoff, bounces, approach, landing, pause, aircraft change and reconnect.
3. Add the minimal additional approach-related event only when supported by evidence. Then connect objective gate → perception → salience → available conversation → voice reaction.

Tests currently cover valid transitions, initial airborne loading, brief ground-contact changes, low-speed glitches, stale/duplicate samples, identity/generation changes, gaps, rewind, teleport, snapshot isolation and gate cooldown/freshness.
