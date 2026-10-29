$ErrorActionPreference = 'Stop'
$pluginRoot = Split-Path $PSScriptRoot -Parent
$desktopRoot = Join-Path $pluginRoot 'desktop'
$runtimeRoot = Join-Path $desktopRoot 'runtime'
$cacheRoot = Join-Path $pluginRoot '.cache/desktop-nuget'
New-Item -ItemType Directory -Path $runtimeRoot,$cacheRoot -Force | Out-Null
$dependencies = Get-Content -LiteralPath (Join-Path $desktopRoot 'dependencies.json') -Raw | ConvertFrom-Json
foreach ($dependency in $dependencies) {
    $directory = Join-Path $cacheRoot ($dependency.id + '-' + $dependency.version)
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $archive = Join-Path $directory 'package.zip'
    if (-not (Test-Path -LiteralPath $archive)) {
        $base = if ($env:REMOTE_OPS_NUGET_SOURCE) { $env:REMOTE_OPS_NUGET_SOURCE.TrimEnd('/') } else { 'https://api.nuget.org/v3-flatcontainer' }
        Invoke-WebRequest ($base + '/' + $dependency.id + '/' + $dependency.version + '/' + $dependency.id + '.' + $dependency.version + '.nupkg') -OutFile $archive
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $dependency.sha256) { throw ('Desktop dependency SHA256 mismatch: ' + $dependency.id) }
    Expand-Archive -LiteralPath $archive -DestinationPath $directory -Force
    Copy-Item -LiteralPath (Join-Path $directory ('lib/' + $dependency.framework + '/' + $dependency.dll)) -Destination $runtimeRoot
    Copy-Item -LiteralPath (Join-Path $directory 'LICENSE.txt') -Destination (Join-Path $runtimeRoot ($dependency.id + '-LICENSE.txt'))
}
$framework = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
$references = @('System.Drawing.dll','System.Windows.Forms.dll','System.Web.Extensions.dll','Microsoft.CSharp.dll','System.Management.dll')
$arguments = @('/nologo','/target:exe','/platform:x64','/optimize+',('/out:' + (Join-Path $runtimeRoot 'RemoteOpsDesktop.exe')))
foreach ($reference in $references) { $arguments += '/reference:' + (Join-Path $framework $reference) }
foreach ($dependency in $dependencies) { $arguments += '/reference:' + (Join-Path $runtimeRoot $dependency.dll) }
$arguments += '/reference:' + (Join-Path $framework 'WPF/WindowsBase.dll')
$arguments += Join-Path $desktopRoot 'RemoteOpsDesktop.cs'
$arguments += '/win32manifest:' + (Join-Path $desktopRoot 'app.manifest')
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw 'Desktop worker compilation failed' }
[IO.File]::WriteAllText((Join-Path $runtimeRoot 'RemoteOpsDesktop.exe.config'),'<configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8" /></startup></configuration>')
$workerArguments = $arguments | ForEach-Object { if ($_ -eq '/target:exe') { '/target:winexe' } elseif ($_ -like '/out:*') { '/out:' + (Join-Path $runtimeRoot 'RemoteOpsDesktopWorker.exe') } else { $_ } }
& $compiler @workerArguments
if ($LASTEXITCODE -ne 0) { throw 'Desktop interactive worker compilation failed' }
Copy-Item -LiteralPath (Join-Path $runtimeRoot 'RemoteOpsDesktop.exe.config') -Destination (Join-Path $runtimeRoot 'RemoteOpsDesktopWorker.exe.config')
& $compiler /nologo /target:winexe /platform:x64 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll ('/out:' + (Join-Path $desktopRoot 'test-app/RemoteOpsDesktopTest.exe')) (Join-Path $desktopRoot 'test-app/Program.cs')
if ($LASTEXITCODE -ne 0) { throw 'Desktop test fixture compilation failed' }
$manifest = @{ protocol = 1; files = @() }
foreach ($file in Get-ChildItem -LiteralPath $runtimeRoot -File | Where-Object Name -ne 'manifest.json' | Sort-Object Name) {
    $manifest.files += @{ name=$file.Name; sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); bytes=$file.Length }
}
[IO.File]::WriteAllText((Join-Path $runtimeRoot 'manifest.json'),($manifest | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
Write-Output ('Desktop runtime built: ' + $runtimeRoot)
