param([string]$Installer)
$ErrorActionPreference = 'Stop'
if (-not $Installer) {
    $packages = @(Get-ChildItem 'target/release/bundle/nsis' -Filter '*-setup.exe')
    if ($packages.Count -ne 1) { throw 'Expected exactly one newly built NSIS installer.' }
    $Installer = $packages[0].FullName
}
$installRoot = Join-Path $env:RUNNER_TEMP ('DevSpace install test ' + [guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $installRoot) { throw 'Disposable install directory already exists.' }
$installed = $false
$uninstalled = $false
try {
    $process = Start-Process -FilePath $Installer -ArgumentList "/S /D=$installRoot" -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
    $executable = Join-Path $installRoot 'devspace-analyzer.exe'
    $uninstaller = Join-Path $installRoot 'uninstall.exe'
    if (-not (Test-Path -LiteralPath $executable) -or -not (Test-Path -LiteralPath $uninstaller)) { throw 'Installed application or uninstaller is missing.' }
    $notices = @(Get-ChildItem -LiteralPath $installRoot -Recurse -Filter THIRD_PARTY_NOTICES.txt)
    if ($notices.Count -lt 1) { throw 'Installed third-party license notices are missing.' }
    foreach ($name in @('LICENSE', 'NOTICE')) {
        $installedNotice = Join-Path $installRoot $name
        if (-not (Test-Path -LiteralPath $installedNotice)) { throw "Installed $name is missing." }
        if ((Get-FileHash -LiteralPath $installedNotice).Hash -ne (Get-FileHash -LiteralPath $name).Hash) { throw "Installed $name differs from source." }
    }
    $installed = $true
    # Launch in a separate PowerShell process: the native-test script uses exit.
    & pwsh -NoProfile -File scripts/windows-native-test.ps1 -Executable $executable
    if ($LASTEXITCODE -ne 0) { throw 'The installed desktop application failed its native UI checks.' }
} finally {
    $uninstaller = Join-Path $installRoot 'uninstall.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw "Uninstaller failed: $($process.ExitCode)" }
        $deadline = [datetime]::UtcNow.AddSeconds(20)
        while ((Test-Path -LiteralPath (Join-Path $installRoot 'devspace-analyzer.exe')) -and [datetime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
        $uninstalled = -not (Test-Path -LiteralPath (Join-Path $installRoot 'devspace-analyzer.exe'))
    }
    New-Item -ItemType Directory -Force artifacts | Out-Null
    @{ installed = $installed; uninstalled = $uninstalled; revision = $env:GITHUB_SHA; installerSha256 = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash } | ConvertTo-Json | Set-Content artifacts/installer-check.json
}
if (-not $installed -or -not $uninstalled) { throw 'Installation/uninstallation did not complete.' }
