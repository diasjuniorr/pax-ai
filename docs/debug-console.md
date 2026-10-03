# Application debug console

The panel at the bottom of the dashboard collects application-authored events, not browser developer-console output.

- Server sources: bridge/simulator connections, detector state changes, event/gate decisions, passenger reaction diagnostics, passenger session changes, text AI requests/results and voice connection lifecycle.
- Browser sources: telemetry socket changes and this tab's voice lifecycle, including response requests, cancellation, generation completion and audio playback start/finish. Provider response IDs, connection IDs and reaction event IDs link related entries.
- No per-sample telemetry stream, API keys, raw exceptions, prompts, profiles, transcripts or audio. Server details use an explicit metadata allowlist. Only intentional application logging calls are collected. The native executable's console is not forwarded wholesale; its connection/telemetry outcomes are logged by the server.

Use Component / Severity filters and Search logs to isolate a flow. Searching an event ID shows EVENT → GATE → PASSENGER and any corresponding voice entries. Each row's **Copy** button copies its full ISO UTC timestamp, source, severity, component, message and metadata. **Copy filtered logs** and **Download filtered JSON** operate on the visible filtered set. Disable Auto-scroll to read an earlier point; collection continues. Clipboard failure leaves selectable text and JSON download available.

The server retains 500 entries in memory and exposes a read-only `/api/debug-log` endpoint requiring dashboard authentication in hosted mode. Agent credentials cannot access it. Responses are no-store; arbitrary browser log ingestion is not supported. Standard server console logging continues. The panel polls every two seconds without AI requests and deduplicates using server-instance/sequence IDs. The merged view retains at most 500 entries.

Server history survives simulator pause/reconnect and passenger session end, but not server restart/deployment. Refreshing fetches retained server history but loses this tab's browser voice logs. Other tabs' local logs are not collected. Export before refreshing or deploying. If polling fails, retained entries remain visible with a stale-connection message.

Rows are ordered by their source timestamp (oldest first). The source label matters: browser timestamps use the laptop clock, server timestamps use the backend clock. Clock skew can change apparent cross-source order. For reaction timing diagnosis use `eventTimestamp`, `evaluatedAt`, signed `eventAgeMs`, `receiptAgeMs`, and the shared `eventId`; a negative event age indicates a future source timestamp, not a pure clock-offset measurement. This implementation adds observability without changing reaction timing policy.

The existing **Download diagnostic log** remains available for focused reaction transitions; the bottom console covers the broader application flow.
