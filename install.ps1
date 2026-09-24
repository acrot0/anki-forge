# anki-forge installer for Windows.
# Downloads the latest self-contained release binary into ~\.local\bin and
# points you at the PATH step. No npm needed, no Node needed.
#
# Usage:  pwsh -File install.ps1          (from a clone)
#     or: irm <raw-url> | iex             (once the file is hosted; review first!)
param(
    [string]$Version = "latest"
)

$ErrorActionPreference = "Stop"

$dest = Join-Path $HOME ".local\bin"
$file = Join-Path $dest "anki-forge.exe"
$base = "https://github.com/acrot0/anki-forge/releases"
if ($Version -eq "latest") {
    $url = "$base/latest/download/anki-forge-windows-x64.exe"
} else {
    $url = "$base/download/$Version/anki-forge-windows-x64.exe"
}

Write-Host "Downloading $url ..."
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Invoke-WebRequest -Uri $url -OutFile $file
Write-Host "Installed to $file"

# ~\.local\bin is rarely on PATH; tell the user instead of silently failing.
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$dest*") {
    Write-Host ""
    Write-Host "NOT on PATH yet. Add it once with:"
    Write-Host "  [Environment]::SetEnvironmentVariable('Path', `$env:Path + ';$dest', 'User')"
    Write-Host "Then reopen the terminal and run: anki-forge"
} else {
    Write-Host "Run: anki-forge"
}
