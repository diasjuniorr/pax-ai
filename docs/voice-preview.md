# Browser voice preview

This is a laptop-independent test of realtime microphone input and AI-generated passenger speech. It is not the final HOTAS interaction path. The browser tab must remain visible and the hold-to-talk control focused/pressed. The Windows package is unchanged.

## Try it on the Mac

1. Deploy the voice-preview commit on the existing Render service after GitHub checks pass.
2. Ensure `OPENAI_API_KEY` is set in the service's Environment settings. Voice uses that same server-only key as text conversation. Optional `PAX_OPENAI_REALTIME_MODEL` defaults to `gpt-realtime`; it must be a Realtime audio model available to the API project. Save/deploy if settings change.
3. Open the HTTPS PAX dashboard, sign in and create/start a passenger session. Use headphones to reduce echo.
4. In **Voice preview**, click **Connect voice** and allow microphone access. Wait for **Ready — hold the button to speak**.
5. Hold **Hold to talk**, ask “What is your name and why are you traveling?”, then release. Alternatively, focus that button and hold/release Space or Enter.
6. The UI should move through listening → thinking → speaking → ready. Hear the reply, compare it with the profile and ask a follow-up.
7. Click **Disconnect voice**. Verify microphone access stops. Then reconnect and confirm a fresh voice conversation. End the flight session and confirm the connection closes too.

The displayed voice is AI-generated. Connecting/speaking uses the OpenAI API and may incur usage charges. PAX does not open a microphone or call the provider automatically on page load. A disconnected page can still inspect/edit profiles and test telemetry.

## What to verify

- Outside a button hold, the outgoing microphone track is disabled. During connection, the browser microphone indicator can remain present because the stream is open; **Disconnect voice** stops the tracks entirely.
- Very short taps are discarded. A hold is limited to 25 seconds. Releasing the button disables input before submitting the turn. Test that the first/last words arrive naturally; WebRTC audio and control events use separate channels and the current release path includes a 150 ms flush allowance.
- The passenger must finish audio playback before the button becomes ready, even if generation completes earlier. No barge-in/interruption feature is claimed.
- Losing focus while holding cancels that utterance. Hiding/reloading the page disconnects voice. HOTAS while MSFS is foreground is still pending; do not treat this preview as that acceptance check.
- End a session in another tab during a reply: the provider call and browser peer should close. Only one voice connection is allowed, and text requests are blocked while it is connected.
- Deny microphone permission, disconnect the headset, or interrupt the network. The UI should show a recoverable error and release the microphone. Reconnection is explicit, with no automatic paid retry.
- Check the latest spoken transcript and input/output token counts shown in the preview. Audio is not stored by the PAX backend; the browser sends it directly to OpenAI via WebRTC.

## Architecture and limits

The authenticated Node server combines the browser's SDP offer with the same profile/planned-flight context builder used for text. It negotiates `/v1/realtime/calls` with its API key and returns only the SDP answer. Browser mutations use the existing cookie and exact-origin checks. Call IDs remain server-side. Client data-channel events own PTT and playback state; the backend owns connection creation, exclusivity, expiry and hangup.

VAD is disabled (`turn_detection: null`): buffer clear on press, commit and `response.create` on release. No telemetry, flight events or autonomous response trigger is added. The latest transcript is displayed as plain text. Voice and text histories are separate in this preview. Voice memory lasts only for the current connection and uses retention-ratio truncation with a 6,000-token post-instruction context limit and a 512-token output cap. Reconnect does not replay audio or restore voice history.

The client renews a server lease every five seconds. Missing heartbeats expire it after 15 seconds; initial negotiation gets 45 seconds. Connections are capped at 20 minutes in this preview, then require an explicit reconnect. Session end, server shutdown and explicit disconnect request provider hangup. A late negotiation result is disposed if its owner ended. Provider hangup has one bounded retry; abrupt process death cannot guarantee that request completes, so peer shutdown and provider connection handling also matter. This is single-instance, in-memory infrastructure.

Browser tests use explicit fake microphone/WebRTC/provider fixtures to verify controls and cleanup. They do not prove actual media negotiation, intelligible speech, network behavior, model access or billing. Live OpenAI voice and Windows/MSFS acceptance remain pending.

Official references: [WebRTC unified interface](https://developers.openai.com/api/docs/guides/voice-webrtc), [manual turns](https://developers.openai.com/api/docs/guides/realtime-conversations), [call configuration](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/create), [call IDs](https://developers.openai.com/api/docs/guides/voice-server-controls), [hangup](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup).
