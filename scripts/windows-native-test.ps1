param([string]$Executable = 'target/release/devspace-analyzer.exe')
$ErrorActionPreference = 'Stop'

# WebView2 150+ ignores environment-based automation flags on elevated hosts.
# Run the unchanged release executable at normal user integrity in CI rather
# than adding a debugging endpoint to the application or weakening its build.
# https://github.com/tauri-apps/wry/issues/1782
if ($env:GITHUB_ACTIONS -ne 'true') {
    & node scripts/native-smoke.mjs $Executable
    exit $LASTEXITCODE
}

# CI-only portable helper, pinned to the official release and published SHA-256.
# https://github.com/gerardog/gsudo/releases/tag/v2.6.1
$helperDirectory = Join-Path $env:RUNNER_TEMP 'devspace-gsudo-2.6.1'
New-Item -ItemType Directory -Force -Path $helperDirectory | Out-Null
$helperArchive = Join-Path $helperDirectory 'gsudo.portable.zip'
Invoke-WebRequest -Uri 'https://github.com/gerardog/gsudo/releases/download/v2.6.1/gsudo.portable.zip' -OutFile $helperArchive -MaximumRetryCount 3 -RetryIntervalSec 2
if ((Get-FileHash -LiteralPath $helperArchive -Algorithm SHA256).Hash -ne '21130BF178D7B9891207F00BFF56F05B6B363CE9CEC7B2D084E45FB12EE51F44') {
    throw 'The CI-only process integrity helper failed checksum verification.'
}
Expand-Archive -LiteralPath $helperArchive -DestinationPath $helperDirectory -Force
$helper = Join-Path $helperDirectory 'x64/gsudo.exe'
if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'The CI-only process integrity helper is missing.' }
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
# Grant only the current runner account access to the disposable checkout.
# Do not grant Everyone access and do not modify the application's own ACLs.
& icacls $env:GITHUB_WORKSPACE /grant "${account}:(OI)(CI)F" /Q
if ($LASTEXITCODE -ne 0) { throw 'Unable to prepare the checkout for a normal-user test process.' }
& $helper --integrity Medium --direct node scripts/native-smoke.mjs $Executable
exit $LASTEXITCODE
