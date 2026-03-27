#!/bin/bash
set -e

# ════════════════════════════════════════════════════════════
# gtalk-openclaw — Auto Setup Script
# https://github.com/ghntech/gtalk-openclaw
# ════════════════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
err()  { echo -e "${RED}❌ $1${NC}"; exit 1; }

echo ""
echo "════════════════════════════════════════"
echo "  gtalk-openclaw Setup"
echo "════════════════════════════════════════"
echo ""

# ── Kiểm tra dependencies ────────────────────────────────────
command -v openclaw >/dev/null 2>&1 || err "openclaw chưa cài. Xem: https://docs.openclaw.ai/install"
TAILSCALE="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
[ -f "$TAILSCALE" ] || err "Tailscale chưa cài. Tải tại: https://tailscale.com/download/mac"
command -v node >/dev/null 2>&1 || err "Node.js chưa cài. Tải tại: https://nodejs.org"

ok "Dependencies OK"

# ── Nhập thông tin cấu hình ──────────────────────────────────
echo ""
echo "Nhập thông tin GTalk OA của bạn:"
echo ""

read -p "oaToken (format: oaId:password): " OA_TOKEN
[ -z "$OA_TOKEN" ] && err "oaToken không được để trống"

read -p "API URL [https://mbff.ghn.vn]: " API_URL
API_URL="${API_URL:-https://mbff.ghn.vn}"

read -p "Webhook Secret (để trống nếu không dùng): " WEBHOOK_SECRET

read -p "GTalk User ID được phép dùng (có thể điền sau): " ALLOW_FROM

echo ""

# ── Install plugin ───────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"

echo "📦 Cài plugin..."
# Xóa thư mục extension cũ nếu tồn tại
openclaw plugins uninstall gtalk-openclaw 2>/dev/null || true
rm -rf "$HOME/.openclaw/extensions/gtalk-openclaw" 2>/dev/null || true
openclaw plugins install "$PLUGIN_DIR" || err "Cài plugin thất bại"
ok "Plugin installed"

# ── Bật Tailscale Funnel ─────────────────────────────────────
echo "📡 Bật Tailscale Funnel..."
"$TAILSCALE" funnel --bg 18789 || err "Bật Tailscale Funnel thất bại. Kiểm tra Tailscale đã login chưa."
sleep 2

# Lấy webhook URL
WEBHOOK_HOST=$("$TAILSCALE" funnel status 2>/dev/null | grep "https://" | awk '{print $1}' | tr -d '/')
[ -z "$WEBHOOK_HOST" ] && err "Không lấy được Tailscale URL"
WEBHOOK_URL="${WEBHOOK_HOST}/gtalk-openclaw/webhook"
ok "Tailscale Funnel: $WEBHOOK_URL"

# ── Cài LaunchAgent (tự bật funnel khi khởi động) ────────────
echo "⚙️  Cài LaunchAgent tự động..."
PLIST="$HOME/Library/LaunchAgents/com.gtalk-openclaw.funnel.plist"
cat > "$PLIST" << PLIST_CONTENT
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.gtalk-openclaw.funnel</string>
    <key>ProgramArguments</key>
    <array>
        <string>$TAILSCALE</string>
        <string>funnel</string>
        <string>--bg</string>
        <string>18789</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/gtalk-openclaw-funnel.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/gtalk-openclaw-funnel.log</string>
</dict>
</plist>
PLIST_CONTENT
launchctl load "$PLIST" 2>/dev/null || true
ok "LaunchAgent installed (funnel tự bật khi khởi động)"

# ── Cập nhật openclaw.json ────────────────────────────────────
echo "⚙️  Cập nhật OpenClaw config..."
CONFIG="$HOME/.openclaw/openclaw.json"
[ -f "$CONFIG" ] || err "Không tìm thấy $CONFIG"

node - << NODE
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('$CONFIG', 'utf8'));

cfg.plugins = cfg.plugins || {};
cfg.plugins.entries = cfg.plugins.entries || {};
cfg.plugins.entries['gtalk-openclaw'] = {
  enabled: true,
  config: ${WEBHOOK_SECRET:+{ "webhookSecret": "$WEBHOOK_SECRET" }}${WEBHOOK_SECRET:-{}}
};

cfg.channels = cfg.channels || {};
cfg.channels['gtalk-openclaw'] = {
  oaToken: '$OA_TOKEN',
  apiUrl: '$API_URL',
  allowFrom: ${ALLOW_FROM:+["$ALLOW_FROM"]}${ALLOW_FROM:-[]}
};

fs.writeFileSync('$CONFIG', JSON.stringify(cfg, null, 2));
console.log('Config updated');
NODE
ok "OpenClaw config updated"

# ── Restart gateway ───────────────────────────────────────────
echo "🔄 Restart OpenClaw gateway..."
openclaw gateway restart
sleep 5

# ── Kiểm tra ─────────────────────────────────────────────────
STATUS=$(openclaw plugins list 2>/dev/null | grep gtalk-openclaw | grep -c loaded || true)
if [ "$STATUS" -gt 0 ]; then
  ok "Plugin loaded!"
else
  warn "Plugin chưa load — chạy: openclaw plugins list"
fi

# ── Done ──────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
ok "Setup hoàn tất!"
echo ""
echo "Webhook URL: $WEBHOOK_URL"
echo ""
echo "Tiếp theo — setup channel cho user:"
echo ""
echo "  curl -X POST http://127.0.0.1:18789/gtalk-openclaw/setup-channel \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{"
echo "      \"oaId\": \"$(echo $OA_TOKEN | cut -d: -f1)\","
echo "      \"oaToken\": \"$OA_TOKEN\","
echo "      \"userId\": \"GTALK_USER_ID\","
echo "      \"webhookUrl\": \"$WEBHOOK_URL\""
echo "    }'"
echo "════════════════════════════════════════"
