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

if (-not (Get-Command gsudo.exe -ErrorAction SilentlyContinue)) {
    & choco install gsudo -y --no-progress
    if ($LASTEXITCODE -ne 0) { throw 'Unable to install the CI-only process integrity helper.' }
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
$helper = (Get-Command gsudo.exe -ErrorAction Stop).Source
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
# Grant only the current runner account access to the disposable checkout.
# Do not grant Everyone access and do not modify the application's own ACLs.
& icacls $env:GITHUB_WORKSPACE /grant "${account}:(OI)(CI)F" /Q
if ($LASTEXITCODE -ne 0) { throw 'Unable to prepare the checkout for a normal-user test process.' }
& $helper --integrity Medium --direct node scripts/native-smoke.mjs $Executable
exit $LASTEXITCODE
