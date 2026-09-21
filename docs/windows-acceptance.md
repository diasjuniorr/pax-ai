# Windows live acceptance — runtime-only strategy, blocked

The gaming laptop is **runtime hardware**. Previous instructions to install Node, .NET SDK, Framework Developer Pack or MSFS SDK on it are superseded. Do not copy/build source there. See [deployment decision](windows-deployment.md).

**No downloadable PAX runtime ZIP exists yet.** C# compilation and app-local dependency loading passed on the Windows builder. Clean-laptop startup, cross-machine transport and live acceptance are unverified. Do not attempt the future `PaxAgent.exe` steps until a package and tested connection configuration are supplied.

## Evidence already recorded

On macOS with Node 20.11.1, 2026-09-21: `npm run build` passed (strict TS check and Vite build), five synthetic tests passed, and the installation audit reported zero vulnerabilities at that time. These are not SimConnect, Windows, browser or deployment results. The environment has no .NET SDK, PowerShell or MSFS SDK/simulator.

Windows source checks passed in [run 35592717297](https://github.com/diasjuniorr/pax-ai/actions/runs/35592717297). C# compilation and app-local load checking passed in [run 35628606547](https://github.com/diasjuniorr/pax-ai/actions/runs/35628606547): zero warnings/errors and both libraries loaded, without installing the SDK (administrative extraction only). The builder has other development/runtime software, so clean-laptop acceptance remains pending. The executable-only CI artifact is not a complete runtime package.

User reported Windows 11 Pro, OS build 26200.9457, on the same Wi-Fi as the Mac. SSH client availability and tunnel setup pending.

## Gate 1 — build/release environment (not gaming laptop)

- [ ] Establish redistribution permission, notices and SDK-free client runtime layout for exact official SimConnect binaries.
- [x] Pin official SDK 1.7.3 archive SHA-256 in `scripts/build-windows.ps1`; build with `windows-2022`.
- [x] Run `npm ci`, `npm run build`, `npm test` on Windows CI/build host (five tests passed).
- [ ] Compile Release/x64 C# bridge; inspect native dependencies and build output.
- [ ] Test startup on an SDK-free Windows runtime machine; identify any actual runtime-only dependency instead of installing build tools.
- [ ] Implement/test protected configurable connection to Node on the development machine. Current code is loopback-only.
- [ ] Publish a versioned allowlisted artifact and checksum, with exact contents and launch instructions. Exclude source, SDK and development dependencies.

Stop here until these checks pass. We have not established that MSFS installation alone provides the managed/native SimConnect client files.

## What to do on the gaming laptop now

Do not install additional software for this task. Record Windows version (`winver`), MSFS 2024 version and existing controller drivers. Optionally confirm the existing Framework runtime using built-in Windows PowerShell (read-only, no administrator privileges):

```powershell
$release = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction Stop).Release
$release
$release -ge 528040
```

`True` indicates Framework 4.8 or newer according to [Microsoft's detection table](https://learn.microsoft.com/en-us/dotnet/framework/install/how-to-determine-which-versions-are-installed). Record a missing key or error; do not install a Developer Pack. Windows 11 already includes a compatible Framework runtime. This check says nothing about SimConnect client availability.

## Gate 2 — extract-and-run acceptance (after Gate 1)

1. Download the supplied `pax-windows-<version>.zip` and compare its hash using built-in PowerShell `Get-FileHash .\pax-windows-<version>.zip -Algorithm SHA256` (substitute the actual filename).
2. Extract to a user-writable folder. Record its manifest/version. Install nothing unless the release notes establish a genuine runtime prerequisite and the user explicitly accepts that tradeoff.
3. Have the existing Node backend/debug dashboard running on the development machine. Apply the package's tested endpoint/security configuration. Exact settings will be supplied with the first artifact; none exists today.
4. Run the packaged `PaxAgent.exe` as a normal user, without MSFS running. On the development-host dashboard verify bridge connected, simulator disconnected and blank telemetry.
5. Start MSFS 2024 and enter a flight in a stock aircraft with retractable gear and flaps. Verify connected status and live samples at about 1 Hz.
6. Taxi, turn, climb and descend; verify altitude/AGL, IAS, vertical speed, true heading, position and on-ground state. Check actual gear/flap extension during movement. Account for true versus magnetic heading and MSL versus indicated altitude.
7. Pause/return to menus and verify freshness labeling. CONNECTED means an SDK session, not necessarily a running flight.
8. Exit MSFS, then relaunch and load a flight. PAX must clear/recover data without crashing. Test forced simulator termination separately if appropriate.
9. Stop/restart agent; stop/restart backend on the development host; refresh/open multiple dashboard tabs. Verify clear/reconnect/latest-value behavior.
10. Record CPU and memory in Task Manager during idle, flight and retry states; ensure no PAX service/autostart remains after closing it.

These are planned acceptance steps, not a claim that the package/endpoint is ready. HOTAS testing follows telemetry acceptance; no Phase 2 work is authorized here.

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
