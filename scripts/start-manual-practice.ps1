[CmdletBinding()]
param(
    [ValidateRange(1024, 65525)]
    [int]$Port = 3000,
    [ValidateRange(15, 600)]
    [int]$StartupTimeoutSeconds = 180,
    [switch]$NoBrowser,
    [switch]$CheckOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Join-Path $projectRoot 'frontend'
$nextCli = Join-Path $frontendRoot 'node_modules\next\dist\bin\next'
$logRoot = Join-Path $projectRoot 'logs\manual-practice'
$mutex = $null
$mutexHeld = $false

function Test-LocalPort([int]$CandidatePort) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $connect = $client.ConnectAsync('127.0.0.1', $CandidatePort)
        if (-not $connect.Wait(300)) { return $false }
        return $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Test-PracticePage([string]$Url, [int]$TimeoutSeconds = 4) {
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSeconds
        return ($response.StatusCode -eq 200 -and $response.Content -match 'data-manual-practice="true"')
    } catch {
        return $false
    }
}

function Show-Practice([string]$Url) {
    Write-Host "练习已就绪：$Url" -ForegroundColor Green
    Write-Host '无需登录。页面中的资金与交易均为本地模拟。'
    if (-not $NoBrowser) { Start-Process -FilePath $Url | Out-Null }
}

try {
    if (-not (Test-Path -LiteralPath (Join-Path $frontendRoot 'package.json'))) {
        throw '没有找到 frontend/package.json。请保留完整项目目录后重新双击启动。'
    }
    $nodeCommand = Get-Command 'node.exe' -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        throw '未找到 Node.js。请从 https://nodejs.org/ 安装 Node.js 22 或更新的 LTS 版本，关闭本窗口后重新启动。'
    }
    $nodeVersionText = (& $nodeCommand.Source --version).Trim()
    $nodeVersion = [version]$nodeVersionText.TrimStart('v')
    if ($nodeVersion -lt [version]'20.9.0') {
        throw "Node.js 版本过低（$nodeVersionText）。请安装 Node.js 22 或更新的 LTS 版本。"
    }
    $pnpmCommand = Get-Command 'pnpm.cmd' -ErrorAction SilentlyContinue
    if ($null -eq $pnpmCommand) { $pnpmCommand = Get-Command 'pnpm.exe' -ErrorAction SilentlyContinue }
    Write-Host "已检测到 Node.js $nodeVersionText。"

    if ($CheckOnly) {
        if (-not (Test-Path -LiteralPath $nextCli)) {
            if ($null -eq $pnpmCommand) {
                throw '缺少前端依赖和 pnpm。请在 PowerShell 执行 npm.cmd install --global pnpm@10，然后重新启动。'
            }
            throw '缺少前端依赖。重新双击 Start-Manual-Practice.cmd 时会自动运行 pnpm install --frozen-lockfile。'
        }
        Write-Host '启动环境检查通过。未启动服务、未打开浏览器。' -ForegroundColor Green
        exit 0
    }

    # A per-checkout named mutex prevents concurrent double-clicks from starting two servers.
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant()))).Replace('-', '')
    } finally {
        $hasher.Dispose()
    }
    $mutex = New-Object System.Threading.Mutex($false, "Local\ManualPractice_$hash")
    try { $mutexHeld = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $mutexHeld = $true }
    if (-not $mutexHeld) { throw '另一个启动窗口正在准备练习页面，请等待它完成后再试。' }

    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
    # Reuse the last successful custom port before selecting a new one.
    $statePath = Join-Path $logRoot 'server.json'
    if (Test-Path -LiteralPath $statePath) {
        $savedUrl = $null
        try {
            $savedState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
            if ($savedState.url -match '^http://127\.0\.0\.1:[0-9]{4,5}/practice$') { $savedUrl = [string]$savedState.url }
        } catch { $savedUrl = $null }
        if ($savedUrl -and (Test-PracticePage $savedUrl)) {
            Show-Practice $savedUrl
            exit 0
        }
    }
    $availablePort = $null
    foreach ($candidate in $Port..($Port + 10)) {
        if (Test-LocalPort $candidate) {
            $url = "http://127.0.0.1:$candidate/practice"
            if (Test-PracticePage $url) {
                Show-Practice $url
                exit 0
            }
        } elseif ($null -eq $availablePort) {
            $availablePort = $candidate
        }
    }
    if ($null -eq $availablePort) {
        throw "端口 $Port 至 $($Port + 10) 均被占用。不会终止其他程序，请关闭不需要的服务，或用 -Port 3100 启动。"
    }

    if (-not (Test-Path -LiteralPath $nextCli)) {
        if ($null -eq $pnpmCommand) {
            throw '缺少 pnpm。请在 PowerShell 执行 npm.cmd install --global pnpm@10，然后重新双击启动。'
        }
        $pnpmVersionText = (& $pnpmCommand.Source --version).Trim()
        $pnpmMajor = [int]($pnpmVersionText.Split('.')[0])
        if ($pnpmMajor -lt 9 -or $pnpmMajor -gt 10) {
            throw "当前 pnpm $pnpmVersionText 与本项目依赖配置不匹配。请执行 npm.cmd install --global pnpm@10，再重新启动。"
        }
        Write-Host '首次启动正在安装前端依赖，需要联网，可能需要几分钟……'
        Push-Location $frontendRoot
        $previousErrorPreference = $ErrorActionPreference
        try {
            # Native stderr can contain nonfatal package-manager progress on Windows PowerShell.
            $ErrorActionPreference = 'Continue'
            & $pnpmCommand.Source install --frozen-lockfile 2>&1 | Tee-Object -FilePath (Join-Path $logRoot 'install.log')
            $installExitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorPreference
            Pop-Location
        }
        if ($installExitCode -ne 0 -or -not (Test-Path -LiteralPath $nextCli)) {
            throw "依赖安装失败（退出代码 $installExitCode）。请查看 $logRoot\install.log；若提示构建脚本未批准，请在 frontend 中执行 pnpm approve-builds，按提示批准本项目依赖，再执行 pnpm install --frozen-lockfile。网络错误请检查网络或代理。"
        }
    }

    $stdoutLog = Join-Path $logRoot 'frontend.stdout.log'
    $stderrLog = Join-Path $logRoot 'frontend.stderr.log'
    $arguments = @(('"' + $nextCli + '"'), 'dev', '--turbopack', '--hostname', '127.0.0.1', '--port', [string]$availablePort)
    $server = Start-Process -FilePath $nodeCommand.Source -ArgumentList $arguments -WorkingDirectory $frontendRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
    $url = "http://127.0.0.1:$availablePort/practice"
    [ordered]@{
        pid = $server.Id
        startedAt = $server.StartTime.ToUniversalTime().ToString('o')
        executable = $nodeCommand.Source
        url = $url
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logRoot 'server.json') -Encoding UTF8
    Write-Host "正在启动练习页面，首次编译稍慢。日志：$logRoot"
    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-PracticePage $url 5) {
            Show-Practice $url
            exit 0
        }
        $server.Refresh()
        if ($server.HasExited) {
            throw "前端服务已退出（代码 $($server.ExitCode)）。请查看 $stderrLog。"
        }
        Start-Sleep -Milliseconds 1000
    }
    throw "页面尚未就绪。服务可能仍在编译，请稍后访问 $url，或查看 $stderrLog。重新双击会检查现有服务。"
} catch {
    Write-Host "启动失败：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($mutexHeld) { $mutex.ReleaseMutex() }
    if ($null -ne $mutex) { $mutex.Dispose() }
}
