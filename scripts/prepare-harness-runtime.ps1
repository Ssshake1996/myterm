[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$sourceRoot = Join-Path $projectRoot "integrations\deepseek-harness-runtime"
$resourceParent = Join-Path $projectRoot "src-tauri\resources"
$resourceRoot = Join-Path $resourceParent "deepseek-harness-runtime"
$releaseResourceParent = Join-Path $projectRoot "src-tauri\target\release\resources"
$releaseResourceRoot = Join-Path $releaseResourceParent "deepseek-harness-runtime"
$packageLock = Join-Path $sourceRoot "package-lock.json"
$nodeModules = Join-Path $sourceRoot "node_modules"
$dependencyMarker = Join-Path $nodeModules ".myterm-package-lock.sha256"
$pluginSource = Join-Path $projectRoot "integrations\dsh-remote-ops"

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

# npm may leave Windows native-package replacement directories behind when an
# antivirus or a running process holds a DLL during `npm ci`. They are not
# runtime dependencies and can add tens of megabytes to the portable bundle.
# npm can create these directories during the install itself, so cleanup is
# deliberately called both before and after dependency installation.
function Remove-StaleNativePackageDirs {
  param([Parameter(Mandatory = $true)][string]$ModulesRoot)
  foreach ($candidate in @(
    @{ Parent = Join-Path $ModulesRoot "@img"; Pattern = ".sharp-*" }
    @{ Parent = Join-Path $ModulesRoot "@koromix"; Pattern = ".koffi-*" }
  )) {
    if (-not (Test-Path -LiteralPath $candidate.Parent -PathType Container)) {
      continue
    }
    Get-ChildItem -LiteralPath $candidate.Parent -Force -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like $candidate.Pattern } |
      ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
      }
  }
}

Remove-StaleNativePackageDirs $nodeModules

foreach ($required in @(
  (Join-Path $sourceRoot "package.json"),
  $packageLock,
  (Join-Path $sourceRoot "harness.lock.json"),
  (Join-Path $sourceRoot "launcher\start.mjs"),
  (Join-Path $projectRoot "integrations\dsh-remote-ops\package.json"),
  (Join-Path $projectRoot "integrations\dsh-remote-ops\cordis.patch.yml"),
  (Join-Path $projectRoot "integrations\dsh-remote-ops\lib\index.js"),
  (Join-Path $projectRoot "integrations\dsh-remote-ops\lib\client.js")
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
      Write-Warning "npm ci could not replace a locked native dependency; retrying with npm install in place."
      & npm install --omit=dev --ignore-scripts --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) {
        throw "DeepSeek Harness dependency installation failed after npm ci and npm install fallback"
      }
    }
  } finally {
    Pop-Location
  }
  # A fallback `npm install` may have recreated a temporary native package
  # directory after the first cleanup. Remove it before staging resources.
  Remove-StaleNativePackageDirs $nodeModules
  [System.IO.File]::WriteAllText($dependencyMarker, $lockHash)
}

# Also clean an already-installed tree when the lock hash did not change.
Remove-StaleNativePackageDirs $nodeModules

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

foreach ($directory in @("launcher", "node_modules")) {
  Copy-Item -LiteralPath (Join-Path $sourceRoot $directory) -Destination (Join-Path $resourceRoot $directory) -Recurse
}
$stagedPluginRoot = Join-Path $resourceRoot "dsh-remote-ops"
New-Item -ItemType Directory -Path (Join-Path $stagedPluginRoot "lib") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stagedPluginRoot "test") -Force | Out-Null
foreach ($pluginFile in @("package.json", "cordis.patch.yml", "README.md", "README.zh-CN.md")) {
  Copy-Item -LiteralPath (Join-Path $pluginSource $pluginFile) -Destination (Join-Path $stagedPluginRoot $pluginFile) -Force
}
foreach ($pluginFile in @("lib\index.js", "lib\client.js", "test\smoke.mjs")) {
  Copy-Item -LiteralPath (Join-Path $pluginSource $pluginFile) -Destination (Join-Path $stagedPluginRoot $pluginFile) -Force
}
$stagedPluginPackage = Join-Path $resourceRoot "node_modules\@dsh\remote-ops"
if (Test-Path -LiteralPath $stagedPluginPackage) {
  $resolvedStagedPlugin = (Resolve-Path -LiteralPath $stagedPluginPackage).Path
  if (-not $resolvedStagedPlugin.StartsWith($resourceRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Staged remote-ops dependency escaped the Harness resource directory."
  }
  Remove-Item -LiteralPath $stagedPluginPackage -Recurse -Force
}
New-Item -ItemType Directory -Path (Split-Path -Parent $stagedPluginPackage) -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot "integrations\dsh-remote-ops") -Destination $stagedPluginPackage -Recurse
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

if (Test-Path -LiteralPath $releaseResourceRoot) {
  $resolvedReleaseResourceParent = (Resolve-Path -LiteralPath $releaseResourceParent).Path
  $resolvedReleaseResourceRoot = (Resolve-Path -LiteralPath $releaseResourceRoot).Path
  if (-not $resolvedReleaseResourceRoot.StartsWith($resolvedReleaseResourceParent + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Release resource cleanup path escaped src-tauri/target/release/resources."
  }
  Remove-Item -LiteralPath $resolvedReleaseResourceRoot -Recurse -Force
}
