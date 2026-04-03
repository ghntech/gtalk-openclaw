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

read -p "GTalk User ID được phép dùng, nhiều ID cách nhau bằng dấu phẩy (có thể điền sau): " ALLOW_FROM

echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"

# ── Install dependencies ─────────────────────────────────────
echo "📦 Cài dependencies..."
(cd "$PLUGIN_DIR" && npm install --omit dev && npm link openclaw) || err "npm install thất bại"
ok "Dependencies installed"

# ── Install plugin ───────────────────────────────────────────
echo " Cài plugin..."
# Xóa channels.gtalk-openclaw khỏi config trước để tránh validation lỗi khi uninstall
GTALK_CONFIG="$HOME/.openclaw/openclaw.json" node << 'RMCHAN'
const fs = require('fs');
const cfgPath = process.env.GTALK_CONFIG;
if (!fs.existsSync(cfgPath)) process.exit(0);
let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
} catch (e) {
  console.error('Warning: openclaw.json parse error, skipping cleanup:', e.message);
  process.exit(0);
}
if (cfg.channels) delete cfg.channels['gtalk-openclaw'];
if (cfg.plugins && cfg.plugins.entries) delete cfg.plugins.entries['gtalk-openclaw'];
if (cfg.plugins && Array.isArray(cfg.plugins.allow)) {
  cfg.plugins.allow = cfg.plugins.allow.filter(id => id !== 'gtalk-openclaw');
  if (cfg.plugins.allow.length === 0) delete cfg.plugins.allow;
}
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
console.log('Cleaned old config');
RMCHAN
# Uninstall plugin cũ và xóa thư mục
openclaw plugins uninstall gtalk-openclaw 2>/dev/null || true
rm -rf "$HOME/.openclaw/extensions/gtalk-openclaw" 2>/dev/null || true
openclaw plugins install --link "$PLUGIN_DIR" || err "Cài plugin thất bại"
ok "Plugin installed"

# ── Bật Tailscale Funnel (chỉ expose đúng webhook path) ──────
echo "📡 Bật Tailscale Funnel..."
# Chỉ expose /gtalk-openclaw/webhook, không expose toàn bộ port
# để tránh ảnh hưởng các channel khác (Telegram, v.v.)
"$TAILSCALE" funnel --bg --set-path /gtalk-openclaw/webhook http://127.0.0.1:18789/gtalk-openclaw/webhook || err "Bật Tailscale Funnel thất bại. Kiểm tra Tailscale đã login chưa."
sleep 2

# Lấy webhook URL — lấy hostname từ dòng https://, rồi ghép path
FUNNEL_STATUS=$("$TAILSCALE" funnel status 2>/dev/null)
WEBHOOK_HOST=$(echo "$FUNNEL_STATUS" | grep -o 'https://[^[:space:]]*' | head -1 | sed 's|/$||')
[ -z "$WEBHOOK_HOST" ] && err "Không lấy được Tailscale URL. Kiểm tra: $TAILSCALE funnel status"
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
        <string>--set-path</string>
        <string>/gtalk-openclaw/webhook</string>
        <string>http://127.0.0.1:18789/gtalk-openclaw/webhook</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/gtalk-openclaw-funnel.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/gtalk-openclaw-funnel.log</string>
</dict>
</plist>
PLIST_CONTENT
# Unload trước nếu đã load (idempotent), rồi load lại
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST" 2>/dev/null || true
ok "LaunchAgent installed (funnel tự bật khi khởi động)"

# ── Kiểm tra openclaw.json hợp lệ ────────────────────────────
CONFIG="$HOME/.openclaw/openclaw.json"
[ -f "$CONFIG" ] || err "Không tìm thấy $CONFIG"
node -e "JSON.parse(require('fs').readFileSync('$CONFIG','utf8'))" || err "openclaw.json bị lỗi JSON, vui lòng kiểm tra lại"

# ── Cập nhật openclaw.json ────────────────────────────────────
echo "⚙️  Cập nhật OpenClaw config..."

