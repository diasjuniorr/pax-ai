# PAX — Passenger Awareness eXperience

This is the authoritative implementation tracker for PAX, a context-aware AI passenger system for Microsoft Flight Simulator 2024. Update this document at the end of every implementation task.

The long-term objective is believable passengers who hold natural realtime voice conversations, understand flight and world context, react autonomously to meaningful events, have configurable identities and backgrounds, and eventually maintain behavioral/emotional state and memories.

## Current Focus

**Current target:** Wednesday MVP v0.1 — 2026-09-23.

**Current milestone:** Milestone 1 — Windows Live Acceptance.

**Next action (authorized; in progress):** Compile the C# agent in GitHub Actions using pinned official SDK 1.7.3 and run an app-local dependency check. Prepare an SSH tunnel for the two-machine acceptance test. Resolve runtime packaging before giving the laptop an executable to run; then complete [windows-acceptance.md](windows-acceptance.md).

**Current blocker:** No approved SDK-free runtime artifact exists. Exact SimConnect DLL redistribution/runtime requirements are unresolved; current loopback transport also needs a protected two-machine configuration. Windows compilation and app-local dependency loading passed on CI; browser execution and live flight remain unverified. See [deployment findings](windows-deployment.md). Milestone 1 is incomplete; Phase 2 has not started.

Last reviewed: 2026-09-21 against source, package boundaries, tests, [README](../README.md), [architecture](architecture.md), and [acceptance evidence](windows-acceptance.md). Dates below are targets, not permission to bypass acceptance gates.

## Status legend

- [x] Completed and verified within the explicitly stated scope, with evidence.
- [ ] Pending implementation or verification work.
- [~] Implemented but awaiting real-world/live verification.

`[~]` is an intentional Markdown status convention; some renderers display it as plain text. Code existing or a synthetic test passing does not prove live MSFS behavior. A locally verified subtask does not complete its parent milestone.

## Engineering principles

1. **Modules produce facts; the AI produces behavior.** Telemetry reports facts/events such as `TURBULENCE_STARTED`, `TAKEOFF`, and `LANDING`. World Context reports facts such as `LANDMARK_VISIBLE`, nearby city and weather context. Passenger Engine describes the passenger. AI Orchestrator decides how that passenger reacts. World Context remains separate from raw Telemetry Engine.
2. **Random generation is a creation method, not the passenger model.** `PassengerProfile` must eventually be fully user-configurable: name, age, gender, occupation, personality, flight disposition, trip reason, interests, background, flight experience and future attributes. Random generation is an optional factory/source. Generated profiles should eventually be coherent rather than independent random fields.
3. **Flight/session context affects behavior.** `FlightSession` should eventually contain expected duration, origin, destination, start time, passenger and current phase. Conversational density and autonomous behavior should adapt to duration: a 15-minute flight should differ from a three-hour flight.
4. **Telemetry sampling frequency is not AI invocation frequency.** Raw telemetry remains local. Only meaningful semantic events/context reach the AI; ordinary changing samples must not trigger API calls.
5. **Keep interfaces extensible and implementations small.** Preserve working module boundaries. Avoid speculative frameworks, unnecessary microservices and architecture redesign without a concrete problem.
6. **Minimize gaming-machine resource usage over time.** Move most responsibilities to cloud services after the MVP, retaining a lightweight local PAX Agent for simulator/controller integration and only necessary local processing. This is a future direction, not a prerequisite for the local MVP.

## Passenger architecture decisions — documented, not implemented

