param([Parameter(Mandatory = $true)][string]$Source, [Parameter(Mandatory = $true)][string]$Destination)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
# ZipFile includes dotfiles and keeps browser licenses/resources intact.
if (Test-Path -LiteralPath $Destination) { throw "ZIP already exists: $Destination. Choose a fresh output directory." }
[System.IO.Compression.ZipFile]::CreateFromDirectory($Source, $Destination, [System.IO.Compression.CompressionLevel]::Optimal, $false)
