param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
try {
    $manifest = Get-Content (Join-Path $PSScriptRoot 'build-manifest.json') -Raw | ConvertFrom-Json
    foreach ($file in $manifest.files) {
        if ($file.name -ne [IO.Path]::GetFileName($file.name)) { throw 'Invalid package manifest' }
        $path = Join-Path $PSScriptRoot $file.name
        if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing package file: $($file.name). Extract the complete personal runtime ZIP." }
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.sha256) { throw "Package file does not match its build: $($file.name)" }
    }
    $agent = Join-Path $PSScriptRoot 'PaxAgent.exe'
    & $agent --check-runtime
    if ($LASTEXITCODE -ne 0) { throw 'Runtime check failed. Keep the error text for diagnosis; do not install the SDK.' }
    if ($CheckOnly) {
        Write-Host 'PAX package and runtime libraries passed. A live MSFS flight has not been tested.'
        exit 0
    }
    Write-Host 'PAX connects your simulator to your hosted dashboard. Close this window or press Ctrl+C to stop.'
    $address = Read-Host 'Render website URL [https://pax-ai-2zo8.onrender.com]'
    if ([string]::IsNullOrWhiteSpace($address)) { $address = 'https://pax-ai-2zo8.onrender.com' }
    $url = [Uri]$address.Trim()
    if (!$url.IsAbsoluteUri -or $url.Scheme -ne 'https' -or $url.UserInfo -or $url.Query -or $url.Fragment -or $url.AbsolutePath -ne '/') {
        throw 'Enter only the HTTPS website address, with no credentials or extra path.'
    }
    $env:PAX_BRIDGE_URL = 'wss://' + $url.Authority + '/bridge'
    $secure = Read-Host 'Paste PAX_BRIDGE_TOKEN from Render Environment (hidden; not the dashboard key)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $env:PAX_BRIDGE_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }
    & $agent --check-configuration
    if ($LASTEXITCODE -ne 0) { throw 'Connection configuration is invalid' }
    & $agent
    if ($LASTEXITCODE -ne 0) { throw 'PAX stopped with an error; keep the console output for diagnosis' }
} catch {
    Write-Host ('PAX: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    Remove-Item Env:PAX_BRIDGE_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:PAX_BRIDGE_URL -ErrorAction SilentlyContinue
}
