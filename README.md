# Pax — MSFS 2024 telemetry MVP

Milestone 1 only: a local SimConnect reader, TypeScript backend and browser debug dashboard. No AI, audio, passengers, event detection or database.

The authoritative implementation tracker is [the PAX roadmap](docs/ROADMAP.md). Current gate: **Milestone 1 — Windows Live Acceptance**. Update the roadmap after every implementation task; later milestones depend on passing the current acceptance gate unless explicitly instructed otherwise.

```text
MSFS 2024 → official SimConnect → C# bridge
                                     ↓ ws://127.0.0.1:3001/bridge
                             TypeScript server
                                     ↓ WebSocket /telemetry (Vite proxy)
                             Browser :5173
```

## Gaming laptop — runtime hardware only

Do **not** install Node/npm, Git, Visual Studio/VS Code, .NET SDK, Framework Developer Pack, MSFS SDK, Docker/WSL2 or databases on the gaming laptop for PAX. The previous all-components-on-Windows development instructions are superseded.

The target must receive a compiled Windows artifact. **That artifact is not available yet:** SimConnect client redistribution/runtime requirements and the two-machine connection must be resolved first. See [deployment findings and blockers](docs/windows-deployment.md) and [runtime acceptance procedure](docs/windows-acceptance.md).

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

[Windows source checks](.github/workflows/windows-checks.yml) install Node dependencies and run the TypeScript/web build and synthetic tests on `windows-2022`. This workflow does not build the bridge or upload a Windows runtime ZIP. SDK deployment questions block that separate packaging step. There is no recorded GitHub Actions run or configured remote in the implementation workspace.

## Prove the live integration

Follow [windows-acceptance.md](docs/windows-acceptance.md). Its build/release gate must pass before the extract-and-run flight test. Do not copy source to the laptop or compile there. All live checks remain pending.

## Checks

```powershell
npm run typecheck
npm test
npm run build
```

`build` type-checks the workspace and builds the web assets. The supported MVP launch is `npm run dev`; a production server/deployment is out of scope. Tests use a synthetic bridge solely to verify validation, real WebSocket delivery, disconnect/reconnect and heartbeat expiry. There is no mock mode that can be mistaken for live simulator data.

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