# Truyền qua env vars để tránh lỗi ký tự đặc biệt trong JSON
GTALK_OA_TOKEN="$OA_TOKEN" \
GTALK_API_URL="$API_URL" \
GTALK_WEBHOOK_SECRET="$WEBHOOK_SECRET" \
GTALK_ALLOW_FROM="$ALLOW_FROM" \
GTALK_CONFIG="$CONFIG" \
node << 'NODE'
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(process.env.GTALK_CONFIG, 'utf8'));

// plugins
cfg.plugins = cfg.plugins || {};
cfg.plugins.entries = cfg.plugins.entries || {};

// plugins.allow — giữ entries cũ, thêm gtalk-openclaw
const allow = Array.isArray(cfg.plugins.allow) ? cfg.plugins.allow : [];
if (!allow.includes('gtalk-openclaw')) allow.push('gtalk-openclaw');
cfg.plugins.allow = allow;

// plugin entry (không cần config — webhookSecret lưu trong channel config)
cfg.plugins.entries['gtalk-openclaw'] = { enabled: true };

// channel config — allowFrom là string (comma-separated)
cfg.channels = cfg.channels || {};
const channelConfig = {
  oaToken: process.env.GTALK_OA_TOKEN,
  apiUrl: process.env.GTALK_API_URL,
  allowFrom: process.env.GTALK_ALLOW_FROM || ''
};
// webhookSecret lưu trong channel config
if (process.env.GTALK_WEBHOOK_SECRET) {
  channelConfig.webhookSecret = process.env.GTALK_WEBHOOK_SECRET;
}
cfg.channels['gtalk-openclaw'] = channelConfig;

fs.writeFileSync(process.env.GTALK_CONFIG, JSON.stringify(cfg, null, 2));
console.log('Config updated. plugins.allow:', cfg.plugins.allow);
NODE
ok "OpenClaw config updated"

# ── Restart gateway ───────────────────────────────────────────
echo "🔄 Restart OpenClaw gateway..."
openclaw gateway install 2>/dev/null || true
openclaw gateway restart 2>/dev/null || openclaw gateway 2>/dev/null &
sleep 5

# ── Kiểm tra ─────────────────────────────────────────────────
STATUS=$(openclaw plugins list 2>/dev/null | grep gtalk-openclaw | grep -c loaded || true)
if [ "$STATUS" -gt 0 ]; then
  ok "Plugin loaded!"
else
  warn "Plugin chưa load — chạy: openclaw plugins list"
fi

# ── Done ──────────────────────────────────────────────────────
OA_ID="$(echo "$OA_TOKEN" | cut -d: -f1)"
echo ""
echo "════════════════════════════════════════"
ok "Setup hoàn tất!"
echo ""
echo "Webhook URL: $WEBHOOK_URL"

# ── Tự động setup channel cho từng userId ────────────────────
if [ -n "$ALLOW_FROM" ]; then
  echo ""
  echo "⚙️  Đang setup channel cho users..."
  IFS=',' read -ra USER_IDS <<< "$ALLOW_FROM"
  for USER_ID in "${USER_IDS[@]}"; do
    USER_ID="$(echo "$USER_ID" | tr -d ' ')"
    [ -z "$USER_ID" ] && continue
    echo "   → userId: $USER_ID"
    RESPONSE=$(curl -s -X POST http://127.0.0.1:18789/gtalk-openclaw/setup-channel \
      -H 'Content-Type: application/json' \
      -d "{\"oaId\": \"$OA_ID\", \"oaToken\": \"$OA_TOKEN\", \"userId\": \"$USER_ID\", \"webhookUrl\": \"$WEBHOOK_URL\"}")
    echo "     $RESPONSE"
  done
  ok "Setup channel xong!"
else
  echo ""
  warn "Chưa có userId — chạy thủ công sau:"
  echo ""
  echo "  curl -X POST http://127.0.0.1:18789/gtalk-openclaw/setup-channel \\"
  echo "    -H 'Content-Type: application/json' \\"
  echo "    -d '{\"oaId\": \"$OA_ID\", \"oaToken\": \"$OA_TOKEN\", \"userId\": \"GTALK_USER_ID\", \"webhookUrl\": \"$WEBHOOK_URL\"}'"
fi
echo "════════════════════════════════════════"
