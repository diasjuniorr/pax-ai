# Flight-aware passenger and optional reactions

Implemented for text and browser voice; live model/audio acceptance is still required. The existing Windows agent package supplies everything needed for this change.

## Try it

1. Deploy this change on Render after CI passes. Keep the existing `OPENAI_API_KEY` and model settings. Refresh the dashboard.
2. Connect the Windows agent and MSFS. Verify LIVE telemetry and an aircraft identity. Create and start a passenger session.
3. With voice disconnected, ask in text: “Are we on the ground or climbing?” Compare the answer with the readings. Pause MSFS and ask again: the passenger should say current observations are unavailable rather than reuse the earlier state.
4. Connect voice with headphones. Hold to talk and ask the same question. Fresh context is requested on each release, not only when connecting.
5. Leave **Allow automatic takeoff and landing comments** unchecked. Perform a takeoff: the reaction list should show a silent preview, with no spontaneous AI request. Enabling afterwards must not replay that event.
6. For a new event, enable the checkbox while voice is connected. Remain on the ground unpaused for several seconds, then take off normally. Expect one brief comment consistent with the passenger disposition. Do not switch away from the voice tab: hidden tabs still disconnect this browser preview.
7. Hold to talk during a spontaneous comment. It should stop; microphone capture begins only after cancellation/output clearing and input-clear acknowledgement. A quick release before that point must not submit an utterance.
8. Fly a normal approach and land, more than 30 seconds after the previous automatic dispatch. Expect one landing comment. Approach reactions themselves are not implemented.
9. While a reaction waits behind conversation, pause, disconnect the agent or change aircraft: the pending reaction must be discarded. An automatic reply already generating/playing is cancelled on invalid flight context. Disable reactions and verify speech stops too.
10. End the session. Voice must close, diagnostics clear, and the next passenger session must start with automatic comments off.

## Responsibilities

- `flight-context.ts`: allowlisted point-in-time observations (aircraft, basic phase, ground state, altitude/AGL, airspeed and vertical motion). Requires live, active, identified telemetry with a backend receipt age of at most 3 seconds. No location enrichment, scenery, weather or approach inference. Unavailable context is explicit. Motion describes the latest reading, not a newly confirmed phase.
- `buildPassengerContext`: one bounded context builder for text and every voice response. Profile/route/aircraft strings are data, not instructions. Past conversation observations are not authoritative current state. Profile and route do not establish actual arrival, destination visibility or time remaining.
- `ReactionCoordinator`: perception maps TAKEOFF/LANDING to a passenger observation. Deterministic eligibility checks event gate, freshness, identity, setting and cooldown; disposition guides delivery. The MVP does not simulate emotions or assign numeric salience scores. Keeps one pending event, expires 15 seconds after the event timestamp, enforces a 30-second dispatch cooldown, and retains 20 diagnostic decisions. No LLM calls for classification or policy.
- Server API: dashboard authentication and same-origin mutation rules apply. Voice context/dispatch also require the current unexpired voice owner. Settings reset each passenger session. Starting/reconnecting voice discards pending work; previous events are never replayed. Native telemetry cannot submit prompts.
- Browser coordinator: polls for an eligible event while connected, opted in, visible and receiving live flight state. Only idle voice may claim; processing/listening/speaking defer. PTT gets a 1.5-second grace period. It rechecks idle, context, generation, elapsed request time and pilot activity after HTTP returns. Expired/late results are dropped without automatic retry. The remaining event lifetime also bounds automatic generation/playback.
- Voice lifecycle: each manual `response.create` gets server-built fresh instructions. Automatic turns use the same connection/history, with the microphone disabled. PTT cancels an automatic response and clears WebRTC output before opening input. Manual replies retain the existing non-interruptible behavior. Pauses/staleness cancel automatic speech but do not prevent ordinary manual conversation with unavailable flight context.

Diagnostics distinguish PREVIEW, QUEUED, DEFERRED, DISPATCHED, SUPPRESSED and DISCARDED. DISPATCHED means the server handed off a single-use opportunity, **not proof of audible playback**: a browser race or network failure can drop it. Delivery favors skipping a comment over duplicates. Voice status/transcript show local generation/playback progress; the server does not receive a playback receipt. Another tab changing settings is observed on the next settings poll (normally one second).

PAX remains single-instance/in-memory. Raw telemetry updates do not call OpenAI. Only user turns and enabled event reactions do; automatic speech uses API credits. API keys and provider call IDs stay on the backend. No new Windows binary, database or third-party service is introduced.

## Verification

Automated tests use synthetic telemetry and provider/WebRTC fixtures. They cover context allowlisting/unavailability, no replay, deduplication, cooldown, queue replacement/expiry/reset, protected real HTTP/WebSocket delivery, current voice ownership, PTT interruption, pending-buffer draining and late-context cancellation. They do not prove live OpenAI audio or model adherence. Record actual acceptance results separately.

Local verification: 50 backend/logic/integration tests, 5 browser regressions, production build and compiled-host smoke passed. Full Windows CI passed for `d171941` in [run 36570941330](https://github.com/diasjuniorr/pax-ai/actions/runs/36570941330). Render deployment has not been independently verified.

Implementation references: [OpenAI manual Realtime conversations and WebRTC interruption](https://developers.openai.com/api/docs/guides/realtime-conversations), [per-response instructions and client events](https://developers.openai.com/api/reference/resources/realtime/client-events).


## Downloading reaction diagnostics

After a suppressed event, click **Download diagnostic log** in Voice preview before ending the passenger session. Pausing MSFS does not clear this reaction history. Share the JSON to inspect the exact gate result and timing. `eventAgeMs` is server evaluation time minus the laptop event timestamp: negative means the event timestamp is ahead of the server, but is not a measurement of pure clock offset. `receiptAgeMs` is backend time since the latest sample receipt at detection. `evaluatedAt` updates for each decision transition; the original event timestamp stays fixed.

The download includes up to 100 decision transitions plus the current 20 decisions, using the last successful dashboard fetch. It excludes credentials, passenger profile, conversations and audio. It includes session/generation identifiers and flight-event timing. This is bounded in-memory diagnosis, not a durable log archive; export before session end or deployment. The standard Render server logs also include these structured diagnostics.
