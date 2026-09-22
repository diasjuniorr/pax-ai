# Windows live acceptance — personal package ready, laptop test pending

The gaming laptop is **runtime hardware**. Previous instructions to install Node, .NET SDK, Framework Developer Pack or MSFS SDK on it are superseded. Do not copy/build source there. See [deployment decision](windows-deployment.md).

**A complete personal PAX runtime ZIP is ready on the development Mac.** See [windows-package.md](windows-package.md) for the exact file/hash and private transfer procedure. Windows CI verified the staged folder; clean-laptop startup and live flight acceptance remain pending. The public Actions download is only assembly inputs and must not be run as a complete package.

## Evidence already recorded

On macOS with Node 20.11.1, 2026-09-21: `npm run build` passed (strict TS check and Vite build), five synthetic tests passed, and the installation audit reported zero vulnerabilities at that time. These are not SimConnect, Windows, browser or deployment results. The environment has no .NET SDK, PowerShell or MSFS SDK/simulator.

Windows source checks passed in [run 35592717297](https://github.com/diasjuniorr/pax-ai/actions/runs/35592717297). C# compilation and app-local load checking passed in [run 35628606547](https://github.com/diasjuniorr/pax-ai/actions/runs/35628606547): zero warnings/errors and both libraries loaded, without installing the SDK (administrative extraction only). The builder has other development/runtime software, so clean-laptop acceptance remains pending. The executable-only CI artifact is not a complete runtime package.

User reported Windows 11 Pro, OS build 26200.9457, on the same Wi-Fi as the Mac. The work-Mac SSH route was rejected. Render hosting is now authorized; follow [render-deployment.md](render-deployment.md).

## Gate 1 — build/release environment (not gaming laptop)

- [x] Assemble personal app-local runtime layout from exact official SDK inputs, with original license and hashes.
- [ ] Establish permission for public redistribution of Microsoft runtime files (separate from the personal test ZIP).
- [x] Pin official SDK 1.7.3 archive SHA-256 in `scripts/build-windows.ps1`; build with `windows-2022`.
- [x] Run `npm ci`, `npm run build`, `npm test` on Windows CI/build host (five tests passed).
- [x] Compile Release/x64 C# bridge, inspect native imports, and verify the staged runtime folder on Windows CI.
- [ ] Test startup on an SDK-free Windows runtime machine; identify any actual runtime-only dependency instead of installing build tools.
- [~] Implement protected configurable WSS connection to Render and authenticated dashboard. Eight local tests and compiled production-server smoke passed; hosted verification pending.
- [x] Assemble a local versioned personal ZIP/checksum with explicit contents, launch instructions and no SDK/development tools. Microsoft files are excluded from public artifacts.

The personal ZIP now supplies the matching app-local client DLLs. Public redistribution remains a separate gate. Proceed with the personal package runtime check on the laptop; no SDK installation is needed. Validate any missing Visual C++ runtime before attempting live flight.

## What to do on the gaming laptop now

Use the package runtime check before adding prerequisites. Record Windows version (`winver`), MSFS 2024 version and existing controller drivers. Optionally confirm the existing Framework runtime using built-in Windows PowerShell (read-only, no administrator privileges):

```powershell
$release = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction Stop).Release
$release
$release -ge 528040
```

`True` indicates Framework 4.8 or newer according to [Microsoft's detection table](https://learn.microsoft.com/en-us/dotnet/framework/install/how-to-determine-which-versions-are-installed). Record a missing key or error; do not install a Developer Pack. Windows 11 already includes a compatible Framework runtime. This check says nothing about SimConnect client availability.

## Gate 2 — extract-and-run acceptance (after Gate 1)

1. Privately transfer `PAX-windows-x64-598c029eea4d.zip` from the development Mac and compare its SHA-256 with [the package record](windows-package.md) using built-in PowerShell `Get-FileHash .\PAX-windows-x64-598c029eea4d.zip -Algorithm SHA256`.
2. Extract to a user-writable folder. Record its manifest/version. Install nothing unless the release notes establish a genuine runtime prerequisite and the user explicitly accepts that tradeoff.
3. Deploy the backend/debug dashboard on Render using [the guide](render-deployment.md). Sign in and configure the agent with the service WSS URL and its separate access key once a complete runtime package exists.
4. Run `Check-Runtime.cmd`, then `Start-PAX.cmd` as a normal user, without MSFS running. On the development-host dashboard verify bridge connected, simulator disconnected and blank telemetry.
5. Start MSFS 2024 and enter a flight in a stock aircraft with retractable gear and flaps. Verify connected status and live samples at about 1 Hz.
6. Taxi, turn, climb and descend; verify altitude/AGL, IAS, vertical speed, true heading, position and on-ground state. Check actual gear/flap extension during movement. Account for true versus magnetic heading and MSL versus indicated altitude.
7. Pause/return to menus and verify freshness labeling. CONNECTED means an SDK session, not necessarily a running flight.
8. Exit MSFS, then relaunch and load a flight. PAX must clear/recover data without crashing. Test forced simulator termination separately if appropriate.
9. Stop/restart agent; stop/restart backend on the development host; refresh/open multiple dashboard tabs. Verify clear/reconnect/latest-value behavior.
10. Record CPU and memory in Task Manager during idle, flight and retry states; ensure no PAX service/autostart remains after closing it.

These are planned target acceptance steps. The personal package is assembled and the hosted dashboard is user-verified; the live agent-to-simulator connection remains unverified. HOTAS testing follows telemetry acceptance; no Phase 2 work is authorized here.

## Evidence to fill in

- Date / tester:
- Windows version and Framework Release value:
- MSFS 2024 version / aircraft:
- Artifact name, version, commit and SHA-256:
- CI run URL / builder and SDK version:
- Packaged SimConnect DLL versions/hashes and notices:
- Runtime prerequisites actually present/added (no development tooling):
- Development-host backend endpoint/connection method (omit secrets):
- CPU/working set and duration of observation:

| Runtime check | Result / evidence |
|---|---|
| Artifact extracts and starts without compilation/development tools | Pending |
| SDK-free client runtime loads | Pending |
| Bridge waits with simulator closed | Pending |
| Real flight → connected, telemetry reaches dashboard | Pending |
| Position, speed, altitude, AGL, vertical speed, heading, ground state | Pending |
| Gear/flaps transitions | Pending |
| Pause/menu freshness | Pending |
| Simulator exit/kill → disconnect, no PAX crash | Pending |
| Relaunch simulator → reconnect | Pending |
| Agent restart → clear/recover | Pending |
| Remote backend restart → agent/browser reconnect | Pending |
| Browser refresh/multiple tabs | Pending |
| CPU/memory/idle/retry and clean shutdown | Pending |

Record connect/first-sample/disconnect/reconnect logs and exact failures. Do not install the SDK to hide a missing dependency. Update [ROADMAP.md](ROADMAP.md) only from evidence. Milestone 1 remains incomplete.
