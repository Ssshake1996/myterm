param(
  [string]$Configuration = "release"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$targetRoot = Join-Path $projectRoot "src-tauri\target\$Configuration"
$sourceExe = Join-Path $targetRoot "myterm.exe"
$outputRoot = Join-Path $projectRoot "dist-release"
$stageRoot = Join-Path $outputRoot ".portable-stage"

if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) {
  throw "Release executable was not found: $sourceExe"
}

if (-not (Test-Path -LiteralPath $outputRoot)) {
  New-Item -ItemType Directory -Path $outputRoot | Out-Null
}

$resolvedOutput = (Resolve-Path -LiteralPath $outputRoot).Path
if (-not $stageRoot.StartsWith($resolvedOutput, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Portable staging directory escaped the release output root."
}
if (Test-Path -LiteralPath $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $stageRoot | Out-Null

try {
  Copy-Item -LiteralPath $sourceExe -Destination (Join-Path $stageRoot "myterm.exe")
  New-Item -ItemType File -Path (Join-Path $stageRoot "portable.flag") | Out-Null

  $resources = Join-Path $targetRoot "resources"
  if (Test-Path -LiteralPath $resources -PathType Container) {
    Copy-Item -LiteralPath $resources -Destination (Join-Path $stageRoot "resources") -Recurse
  }

  $package = Get-Content -Raw -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json
  $archive = Join-Path $outputRoot "myterm-portable-v$($package.version)-windows-x64.zip"
  if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
  }
  Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $archive -CompressionLevel Optimal
  Write-Host "Portable archive: $archive"
}
finally {
  if (Test-Path -LiteralPath $stageRoot) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
  }
}
