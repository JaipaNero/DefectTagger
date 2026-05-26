param(
    [string]$Version = '2.2.0',
    [switch]$BuildApk
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'
$venvPyInstaller = Join-Path $repoRoot '.venv\Scripts\pyinstaller.exe'

if (-not (Test-Path $venvPython)) {
    throw "Virtual environment Python not found at $venvPython. Create the .venv first."
}

Write-Host 'Installing Python requirements...'
& $venvPython -m pip install -r requirements.txt

Write-Host 'Ensuring PyInstaller is installed...'
& $venvPython -m pip install pyinstaller

Write-Host 'Building LocalSyncHub.exe...'
& $venvPyInstaller --noconfirm --clean --onefile --name LocalSyncHub main.py

$exePath = Join-Path $repoRoot 'dist\LocalSyncHub.exe'
if (Test-Path $exePath) {
    Write-Host "Build succeeded: $exePath"
} else {
    throw 'Build completed but dist\\LocalSyncHub.exe was not found.'
}

$versionedExePath = Join-Path $repoRoot ("dist\\LocalSyncHub-v{0}.exe" -f $Version)
Copy-Item -Path $exePath -Destination $versionedExePath -Force
Write-Host "Versioned release artifact created: $versionedExePath"

if ($BuildApk) {
    $mobileDir = Join-Path $repoRoot 'mobile'
    if (-not (Test-Path $mobileDir)) {
        throw "Mobile folder not found at $mobileDir"
    }

    Write-Host 'Building Android APK via EAS (preview profile)...'
    Set-Location $mobileDir
    npm install
    npx eas build -p android --profile preview
    Set-Location $repoRoot
}
