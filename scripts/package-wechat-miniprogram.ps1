param(
  [string]$DestinationPath = ""
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Source = Join-Path $ProjectRoot "wechat-miniprogram"
$PackageName = "StyleTap-wechat-miniprogram"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

if (-not (Test-Path $Source)) {
  throw "wechat-miniprogram directory was not found."
}

if ([string]::IsNullOrWhiteSpace($DestinationPath)) {
  $DestinationPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "$PackageName-$Timestamp.zip"
}

$StageRoot = Join-Path ([System.IO.Path]::GetTempPath()) "$PackageName-$Timestamp"
$StageApp = Join-Path $StageRoot "wechat-miniprogram"

if (Test-Path $StageRoot) {
  Remove-Item -LiteralPath $StageRoot -Recurse -Force
}

Copy-Item -LiteralPath $Source -Destination $StageApp -Recurse -Force

$Forbidden = Get-ChildItem -LiteralPath $StageApp -Recurse -Force | Where-Object {
  $_.Name -eq ".env" -or
  ($_.Name -like ".env.*" -and $_.Name -ne ".env.example") -or
  $_.Name -like "*.key" -or
  $_.Name -like "*.pem" -or
  $_.FullName -match "\\data\\wardrobe\.json$"
}

if ($Forbidden) {
  $Forbidden | Select-Object FullName | Format-Table -AutoSize
  throw "WeChat package blocked because private files were staged."
}

if (Test-Path $DestinationPath) {
  Remove-Item -LiteralPath $DestinationPath -Force
}

$DestinationParent = Split-Path -Parent $DestinationPath
if ($DestinationParent -and -not (Test-Path $DestinationParent)) {
  New-Item -ItemType Directory -Path $DestinationParent | Out-Null
}

Compress-Archive -Path $StageApp -DestinationPath $DestinationPath -Force
Remove-Item -LiteralPath $StageRoot -Recurse -Force

Write-Host "WeChat Mini Program package created:"
Write-Host $DestinationPath
