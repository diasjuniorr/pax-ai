$ErrorActionPreference = 'Stop'
$version = '1.7.3'
$expectedHash = 'aae63270c9420e099ffa2d21565c267f0603f8e226cf2c8ab2ca8966f6a052bf'
$work = Join-Path $env:RUNNER_TEMP 'pax-sdk'
New-Item -ItemType Directory -Force $work | Out-Null
$zip = Join-Path $work 'core.zip'
Invoke-WebRequest "https://sdk.flightsimulator.com/msfs2024/files/installers/$version/MSFS2024_SDK_Core_Installer_$version.zip" -OutFile $zip
if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $expectedHash) { throw 'SDK checksum mismatch' }
Expand-Archive $zip -DestinationPath (Join-Path $work 'installer')
$installers = @(Get-ChildItem (Join-Path $work 'installer') -Recurse -Filter '*.msi')
if ($installers.Count -ne 1) { throw 'Expected exactly one SDK installer' }
$msi = $installers[0]
$extracted = Join-Path $work 'extracted'
$log = Join-Path $work 'extract.log'
$process = Start-Process msiexec.exe -ArgumentList "/a `"$($msi.FullName)`" /qn TARGETDIR=`"$extracted`" /L*v `"$log`"" -Wait -PassThru
if ($process.ExitCode -ne 0) {
    Get-Content $log -Tail 80
    throw "SDK administrative extraction failed: $($process.ExitCode)"
}
$managed = @(Get-ChildItem $extracted -Recurse -Filter 'Microsoft.FlightSimulator.SimConnect.dll')
$native = @(Get-ChildItem $extracted -Recurse -Filter 'SimConnect.dll' | Where-Object { $_.FullName -match 'SimConnect SDK[\\/]lib[\\/]SimConnect.dll$' })
if ($managed.Count -ne 1 -or $native.Count -ne 1) { throw 'Expected exactly one matching managed/native SDK pair' }
Get-ChildItem $extracted -Recurse -File | Where-Object { $_.Name -match 'licen|eula|redist' -or $_.FullName -match 'SimConnect SDK' } | ForEach-Object { Write-Output $_.FullName }
$output = Join-Path $env:RUNNER_TEMP 'pax-build'
dotnet build "$PSScriptRoot/../services/simconnect-bridge/SimConnectBridge.csproj" -c Release -o $output "-p:SimConnectManagedDll=$($managed[0].FullName)" "-p:SimConnectNativeDll=$($native[0].FullName)"
if ($LASTEXITCODE -ne 0) { throw 'Agent compilation failed' }
& "$output/PaxAgent.exe" --check-runtime
if ($LASTEXITCODE -ne 0) { throw 'Runtime load check failed' }
& "$PSScriptRoot/check-agent-configuration.ps1" -Agent "$output/PaxAgent.exe"
# Assemble and test a complete app-local package on the builder. Only PAX-owned
# files plus dependency metadata are uploaded from this public repository.
$stage = Join-Path $env:RUNNER_TEMP 'pax-personal-runtime'
New-Item -ItemType Directory -Force $stage | Out-Null
foreach ($name in @('PaxAgent.exe', 'PaxAgent.exe.config', 'Microsoft.FlightSimulator.SimConnect.dll', 'SimConnect.dll')) {
    Copy-Item (Join-Path $output $name) $stage
}
$license = @(Get-ChildItem $extracted -Recurse -Filter 'MSFS SDK EULA.pdf')
if ($license.Count -ne 1) { throw 'Expected official SDK license PDF' }
Copy-Item $license[0].FullName (Join-Path $stage 'MSFS-SDK-EULA.pdf')
Copy-Item "$PSScriptRoot/../packaging/windows/*" $stage
$vswhere = "${env:ProgramFiles(x86)}/Microsoft Visual Studio/Installer/vswhere.exe"
$vs = & $vswhere -latest -products '*' -property installationPath
$dumpbin = Get-ChildItem "$vs/VC/Tools/MSVC/*/bin/Hostx64/x64/dumpbin.exe" | Sort-Object FullName -Descending | Select-Object -First 1
if (!$dumpbin) { throw 'dumpbin is required to inspect native runtime imports' }
$dependencyReport = foreach ($name in @('SimConnect.dll', 'Microsoft.FlightSimulator.SimConnect.dll')) {
    Write-Output "Runtime imports: $name"
    & $dumpbin.FullName /DEPENDENTS (Join-Path $stage $name)
    if ($LASTEXITCODE -ne 0) { throw "Dependency inspection failed: $name" }
}
$dependencyReport | Set-Content (Join-Path $stage 'native-dependencies.txt')
$dependencyReport | Write-Output
$vendorNames = @('SimConnect.dll', 'Microsoft.FlightSimulator.SimConnect.dll', 'MSFS-SDK-EULA.pdf')
$manifest = @{
    schemaVersion = 1
    commit = $env:GITHUB_SHA
    sdkVersion = $version
    sdkUrl = "https://sdk.flightsimulator.com/msfs2024/files/installers/$version/MSFS2024_SDK_Core_Installer_$version.zip"
    sdkSha256 = $expectedHash
    files = @(Get-ChildItem $stage -File | Sort-Object Name | ForEach-Object {
        @{ name = $_.Name; bytes = $_.Length; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash;
           source = $(if ($_.Name -in $vendorNames) { 'MicrosoftSDK' } else { 'PAX' }) }
    })
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content "$stage/build-manifest.json"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$stage/Launch-PAX.ps1" -CheckOnly
if ($LASTEXITCODE -ne 0) { throw 'Staged runtime check failed' }
# Verify missing dependencies fail before launching the application.
Move-Item "$stage/SimConnect.dll" "$stage/SimConnect.dll.saved"
try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$stage/Launch-PAX.ps1" -CheckOnly
    if ($LASTEXITCODE -eq 0) { throw 'Missing runtime DLL was not rejected' }
} finally { Move-Item "$stage/SimConnect.dll.saved" "$stage/SimConnect.dll" }
$stdout = Join-Path $env:RUNNER_TEMP 'pax-startup.log'
$stderr = Join-Path $env:RUNNER_TEMP 'pax-startup-errors.log'
$agent = Start-Process "$stage/PaxAgent.exe" -WorkingDirectory $stage -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
try {
    Start-Sleep -Seconds 6
    if ($agent.HasExited) { Get-Content $stdout, $stderr; throw 'Agent exited during simulator-absent startup check' }
} finally {
    if (!$agent.HasExited) { Stop-Process -Id $agent.Id; $agent.WaitForExit() }
}
$startupLog = Get-Content $stdout -Raw
if ($startupLog -notmatch 'Waiting for MSFS') { throw 'Agent did not report simulator-absent waiting state' }
Write-Output 'Staged app remains running with MSFS absent; missing DLL fails closed.'
$artifact = Join-Path $env:RUNNER_TEMP 'pax-agent-compiled'
New-Item -ItemType Directory -Force $artifact | Out-Null
foreach ($file in $manifest.files) {
    if ($file.source -eq 'PAX') { Copy-Item (Join-Path $stage $file.name) $artifact }
}
Copy-Item "$stage/build-manifest.json" $artifact
# README in the public inputs must not imply the Microsoft dependencies are present.
'These are assembly inputs, not the complete runtime ZIP. Three Microsoft files are intentionally absent. Use scripts/assemble-personal-runtime.py on the development Mac with the official SDK archive to create your personal runtime ZIP. The README describes that completed package.' | Set-Content "$artifact/ASSEMBLY-INPUTS.txt"
$global:LASTEXITCODE = 0
