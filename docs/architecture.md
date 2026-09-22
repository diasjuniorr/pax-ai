# PAX architecture and wire contract

The C# executable is a platform adapter. Node owns the application state; the browser only renders it. There are two application processes plus the Vite development server. Packages are code boundaries, not independent services.

## Deployment constraint (2026-09-21)

The gaming laptop is runtime hardware. Build tools and SDKs belong on a separate builder/CI; distribute only compiled, approved runtime files. No Node development server, Docker/WSL2, database or extra persistent service belongs on the target. See [deployment findings](windows-deployment.md) for the SDK blocker and [roadmap](ROADMAP.md) for the gate.

The transport below describes current implemented loopback behavior. The intended clean-target acceptance topology keeps Node/browser on the development machine and only the compiled bridge on Windows. Configurable protected cross-machine ingress is still pending, not an implemented cloud migration. Preserve the existing module responsibilities.

## Transport and state

The bridge is a WebSocket **client** of the loopback Node server. This keeps listening sockets out of the .NET Framework bridge, requires no HTTP listener URL reservation, and allows a single familiar JSON protocol. Node exposes `/bridge` for one native producer and `/telemetry` for multiple viewers. Vite proxies the browser path to Node. All listeners bind to `127.0.0.1`; browser origins are limited to the local dev UI, and browser-origin requests cannot use the producer endpoint. This is local development isolation, not authentication.

Every second, the bridge publishes a versioned `bridgeSnapshot` with `simulatorConnected` and nullable `telemetry`. Each publication is also a heartbeat. It keeps only the latest sample, never an accumulating queue. Send operations have a timeout; failures retry after two seconds. SimConnect subscriptions request `SECOND` cadence, with unchanged samples included. SDK calls and callbacks remain on one Windows message-loop thread because SimConnect is not thread-safe. Only immutable normalized snapshots cross to the async network loop.

The backend validates every message using the shared schema and publishes `snapshot` messages containing bridge state, simulator state, telemetry freshness and latest values. It disconnects an invalid producer, expires silent producers after five seconds, and disconnects slow viewers instead of growing an unlimited send buffer. A producer reconnect starts with empty state. A repeated capture timestamp does not refresh the last received sample time. Freshness uses Node receipt time, avoiding clock skew between processes. Samples become stale after three seconds; stale values remain visible and labeled. Disconnection clears values. The browser clears values if its backend connection fails and retries every second.

`simulatorConnected` means the SimConnect open callback has occurred and no quit/error/response timeout has invalidated it. It is separate from flight-running/paused status, which this milestone does not model. A `RequestSystemState("Sim")` probe checks responsiveness every two seconds; its numeric flight state is not interpreted as a disconnect. Ten seconds without SDK responses causes disposal/reconnection. The backend cannot independently verify the simulator behind a bridge.

The definitive schemas live in `packages/shared/src/index.ts`. Both message types carry `version: 1`; unknown versions are rejected. `timestamp` is UTC Unix milliseconds captured when the bridge receives simulator data, not simulator time. Percent fields are 0–100. Negative AGL/altitude/vertical speed values are not clamped; only heading is wrapped into [0, 360).

## Official SimVar mapping

Each definition requests `FLOAT64`, including the numeric boolean, so the sequential packed C# structure has one consistent field representation. SimConnect converts compatible requested units. Field order in the definition must match the raw structure exactly.

| Normalized field | Official SimVar | Requested unit | Meaning/conversion |
|---|---|---|---|
| latitude | PLANE LATITUDE | degrees | North positive |
| longitude | PLANE LONGITUDE | degrees | East positive |
| altitudeMslFeet | PLANE ALTITUDE | feet | Aircraft altitude, not barometric indicated altitude |
| altitudeAglFeet | PLANE ALT ABOVE GROUND | feet | Above world surface, including obstacles; not minus CG |
| indicatedAirspeedKnots | AIRSPEED INDICATED | knots | Indicated airspeed |
| verticalSpeedFpm | VERTICAL SPEED | feet per minute | Requested conversion from documented ft/s; climb positive |
| headingTrueDegrees | PLANE HEADING DEGREES TRUE | degrees | True heading, explicitly converted from default radians |
| onGround | SIM ON GROUND | bool | Numeric value converted to boolean |
| gearExtensionPercent | GEAR TOTAL PCT EXTENDED | percent | Aggregate actual gear extension, not handle position |
| flapsLeftExtensionPercent | TRAILING EDGE FLAPS LEFT PERCENT | percent over 100 | Actual left trailing-edge extension × 100 |
| flapsRightExtensionPercent | TRAILING EDGE FLAPS RIGHT PERCENT | percent over 100 | Actual right trailing-edge extension × 100 |

