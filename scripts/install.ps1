# ════════════════════════════════════════════════════════════
# gtalk-openclaw — Auto Setup Script (Windows PowerShell)
# https://github.com/ghntech/gtalk-openclaw
# ════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"

function Write-Ok { param($msg) Write-Host "✅ $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "⚠️  $msg" -ForegroundColor Yellow }
function Write-Err { param($msg) Write-Host "❌ $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  gtalk-openclaw Setup (Windows)" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ── Kiểm tra dependencies ────────────────────────────────────
if (-not (Get-Command "openclaw" -ErrorAction SilentlyContinue)) {
    Write-Err "openclaw chưa cài. Xem: https://docs.openclaw.ai/install"
}
if (-not (Get-Command "tailscale" -ErrorAction SilentlyContinue)) {
    Write-Err "Tailscale chưa cài. Tải tại: https://tailscale.com/download/windows"
}
if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    Write-Err "Node.js chưa cài. Tải tại: https://nodejs.org"
}

Write-Ok "Dependencies OK"

# ── Nhập thông tin cấu hình ──────────────────────────────────
Write-Host ""
Write-Host "Nhập thông tin GTalk OA của bạn:" -ForegroundColor Yellow
Write-Host ""

$OA_TOKEN = Read-Host "oaToken (format: oaId:password)"
if ([string]::IsNullOrWhiteSpace($OA_TOKEN)) {
    Write-Err "oaToken không được để trống"
}

$API_URL = Read-Host "API URL [https://mbff.ghn.vn]"
if ([string]::IsNullOrWhiteSpace($API_URL)) {
    $API_URL = "https://mbff.ghn.vn"
}

$WEBHOOK_SECRET = Read-Host "Webhook Secret (để trống nếu không dùng)"

$ALLOW_FROM = Read-Host "GTalk User ID được phép dùng, nhiều ID cách nhau bằng dấu phẩy (có thể điền sau)"

Write-Host ""

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$PLUGIN_DIR = Split-Path -Parent $SCRIPT_DIR

# ── Install dependencies ─────────────────────────────────────
Write-Host "📦 Cài dependencies..." -ForegroundColor Cyan
Push-Location $PLUGIN_DIR
try {
    npm install --omit dev
    npm link openclaw
} catch {
    Write-Err "npm install thất bại: $_"
}
Pop-Location
Write-Ok "Dependencies installed"

# ── Install plugin ───────────────────────────────────────────
Write-Host "🔌 Cài plugin..." -ForegroundColor Cyan

$CONFIG = "$env:USERPROFILE\.openclaw\openclaw.json"

# Xóa config cũ
if (Test-Path $CONFIG) {
    $cfg = Get-Content $CONFIG -Raw | ConvertFrom-Json
    if ($cfg.channels.PSObject.Properties.Name -contains "gtalk-openclaw") {
        $cfg.channels.PSObject.Properties.Remove("gtalk-openclaw")
    }
    if ($cfg.plugins.entries.PSObject.Properties.Name -contains "gtalk-openclaw") {
        $cfg.plugins.entries.PSObject.Properties.Remove("gtalk-openclaw")
    }
    if ($cfg.plugins.allow -is [array]) {
        $cfg.plugins.allow = $cfg.plugins.allow | Where-Object { $_ -ne "gtalk-openclaw" }
    }
    $cfg | ConvertTo-Json -Depth 10 | Set-Content $CONFIG
    Write-Host "Cleaned old config"
}

# Uninstall plugin cũ
openclaw plugins uninstall gtalk-openclaw 2>$null
Remove-Item -Recurse -Force "$env:USERPROFILE\.openclaw\extensions\gtalk-openclaw" -ErrorAction SilentlyContinue

# Install plugin
openclaw plugins install --link $PLUGIN_DIR
if ($LASTEXITCODE -ne 0) {
    Write-Err "Cài plugin thất bại"
}
Write-Ok "Plugin installed"

# ── Bật Tailscale Funnel ─────────────────────────────────────
Write-Host "📡 Bật Tailscale Funnel..." -ForegroundColor Cyan
# Chỉ expose /gtalk-openclaw/webhook
tailscale funnel --bg --set-path /gtalk-openclaw/webhook http://127.0.0.1:18789/gtalk-openclaw/webhook
if ($LASTEXITCODE -ne 0) {
    Write-Err "Bật Tailscale Funnel thất bại. Kiểm tra: tailscale status"
}
Start-Sleep -Seconds 2

# Lấy webhook URL
$FUNNEL_STATUS = tailscale funnel status 2>$null
$WEBHOOK_HOST = ($FUNNEL_STATUS | Select-String -Pattern "https://[^\s]*" | ForEach-Object { $_.Matches[0].Value }) | Select-Object -First 1
$WEBHOOK_HOST = $WEBHOOK_HOST.TrimEnd('/')
if ([string]::IsNullOrWhiteSpace($WEBHOOK_HOST)) {
    Write-Err "Không lấy được Tailscale URL. Kiểm tra: tailscale funnel status"
}
$WEBHOOK_URL = "$WEBHOOK_HOST/gtalk-openclaw/webhook"
Write-Ok "Tailscale Funnel: $WEBHOOK_URL"

# ── Cài Task Scheduler (tự bật funnel khi khởi động) ─────────
Write-Host "⚙️  Cài Task Scheduler..." -ForegroundColor Cyan
$TaskName = "GTalkOpenClawFunnel"
$Action = New-ScheduledTaskAction -Execute "tailscale" -Argument "funnel --bg --set-path /gtalk-openclaw/webhook http://127.0.0.1:18789/gtalk-openclaw/webhook"
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

# Xóa task cũ nếu có
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
Write-Ok "Task Scheduler installed (funnel tự bật khi khởi động)"

# ── Kiểm tra openclaw.json hợp lệ ────────────────────────────
if (-not (Test-Path $CONFIG)) {
    Write-Err "Không tìm thấy $CONFIG"
}
try {
    $null = Get-Content $CONFIG -Raw | ConvertFrom-Json
} catch {
    Write-Err "openclaw.json bị lỗi JSON"
}

# ── Cập nhật openclaw.json ────────────────────────────────────
Write-Host "⚙️  Cập nhật OpenClaw config..." -ForegroundColor Cyan

$cfg = Get-Content $CONFIG -Raw | ConvertFrom-Json

# plugins
if (-not $cfg.plugins) { $cfg | Add-Member -NotePropertyName "plugins" -NotePropertyValue @{} }
if (-not $cfg.plugins.entries) { $cfg.plugins | Add-Member -NotePropertyName "entries" -NotePropertyValue @{} }

# plugins.allow
if (-not $cfg.plugins.allow) {
    $cfg.plugins | Add-Member -NotePropertyName "allow" -NotePropertyValue @()
}
if ($cfg.plugins.allow -notcontains "gtalk-openclaw") {
    $cfg.plugins.allow += "gtalk-openclaw"
}

# plugin entry
$cfg.plugins.entries | Add-Member -NotePropertyName "gtalk-openclaw" -NotePropertyValue @{ enabled = $true } -Force

# channel config
if (-not $cfg.channels) { $cfg | Add-Member -NotePropertyName "channels" -NotePropertyValue @{} }
$channelConfig = @{
    oaToken = $OA_TOKEN
    apiUrl = $API_URL
    allowFrom = $ALLOW_FROM
}
if (-not [string]::IsNullOrWhiteSpace($WEBHOOK_SECRET)) {
    $channelConfig.webhookSecret = $WEBHOOK_SECRET
}
$cfg.channels | Add-Member -NotePropertyName "gtalk-openclaw" -NotePropertyValue $channelConfig -Force

$cfg | ConvertTo-Json -Depth 10 | Set-Content $CONFIG
Write-Ok "OpenClaw config updated"

# ── Restart gateway ───────────────────────────────────────────
Write-Host "🔄 Restart OpenClaw gateway..." -ForegroundColor Cyan
openclaw gateway install 2>$null
openclaw gateway restart 2>$null
Start-Sleep -Seconds 5

# ── Kiểm tra ─────────────────────────────────────────────────
$STATUS = openclaw plugins list 2>$null | Select-String "gtalk-openclaw.*loaded"
if ($STATUS) {
    Write-Ok "Plugin loaded!"
} else {
    Write-Warn "Plugin chưa load — chạy: openclaw plugins list"
}

# ── Done ──────────────────────────────────────────────────────
$OA_ID = $OA_TOKEN.Split(':')[0]
Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Ok "Setup hoàn tất!"
Write-Host ""
Write-Host "Webhook URL: $WEBHOOK_URL" -ForegroundColor Green

# ── Tự động setup channel cho từng userId ────────────────────
if (-not [string]::IsNullOrWhiteSpace($ALLOW_FROM)) {
    Write-Host ""
    Write-Host "⚙️  Đang setup channel cho users..." -ForegroundColor Cyan
    $USER_IDS = $ALLOW_FROM -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    foreach ($USER_ID in $USER_IDS) {
        Write-Host "   → userId: $USER_ID"
        $body = @{
            oaId = $OA_ID
            oaToken = $OA_TOKEN
            userId = $USER_ID
            webhookUrl = $WEBHOOK_URL
        } | ConvertTo-Json
        try {
            $response = Invoke-RestMethod -Uri "http://127.0.0.1:18789/gtalk-openclaw/setup-channel" -Method Post -ContentType "application/json" -Body $body
            Write-Host "     $($response | ConvertTo-Json -Compress)"
        } catch {
            Write-Host "     Error: $_" -ForegroundColor Red
        }
    }
    Write-Ok "Setup channel xong!"
} else {
    Write-Host ""
    Write-Warn "Chưa có userId — chạy thủ công sau:"
    Write-Host ""
    Write-Host "  Invoke-RestMethod -Uri 'http://127.0.0.1:18789/gtalk-openclaw/setup-channel' ``" -ForegroundColor Gray
    Write-Host "    -Method Post -ContentType 'application/json' ``" -ForegroundColor Gray
    Write-Host "    -Body '{`"oaId`":`"$OA_ID`",`"oaToken`":`"$OA_TOKEN`",`"userId`":`"GTALK_USER_ID`",`"webhookUrl`":`"$WEBHOOK_URL`"}'" -ForegroundColor Gray
}
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
