# Personal Windows runtime package

The public Actions artifact contains PAX assembly inputs. The complete **personal test ZIP** is assembled on the development Mac from those inputs and the pinned official Microsoft SDK archive. The gaming laptop only extracts and runs the completed ZIP; no SDK, build tool, Node installation, or compilation is involved there.

## DLL supply

Both `SimConnect.dll` and `Microsoft.FlightSimulator.SimConnect.dll` come unchanged from official MSFS 2024 SDK **1.7.3**. The archive URL and SHA-256 are recorded in `build-manifest.json`; the source archive hash is `aae63270c9420e099ffa2d21565c267f0603f8e226cf2c8ab2ca8966f6a052bf`. The SDK is administratively extracted on the CI builder, not installed. The Mac assembler extracts matching cabinet members by size and SHA-256, retaining only the two DLLs and the original SDK EULA PDF. It never executes the SDK installer.

The exact metadata is produced from the same SDK inputs that compiled and passed the Windows runtime check. No third-party DLL download or random NuGet bundle is used. The manifest also records the commit and every package file's size/hash. `native-dependencies.txt` records imports found by Microsoft's dumpbin for both DLLs; required runtimes must still be checked on the actual laptop.

## Distribution boundary

The official support topics [managed/native redistribution](https://devsupport.flightsimulator.com/t/permission-to-redistribute-simconnect-dll-and-microsoft-flightsimulator-simconnect-dll/18087) and [MSFS 2024 native redistribution](https://devsupport.flightsimulator.com/t/redistribution-rights-for-msfs-2024-native-simconnect-dll/18233) were checked on 2026-09-22. Neither contained a Microsoft/Asobo answer resolving the public redistribution question. This workflow does not claim a public redistribution grant. The full ZIP remains on the user's development machine for their personal simulator test; Microsoft binaries and the SDK license PDF are excluded from public Actions uploads, Git, and releases. The original Microsoft terms still apply. A general public runtime release remains a separate unresolved task; no inquiry was sent on the user's behalf.

## Build and assembly (development host only)

1. Let `Windows checks and agent compilation` pass on the intended commit. Download its `pax-agent-compiled` artifact into an ignored `dist/runtime-input/<commit>` folder. `ASSEMBLY-INPUTS.txt` warns that this download is incomplete by itself.
2. Obtain the pinned SDK ZIP from the official URL in the manifest on the development Mac. Install `cabextract` on that development host if needed. The gaming laptop does not perform either step.
3. Run:

   ```sh
   python3 scripts/assemble-personal-runtime.py \
     --build dist/runtime-input/<commit> \
     --sdk /path/to/MSFS2024_SDK_Core_Installer_1.7.3.zip \
     --output dist/personal-runtime
   ```

4. The assembler checks the source archive, finds the exact Microsoft inputs, verifies every runtime file, then writes a versioned ZIP and adjacent `.zip.sha256` checksum. Transfer that ZIP privately to the user's gaming laptop (for example via their own USB storage). Do not upload it to the public repository.

## Laptop steps

1. Extract the entire ZIP to `Documents\PAX` or another user-owned directory.
2. Run `Check-Runtime.cmd`. It checks file integrity and app-local x64 runtime loading; no simulator or key needed.
3. Run `Start-PAX.cmd`, accept the default Render URL, and paste **PAX_BRIDGE_TOKEN** at the hidden prompt. The launcher does not save the key. It is cleared from the launcher's process environment on exit.
4. Start MSFS 2024 and enter a flight. Sign in to the dashboard with the separate **PAX_DASHBOARD_TOKEN** and inspect telemetry.
5. Close the console or press Ctrl+C to stop. No service/autostart is installed. Follow [live acceptance](windows-acceptance.md) for reconnect and flight checks.

The CMD files invoke built-in Windows PowerShell with a process-only execution policy setting; no persistent policy setting is changed. PAX is unsigned. Record any actual Windows security/runtime error rather than disabling security or installing development tools speculatively.

## Verification limits

CI compiles the agent, inspects native dependencies, builds a full staged folder, checks all hashes and runtime loading, rejects a missing DLL, and checks that the process remains alive while MSFS is absent. The builder already has Windows development/runtime prerequisites, so this does not prove the clean gaming-laptop prerequisite set. Live flight telemetry, Windows security prompts and CPU/memory measurements require the actual laptop.

## Completed personal build — 2026-09-22

Windows [run 35694510784](https://github.com/diasjuniorr/pax-ai/actions/runs/35694510784) passed for commit `598c029eea4d`: compilation, app-local runtime/hash checks, missing-DLL rejection, simulator-absent process survival, endpoint validation, backend tests and browser regression. The complete ZIP was then assembled on the Mac at `dist/personal-runtime/PAX-windows-x64-598c029eea4d.zip` (258,149 bytes). All ten payload files match the CI manifest; the exe and both DLLs have x64 PE headers. ZIP SHA-256: `560ce76ddecf194a69d0911ae0ec1384341b52459a5235ea49d836a89d42128a`. The adjacent `.zip.sha256` file records it too. The ZIP is local/ignored, not a public Actions artifact.

Native import inspection confirms `MSVCP140.dll`, `VCRUNTIME140.dll`, and `VCRUNTIME140_1.dll`, plus Windows/UCRT libraries; the managed wrapper also imports `mscoree.dll` and native `SimConnect.dll`. Consequently the x64 Visual C++ v14 runtime is an actual prerequisite. Run the package check first; do not assume it is absent. If a missing VC runtime is confirmed, obtain the [official x64 runtime installer](https://aka.ms/vc14/vc_redist.x64.exe), following [Microsoft's runtime guidance](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist). It is a runtime prerequisite, not Visual Studio or an SDK. No redistributable installer is bundled or automatically run. Target installation/versions remain unverified until the laptop is available.

## Updating from an existing personal package

The assembler also accepts `--existing-runtime PATH_TO_OLDER_PERSONAL_ZIP` instead of `--sdk`. It reuses only the two Microsoft DLLs and EULA, checks their size and SHA-256 against the **new** Windows CI manifest, and verifies all new PAX payloads before writing a ZIP. A vendor mismatch fails before packaging; no developer tools or installer are added to the gaming laptop. This path was locally checked by reproducing the previous ZIP byte-for-byte and rejecting a modified native DLL.

The aircraft-identity/event-debug change requires a newly compiled personal package for tonight. The prior `598c029eea4d` package still sends basic telemetry but cannot enable event detection. Updated artifact evidence will be recorded after CI and assembly complete.
