$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot '..\services\simconnect-bridge\SimConnectBridge.csproj'
dotnet build $project -c Debug
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& (Join-Path $PSScriptRoot '..\services\simconnect-bridge\bin\Debug\net48\SimConnectBridge.exe')
exit $LASTEXITCODE
