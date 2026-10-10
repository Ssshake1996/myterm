[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version,
  [switch]$SkipPublish
)

# Thin wrapper: the release logic lives in release-dsh-remote-ops.mjs so Windows, Linux, macOS and CI share one implementation.
$ErrorActionPreference = "Stop"
$releaseScript = Join-Path $PSScriptRoot "release-dsh-remote-ops.mjs"
$arguments = @($releaseScript, $Version)
if ($SkipPublish) { $arguments += "--no-push" }

& node @arguments
if ($LASTEXITCODE -ne 0) {
  throw "dsh-remote-ops release failed with exit code $LASTEXITCODE"
}
