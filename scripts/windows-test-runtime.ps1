$ErrorActionPreference = 'Stop'
$directory = Join-Path $env:RUNNER_TEMP 'devspace-webview-runtime'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$bootstrap = Join-Path $directory 'MicrosoftEdgeWebview2Setup.exe'
Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrap
$signature = Get-AuthenticodeSignature -FilePath $bootstrap
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
    throw 'The WebView2 bootstrapper does not have a valid Microsoft signature.'
}
$process = Start-Process -FilePath $bootstrap -ArgumentList '/silent', '/install' -Wait -PassThru
Write-Output "WebView2 bootstrapper exit code: $($process.ExitCode)"
Get-ChildItem "${env:ProgramFiles(x86)}\Microsoft\EdgeWebView\Application" -Directory -ErrorAction SilentlyContinue | Select-Object Name, FullName