See [architecture synchronization](architecture.md#architecture-synchronization--2026-09-21) for ownership, exact MVP flow and separate long-term direction. The supplied Mantella/Pantella study is guidance, not a generic game framework specification.

- Existing code: thin SimConnect adapter, normalized telemetry, latest-value/freshness store, Node transport and debug UI. No passenger/AI/event implementation exists yet.
- Wednesday plan: small event detector plus minimal WorldState → objective event gate → simple perception → deterministic salience → orchestrator → bounded conversation lifecycle/audio. User PTT is an independent input into the same lifecycle.
- WorldState means current facts; FlightEvent means a meaningful occurrence. Perception determines passenger awareness; salience determines whether this passenger cares. Event priority is not salience.
- Every event need not be perceived, every perceived event need not trigger AI, and every state update need not create an event. Raw samples do not become prompts.
- Random/manual profile sources share PassengerProfile. Duration controls attention/conversation density rather than telemetry processing.
- MVP context must be bounded. Each future context source needs an explicit budget/policy. Long-term memory, emotion, complex attention and tools remain post-MVP.
- Documentation does not complete any planned feature. No speculative source contracts or packages were added. The Windows deployment/acceptance gate remains in force.

## Hard deployment constraint — clean gaming machine

The gaming PC is **runtime hardware, not a development environment**. Clean target deployment is part of product architecture now, not only post-MVP polish.

- The lightweight Local Agent owns only required Windows integration: SimConnect, HOTAS/controller input, audio if necessary, minimal processing and secure communication.
- CI/separate build machines compile/package versioned Windows runtime artifacts. Gaming-PC compilation is zero.
- No target Node/npm, Git, IDEs, .NET SDK, Framework Developer Pack, MSFS SDK, Docker Desktop, WSL2, local database or persistent development servers. Establish any genuine runtime prerequisite separately.
- No Docker requirement for end users. Measure CPU/memory impact; avoid services/autostart and unnecessary background work.
- Existing C# adapter, Node state and browser boundaries remain. Node/debugging can stay on the development host once the connection is configured and protected. Cloud separation remains post-MVP.

### Deployment prerequisite gate for Windows acceptance

- [x] Review existing framework/transport against official runtime, SDK and runner documentation; record facts and unresolved requirements in [windows-deployment.md](windows-deployment.md).
- [x] Windows TypeScript build and five synthetic tests passed in [GitHub run 35592717297](https://github.com/diasjuniorr/pax-ai/actions/runs/35592717297).
- [x] Pinned SDK C# compilation and `PaxAgent.exe --check-runtime` passed in [run 35628606547](https://github.com/diasjuniorr/pax-ai/actions/runs/35628606547), with zero warnings/errors. Published executable-only artifact; it excludes SDK DLLs and is not a complete runtime package. A builder load check is not clean-laptop acceptance.
- [ ] Establish official SDK build acquisition and exact managed/native DLL redistribution terms, required notices and supported SDK-free runtime deployment.
- [x] Provision public repository `diasjuniorr/pax-ai`, push main, and verify Windows runner access. Official SDK 1.7.3 archive SHA-256 pinned in build script.
- [ ] Compile bridge remotely and inspect/test its runtime dependency closure without the SDK installed on the runtime test machine.
- [ ] Add/configure a protected agent-to-development-host connection; current bridge and backend remain loopback-only.
- [ ] Produce versioned minimal Windows runtime ZIP with manifest/hashes and required notices; verify startup without target compilation or development tools.
- [ ] Record runtime-only resource usage and complete live Windows acceptance. Do not silently relax the clean-machine requirement to meet Wednesday.

## Wednesday MVP v0.1 — target 2026-09-23

Prove the complete interaction pipeline with only the functionality needed for these outcomes:

- [~] PAX connects to MSFS 2024 through official SimConnect; implementation exists, Windows proof pending.
- [~] Live telemetry reaches the application/browser; synthetic transport verified, real flight pending.
- [ ] Telemetry Engine converts samples into selected semantic events.
- [ ] A passenger profile exists and is included in AI context.
- [ ] A HOTAS button operates PTT while MSFS remains foreground.
- [ ] User speech reaches OpenAI Realtime.
- [ ] Passenger responds audibly.
- [ ] Passenger reacts audibly to a telemetry event without user speech.
- [ ] Debug/event logs make the complete pipeline observable.
- [ ] **MVP v0.1 complete:** final real acceptance flight in Phase 5 passes with evidence.

No cloud migration, World Context implementation, Passenger Studio, behavioral simulation, full Cost Governor, database, authentication, installer or polished UI is required for Wednesday.

## Phase 1 — Foundation / live telemetry

**Target:** Monday, 2026-09-21. **Milestone status:** implemented in part and locally verified; live acceptance outstanding.

### Existing implementation and evidence

- [x] Repository/module structure reviewed: `apps/server`, `apps/web`, `services/simconnect-bridge`, `packages/shared`, `packages/telemetry`, `docs`. These are code boundaries; only the platform bridge is a separate application process from Node.
- [x] Shared normalized telemetry contract and runtime validation: [shared source](../packages/shared/src/index.ts). Invalid values and inconsistent disconnected snapshots are covered by tests. Includes MSL/AGL altitude, true heading, actual gear extension and separate left/right flap extension.
- [x] Transport-independent latest-value/freshness store: [telemetry source](../packages/telemetry/src/index.ts). Tests verify repeated samples become stale and disconnect clears values. No flight-event detection exists yet.
- [x] Node ingress and viewer WebSocket protocol verified with synthetic messages over actual local sockets: [server source](../apps/server/src/server.ts), [tests](../tests/telemetry.test.ts). Covers forwarding, invalid input rejection, producer replacement, heartbeat expiry, late-viewer snapshots and producer isolation.
- [x] Local TypeScript/web build and five automated tests passed on macOS, recorded on 2026-09-21 in [windows-acceptance.md](windows-acceptance.md). This is not a Windows or browser execution result.
- [x] Setup commands, architecture, official SimVar mappings and Windows checklist documented and reviewed in [README](../README.md), [architecture.md](architecture.md), and [windows-acceptance.md](windows-acceptance.md). Windows usability remains to be validated below.
- [~] Official C#/.NET Framework 4.8 x64 SimConnect bridge: [source](../services/simconnect-bridge/Program.cs), [project](../services/simconnect-bridge/SimConnectBridge.csproj). SDK definitions, normalization, message loop and one-second subscription implemented; Windows compile/runtime unverified.
- [~] Actual C# bridge → Node loopback WebSocket transport. Latest snapshots, heartbeat, bounded send time and retry implemented; tests use a synthetic producer, not this bridge.
- [~] Full backend → browser WebSocket path through Vite and minimal dashboard. Web assets build; live browser rendering and updates remain unverified.
- [~] Live connection/freshness presentation: bridge connection, SimConnect session and waiting/live/stale telemetry are distinct. Code exists; Windows behavior pending.
- [~] SimConnect quit/timeout/reconnect, C# → Node reconnect and browser reconnect. Only Node-side synthetic producer disconnect/replacement is already tested.
- [~] Structured connection logs and throttled sample/retry logs across the live pipeline. Reviewed in code; Windows observation pending.
- [ ] **Milestone 1 complete:** all Windows Live Acceptance checks below pass and evidence is recorded.

### Immediate gate — WINDOWS LIVE ACCEPTANCE

Use the runtime-only [acceptance runbook](windows-acceptance.md) after the deployment prerequisite gate passes. The previous gaming-PC development setup is superseded. Record results, versions, aircraft, log excerpts and any failures in [windows-acceptance.md](windows-acceptance.md), then update this tracker.

- [ ] Run dependency restore, build and tests on the Windows CI/build environment; compile C# there against approved official SDK inputs.
- [ ] Download and extract the verified runtime artifact on the gaming PC; no source checkout, npm commands or compilation.
- [ ] Verify the documented runtime prerequisites only and start the packaged agent with the approved backend endpoint.
- [ ] With simulator closed, bridge waits safely; UI shows bridge connected, MSFS disconnected and no telemetry.
- [ ] Enter a flight and establish SimConnect; real telemetry reaches the browser and becomes LIVE.
- [ ] Confirm changing altitude, AGL, airspeed, vertical speed, true heading, latitude, longitude and on-ground state.
- [ ] Confirm gear and left/right flap extension, including transitions, on a stock aircraft with retractable gear and flaps.
- [ ] Observe pause/menu behavior and correct freshness labeling. CONNECTED means SDK session, not necessarily an active flight.
- [ ] Exit/kill simulator: connection clears without crashing PAX.
- [ ] Relaunch simulator and load another flight: connection and telemetry recover.
- [ ] Restart bridge: browser values clear and recover.
- [ ] Restart backend on the development host: bridge and browser reconnect.
- [ ] Refresh browser and open multiple tabs: current telemetry appears correctly.
- [ ] Complete the acceptance evidence record and resolve failed checks before marking Milestone 1 complete.

No failed live checks have been reported yet; the gate is **untested**, not passed. Do not start a later milestone while this critical gate is unresolved unless explicitly instructed.

### HOTAS feasibility spike — only after telemetry acceptance

- [ ] Detect `BUTTON DOWN` and `BUTTON UP` from one selected HOTAS button while MSFS has foreground focus.
- [ ] Record device, button mapping, input approach and foreground-test evidence.

Keep the spike limited to button detection; do not implement the complete PTT/audio system here. Resolve foreground-input feasibility before depending on it in Phase 2.

## Phase 2 — Passenger + realtime voice

**Target:** Tuesday, 2026-09-22. **Status:** pending; do not implement during roadmap creation.

### Passenger Engine and flight session

- [ ] Define `PassengerProfile` independently of random generation, initially containing `name`, `age`, `gender`, `occupation`, `tripReason`, `personalityTraits` and `flightDisposition`.
- [ ] Provide a simple random generator as one profile factory/source. Allow future manual/custom creation without redesigning the domain model.
- [ ] Define minimal `FlightSession`: `passenger`, `expectedDurationMinutes`, `startedAt`; origin/destination may initially be optional. Current phase and richer session context can follow when needed.
- [ ] Verify model/factory behavior with relevant checks, including that profiles need not originate from the random generator.

### Interaction Engine and OpenAI Realtime

- [ ] Implement HOTAS PTT while MSFS remains foreground; do not depend on browser keyboard focus.
- [ ] `HOTAS DOWN` begins microphone capture/sending for AI interaction.
- [ ] `HOTAS UP` stops/commits input.
- [ ] Implement realtime voice conversation with audible passenger output.
- [ ] Add a small ContextBuilder inside AI Orchestrator: profile, session, permitted important flight facts, current perceived event and bounded conversation; one place controls model-visible context. No retrieval/vector memory.
- [ ] Implement one explicit conversation lifecycle: IDLE → LISTENING on PTT down → PROCESSING on PTT up → SPEAKING on response → IDLE on completion; include basic failure/reconnect transitions. Defer complex interruption.
- [ ] Bound short-term conversation/relevant-event context with a simple retention policy; select permitted world facts rather than injecting raw telemetry or all WorldState.
- [ ] Capture enough API usage and lifecycle logging to inspect behavior; full cost governance is post-MVP.
- [ ] Live acceptance while flying: hold button, ask the passenger's name, release, hear an audible answer matching the profile.
- [ ] Live acceptance: ask why they are traveling and hear a profile-consistent answer.

## Phase 3 — Telemetry intelligence

**Target:** Wednesday, 2026-09-23. **Status:** pending.

Implement independently of SimConnect transport, building on the normalized contract:

```text
AircraftTelemetry → State Tracker → minimal WorldState + FlightEvent
FlightEvent → objective priority / dedup / cooldown gate
```

- [ ] Define normalized `FlightEvent` with type, objective priority, timestamp, relevant payload and source; keep cooldown/dedup policy separate from passenger salience.
- [ ] Define minimal `WorldState` for current flight facts/freshness, separately from events. No geography/landmark enrichment.
- [ ] Initialize/reset detector baselines across stale data/reconnect and aircraft changes without emitting false transitions; carry normalized aircraft identity/session generation.
- [ ] Confirm TAKEOFF/LANDING with a short fresh-sample history combining ground transitions, plausible IAS, AGL trend/height and climb/descent evidence; debounce bounces and tune for the stock test aircraft.
- [ ] Implement state tracking and selected event detectors without coupling them to SDK structures.
- [ ] HIGH: `TAKEOFF`.
- [ ] HIGH: `LANDING`.
- [ ] After TAKEOFF/LANDING, select only the minimum additional event needed for approach acceptance (`GEAR_DEPLOYED`, previously `GEAR_DOWN`, is a candidate); do not claim gear deployment alone proves approach.
- [ ] Optional/defer if unnecessary for Wednesday: `STRONG_MANEUVER`, only with reliable required measurements.
- [ ] Optional/defer: heavy-rain entry only if reliable telemetry and remaining MVP needs justify it. The broader event examples are not a Wednesday checklist.
- [ ] Implement deduplication, cooldowns and basic priority handling.
- [ ] Verify detector transitions and suppression with focused tests, then validate selected events in a live flight.
- [ ] Ensure ordinary raw telemetry changes stay local and are not sent to OpenAI.

Dependency note: current telemetry has no weather, acceleration, pitch or bank fields. During this phase, determine the minimum reliable inputs for selected detectors; document any required contract extension. Do not infer reliable weather or strong-maneuver detection from unavailable data, or expand telemetry now merely for future scope.

## Phase 4 — Autonomous passenger

**Target:** Wednesday, 2026-09-23. **Status:** pending.

```text
FlightEvent + minimal WorldState + PassengerContext
→ objective gate → perception → PerceivedEvent
→ deterministic salience / conversation availability
→ AI Orchestrator → OpenAI → conversation lifecycle → speech
```

- [ ] Add a perception seam consuming current facts, event and PassengerContext. Pass through explicitly supported physical events for MVP; permit no perceived event.
- [ ] Add a separate deterministic salience decision (react/ignore/suppress), preserving objective priority. No scoring engine or LLM-based evaluation.
- [ ] Route accepted events to the orchestrator with bounded permitted context. HIGH-priority supported events may trigger deterministically when conversation is available.
- [ ] Suppress repetitions and autonomous requests while conversation is busy; record gate/perception/salience reasons without accumulating an unbounded queue. Preserve user-initiated PTT.
- [ ] On failure/reconnect, clear invalid conversation work and suppress stale reactions; retain explicit network/UI/simulator/AI boundaries.
- [ ] Optional/deferred for Wednesday: `AMBIENT_OPPORTUNITY`. If retained, consider time since passenger/user speech, expected duration and conversation state; no timer-only random chatter or constant AI requests. This supersedes the earlier mandatory ambient mechanism.
- [ ] Live acceptance: pilot takes off without speaking, PAX detects `TAKEOFF`, passenger spontaneously reacts audibly.

## Phase 5 — Debugging / MVP acceptance

**Target:** Wednesday, 2026-09-23. **Status:** pending.

- [ ] Provide an event/debug console spanning `SIMCONNECT`, `TELEMETRY`, `EVENT`, `GATE`, `HOTAS`, `OPENAI`, and `PASSENGER/AUDIO`.
- [ ] Make detection, objective gating, perception, salience decision/reason, AI requests and audio lifecycle visible without per-sample flooding; preserve separate objective and passenger decisions.

Conceptual output (not existing acceptance evidence):

```text
10:42:07 EVENT   TAKEOFF detected
10:42:07 GATE    HIGH → FORWARD
10:42:07 OPENAI  autonomous reaction requested
10:42:08 AUDIO   passenger response started
```

### Final MVP acceptance flight

- [ ] Start PAX, connect MSFS, create passenger and confirm visible telemetry.
- [ ] Taxi and take off; hear a passenger reaction without speaking first.
- [ ] Cruise and hold a HOTAS PTT conversation while MSFS remains foreground.
- [ ] Approach; observe a relevant event/reaction.
- [ ] Land; observe landing detection and hear the passenger react.
- [ ] Record real-flight evidence for the complete sequence and resolve failures.
- [ ] Mark MVP v0.1 complete only when this real MSFS acceptance flight passes.

## Post-MVP roadmap

These are macro-level directions only. No implementation is authorized by this roadmap task.

### v0.2 — Cloud separation

- [ ] Move eligible responsibilities from the development-host/local MVP arrangement to cloud PAX services: `MSFS → lightweight PAX Local Agent → cloud PAX services → OpenAI`.
- [ ] Keep local responsibilities to SimConnect, HOTAS/controller input, necessary integration processing and a secure cloud connection. Raw sampling remains local; send appropriate semantic context onward. No Docker requirement for end users.
- [ ] Evaluate Vercel for frontend/appropriate stateless endpoints, Supabase for persistence/auth/settings/history, and a suitable persistent/realtime backend. Do not assume long-lived realtime orchestration belongs in serverless request functions.

### v0.3 — World awareness

- [ ] Separate World Context Engine: coordinates, cities/regions, landmarks, terrain/mountains, weather, time of day, sunrise/sunset, seat/window position, and plausible visibility/direction.

### v0.4 — Passenger Studio

- [ ] Fully customizable profiles with manual, random and constrained creation, coherent biographies and presets. Support interests, background, occupation, travel purpose, flight experience, personality, conversational style and density.

### v0.5 — Behavioral simulation

- [ ] Emotional state, fear, excitement, boredom, trust and fatigue; previous events affect reactions, with passenger memory and conversation continuity.
- [ ] Separate bounded short-term context from summarized/retrieved episodic history and pilot facts; compact state may track relationship, trust, anxiety and known facts. No indefinite transcript accumulation.
- [ ] Evolve perception and attention with passenger interests/activity/previous reactions. Sophisticated scoring, visibility simulation, memory retrieval/editor and any vector tooling are post-MVP decisions, not committed technology choices.

### v0.6 — Flight intelligence

- [ ] Detailed phases, turbulence severity, hard landings, go-arounds, unusual maneuvers, airport awareness, delays, destination context and richer weather.

### v0.7 — Immersion

- [ ] Multiple passengers and passenger-to-passenger interaction, copilot, cabin crew, seat positions, different voices and role-specific behavior.

### v0.8 — Cost Governor

- [ ] Measure flight duration, user/passenger speech duration, AI event number/type, available text/audio token usage, estimated session cost and estimated cost per flight-hour.
- [ ] Configure maximum session budget, conversation density, autonomous-dialogue density and preferred realtime model.
- [ ] Degrade progressively near budget limits: reduce ambient opportunities first, then low-priority autonomous reactions; preserve important event reactions where practical and user-initiated PTT as long as possible.
- [ ] Compact long-session context/memory so conversation history does not grow without bound.
- [ ] Assign budgets/policies to identity, current world facts, recent events, conversation, memory and geographic enrichment; combine priority, salience, lifecycle, cooldown, duration and API usage before expensive processing.

Cost Governor is outside Wednesday scope beyond enough API usage/logging data to inspect behavior.

### v1.0 — Productization

- [ ] Installer, polished UI, controller mapping UI, saved passenger presets, flight history, authentication if needed, settings persistence, robust recovery, cloud/local-agent connectivity, API cost controls, production logging and user-friendly onboarding.

## Explicitly deferred architectural extensions

No Wednesday implementation of vector memory/embeddings/ChromaDB, sophisticated episodic memory, emotional/relationship simulation, multiple passengers, generic game frameworks, geographic/seat visibility simulation, vision models, elaborate or LLM-based salience, tool calling/passenger control of MSFS, world-knowledge retrieval, dynamic biographies, memory editor, complex barge-in or elaborate chatter scheduling. Future actions/tools are an extension seam only.

## Roadmap maintenance rules

At the end of every implementation task:

1. Run relevant tests/checks; documentation-only work can use document/link/consistency checks.
2. Update this roadmap, including Current Focus when the active gate changes.
3. Mark `[x]` only when verified, and name the evidence and scope of verification.
4. Use `[~]` for implemented work awaiting real-world/live verification. Live MSFS claims require a Windows/MSFS 2024 test.
5. Add a short blocker/failure note with evidence and next action; update [windows-acceptance.md](windows-acceptance.md) for Windows results.
6. Do not silently expand scope.
7. Do not begin a later milestone while a critical current acceptance gate is unresolved unless explicitly instructed.

## Review notes

- 2026-09-21: Created this tracker after reviewing current source, module boundaries, README, tests and acceptance records. Existing evidence supports local contract/store/Node transport checks and the TS/web build. C# compilation, browser execution and all live Windows checks remain unverified. No Phase 2 functionality was added. Documentation paths and roadmap consistency were checked; existing runtime test results were not represented as a new live test.

- 2026-09-21: Clean-target constraint supersedes the original development-stack acceptance setup. Added deployment investigation and Windows TS-only CI; SDK packaging remains blocked by unestablished distribution/runtime details. No Windows runtime artifact, CI run, framework migration, cloud deployment or Phase 2 implementation claimed.
- Validation for deployment documentation/CI change: local TS/web build passed, 5 tests passed, workflow YAML/trigger/runner checks passed, and 32 local documentation links resolved. Live acceptance remains pending.

- 2026-09-21: Reconciled supplied Mantella/Pantella lessons with source. No present coupling warrants a refactor. Documented WorldState/perception/salience, explicit conversation lifecycle and context limits as pending work. Narrowed events and made ambient conversation optional/deferred. Clean-target deployment and live acceptance blockers remain unchanged.
- Architecture synchronization validation: `npm run build` passed; all 5 existing tests passed; 34 local documentation paths resolved and implementation-status sections were checked. No application code changed and no next feature started. Windows/C# and live acceptance remain unverified.

- 2026-09-21: Focused MSFS2024_AI study pinned to 204413bccaae7f10544a68359d31872f5f8a36cd; v1.0.0 runtime ZIP contents and published checksum verified. Recommend retaining C# and app-local managed/native DLL packaging. Official redistribution basis remains a release check; PAX build/live acceptance remains pending. Added latency tiers and planned ContextBuilder; no implementation recommendations executed. Pitch/bank are cheap optional additions, weather and aircraft-specific integrations remain deferred. Next task is a bounded runtime acceptance build, subject to direction approval.
