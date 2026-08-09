param(
    [string]$Executable = "$(Join-Path $PSScriptRoot '..\src-tauri\target\debug\myterm.exe')",
    [int]$Port = 19867
)

$ErrorActionPreference = "Stop"
$executablePath = (Resolve-Path $Executable).Path
$baseUrl = "http://127.0.0.1:$Port"
$token = (& $executablePath api token create 2>$null | Select-Object -First 1).Trim()
if (-not $token.StartsWith("mt_")) {
    throw "REST token creation failed"
}

$server = $null
try {
    $server = Start-Process `
        -FilePath $executablePath `
        -ArgumentList @("api", "serve", "--bind", "127.0.0.1:$Port") `
        -PassThru `
        -WindowStyle Hidden

    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri "$baseUrl/health" -TimeoutSec 1
            if ($health.status -eq "ok") {
                $ready = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $ready) {
        throw "REST server did not become ready"
    }

    try {
        Invoke-RestMethod -Uri "$baseUrl/v1/tasks/not-found" -TimeoutSec 3 | Out-Null
        throw "Unauthenticated request was accepted"
    } catch {
        if ($_.Exception.Response.StatusCode.value__ -ne 401) {
            throw
        }
    }

    $authorization = @{ Authorization = "Bearer $token" }
    $createHeaders = @{
        Authorization = "Bearer $token"
        "Idempotency-Key" = "live-$([guid]::NewGuid())"
    }
    $body = @{
        server = "yuxiaservers"
        task = "Call remote_exec with command hostname; whoami, then return the evidence."
        permission = "read_only"
    } | ConvertTo-Json
    $first = Invoke-RestMethod `
        -Uri "$baseUrl/v1/tasks" `
        -Method Post `
        -Headers $createHeaders `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec 20
    $second = Invoke-RestMethod `
        -Uri "$baseUrl/v1/tasks" `
        -Method Post `
        -Headers $createHeaders `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec 20
    if ($first.taskId -ne $second.taskId -or -not $second.replayed) {
        throw "REST idempotency verification failed"
    }

    $task = $null
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        $task = Invoke-RestMethod `
            -Uri "$baseUrl/v1/tasks/$($first.taskId)" `
            -Headers $authorization `
            -TimeoutSec 3
        if ($task.state -in @("succeeded", "failed", "canceled")) {
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if ($task.state -ne "succeeded") {
        throw "REST task finished in state '$($task.state)'"
    }

    $openapi = Invoke-RestMethod `
        -Uri "$baseUrl/v1/openapi.json" `
        -Headers $authorization `
        -TimeoutSec 3
    if ($openapi.openapi -ne "3.0.3") {
        throw "OpenAPI contract verification failed"
    }
    $events = Invoke-WebRequest `
        -Uri "$baseUrl/v1/tasks/$($first.taskId)/events" `
        -Headers $authorization `
        -TimeoutSec 10
    if (-not $events.Content.Contains("event: complete")) {
        throw "SSE completion event is missing"
    }

    Write-Output "REST_VERIFIED auth health idempotency task sse openapi state=$($task.state)"
} finally {
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id
    }
    $previousErrorPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & $executablePath api token revoke 2>$null | Out-Null
    $ErrorActionPreference = $previousErrorPreference
}
