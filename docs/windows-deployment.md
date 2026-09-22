# Windows runtime deployment decision

Reviewed 2026-09-21. **Current status: complete personal runtime ZIP assembled and CI-checked; gaming-laptop acceptance pending.** See [the package record](windows-package.md). Public redistribution permission remains unresolved. The historical investigation below documents how this deployment decision developed. This replaces the assumption that the gaming laptop is a development workstation. The existing C# / Node / browser responsibilities remain intact.

## Decision and hard constraint

The gaming laptop is runtime hardware. It must receive compiled PAX files, never compile them. Do not install Node/npm, Git, Visual Studio/VS Code, .NET SDK, Framework Developer Pack, MSFS SDK, Docker Desktop, WSL2 or a database on it for PAX acceptance. A proven runtime prerequisite is a separate decision; do not disguise development tooling as a prerequisite.

Retain the current thin native Windows process and `net48` target for now. Avoid migration solely to achieve a self-contained label. No local services/autostart, containers, VMs, databases or development servers belong in the target package. Later local responsibilities can include SimConnect, HOTAS, necessary audio integration, minimal processing and secure communication. Cloud separation remains post-MVP.

## What the source actually requires

[SimConnectBridge.csproj](../services/simconnect-bridge/SimConnectBridge.csproj) targets .NET Framework 4.8 (`net48`), x64, console executable, with `System.Windows.Forms` and `System.Web.Extensions`. The latter supplies `JavaScriptSerializer`. The message-loop approach follows the official managed-wrapper documentation, which specifies Framework 4.7 setup. Framework 4.8 was our compatible implementation choice, not an SDK mandate to install developer tools on end-user PCs. [Official managed setup](https://docs.flightsimulator.com/msfs2024/retail/programming-apis/simconnect/programming-simconnect-clients-using-managed-code/)

The project references `Microsoft.FlightSimulator.SimConnect.dll` from the SDK and sets `Private=true`; it copies native `SimConnect.dll` and now fails the build if either DLL is missing. That copy instruction is neither redistribution permission nor evidence that the resulting executable runs on a clean machine. The executable is now named `PaxAgent.exe`; a missing native DLL fails the build.

| Component | Build environment | Gaming target |
|---|---|---|
| Source, Git, .NET SDK/MSBuild, Framework 4.8 reference/targeting pack | Required to compile C# | Not needed |
| Node/npm, TS/Vite, source dependencies | Needed for TS checks and development host | Not part of agent runtime |
| .NET Framework 4.8-compatible runtime | Used on Windows builder | Required by current executable; Windows 11 includes 4.8/4.8.1 |
| Managed `Microsoft.FlightSimulator.SimConnect.dll` | Compile-time reference from official SDK | Runtime assembly also required; build-reference existence does not make it compile-only |
| Native x64 `SimConnect.dll` | Required for runtime smoke testing; existing project copies it conditionally | Expected client-side native dependency; exact installed version/dependency closure must be inspected and tested |
| SDK tools, headers, samples, Developer Pack | Build/reference material as applicable | Excluded |
| MSFS 2024 | Not established as necessary for compiling client code | Simulator and its server-side SimConnect endpoint |
| Native DLL transitive runtimes (for example VC++ runtime, if imported) | Inspect exact official binaries on builder | Undetermined; do not add an installer speculatively |

Microsoft documents Framework deployment separately from modern .NET self-contained publication. `dotnet publish --self-contained` is not a supported way to bundle the Framework runtime for this `net48` project. Migrating to modern .NET would require checking the official wrapper's compatibility and replacing Framework-specific API usage; neither has been validated. Windows 11 already includes a suitable Framework runtime, so a small Framework-dependent executable may satisfy the clean-target requirement without any separate runtime installation. [Framework deployment](https://learn.microsoft.com/en-us/dotnet/framework/deployment/deployment-guide-for-developers), [modern .NET publishing](https://learn.microsoft.com/en-us/dotnet/core/deploying/), [Windows runtime versions](https://learn.microsoft.com/en-us/dotnet/framework/get-started/system-requirements)

## SimConnect runtime and licensing blocker

The official managed documentation describes GAC registration during **SDK installation**. It does not prove that installing MSFS 2024 alone supplies or registers the managed client assembly for external applications. A SimConnect server inside MSFS is not evidence that our process can load its client dependencies. We cannot promise an MSFS-only prerequisite set from these docs. [Managed-wrapper documentation](https://docs.flightsimulator.com/msfs2024/retail/programming-apis/simconnect/programming-simconnect-clients-using-managed-code/)

The public SDK terms permit development of add-ons, but restrict sharing SDK software except distributable code. The reviewed terms do not identify these exact DLLs or accompanying notice requirements. This is an unresolved permission question, not a conclusion that redistribution is forbidden. The same terms also contain an AI/machine-learning provision whose applicability to the later passenger integration needs clarification. No SDK binaries, third-party repackaged NuGet dependency, GAC-install workaround or SDK artifact upload has been added. A private repository/cache does not by itself resolve those terms. [Official SDK EULA, sections 1 and 2](https://docs.flightsimulator.com/msfs2024/retail/introduction/sdk-eula/)

Before packaging, obtain the exact official SDK version and its included licence/redist notices on a **build machine**, and establish:

1. Whether the matching managed/native DLLs are designated redistributable, and under which notices/conditions.
2. Whether app-local deployment beside our executable is the supported SDK-free runtime route; otherwise identify an official runtime-only prerequisite.
3. The exact native imports/runtime prerequisites and version pairing, verified using a clean Windows machine without the SDK or developer tools.
4. Whether hosted CI use and any private caching are covered by the applicable SDK terms; do not publish the whole SDK.

If the installed terms do not settle this, request confirmation from Microsoft/Asobo. No message has been sent on the user's behalf. No official Microsoft-published SimConnect NuGet package was established in this investigation; do not infer authorization from a community package.

## Remote build and GitHub Actions

A Windows runner is technically suitable for `net48` compilation. GitHub's `windows-2022` inventory includes Framework 4.8 targeting tools and modern .NET SDKs. MSFS SDK acquisition remains a separate input; it is not established as preinstalled. [Runner inventory](https://raw.githubusercontent.com/actions/runner-images/main/images/windows/Windows2022-Readme.md)

An Asobo support response points to the official [SDK download manifest](https://sdk.flightsimulator.com/msfs2024/files/sdk.json), so downloading the SDK is not inherently dependent on running MSFS on the builder. The manifest currently distinguishes retail and flighting releases; do not automatically select the newest entry. Pin the appropriate release and checksum after validating its terms and installer behavior. Availability of a URL does not itself establish redistribution rights. [Asobo download guidance](https://devsupport.flightsimulator.com/t/download-sdk-outside-of-simulator/14610/5)

Added [windows-checks.yml](../.github/workflows/windows-checks.yml) for `npm ci`, build/typecheck and synthetic tests on a Windows runner. The original source-only scope has since been extended with C# compilation as recorded below. [GitHub Node CI documentation](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs)

Repository `diasjuniorr/pax-ai` is public and main is pushed. Windows TypeScript checks passed in [run 35592717297](https://github.com/diasjuniorr/pax-ai/actions/runs/35592717297). The workflow now also compiles C# from pinned official SDK 1.7.3, administratively extracted without SDK installation, and invokes `--check-runtime`. Its artifact contains only PAX exe/config/manifest, not Microsoft DLLs, until redistribution is resolved. C# compile and app-local runtime check passed in [run 35628606547](https://github.com/diasjuniorr/pax-ai/actions/runs/35628606547): zero warnings/errors, both runtime libraries loaded. The runner has development/runtime software preinstalled, so this does not prove the clean laptop prerequisite set.

Once SDK permissions and runtime closure are established, implement a separate packaging job: acquire pinned official build inputs; compile Release/x64; test startup without simulator and without SDK/GAC assumptions; stage an explicit allowlist; include version/commit/dependency hashes and required notices; publish `pax-windows-<version>.zip`. Hosted CI cannot substitute for a real flight acceptance test.

## Artifact contents: proposed, not yet approved or produced

An exact working manifest cannot be asserted before the SDK dependency inspection. The intended minimal set is:

- `PaxAgent.exe` and its generated `.exe.config` if required (rename the current assembly during packaging implementation, not manually after the fact).
- Matching official managed/native SimConnect client DLLs **only if** their app-local deployment and redistribution are established.
- Any proven required app-local native dependencies, under their applicable distribution terms.
- Agent endpoint configuration/launcher, concise runtime instructions, required third-party notices and a version/hash manifest.

No source, SDK installer, developer pack, `node_modules`, Node runtime, build tools, tests, debug symbols, Vite server or local database. Debug web assets/backend stay on the development host for this acceptance plan. No ZIP currently exists, and `PaxAgent.exe` is not yet a runnable command in this repository.

## Keeping Node off the target without a cloud migration

Proposed acceptance topology:

```text
Gaming laptop: MSFS → compiled C# agent
                                  ↓ configured, protected connection
Development machine: existing Node backend → existing browser dashboard
```

This preserves platform adapter / application state / rendering boundaries. The current implementation is **not yet capable of this topology**: the bridge hardcodes `ws://127.0.0.1:3001/bridge`, Node binds loopback, and Vite/browser-origin settings assume local use. Merely copying the EXE or changing a hostname in documentation will not work.

After clearing the SDK packaging blocker, add the minimum configurable agent endpoint and restricted backend ingress needed for a two-machine test, with explicit connection protection. Keep the dashboard on the development machine; do not expose unauthenticated ingress publicly or disable certificate verification. Decide and test that connection as part of packaging, not as a cloud-services project. No network changes have been made in this task because the artifact path is not yet established.

## Wednesday tradeoff and resource checks

The shortest path is to retain `net48`, build elsewhere, establish the redistributable client runtime, and keep Node on the existing development host. Until the SDK issue is resolved, there is no verified clean-target artifact. Installing SDK/tooling or running Node on the laptop would relax the user's requirement and must be an explicit decision; it is not the fallback in our runbook.

Once runnable, measure agent CPU, working set, disconnect/idle behavior, retry frequency and sustained-flight stability using Windows Task Manager. Current code requests one-second telemetry and two-second health probes with throttled retry logs. Negligible impact is a goal, not a measurement already achieved. Keep agent lifetime tied to the test session, with no background service installation.

## Checks performed for this change

On 2026-09-21, `npm run build` passed and all five existing tests passed locally. YAML parsing and expected workflow triggers/runner checks passed; 32 local documentation links resolved across five documents. Reviewed instructions for obsolete gaming-PC development setup. These checks do not validate GitHub execution, C# compilation, PowerShell launch, SDK redistribution, browser behavior or MSFS runtime acceptance; those remain outstanding. No .NET SDK, PowerShell or actionlint executable is available in this environment.

## Reference evidence update — 2026-09-21

The [MSFS2024_AI project file](https://github.com/noscapect/MSFS2024_AI/blob/204413bccaae7f10544a68359d31872f5f8a36cd/src/Copilot/Copilot.csproj) references the official managed SDK DLL with `Private=true`, and copies native `SimConnect.dll` as output content. Its [release script](https://github.com/noscapect/MSFS2024_AI/blob/204413bccaae7f10544a68359d31872f5f8a36cd/tools/Publish-Release.ps1) explicitly stages both beside the exe/config. The inspected [v1.0.0 release](https://github.com/noscapect/MSFS2024_AI/releases/tag/v1.0.0) actually contains those files; checksum verified. It packages a Framework-dependent net472/x64 application, not a self-contained modern .NET runtime. Its build-only reference-assemblies NuGet package does not appear in the runtime ZIP.

**Recommended deployment direction:** retain PAX net48/x64 and implement the same app-local two-DLL packaging on a separate Windows builder. Make a missing native DLL a packaging error (PAX currently copies it only if present), add an explicit manifest/checksum and perform SDK-free smoke testing. The reference uses a local release script; it does not establish a working GitHub-hosted SDK acquisition workflow for us. Keep Node off the target through a configured protected connection to the development host.

This narrows the earlier technical uncertainty: there is now concrete source and shipped-artifact precedent, so framework/C++ alternatives need no further broad study. The reference's releasing document labels the DLLs distributable but does not supply a Microsoft permission notice in the inspected packaging path. Obtain PAX build inputs from the official SDK, not the third-party ZIP; record the applicable SDK redistribution basis before distributing PAX. This remaining release check is distinct from deciding to retain C# and implementing build tooling. No PAX artifact or live result is claimed by this study.

## Home acceptance connection — superseded

The user confirmed Windows 11 Pro, build 26200.9457, and both computers on the same Wi-Fi. For initial acceptance use a Windows SSH local forward to the Mac loopback backend. This provides encrypted authenticated transport without modifying the existing endpoint or opening port 3001 to the LAN. Check `ssh -V` on Windows first. On Mac enable Remote Login for the specific account only; verify the host fingerprint, then use `ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L 127.0.0.1:3001:127.0.0.1:3001 <mac-user>@<mac-lan-ip>`. Keep the tunnel open during the test and close it afterwards. This is a temporary acceptance topology, not the final product deployment. Network and live simulator behavior remain unverified.

## Render acceptance connection — current

The user rejected using the work Mac as a runtime host and approved one Render Free Web Service. See [the deployment guide](render-deployment.md). Production serves the built dashboard and backend together, requires separate generated agent/dashboard secrets, and binds Render's assigned port. The C# agent accepts `PAX_BRIDGE_URL` and `PAX_BRIDGE_TOKEN`, requires WSS off loopback, and preserves normal certificate validation. The development-only loopback defaults remain. No SSH, inbound access to the work machine, Supabase, or database is required. This supersedes the earlier proposed remote-host transport changes and the previous deferral of all cloud hosting. Actual Render and gaming-laptop runtime tests remain pending; this does not resolve SDK runtime packaging.
