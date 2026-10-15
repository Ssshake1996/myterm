[CmdletBinding()]
param(
  [string]$Profile = "web",
  [string]$DshHome = "",
  [string]$DshEntry = "",
  [switch]$VerifyOnly
)
$ErrorActionPreference = "Stop"
$arguments = @((Join-Path $PSScriptRoot "install.mjs"), "--profile", $Profile)
if ($DshHome) { $arguments += @("--home", $DshHome) }
if ($DshEntry) { $arguments += @("--dsh-entry", $DshEntry) }
if ($VerifyOnly) { $arguments += "--verify-only" }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw "Remote Ops installation failed ($LASTEXITCODE)." }
