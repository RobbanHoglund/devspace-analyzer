$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path 'artifacts' | Out-Null
Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'devspace|msedge|WebView' } | Select-Object Name, ProcessId, ParentProcessId, ExecutablePath, CommandLine | ConvertTo-Json -Depth 3 | Set-Content 'artifacts/native-processes.json'
Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object ProcessName, Id, MainWindowTitle | ConvertTo-Json | Set-Content 'artifacts/native-windows.json'
Get-NetTCPConnection -LocalPort 9337 -ErrorAction SilentlyContinue | Format-List | Out-File 'artifacts/native-port.txt'
try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save((Join-Path (Get-Location) 'artifacts/native-desktop.png'))
    $graphics.Dispose()
    $bitmap.Dispose()
} catch { $_ | Out-File 'artifacts/native-desktop-error.txt' }
try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    $text = @()
    foreach ($window in $windows) {
        $text += $window.Current.Name
        if ($window.Current.Name -match 'DevSpace|WebView|Error|Application') {
            $children = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            foreach ($element in $children) { $text += $element.Current.Name }
        }
    }
    $text | Select-Object -First 200 | Set-Content 'artifacts/native-window-text.txt'
} catch { $_ | Out-File 'artifacts/native-automation-error.txt' }