Two flap fields avoid silently hiding asymmetric extension. These are not flap handle detents or leading-edge slats. Gear uses the aggregate conventional SimVar; modular or custom aircraft may need additional mappings later. Start acceptance testing with a stock conventional aircraft.

## SDK sources

Verified against official MSFS 2024 documentation on 2026-09-21. The current retail docs are transitioning URLs; the official legacy HTML pages remain linked for detailed SimVar tables.

- [Managed wrapper, message dispatch, structure registration](https://docs.flightsimulator.com/msfs2024/retail/programming-apis/simconnect/programming-simconnect-clients-using-managed-code/)
- [SDK design and threading](https://docs.flightsimulator.com/msfs2024/retail/programming-apis/simconnect/simconnect-sdk/)
- [Data definitions and unit conversion](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_AddToDataDefinition.htm)
- [User aircraft data subscriptions](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_RequestDataOnSimObject.htm)
- [System-state probe](https://docs.flightsimulator.com/msfs2024/retail/programming-apis/simconnect/api-reference/general/simconnect_requestsystemstate/)
- [Position, altitude, heading, speed and ground state](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Aircraft_SimVars/Aircraft_Misc_Variables.htm)
- [Gear variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Aircraft_SimVars/Aircraft_Brake_Landing_Gear_Variables.htm)
- [Flap variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Aircraft_SimVars/Aircraft_Control_Variables.htm)

## Architecture synchronization — 2026-09-21

The immediate goal is **one believable autonomous passenger in MSFS 2024**. The supplied Mantella/Pantella study informs these decisions; those projects are references, not PAX specifications. This document records PAX decisions, not independently verified claims about either reference implementation.

### IMPLEMENTED — scope and evidence

Today the pipeline is `MSFS → C# adapter → normalized AircraftTelemetry → Node latest-value store → WebSocket → debug browser`. Only the TypeScript contract/store and synthetic WebSocket path have automated verification; the web build passes. C# compilation, browser execution and real Windows/MSFS acceptance remain unverified. See [acceptance evidence](windows-acceptance.md).

The adapter owns SDK structures, SimVar names, unit conversion and integration lifecycle. No SDK types or APIs leak into core TypeScript. `AircraftTelemetry` is normalized measurement data, not semantic events. The latest-value store holds one snapshot; it is neither `WorldState` nor a conversation history. Its connection booleans describe independent transport facts, not a future conversation lifecycle.

No semantic detectors, passenger model/generator, perception, salience, prompts, OpenAI integration, conversation state machine or memory exist. Therefore there is currently no priority/salience conflation, raw-to-prompt coupling, random-only passenger representation, unbounded transcript or event-to-API assumption to refactor. Document seams now; introduce concrete types/functions when their first consumer is implemented. Do not add empty packages or generic game interfaces.

### PLANNED FOR WEDNESDAY MVP — responsibility boundaries

| Responsibility | Meaning and ownership | Smallest useful MVP behavior |
|---|---|---|
| MSFS adapter | Simulator-specific acquisition and normalization | Preserve thin existing bridge; never decide passenger behavior |
| Telemetry Engine | Measurements become meaningful transitions | Small supported event set, starting with TAKEOFF and LANDING |
| WorldState | What is true now | Minimal current flight/aircraft facts and freshness; no geography/landmarks |
| FlightEvent | What just happened | Type, timestamp, objective priority, relevant payload and source; dedup/cooldown handled by event policy |
| Event gate | Is this objective event eligible downstream? | Deduplicate, prioritize and suppress repetition before AI processing |
| Perception | What can this passenger perceive? | Explicit pass-through for supported physical events; may return no PerceivedEvent |
| Attention/salience | Does this passenger care enough to react now? | Deterministic react/ignore/suppress decision; no LLM scoring |
| PassengerProfile | Who the passenger is | Same domain representation for random factory and future manual configuration |
| AI Orchestrator | Assemble permitted context and request behavior | Invoke only for accepted reactions or user conversation |
| Conversation lifecycle | Coordinate input, requests and output | Explicit state transitions, bounded context and basic failure handling |

`WorldState` and `FlightEvent` must remain separate contracts. A state update need not produce an event; a transient event is not the current state. The Telemetry Engine can update minimal WorldState and emit events from the same normalized samples without creating another service. A disconnected/stale sample must not be treated as a fresh world fact. Initialize/rebase detector state on reconnect rather than misclassifying the first sample as a takeoff or landing; verify this when detectors are added.

Perception consumes `WorldState + FlightEvent + PassengerContext` and yields a `PerceivedEvent` or nothing. PAX knowing a fact does not establish passenger awareness. For MVP, explicitly allow supported events such as TAKEOFF/LANDING through; do not make all future event types automatically perceived. Do not wire an entire WorldState snapshot directly into a prompt. Only selected, relevant facts permitted by perception/context policy reach AI context.

**Priority and salience are distinct.** Event priority represents objective flight importance. Salience represents this passenger's interest at this moment. Even when the MVP rule accepts high-priority supported events deterministically, preserve separate event-filter and passenger-decision functions/results; do not rename priority to salience or require a numeric scoring engine. A perceived event may still be ignored. Passenger policy will eventually consider personality, interests, activity, emotion, previous reactions, recency, repetition, phase, duration and conversation state.

Flight duration affects attention/conversation density, not sampling or event detection. Keep the planned `FlightSession` with passenger, expected duration and start time. Preserve the planned profile fields: name, age, gender, occupation, trip reason, personality traits and flight disposition. A random factory returns that same profile; it does not define a different passenger type.

### Exact simplified MVP flow (planned, not implemented)

```text
MSFS → thin adapter → normalized AircraftTelemetry
                         ↓
            small detector + minimal WorldState
                         ↓
              FlightEvent (TAKEOFF / LANDING first)
                         ↓
              objective priority / dedup / cooldown
                         ↓
              explicit perception pass-through
                         ↓
              PerceivedEvent
                         ↓
              deterministic salience + conversation availability
                         ↓
              react / ignore / suppress
                         ↓ react only
              AI Orchestrator + bounded permitted context
                         ↓
              OpenAI → conversation lifecycle → audible speech

HOTAS DOWN → LISTENING → HOTAS UP → PROCESSING
           → AI response/audio → SPEAKING → response finished → IDLE
```

PassengerProfile and FlightSession feed perception, attention and AI context. PTT is an independent user-initiated input into the same conversation coordinator; autonomous output must not require pilot speech first. The state machine also governs whether an autonomous request may start, not just what happens after OpenAI returns. For MVP, suppress autonomous opportunities while listening/processing/speaking rather than adding an unbounded pending queue. Log the reason. Detailed interruption/barge-in comes later.

Use the minimum states required for IDLE, LISTENING, PROCESSING, SPEAKING and an explicit failure/reconnecting transition. Exact API-event mapping is a later implementation decision. Reserve a clean transition seam for INTERRUPTED; do not invent unrelated speaking/listening/processing booleans. Test PTT release, response completion and disconnect paths when implementing the lifecycle.

User-initiated voice and event-initiated voice are MVP requirements. Passenger-initiated idle conversation is **optional/deferred** for Wednesday. If a tiny AMBIENT_OPPORTUNITY policy is retained, it must use passenger/user speech recency, duration and conversation availability, never timer-only random chatter or continuous API invocation.

### Context, memory and cost rules

MVP uses bounded short-term context: the current conversation, a bounded selection of relevant recent events, permitted current world facts and passenger state. Define a simple explicit retention/size policy when context is implemented; do not append samples/events/transcripts forever. No sophisticated token manager is required.

Every future context source needs its own budget/selection policy: identity/personality, current world facts, recent events, conversation, memory and geographic enrichment. The full WorldState is not itself a prompt. Budgeting must preserve useful identity/current context while discarding or compacting old material. Full cost accounting and long-session compaction remain in the post-MVP Cost Governor roadmap.

Memory later separates short-term context from episodic/long-term summaries and retrieval: meaningful experiences, pilot facts, flight events and relationship/history. Compact passenger state may include trust, anxiety, relationship and known facts. Memory is neither an unlimited transcript nor a compulsory database layer in the MVP.

The core decides whether an event merits expensive processing before invoking AI. Later cost policy can consider objective priority, passenger salience, lifecycle state, cooldown, actual API usage, expected duration and configured budget. No LLM call merely to decide salience; raw telemetry never drives continuous API usage.

### Failure boundaries and observability

Keep simulator, SimConnect client, agent/backend network, browser and future OpenAI session failures distinct. Existing telemetry reconnect/freshness behavior remains relevant and still needs live acceptance. Future conversation failure must stop/clear invalid in-flight activity, enter an explicit recovery state and log it; do not replay stale autonomous reactions after reconnect. Avoid sophisticated recovery orchestration for Wednesday.

Debug output should show event detection, event-gate decision, perception, salience decision/reason, request and audio lifecycle. Sampling, perceived events and spoken reactions are different rates; logs should make suppression understandable without per-sample flooding.

### POST-MVP ARCHITECTURAL DIRECTION

```text
MSFS → adapter → normalized measurements
                     ↓
             semantic events + WorldState ← separate World Context enrichment
                     ↓
             objective event filtering
                     ↓  WorldState + event + PassengerContext
             character perception → PerceivedEvent
                     ↓
             attention / passenger salience
                     ↓
             relevant bounded memory/context
                     ↓
             AI orchestration ↔ conversation lifecycle
                     ↓
             autonomous reaction / conversation
```

Memory and passenger state feed context/policy; this is a responsibility map, not a mandate for serial services or an LLM call per stage. A nearby landmark is only a world fact until visibility/perception allows awareness; interest then determines salience. Future actions/tools are a separate extension point. Passenger control of MSFS is not an MVP capability.

Explicitly deferred: vector memory, embeddings, ChromaDB/vector databases, sophisticated episodic memory, emotion/relationship simulation, multiple passengers/inter-passenger conversation, generic game frameworks, geographic visibility/seat simulation, vision models, sophisticated or LLM-based salience, complex tool calling, passenger MSFS control, world-knowledge retrieval, dynamic biographies, memory editors, complex interruption/barge-in and elaborate chatter scheduling.

Clean Windows deployment remains a hard constraint. These logical responsibilities do not dictate deployment location or authorize cloud work. Preserve low latency and a small agent; cloud separation remains post-MVP. Implement one passenger's complete experience before expanding any of these layers.


## Focused MSFS reference study — 2026-09-21 (recommendations pending approval)

Primary integration reference: [noscapect/MSFS2024_AI at 204413b](https://github.com/noscapect/MSFS2024_AI/tree/204413bccaae7f10544a68359d31872f5f8a36cd). Reviewed its project/status, architecture, live-test and native-control docs, registration/contracts, session manager, state conversion, diagnostics, tests and release script. Inspected the published v1.0.0 ZIP without executing binaries; its SHA-256 matches the published checksum: `a00dbb559c295ca89aebe32f0f0f5867ced2a0cb297678abc2a6edefaea597fe`.

Their net472/x64 project uses SDK managed-reference Copy Local plus explicit native DLL copying; the release script stages both DLLs beside the executable/config. PAX already has the same basic copy pattern and can retain net48/x64. No C++ rewrite is justified. Source/release evidence supports the technical approach, not PAX live validation or independent Microsoft redistribution permission. See [deployment update](windows-deployment.md#reference-evidence-update--2026-09-21).

Adopt only small lifecycle lessons: guard callbacks by active connection identity, clear transient state at session/aircraft boundaries, re-register on new sessions, and test retry/disposal invariants. Retain PAX's heartbeat/freshness handling; the reference session manager itself does not implement a telemetry-age watchdog. Add aircraft title and a connection/session generation before detectors; do not import its aircraft control framework.

Event truth requires observation over a short fresh-sample window. TAKEOFF should combine a stable ground-to-air transition with plausible IAS, rising AGL and climb evidence; LANDING should combine air-to-ground with preceding low AGL/descent and plausible speed. Tune for the selected stock aircraft, debounce bounces and suppress initialization/loading/reconnect artifacts. Do not borrow airliner thresholds or assume one instantaneous sample satisfies every signal. Aircraft-specific native readback belongs after MVP unless generic telemetry demonstrably blocks the selected test aircraft.

### Intelligence / latency tiers

| Tier | Responsibility | Policy |
|---|---|---|
| 0 — raw | Simulator acquisition | Current PAX cadence is 1 Hz; raise only if live evidence requires it |
| 1 — deterministic | State/event interpretation | Cheap local/core rules; milliseconds are a design target, not measured performance |
| 2 — cognitive policy | Perception, attention, salience | Deterministic and inexpensive for MVP |
| 3 — generative | OpenAI speech/behavior | Network-dependent, slower and metered; invoke only after cheaper gates |

Never use a slower, more expensive tier for a decision a cheaper deterministic tier reliably handles.

### ContextBuilder — planned orchestrator responsibility

ContextBuilder is the single place selecting/bounding model-visible context. Wednesday inputs: PassengerProfile + FlightSession + important permitted current flight facts + accepted current PerceivedEvent + bounded conversation. Later, add selected recent perceived events and relevant memory under explicit budgets. No retrieval/vector memory, new service or speculative framework. The event path becomes detector → priority/cooldown → perception → deterministic salience → ContextBuilder → OpenAI Realtime → speech; HOTAS/microphone uses the same minimal conversation lifecycle independently.

## Hosted acceptance update — 2026-09-21

The user approved a single Render Free Web Service because the work Mac cannot serve as the runtime backend. This changes deployment placement, not the C# / telemetry / application / browser responsibilities. Render hosts the existing Node backend and built dashboard; the gaming agent connects through authenticated WSS. No Supabase, database, multi-user infrastructure or broader cloud migration is included. See [render-deployment.md](render-deployment.md). This supersedes the work-Mac SSH plan and the earlier blanket deferral of cloud hosting for this acceptance test.

## Passenger/session foundation — 2026-09-22

With explicit user authorization to proceed while the laptop is unavailable, the shared package now defines validated `PassengerProfile`, `FlightSession` and input/state schemas. The server's passenger module provides a coherent starter factory and in-memory single-session store. Manual profiles use exactly the same model. Session IDs and start timestamps are server-owned, active profiles are copied, and stale end/replacement requests conflict instead of overwriting another session.

Authenticated `/api/session` GET/POST, `/api/session/end` POST and `/api/passenger/random` POST serve the dashboard. Mutation requests require the configured browser origin and JSON; the agent credential cannot access these endpoints. Session state is separate from simulator connection/freshness and unaffected by bridge disconnect. It is not persisted across process restarts. The browser polls shared session state and preserves an unsaved draft while no session is active. No OpenAI calls, audio, HOTAS or flight event detection are added.

## Text conversation foundation — 2026-09-22

With user authorization to continue before laptop acceptance, `apps/server/src/conversation.ts` now owns the minimal context builder, provider adapter and bounded text-conversation lifecycle. Authenticated `/api/conversation` GET/POST shares the session API's cookie/origin checks. The server constructs context from the active passenger/planned flight, never accepts a browser-supplied history or system prompt, and does not feed raw telemetry to the model. POST requires the active session ID and a request UUID.

The current lifecycle is IDLE → PROCESSING → IDLE. One request runs per session; timeout/failure resets availability, session end/shutdown aborts work, and obsolete replies cannot modify a new session. Ten complete exchanges are retained in memory and recent request IDs deduplicated. The Node-only Responses adapter reads environment credentials and caps output at 400 tokens with `store: false`; no SDK/dependency or Windows-agent change is needed. Logs expose token counts/latency without content or credentials. The dashboard displays plain text, checks server readiness, and refreshes shared state. See [configuration and acceptance](text-conversation.md).

This implements only the profile/planned-session/bounded-conversation subset of ContextBuilder. Permitted live facts, perception/events, PTT LISTENING, audible SPEAKING, Realtime transport and autonomous scheduling remain pending.

## Browser voice and isolated event foundation — 2026-09-22

The user authorized laptop-independent voice/event work. `voice.ts` on the server negotiates Realtime WebRTC calls with the existing context builder and server-only API key. The browser owns media and an explicit, separately testable PTT lifecycle; the server owns single-call leases, text/voice exclusion and hangup. Voice history is bounded by provider truncation and ends on disconnect. It is separate from the text transcript in this preview. No Windows-agent or HOTAS implementation is claimed. See [voice boundaries](voice-preview.md).

The telemetry package now exports an isolated `FlightEventDetector`, minimal `FlightWorldState`, normalized `FlightEvent` and separate `FlightEventGate`. No server code consumes it yet. Live wiring requires aircraft identity/stream generation not present in the current native protocol. Synthetic threshold tests precede the required stock-aircraft acceptance and tuning. See [detector boundaries](flight-event-foundation.md). Perception, salience and autonomous voice requests remain pending.
