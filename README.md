# Pax — MSFS 2024 telemetry MVP

PAX currently has a local SimConnect reader, hosted TypeScript backend, telemetry dashboard, editable passenger/flight-session controls, and a text conversation preview backed by OpenAI. A browser voice preview is implemented but live voice is unverified. HOTAS, autonomous event reactions, and a database are not implemented. Live simulator acceptance remains pending.

The authoritative implementation tracker is [the PAX roadmap](docs/ROADMAP.md). Current gate: **Milestone 1 — Windows Live Acceptance**. Update the roadmap after every implementation task; later milestones depend on passing the current acceptance gate unless explicitly instructed otherwise.

```text
Gaming laptop: MSFS 2024 → SimConnect → compiled C# agent
                                              ↓ authenticated WSS
Render Free Web Service: TypeScript backend → signed-in browser dashboard
```

The hosted test configuration is ready in [render.yaml](render.yaml). Follow the [Render deployment guide](docs/render-deployment.md) to create the service. The work Mac is not part of the runtime connection. Local development still uses loopback and Vite.


## Gaming laptop — runtime hardware only

Do **not** install Node/npm, Git, Visual Studio/VS Code, .NET SDK, Framework Developer Pack, MSFS SDK, Docker/WSL2 or databases on the gaming laptop for PAX. The previous all-components-on-Windows development instructions are superseded.

The target receives a compiled Windows artifact. A **complete personal test ZIP is now assembled locally**, including the two official SimConnect DLLs, launcher, runtime check, hashes and SDK license. See [package details](docs/windows-package.md) and [runtime acceptance](docs/windows-acceptance.md). Public GitHub artifacts intentionally contain only assembly inputs; the complete ZIP is transferred privately from the development Mac. No SDK is downloaded or installed on the gaming laptop.

The current bridge targets .NET Framework 4.8/x64; it is not a modern .NET self-contained application. Windows 11 includes a compatible Framework runtime, but the exact SimConnect client runtime prerequisites have not been verified on an SDK-free target. Do not install the SDK to conceal a missing-runtime failure.

## Development/build machines only

The following commands are for a development host or CI, **not the gaming laptop**:

```sh
npm ci
npm run dev
```

Node listens on `127.0.0.1:3001`; the dashboard is `http://127.0.0.1:5173`. Individual commands are `npm run dev:server` and `npm run dev:web`.

On a separate Windows build/development machine, the current C# build requires a .NET SDK/MSBuild, Framework 4.8 targeting pack and an authorized official MSFS 2024 SDK managed reference. The existing developer command is:

```powershell
$env:MSFS2024_SDK = 'C:\MSFS 2024 SDK'
npm run bridge
```

This compiles and launches the developer executable; it is **not** a distribution procedure. The expected managed reference is `SimConnect SDK\lib\managed\Microsoft.FlightSimulator.SimConnect.dll`; the project also conditionally copies `SimConnect SDK\lib\SimConnect.dll`. Those copy settings are not redistribution authorization. Explicit `SimConnectManagedDll` and `SimConnectNativeDll` MSBuild properties can override build-input paths.

The bridge currently hardcodes a loopback backend address. Running Node on another machine requires a small, protected configurable connection change that is still pending. The existing architecture diagram above describes current code, not an already functioning two-machine setup. No cloud migration is part of this task.

## CI and artifacts

[Windows checks](.github/workflows/windows-checks.yml) build and test the TypeScript/web application, run browser checks, compile the C# agent against verified official SDK inputs and exercise runtime/configuration checks on `windows-2022`. Public artifacts contain PAX assembly inputs; the complete personal runtime ZIP is assembled locally as described in [package details](docs/windows-package.md).

## Prove the live integration

Follow [windows-acceptance.md](docs/windows-acceptance.md). Its build/release gate must pass before the extract-and-run flight test. Do not copy source to the laptop or compile there. All live checks remain pending.

## Checks

```powershell
npm run typecheck
npm test
npm run build
```

`build` type-checks the workspace and builds both the web assets and production server. Render runs `npm start`; development uses `npm run dev`. Tests cover telemetry transport, hosting/auth, passenger sessions and conversation lifecycle. Provider fixtures are confined to tests; they do not prove live model behavior or simulator acceptance.

The Node/web portions can be developed on macOS/Linux. The bridge cannot run there.

## Logs and troubleshooting

Existing logs use JSON component names `SIMCONNECT`, `BRIDGE`, `SERVER`, `WEB`. Sample receipt/retry messages are throttled. See [architecture](docs/architecture.md) for freshness and reconnect semantics.

Build-reference/targeting-pack failures belong on the builder. Assembly-load or native-DLL failures on the target must be recorded with the artifact version and exact error; fix the package or establish an actual runtime prerequisite instead of installing developer tools. SDK Inspector is a build/development diagnostic, not a target-machine requirement.

## Boundaries

- `services/simconnect-bridge`: SDK calls, unit normalization and local transport only.
- `packages/shared`: runtime schemas and inferred TypeScript wire contracts; no SimConnect types.
- `packages/telemetry`: latest telemetry and freshness state, without flight-event detection.
- `apps/server`: local WebSocket ingress, state publication and logs.
- `apps/web`: a deliberately plain engineering dashboard.
- `docs`: protocol, SimVar mapping and acceptance evidence.

World context, passenger, interaction and AI orchestration will be separate modules consuming normalized telemetry when their milestones require them. No speculative classes or empty services are needed yet. See [architecture and mapping](docs/architecture.md).

## Passenger and session controls

Sign into the hosted dashboard to create a profile manually or choose **Generate passenger** for one of four coherent starter profiles, then edit its fields. Set expected duration and optionally origin/destination, then select **Start session**. Active profiles are held as a snapshot; end the current session before starting another. A single session is shared by dashboard tabs. Refresh retains it, but a server restart/deployment clears it. This feature works without MSFS and does not initiate a simulator flight. Starting a session makes no AI request. The separate conversation form sends a request only when you select **Send message**.

## Text conversation preview

Set `OPENAI_API_KEY` in the server environment to enable text replies. Optional `PAX_OPENAI_TEXT_MODEL` defaults to `gpt-4.1-mini`. See [setup and testing](docs/text-conversation.md). The key stays on the server. The last ten exchanges are held in memory, cleared at session end/restart, and sent with the profile and planned route on each request. Live flight awareness and autonomous reactions remain pending. The separate voice preview below is ready for hardware/API testing.

## Browser voice and flight-event foundations

Use **Voice preview → Connect voice**, allow the microphone, then hold/release **Hold to talk**. The server uses `OPENAI_API_KEY` and optional `PAX_OPENAI_REALTIME_MODEL` (default `gpt-realtime`). See [voice setup, limits and acceptance](docs/voice-preview.md). This preview requires a visible browser tab and does not replace the pending HOTAS integration.

Takeoff/landing detection and an objective event gate are implemented as isolated, synthetically tested logic. They are not connected to live telemetry or AI yet; see [event integration prerequisites](docs/flight-event-foundation.md).
