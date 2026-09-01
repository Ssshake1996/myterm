[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$sourceRoot = Join-Path $projectRoot "integrations\deepseek-harness-runtime"
$resourceParent = Join-Path $projectRoot "src-tauri\resources"
$resourceRoot = Join-Path $resourceParent "deepseek-harness-runtime"
$packageLock = Join-Path $sourceRoot "package-lock.json"
$nodeModules = Join-Path $sourceRoot "node_modules"
$dependencyMarker = Join-Path $nodeModules ".myterm-package-lock.sha256"

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
      $sha.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

foreach ($required in @(
  (Join-Path $sourceRoot "package.json"),
  $packageLock,
  (Join-Path $sourceRoot "launcher\start.mjs"),
  (Join-Path $sourceRoot "profile\cordis.yml")
)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "DeepSeek Harness runtime source is incomplete: $required"
  }
}

$lockHash = Get-Sha256 $packageLock
$installedHash = if (Test-Path -LiteralPath $dependencyMarker -PathType Leaf) {
  (Get-Content -Raw -LiteralPath $dependencyMarker).Trim()
} else {
  ""
}

if ($installedHash -ne $lockHash) {
  Push-Location $sourceRoot
  try {
    & npm ci --omit=dev --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
      throw "npm ci for DeepSeek Harness failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
  [System.IO.File]::WriteAllText($dependencyMarker, $lockHash)
}

Push-Location $sourceRoot
try {
  & npm run check
  if ($LASTEXITCODE -ne 0) {
    throw "DeepSeek Harness lock/profile check failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

$nodeCommand = Get-Command node -ErrorAction Stop
$nodeSource = (Resolve-Path -LiteralPath $nodeCommand.Source).Path
$nodeVersionText = (& $nodeSource --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersionText -notmatch '^v(?<major>\d+)\.') {
  throw "Unable to verify the Node.js runtime: $nodeSource"
}
if ([int]$Matches.major -lt 20) {
  throw "DeepSeek Harness requires Node.js 20 or newer; found $nodeVersionText"
}

if (-not (Test-Path -LiteralPath $resourceParent -PathType Container)) {
  New-Item -ItemType Directory -Path $resourceParent | Out-Null
}
$resolvedResourceParent = (Resolve-Path -LiteralPath $resourceParent).Path
$expectedResourceRoot = Join-Path $resolvedResourceParent "deepseek-harness-runtime"
if (-not $resourceRoot.Equals($expectedResourceRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Harness resource staging path escaped src-tauri/resources."
}
if (Test-Path -LiteralPath $resourceRoot) {
  Remove-Item -LiteralPath $resourceRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $resourceRoot | Out-Null

foreach ($directory in @("launcher", "profile", "node_modules")) {
  Copy-Item -LiteralPath (Join-Path $sourceRoot $directory) -Destination (Join-Path $resourceRoot $directory) -Recurse
}
foreach ($file in @("package.json", "package-lock.json", "harness.lock.json")) {
  Copy-Item -LiteralPath (Join-Path $sourceRoot $file) -Destination (Join-Path $resourceRoot $file)
}
$runtimeDirectory = Join-Path $resourceRoot "runtime"
New-Item -ItemType Directory -Path $runtimeDirectory | Out-Null
Copy-Item -LiteralPath $nodeSource -Destination (Join-Path $runtimeDirectory "node.exe")

$manifest = [ordered]@{
  schemaVersion = 1
  nodeVersion = $nodeVersionText
  nodeSha256 = Get-Sha256 $nodeSource
  packageLockSha256 = $lockHash
  preparedAtUtc = [DateTime]::UtcNow.ToString("o")
}
$manifestJson = $manifest | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText(
  (Join-Path $resourceRoot "runtime-manifest.json"),
  $manifestJson,
  (New-Object System.Text.UTF8Encoding($false))
)

$resourceBytes = (Get-ChildItem -LiteralPath $resourceRoot -Recurse -File | Measure-Object Length -Sum).Sum
Write-Host ("Prepared DeepSeek Harness runtime: {0:N2} MiB ({1}, {2})" -f ($resourceBytes / 1MB), $nodeVersionText, $resourceRoot)
