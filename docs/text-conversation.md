# Text passenger conversation preview

This laptop-independent step tests passenger identity and conversation before voice. It does not complete the realtime/HOTAS milestone or prove simulator awareness.

## Enable on Render

1. Wait for the conversation commit's GitHub checks to pass, then deploy that commit on the existing PAX service. If auto-deployment does not start, use **Manual Deploy → Deploy latest commit**.
2. Open the service's **Environment** settings and add `OPENAI_API_KEY` using a key from your [OpenAI API project](https://platform.openai.com/api-keys). Enter the value directly in Render, never in Git, chat, the browser console or the dashboard access-key form.
3. Optionally add `PAX_OPENAI_TEXT_MODEL`. The default is `gpt-4.1-mini`; the configured model must support text input/output through Responses and be available to your API project.
4. Save the environment change and deploy/restart. Wait for **Live**, then refresh PAX and sign in with the existing dashboard key if needed. A deployment clears the current session.
5. Generate/edit a passenger, set route/duration and start a session. Under **Talk to your passenger**, the status should become **Ready to talk**.
6. Send a short question. Each submitted message can incur OpenAI API usage. Creating a session or polling the dashboard does not make an AI request.

A missing API key disables only text conversation. Other dashboard and telemetry features remain available. The key is read only by the Node server and never returned to the browser. There is no public/mock provider switch.

## Acceptance without the gaming laptop

- Ask “What is your name and what do you do?” Compare the reply with the edited profile.
- Ask “Why are you traveling?” Compare with the trip reason, then ask a follow-up that relies on the previous turn.
- Ask about destination and planned duration. The answer should reflect configured plans without claiming a known live location, flight phase or arrival time.
- Ask what the passenger can see outside. With no observations supplied, they should not claim specific live scenery or weather. This is a prompt behavior to evaluate with the real model, not a deterministic guarantee.
- Refresh the page: the recent transcript should return. Open another tab and confirm the same shared session/transcript.
- End the session, including while a reply is pending, and create a different passenger. The previous conversation must disappear and late replies must not enter the new session.
- Record the deployed commit, configured model and observed outcomes in the roadmap. Live model acceptance remains pending until these checks are performed.

## Boundaries and failure behavior

The backend sends a fixed passenger-role instruction plus validated profile/planned-flight JSON and the last ten complete exchanges. Input is capped at 2,000 characters and generated output at 400 tokens. It sends no telemetry, tools, inferred flight phase, geographic data or events. It makes no autonomous requests. The output is displayed as plain text.

Only one request is active per session. A second concurrent message receives a conflict; ending the session aborts pending work. A 30-second deadline recovers the lifecycle even when the provider fails. Failed/incomplete turns are not appended. Successful recent request IDs are deduplicated within the retained ten turns. There is no automatic retry; after an uncertain network failure, inspect the refreshed transcript before resending to avoid another charge.

Session/history storage is process memory. Browser refresh retains it; session end or server restart/deploy clears it. History older than ten exchanges is discarded, with no summary or long-term memory. `store: false` disables Responses application-state storage; it is not a promise of zero provider retention. Logs contain request/session identifiers, elapsed time, and returned input/output token counts, without transcripts, prompts, API keys or raw upstream error bodies.

If the service reports API configuration failure, verify the Render key and model. Rate-limit/quota failures require checking API account limits/credits. No paid live request is made by automated tests. Backend tests inject a provider or HTTP fixture; the browser conversation test stubs that endpoint and uses the real session/auth/assets server.

Official API references used for this implementation: [Responses create](https://developers.openai.com/api/reference/cli/resources/responses/methods/create), [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini).
