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
# Publish our executable only until the SDK redistribution check is resolved.
# SDK binaries and extracted installer files never enter a public artifact.
$artifact = Join-Path $env:RUNNER_TEMP 'pax-agent-compiled'
New-Item -ItemType Directory -Force $artifact | Out-Null
Copy-Item "$output/PaxAgent.exe", "$output/PaxAgent.exe.config" $artifact
@{
    commit = $env:GITHUB_SHA
    sdkVersion = $version
    sdkSha256 = $expectedHash
    files = @(Get-ChildItem $output -File | Where-Object { $_.Extension -ne '.pdb' } | ForEach-Object {
        @{ name = $_.Name; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash }
    })
} | ConvertTo-Json -Depth 4 | Set-Content "$artifact/build-manifest.json"
'Compiled PAX agent only. Requires the matching managed and native SimConnect runtime DLLs. This is not yet a complete end-user package.' | Set-Content "$artifact/README.txt"
