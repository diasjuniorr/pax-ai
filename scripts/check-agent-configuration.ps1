param([Parameter(Mandatory)][string]$Agent)
$ErrorActionPreference = 'Stop'
function Check-Configuration([string]$Url, [string]$Token, [bool]$ExpectedSuccess) {
    $env:PAX_BRIDGE_URL = $Url
    $env:PAX_BRIDGE_TOKEN = $Token
    & $Agent --check-configuration
    if (($LASTEXITCODE -eq 0) -ne $ExpectedSuccess) { throw 'Unexpected agent configuration validation result' }
}
try {
    Check-Configuration 'ws://127.0.0.1:3001/bridge' '' $true
    Check-Configuration 'wss://pax-test.onrender.com/bridge' ('x' * 48) $true
    Check-Configuration 'ws://pax-test.onrender.com/bridge' ('x' * 48) $false
    Check-Configuration 'wss://pax-test.onrender.com/bridge' '' $false
    Check-Configuration 'wss://pax-test.onrender.com/bridge?token=secret' ('x' * 48) $false
    Check-Configuration 'wss://user:secret@pax-test.onrender.com/bridge' ('x' * 48) $false
} finally {
    Remove-Item Env:PAX_BRIDGE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:PAX_BRIDGE_TOKEN -ErrorAction SilentlyContinue
}
$global:LASTEXITCODE = 0
