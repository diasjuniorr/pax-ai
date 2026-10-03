# Passenger observations, weather and voice

Implemented 2026-10-03 after a live passenger invented clear weather and quoted a four-foot height above ground.

## What the passenger receives

The shared text/voice context now contains qualitative motion (on the ground, climbing, descending or approximately level), local weather observations and explicit unknowns. Numerical altitude, AGL, airspeed, vertical speed, heading, coordinates, raw aircraft identity and capture timestamps are excluded at the context boundary. Exact readings remain in dashboard diagnostics. Planned airports are not current location; actual location remains unknown.

Every text reply and every manual/automatic voice response uses this context. Missing, paused, disconnected or stale observations become unavailable, including weather. Instructions explicitly address direct weather/visibility and exact-height questions, distinguish pilot reports from independent observations, and prohibit carrying unsupported earlier claims forward. Personality affects phrasing, not facts. These rules and data minimization reduce hallucinations; they are not a guarantee of model adherence. Starting a new passenger/voice session clears older conversation claims for acceptance testing.

## Simulator weather

The new Windows bridge reads an independent, four-FLOAT64 weather definition at 1 Hz. The existing twelve-double plus STRING256 flight definition remains unchanged. Request IDs are paired and renewed across continuity changes, so old weather callbacks are ignored; weather is cleared on pause/load/aircraft/slew changes and disconnect. Weather SDK request/definition errors disable optional weather until reconnection while core flight telemetry continues. Packet IDs identify weather-specific SDK exceptions.

Read-only SDK inputs, at the aircraft:

| SimVar | Unit | Passenger interpretation and limit |
| --- | --- | --- |
| `AMBIENT PRECIP STATE` | mask | None, rain, snow or rain-and-snow. Unknown/conflicting masks become unavailable. No rain does not establish clear skies. |
| `AMBIENT IN CLOUD` | bool | Inside cloud or outside cloud at the aircraft. Does not describe surrounding cloud cover or cloud layers. |
| `AMBIENT VISIBILITY` | meters | Low values can support limited visibility from airborne particles. This measures particle visibility, not the entire view. High values do not establish clear skies. In-cloud observations take precedence. |
| `AMBIENT WIND VELOCITY` | knots | Coarse light/some/strong local wind; not turbulence, gusts, discomfort or danger. |

Source: [Microsoft MSFS 2024 weather SimVars](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Miscellaneous_Variables.htm), [units](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Simulation_Variable_Units.htm). Reviewed 2026-10-03. `ENV CLOUD DENSITY` was investigated but is also local to the aircraft, not sky coverage, so this increment uses in-cloud state only. Rain intensity, cloud layers, total cloud cover, sunshine, scenery and turbulence are not inferred. No real-world weather API is used.

Coarse wording thresholds are application choices requiring live validation: particle visibility below 1,000 m is very limited, below 5,000 m limited; wind below 5 kt light, below 20 kt some, otherwise strong. Numbers are never supplied to the model. Invalid fields are independently nullable; missing weather never rejects otherwise valid flight telemetry. Native bounds discard nonfinite/negative or implausibly large values. Cloud bool follows SDK nonzero=true semantics.

Weather has its own capture timestamp. The bridge and context reject samples more than 2.5 seconds older than the accompanying flight sample, or from its future; both timestamps use the same source clock. The overall flight context also requires a backend receipt no older than 3 seconds and an active tracking simulation. This preserves compatibility with old agents: weather stays explicitly unknown until the new runtime is installed.

## Voice

The passenger editor now offers Marin, Cedar, Coral, Ash, Sage and Verse. Generated starter profiles have curated defaults: Sofia/Maya use Marin, Daniel Cedar, Alex Sage. Any profile can use any listed voice; editing gender does not silently replace a chosen voice. Older profiles default to Marin. Selection persists with the passenger session, is validated by the backend, and reaches the provider at call creation. End/start a session to change it.

Calm, curious, nervous and enthusiastic dispositions have distinct delivery guidance, with short, everyday language and restrained reactions. No model switch or playback-speed manipulation was introduced. These are voice/style suggestions, not guaranteed gender, age or accent matching. [OpenAI Realtime voice options](https://developers.openai.com/api/docs/guides/realtime-conversations) document that voice cannot change after audio begins; [prompting guidance](https://developers.openai.com/cookbook/examples/realtime_prompting_guide) supports explicit personality, brevity and varied phrasing.

## Validation and laptop checklist

Automated tests check context exclusion, ground-height regression, unknown/malformed/partial/stale weather, text requests for direct weather questions, initial/per-turn/automatic voice context delivery, voice validation/provider selection, and browser restoration/weather display. Providers/WebRTC are fixtures: these tests do not assert that a live model produced a truthful sentence. Windows CI additionally compiles against the official SDK and checks interop layouts and weather normalization. Live weather readout accuracy remains pending.

1. Deploy/refresh; end any old passenger session. Choose a voice and start a new session.
2. With the existing agent, ask by text and voice: “How is the weather?”, “Can you see clearly?”, “Where are we?” and “How many feet above the ground are we?” Expect uncertainty about weather/location and no numerical instrument claims; ground state may still be described.
3. Install the new complete Windows ZIP (stop the old agent, extract to a separate folder, run Check-Runtime then Start-PAX). No SDK or new API key is needed. The old ZIP remains usable but cannot supply weather.
4. In an unpaused flight, compare the dashboard weather line against simulator rain, snow and cloud conditions. Ask the same questions in text and voice. Rain may be described; unknown sky coverage should not become “beautiful clear skies.”
5. Try strong wind, flight pause/resume and reconnect. Wind alone must not produce claims about turbulence. Paused/stale weather must not be repeated as current.
6. Repeat takeoff/landing comments and compare two voice selections in separate sessions. Export debug logs before refreshing. `Reply requested` / `Voice context prepared` include safe qualitative weather metadata; `Voice connecting` includes selected voice. Logs still exclude prompts, audio and transcripts, so report any incorrect sentence separately.

User acceptance from the prior live export: a takeoff was queued and dispatched in 239 ms despite source time about three seconds ahead, and the matching automatic response reached playback start/finish. The user heard an accurate spontaneous comment. Five manual replies also completed playback. An earlier page-hidden disconnect recovered; one provider hangup failure remains a separate investigation, not fixed by this change. Landing and full recovery acceptance remain pending.
