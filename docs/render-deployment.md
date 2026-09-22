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

The Blueprint specifies the build command `npm ci --include=dev && npm run build`, start command `npm start`, and `/health` health check. Render supplies `PORT` and `RENDER_EXTERNAL_URL`; no manual hostname configuration is needed. Node 22 and `NODE_ENV=production` are explicit. Automatic deployment is configured for branch `main` with `autoDeployTrigger: checksPass`: pushes and merges deploy after GitHub checks pass. The existing service must sync its Blueprint or have **Settings → Auto-Deploy → After CI Checks Pass** saved once. A connected GitHub account/repository is required; a service connected only through a public repository URL cannot auto-deploy. Confirm the linked branch is `main`. Commits with no CI checks do not auto-deploy; use `[skip render]` when intentionally skipping deployment.

## Access and runtime connection

Render generates two separate random secrets. `PAX_DASHBOARD_TOKEN` creates a 12-hour, Secure/HttpOnly/SameSite cookie for the browser. `PAX_BRIDGE_TOKEN` authorizes the native agent with a Bearer header. Neither secret is included in the frontend bundle. Rotate them in Render Environment if exposed; rotating the dashboard key invalidates existing cookies after the service restarts.

For the compiled agent, configure `PAX_BRIDGE_URL=wss://YOUR-SERVICE.onrender.com/bridge` and set `PAX_BRIDGE_TOKEN` in its process environment to the generated agent secret. The agent rejects remote plaintext WebSockets and credentials in URLs. Standard Windows certificate validation remains enabled. It allows 75 seconds for connection setup and retries with backoff. Use the launcher in the [complete personal runtime package](windows-package.md). The public Actions artifact remains assembly inputs without Microsoft runtime DLLs.

The backend holds one active agent and its latest snapshot in memory. A service restart clears state, and clients reconnect. There is no history/database, autoscaling or multi-user support. The dashboard, its assets and viewer WebSocket require login; `/health` is intentionally public and contains no telemetry. Production startup fails when required secrets/origin are missing or invalid. Local development retains its loopback-only behavior.

## Verification boundary

Local automated checks cover invalid configuration, login/cookies, protected assets, origin checks, distinct agent/viewer credentials, and authenticated WebSocket delivery. A separate smoke test boots the compiled production entrypoint used by Render. Windows CI also compiles the agent and checks accepted/rejected endpoint configurations. All eight tests, the compiled production-server smoke, Windows C# compilation/runtime loading, and six agent-configuration cases passed in [GitHub run 35632679736](https://github.com/diasjuniorr/pax-ai/actions/runs/35632679736) for commit `3f5f485`. Actual Render deployment, public TLS/WebSocket connectivity, and real MSFS telemetry must still be verified on the deployed service and laptop.

The SDK runtime packaging check remains separate from this hosted backend setup. Do not treat a working dashboard or compiled-agent artifact as completed simulator acceptance.

Sources: [Render Blueprints](https://render.com/docs/blueprint-spec), [web services](https://render.com/docs/web-services), [WebSockets](https://render.com/docs/websocket), [free-plan behavior](https://render.com/docs/free).

## Sign-in Forbidden fix — 2026-09-22

The deployed service is `https://pax-ai-2zo8.onrender.com`. Its initial sign-in form used `Referrer-Policy: no-referrer`, which made native browser form submissions send `Origin: null` and fail the strict origin check before checking the access key. The fix uses `same-origin`; null and cross-site origins remain rejected. Existing keys need no change.

After the fix passes CI, open the Render service and select **Manual Deploy → Deploy latest commit**. Wait for **Live**, then reopen the site's root URL and reload before signing in. Do not resubmit the old Forbidden page: it may retain the old policy. Browser regression checks run with `npm run build`, `npx playwright install chromium`, and `npm run test:browser`. The browser test uses an HTTPS routing fixture and checks the resulting cookie in a new tab because Playwright does not route the redirect chain; the real Render redirect still needs live confirmation.

## Live confirmation and automatic deployment — 2026-09-22

The user confirmed successful sign-in and dashboard display after deploying the sign-in fix. Automatic deployment is now requested and configured in the repository for `main` after CI passes. Applying/verifying this setting on the existing Render service remains a dashboard action because this session has no Render account connection. See [Render auto-deploy documentation](https://render.com/docs/deploys#automatic-deploys).
