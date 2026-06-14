param(
  [string]$DestinationPath = ""
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$PackageName = "StyleTap-clean"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

if ([string]::IsNullOrWhiteSpace($DestinationPath)) {
  $DestinationPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "$PackageName-$Timestamp.zip"
}

$StageRoot = Join-Path ([System.IO.Path]::GetTempPath()) "$PackageName-$Timestamp"
$StageApp = Join-Path $StageRoot "StyleTap"

if (Test-Path $StageRoot) {
  Remove-Item -LiteralPath $StageRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $StageApp | Out-Null

$Files = @(
  "index.html",
  "manifest.webmanifest",
  "render.yaml",
  "service-worker.js",
  "server.py",
  "requirements.txt",
  "package.json",
  "README.md",
  ".env.example",
  ".gitignore"
)

$Directories = @(
  "src",
  "wechat-miniprogram",
  "docs",
  "scripts"
)

foreach ($File in $Files) {
  $Source = Join-Path $ProjectRoot $File
  if (Test-Path $Source) {
    Copy-Item -LiteralPath $Source -Destination (Join-Path $StageApp $File) -Force
  }
}

foreach ($Directory in $Directories) {
  $Source = Join-Path $ProjectRoot $Directory
  if (Test-Path $Source) {
    Copy-Item -LiteralPath $Source -Destination (Join-Path $StageApp $Directory) -Recurse -Force
  }
}

$Forbidden = Get-ChildItem -LiteralPath $StageApp -Recurse -Force | Where-Object {
  $_.FullName -match "\\data(\\|$)" -or
  $_.FullName -match "\\__pycache__(\\|$)" -or
  $_.Name -eq ".env" -or
  ($_.Name -like ".env.*" -and $_.Name -ne ".env.example") -or
  $_.Name -like "*.key" -or
  $_.Name -like "*.pem" -or
  $_.FullName -match "\\data\\wardrobe\.json$"
}

if ($Forbidden) {
  $Forbidden | Select-Object FullName | Format-Table -AutoSize
  throw "Clean package blocked because private files were staged."
}

if (Test-Path $DestinationPath) {
  Remove-Item -LiteralPath $DestinationPath -Force
}

$DestinationParent = Split-Path -Parent $DestinationPath
if ($DestinationParent -and -not (Test-Path $DestinationParent)) {
  New-Item -ItemType Directory -Path $DestinationParent | Out-Null
}

Compress-Archive -Path (Join-Path $StageRoot "StyleTap") -DestinationPath $DestinationPath -Force

$ZipEntries = Add-Type -AssemblyName System.IO.Compression.FileSystem -PassThru
$Archive = [System.IO.Compression.ZipFile]::OpenRead($DestinationPath)
try {
  $BadEntries = $Archive.Entries | Where-Object {
    $_.FullName -match "(^|/)StyleTap/data(/|$)" -or
    $_.FullName -match "(^|/)StyleTap/__pycache__(/|$)" -or
    $_.Name -eq ".env" -or
    ($_.Name -like ".env.*" -and $_.Name -ne ".env.example") -or
    $_.Name -like "*.key" -or
    $_.Name -like "*.pem" -or
    $_.FullName -match "(^|/)StyleTap/data/wardrobe\.json$"
  }
  if ($BadEntries) {
    $BadEntries | Select-Object FullName | Format-Table -AutoSize
    throw "Clean package verification failed."
  }
}
finally {
  $Archive.Dispose()
}

Remove-Item -LiteralPath $StageRoot -Recurse -Force

Write-Host "Clean package created:"
Write-Host $DestinationPath
