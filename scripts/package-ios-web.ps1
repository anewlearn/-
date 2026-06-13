param(
  [string]$DestinationPath = ""
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

if ([string]::IsNullOrWhiteSpace($DestinationPath)) {
  $DestinationPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "StyleTap-iOS-Web-$Timestamp.zip"
}

& (Join-Path $ProjectRoot "scripts\package-clean.ps1") -DestinationPath $DestinationPath

Write-Host ""
Write-Host "iOS Web App package is ready."
Write-Host "Deploy this package to an HTTPS server, then open it in iPhone Safari and choose Share -> Add to Home Screen."
