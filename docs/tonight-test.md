# Tonight: agent and flight-event validation

Use the newest complete personal ZIP listed in [windows-package.md](windows-package.md). The old `598c029eea4d` ZIP lacks identity metadata. No source checkout, SDK, Node, compilation or administrator setup is required on the gaming laptop.

1. **Prepare the dashboard.** Confirm the latest feature deployment is Live on Render. Sign in at https://pax-ai-2zo8.onrender.com/ and locate **Flight events · validation**. No passenger session or API key is needed for this telemetry test.
2. **Extract the new ZIP into a fresh folder**, e.g. `Documents\PAX-test`. Keep its files together; do not mix them with an older package. Close any older PAX agent first.
3. **Run `Check-Runtime.cmd`.** It verifies the package and loads the app-local libraries. If it fails, record the exact error. Do not install the SDK; follow the runtime-only prerequisite guidance in the package documentation.
4. **Run `Start-PAX.cmd`.** Use `https://pax-ai-2zo8.onrender.com` and enter the existing `PAX_BRIDGE_TOKEN` at the hidden prompt. Use the agent token, not the dashboard key. Keep the console open.
5. **With MSFS closed**, confirm Bridge CONNECTED, MSFS DISCONNECTED and no current aircraft or events.
6. **Load a stock fixed-wing aircraft on the ground**, preferably with retractable gear/flaps for the original telemetry checks. Unpause and leave slew mode off. Confirm telemetry becomes LIVE, the aircraft title and generation appear, and the detector changes from UNKNOWN to GROUND after several fresh samples. Initial loading must not produce an event.
7. **Taxi and take off.** Check changing IAS/AGL/vertical speed. After sustained climb, expect one HIGH TAKEOFF entry marked ACCEPTED and phase AIRBORNE. Continued climb should not repeat the event. Record any missed or false event with aircraft, IAS, AGL, vertical speed and time.
8. **Fly an ordinary approach and land.** After a low descending approach and several seconds of stable ground contact, expect one HIGH LANDING entry and phase GROUND. The current thresholds are preliminary; a missed event is a tuning result, not proof that the agent failed.
9. **Test reset boundaries.** Pause, resume, try active pause, enter/leave slew, and load another flight/aircraft. Expect suppression while inactive, a new generation, cleared history for that generation and a silent new baseline. Resuming/spawning airborne must not invent takeoff. Generation may change more than once while a flight loads.
10. **Test recovery.** Stop/restart the agent, then exit/relaunch MSFS. Identity/telemetry must clear and recover. Refresh/open another dashboard tab: it should show the same current event history, without replaying events as new detections.

No spontaneous passenger speech should occur from these events yet. HOTAS is also not implemented. Browser voice is a separate preview requiring a visible tab; do not use it as evidence of foreground MSFS push-to-talk.

## Record the result

- Package commit/hash and Render deployment commit:
- Windows/MSFS version and aircraft:
- Runtime check and simulator-absent behavior:
- Identity/generation and initial GROUND/AIRBORNE baseline:
- TAKEOFF observed once (or missed/false, with values/time):
- LANDING observed once (or missed/false, with values/time):
- Pause/active-pause/slew/load reset behavior:
- Agent/simulator reconnect and dashboard refresh:
- Exact console/SDK errors, if any (exclude access tokens):

All entries are pending until a real flight is performed. Report failures before changing thresholds or enabling autonomous speech.
