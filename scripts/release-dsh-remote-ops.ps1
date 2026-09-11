[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version,
  [switch]$SkipPublish
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$pluginRoot = Join-Path $projectRoot "integrations\dsh-remote-ops"
$artifactRoot = Join-Path $projectRoot "dist-release"
$releaseNotes = Join-Path $projectRoot "docs\releases\dsh-remote-ops-v$Version.md"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )
  Write-Host "`n== $Label ==" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

function Get-GitHubToken {
  $credential = "protocol=https`nhost=github.com`n`n" | git credential fill
  $tokenLine = ($credential -split "`n" | Where-Object { $_ -like "password=*" } | Select-Object -First 1)
  if ([string]::IsNullOrWhiteSpace($tokenLine)) {
    throw "GitHub credential manager did not provide a token. Run 'gh auth login' or configure Git Credential Manager."
  }
  $token = $tokenLine.Substring(9)
  if ([string]::IsNullOrWhiteSpace($token)) {
    throw "GitHub credential manager returned an empty token."
  }
  return $token
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

$manifestPath = Join-Path $pluginRoot "package.json"
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.version -ne $Version) {
  throw "Plugin package version $($manifest.version) does not match requested release $Version."
}
if (-not (Test-Path -LiteralPath $releaseNotes -PathType Leaf)) {
  throw "Release notes were not found: $releaseNotes"
}

Write-Host "dsh-remote-ops standalone release v$Version" -ForegroundColor Green
Invoke-Checked "Plugin checks" {
  Push-Location $pluginRoot
  try { npm run check } finally { Pop-Location }
}

if (-not (Test-Path -LiteralPath $artifactRoot -PathType Container)) {
  New-Item -ItemType Directory -Path $artifactRoot | Out-Null
}

Push-Location $pluginRoot
try {
  $packedName = (& npm pack --silent --pack-destination $artifactRoot).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($packedName)) {
    throw "npm pack failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

$packedPath = Join-Path $artifactRoot $packedName
$artifactPath = Join-Path $artifactRoot "dsh-remote-ops-v$Version.tgz"
if (-not (Test-Path -LiteralPath $packedPath -PathType Leaf)) {
  throw "Package was not created: $packedPath"
}
if (-not $packedPath.Equals($artifactPath, [System.StringComparison]::OrdinalIgnoreCase)) {
  Copy-Item -LiteralPath $packedPath -Destination $artifactPath -Force
}

$checksumPath = Join-Path $artifactRoot "SHA256SUMS-dsh-remote-ops-v$Version.txt"
$checksum = "$(Get-Sha256 $artifactPath)  $([System.IO.Path]::GetFileName($artifactPath))"
[System.IO.File]::WriteAllText($checksumPath, "$checksum`n", $utf8NoBom)

git diff --check
git add -- integrations/dsh-remote-ops scripts/release-dsh-remote-ops.ps1 docs/releases/dsh-remote-ops-v$Version.md
git diff --cached --check
if (-not (git diff --cached --quiet)) {
  git commit -m "release: publish dsh-remote-ops v$Version"
}

$tagRef = "dsh-remote-ops-v$Version"
git show-ref --verify --quiet "refs/tags/$tagRef"
if ($LASTEXITCODE -ne 0) {
  git tag -a $tagRef -m "dsh-remote-ops v$Version"
} else {
  $head = git rev-parse HEAD
  $tagCommit = git rev-list -n 1 $tagRef
  if ($tagCommit -ne $head) {
    throw "Tag $tagRef already points to a different commit."
  }
}

git push origin main
git push origin $tagRef

if (-not $SkipPublish) {
  $token = Get-GitHubToken
  $headers = @{
    Authorization = "Bearer $token"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
    "User-Agent" = "dsh-remote-ops-release-publisher"
  }
  $repo = "Ssshake1996/myterm"
  $body = [System.IO.File]::ReadAllText($releaseNotes)
  $payload = @{
    tag_name = $tagRef
    target_commitish = "main"
    name = "dsh-remote-ops v$Version"
    body = $body
    draft = $false
    prerelease = $false
    generate_release_notes = $false
  } | ConvertTo-Json -Depth 10
  try {
    $release = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/releases/tags/$tagRef" -Headers $headers
    $updatePayload = @{ name = "dsh-remote-ops v$Version"; body = $body; draft = $false; prerelease = $false } | ConvertTo-Json -Depth 10
    $release = Invoke-RestMethod -Method Patch -Uri "https://api.github.com/repos/$repo/releases/$($release.id)" -Headers $headers -ContentType "application/json; charset=utf-8" -Body $updatePayload
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
    $release = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $headers -ContentType "application/json; charset=utf-8" -Body $payload
  }
  $uploadBase = ($release.upload_url -replace '\{\?name,label\}$', '')
  $assetNames = @($artifactPath, $checksumPath) | ForEach-Object { [System.IO.Path]::GetFileName($_) }
  foreach ($oldAsset in @($release.assets | Where-Object { $assetNames -contains $_.name })) {
    Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$repo/releases/assets/$($oldAsset.id)" -Headers $headers | Out-Null
  }
  foreach ($artifact in @($artifactPath, $checksumPath)) {
    $name = [System.IO.Path]::GetFileName($artifact)
    $asset = Invoke-RestMethod -Method Post -Uri ("{0}?name={1}" -f $uploadBase, [uri]::EscapeDataString($name)) -Headers $headers -InFile (Resolve-Path -LiteralPath $artifact).Path -ContentType "application/octet-stream"
    Write-Host "Uploaded $($asset.name)" -ForegroundColor Green
  }
  Write-Host "Release: https://github.com/$repo/releases/tag/$tagRef" -ForegroundColor Green
}

Write-Host "Standalone dsh-remote-ops release v$Version completed." -ForegroundColor Green
