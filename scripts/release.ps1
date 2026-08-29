[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version,
  [switch]$SkipPublish,
  [switch]$SkipMemoryCheck,
  [switch]$RunRustTests
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$releaseNotes = Join-Path $projectRoot "docs\releases\v$Version.md"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory
  )
  Write-Host "`n== $Label ==" -ForegroundColor Cyan
  Push-Location $WorkingDirectory
  try {
    & powershell -NoProfile -ExecutionPolicy Bypass -Command $Command
    if ($LASTEXITCODE -ne 0) {
      throw "$Label failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Replace-Required {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Pattern,
    [Parameter(Mandatory = $true)][string]$Replacement
  )
  $text = [System.IO.File]::ReadAllText($Path)
  $regex = [regex]::new($Pattern)
  if (-not $regex.IsMatch($text)) {
    throw "Version marker was not found in $Path"
  }
  $updated = $regex.Replace($text, $Replacement, 1)
  [System.IO.File]::WriteAllText($Path, $updated, $utf8NoBom)
}

function Update-VersionFiles {
  Replace-Required (Join-Path $projectRoot "package.json") '"version"\s*:\s*"[^"]+"' ('"version": "{0}"' -f $Version)
  Replace-Required (Join-Path $projectRoot "package-lock.json") '"version"\s*:\s*"[^"]+"' ('"version": "{0}"' -f $Version)
  Replace-Required (Join-Path $projectRoot "package-lock.json") '("":\s*\{\s*"name":\s*"myterm",\s*"version":\s*)"[^"]+"' ('$1"{0}"' -f $Version)
  Replace-Required (Join-Path $projectRoot "src-tauri\Cargo.toml") '(?m)^version\s*=\s*"[^"]+"' ('version = "{0}"' -f $Version)
  Replace-Required (Join-Path $projectRoot "src-tauri\Cargo.lock") '(name\s*=\s*"myterm"\r?\nversion\s*=\s*)"[^"]+"' ('$1"{0}"' -f $Version)
  Replace-Required (Join-Path $projectRoot "src-tauri\tauri.conf.json") '"version"\s*:\s*"[^"]+"' ('"version": "{0}"' -f $Version)
  Replace-Required (Join-Path $projectRoot "README.md") '\d+\.\d+\.\d+' $Version
  Replace-Required (Join-Path $projectRoot "README.en.md") 'Current version: `[^`]+`' ('Current version: `{0}`' -f $Version)
  Replace-Required (Join-Path $projectRoot "docs\user-guide.zh-CN.md") '\d+\.\d+\.\d+' $Version
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

function Get-Sha256 {
  param(
    [Parameter(Mandatory = $true)][string]$Path
  )
  $getFileHash = Get-Command Get-FileHash -ErrorAction SilentlyContinue
  if ($null -ne $getFileHash) {
    return ((Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant())
  }
  $certutilOutput = & certutil.exe -hashfile $Path SHA256 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to calculate SHA-256 for $Path. Neither Get-FileHash nor certutil succeeded."
  }
  $hash = $certutilOutput |
    Where-Object { $_ -match '^[0-9a-fA-F]{64}$' } |
    Select-Object -First 1
  if ([string]::IsNullOrWhiteSpace($hash)) {
    throw "certutil did not return a SHA-256 digest for $Path."
  }
  return $hash.Trim().ToLowerInvariant()
}

if (-not (Test-Path -LiteralPath $releaseNotes -PathType Leaf)) {
  throw "Release notes were not found: $releaseNotes"
}

Write-Host "myterm release v$Version" -ForegroundColor Green
Update-VersionFiles

Invoke-Step "Frontend tests (single thread)" 'npm test -- --pool=threads --poolOptions.threads.singleThread' $projectRoot
Invoke-Step "Frontend lint" 'npm run lint' $projectRoot
Invoke-Step "Frontend build" 'npm run build' $projectRoot
Invoke-Step "dsh-codex-agent native and Harness gate" 'npm run test:codex-harness' $projectRoot
Invoke-Step "Rust format" 'cargo fmt --all -- --check' (Join-Path $projectRoot "src-tauri")
Invoke-Step "Rust type check" 'cargo check -j 1' (Join-Path $projectRoot "src-tauri")

if ($RunRustTests) {
  Invoke-Step "Desktop host Rust tests" 'cargo test -j 1' (Join-Path $projectRoot "src-tauri")
}

$env:CARGO_BUILD_JOBS = "1"
Invoke-Step "Windows Release build" 'npm run build:release' $projectRoot
Invoke-Step "Distribution audit" 'npm run check:dist' $projectRoot

if (-not $SkipMemoryCheck) {
  $exe = (Resolve-Path -LiteralPath (Join-Path $projectRoot "src-tauri\target\release\myterm.exe")).Path
  $process = Start-Process -FilePath $exe -ArgumentList "--portable" -WindowStyle Hidden -PassThru
  $samples = @()
  try {
    for ($index = 0; $index -lt 7; $index++) {
      Start-Sleep -Seconds 5
      $native = Get-Process -Id $process.Id -ErrorAction Stop
      $samples += [pscustomobject]@{
        Seconds = (($index + 1) * 5)
        WorkingSetMiB = [math]::Round($native.WorkingSet64 / 1MB, 2)
        PrivateMiB = [math]::Round($native.PrivateMemorySize64 / 1MB, 2)
        Handles = $native.HandleCount
      }
    }
    $first = $samples[0]
    $last = $samples[$samples.Count - 1]
    $privateDelta = [math]::Round($last.PrivateMiB - $first.PrivateMiB, 2)
    $workingDelta = [math]::Round($last.WorkingSetMiB - $first.WorkingSetMiB, 2)
    $handleDelta = $last.Handles - $first.Handles
    $samples | Format-Table -AutoSize
    Write-Host "memory-check private_delta_mib=$privateDelta working_set_delta_mib=$workingDelta handle_delta=$handleDelta" -ForegroundColor Green
    if ($privateDelta -gt 8 -or $handleDelta -gt 32) {
      throw "Runtime memory sample shows sustained growth."
    }
  } finally {
    if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
      Stop-Process -Id $process.Id -Force
      Wait-Process -Id $process.Id -Timeout 10 -ErrorAction SilentlyContinue
    }
  }
}

