# Render test deployment

One Free Web Service hosts the existing backend and compiled telemetry dashboard. No database, Supabase, connection to the work Mac, or software installation on the gaming laptop is needed for this service. This is a single-user telemetry acceptance deployment; passenger functionality is not implemented yet.

## Create the service

1. Sign in to your personal Render account.
2. Open [Deploy PAX on Render](https://render.com/deploy?repo=https://github.com/diasjuniorr/pax-ai). This uses the repository's `render.yaml` Blueprint. If needed, use **New → Blueprint** and select `diasjuniorr/pax-ai`, branch `main`.
3. Name the Blueprint `pax-test`. Review the service: **Node**, **Free**, **Frankfurt**, one service, no database. Submit using **Deploy** / **Create resources** as shown by Render.
4. Wait for service status **Live**, then open its `https://…onrender.com` address. Initial startup can take about a minute after sleeping.
5. In the service's **Environment** settings, reveal/copy the generated `PAX_DASHBOARD_TOKEN`. Enter it in the dashboard's **Dashboard access key** field. Keep the key private; do not put it in chat, Git, screenshots or the URL.
6. Expect **Server: CONNECTED**, **Bridge: DISCONNECTED**, **MSFS: DISCONNECTED** until the Windows runtime package is running. These disconnected states are normal at this stage.
7. Share only the public service URL so we can check `/health` and continue Windows configuration.

The Blueprint specifies the build command `npm ci --include=dev && npm run build`, start command `npm start`, and `/health` health check. Render supplies `PORT` and `RENDER_EXTERNAL_URL`; no manual hostname configuration is needed. Node 22 and `NODE_ENV=production` are explicit. Auto-deploy is off: later changes require **Manual Deploy → Deploy latest commit** after CI passes.

## Access and runtime connection

Render generates two separate random secrets. `PAX_DASHBOARD_TOKEN` creates a 12-hour, Secure/HttpOnly/SameSite cookie for the browser. `PAX_BRIDGE_TOKEN` authorizes the native agent with a Bearer header. Neither secret is included in the frontend bundle. Rotate them in Render Environment if exposed; rotating the dashboard key invalidates existing cookies after the service restarts.

For the compiled agent, configure `PAX_BRIDGE_URL=wss://YOUR-SERVICE.onrender.com/bridge` and set `PAX_BRIDGE_TOKEN` in its process environment to the generated agent secret. The agent rejects remote plaintext WebSockets and credentials in URLs. Standard Windows certificate validation remains enabled. It allows 75 seconds for connection setup and retries with backoff. Exact laptop launch steps will accompany the complete runtime package; the executable-only Actions artifact is still missing the Microsoft runtime DLLs.

The backend holds one active agent and its latest snapshot in memory. A service restart clears state, and clients reconnect. There is no history/database, autoscaling or multi-user support. The dashboard, its assets and viewer WebSocket require login; `/health` is intentionally public and contains no telemetry. Production startup fails when required secrets/origin are missing or invalid. Local development retains its loopback-only behavior.

## Verification boundary

Local automated checks cover invalid configuration, login/cookies, protected assets, origin checks, distinct agent/viewer credentials, and authenticated WebSocket delivery. A separate smoke test boots the compiled production entrypoint used by Render. Windows CI also compiles the agent and checks accepted/rejected endpoint configurations. Actual Render deployment, public TLS/WebSocket connectivity, and real MSFS telemetry must still be verified on the deployed service and laptop.

The SDK runtime packaging check remains separate from this hosted backend setup. Do not treat a working dashboard or compiled-agent artifact as completed simulator acceptance.

Sources: [Render Blueprints](https://render.com/docs/blueprint-spec), [web services](https://render.com/docs/web-services), [WebSockets](https://render.com/docs/websocket), [free-plan behavior](https://render.com/docs/free).
