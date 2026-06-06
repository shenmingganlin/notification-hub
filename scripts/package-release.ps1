param(
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$packageJson = Get-Content (Join-Path $repoRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$packageJson.version
if ([string]::IsNullOrWhiteSpace($version)) {
  throw "package.json version is empty"
}

$distDir = Join-Path $repoRoot "dist"
$stageDir = Join-Path $distDir "notification-hub"
$helperPublishDir = Join-Path $distDir "helper-publish"
$zipPath = Join-Path $distDir "notification-hub-$version.zip"

Remove-Item $distDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $distDir | Out-Null

Write-Host "Publishing helper..."
dotnet publish (Join-Path $repoRoot "helper/NotificationToastHelper.csproj") -c $Configuration -o $helperPublishDir

Write-Host "Staging plugin files..."
$excludeDirs = @(".git", "node_modules", "dist", "bin", "obj", "publish", "data", "plugin-data", "custom-toast", "custom-toast-clicks")
$excludeFiles = @("*.log", "*.tmp", "*.bak", "*.old", "*.zip", "notifications.jsonl", "notification-clicks.jsonl")
robocopy $repoRoot $stageDir /E /XD $excludeDirs /XF $excludeFiles | Out-Null
$robocopyCode = $LASTEXITCODE
if ($robocopyCode -gt 7) {
  throw "robocopy failed with exit code $robocopyCode"
}
$global:LASTEXITCODE = 0

Copy-Item (Join-Path $helperPublishDir "*") (Join-Path $stageDir "helper") -Recurse -Force

$manifestPath = Join-Path $stageDir "manifest.json"
if (-not (Test-Path $manifestPath)) {
  throw "release staging root is invalid: manifest.json missing at zip root"
}

$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]$manifest.version -ne $version) {
  throw "manifest version ($($manifest.version)) does not match package version ($version)"
}

Write-Host "Creating zip..."
Compress-Archive -Path (Join-Path $stageDir "*") -DestinationPath $zipPath -Force

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $hasRootManifest = $zip.Entries | Where-Object { $_.FullName -eq "manifest.json" } | Select-Object -First 1
  $hasNestedManifest = $zip.Entries | Where-Object { $_.FullName -eq "notification-hub/manifest.json" -or $_.FullName -eq "notification-hub\manifest.json" } | Select-Object -First 1
  if (-not $hasRootManifest) {
    throw "zip root is invalid: manifest.json is not at root"
  }
  if ($hasNestedManifest) {
    throw "zip root is invalid: nested notification-hub/manifest.json detected"
  }
}
finally {
  $zip.Dispose()
}

$hash = Get-FileHash $zipPath -Algorithm SHA256
Write-Host "Release zip: $zipPath"
Write-Host "SHA256: $($hash.Hash)"