$installer = Join-Path $projectRoot "src-tauri\target\release\bundle\nsis\myterm_${Version}_x64-setup.exe"
$portable = Join-Path $projectRoot "dist-release\myterm-portable-v${Version}-windows-x64.zip"
foreach ($artifact in @($installer, $portable)) {
  if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
    throw "Expected release artifact was not found: $artifact"
  }
}
$checksumPath = Join-Path $projectRoot "dist-release\SHA256SUMS-v${Version}.txt"
$checksumLines = foreach ($artifact in @($installer, $portable)) {
  $hash = Get-Sha256 -Path $artifact
  "$hash  $([System.IO.Path]::GetFileName($artifact))"
}
[System.IO.File]::WriteAllLines($checksumPath, $checksumLines, $utf8NoBom)

git diff --check
git add -A
git diff --cached --check
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -m "release: publish v$Version"
}
$tagRef = "v$Version"
$tagExists = git show-ref --verify --quiet "refs/tags/$tagRef"
if ($LASTEXITCODE -eq 0) {
  $head = git rev-parse HEAD
  $tagCommit = git rev-list -n 1 $tagRef
  if ($tagCommit -ne $head) {
    throw "Tag $tagRef already points to a different commit."
  }
} else {
  git tag -a $tagRef -m "myterm v$Version"
}
git push origin main
git push origin $tagRef

if (-not $SkipPublish) {
  $token = Get-GitHubToken
  $headers = @{
    Authorization = "Bearer $token"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
    "User-Agent" = "myterm-release-publisher"
  }
  $repo = "Ssshake1996/myterm"
  $body = [System.IO.File]::ReadAllText($releaseNotes)
  $payload = @{
    tag_name = "v$Version"
    target_commitish = "main"
    name = "myterm v$Version"
    body = $body
    draft = $false
    prerelease = $false
    generate_release_notes = $false
  } | ConvertTo-Json -Depth 10
  try {
    $release = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/releases/tags/v$Version" -Headers $headers
    $updatePayload = @{ name = "myterm v$Version"; body = $body; draft = $false; prerelease = $false } | ConvertTo-Json -Depth 10
    $release = Invoke-RestMethod -Method Patch -Uri "https://api.github.com/repos/$repo/releases/$($release.id)" -Headers $headers -ContentType "application/json; charset=utf-8" -Body $updatePayload
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
    $release = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $headers -ContentType "application/json; charset=utf-8" -Body $payload
  }
  $uploadBase = ($release.upload_url -replace '\{\?name,label\}$', '')
  $assetNames = @($installer, $portable, $checksumPath) | ForEach-Object { [System.IO.Path]::GetFileName($_) }
  foreach ($oldAsset in @($release.assets | Where-Object { $assetNames -contains $_.name })) {
    Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$repo/releases/assets/$($oldAsset.id)" -Headers $headers | Out-Null
  }
  foreach ($artifact in @($installer, $portable, $checksumPath)) {
    $name = [System.IO.Path]::GetFileName($artifact)
    $asset = Invoke-RestMethod -Method Post -Uri ("{0}?name={1}" -f $uploadBase, [uri]::EscapeDataString($name)) -Headers $headers -InFile (Resolve-Path -LiteralPath $artifact).Path -ContentType "application/octet-stream"
    Write-Host "Uploaded $($asset.name)" -ForegroundColor Green
  }
  Write-Host "Release: https://github.com/$repo/releases/tag/v$Version" -ForegroundColor Green
}

Write-Host "Release v$Version completed." -ForegroundColor Green
