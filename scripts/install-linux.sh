#!/bin/bash
set -e

# ════════════════════════════════════════════════════════════
# gtalk-openclaw — Auto Setup Script (Linux)
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
echo "  gtalk-openclaw Setup (Linux)"
echo "════════════════════════════════════════"
echo ""

# ── Kiểm tra dependencies ────────────────────────────────────
command -v openclaw >/dev/null 2>&1 || err "openclaw chưa cài. Xem: https://docs.openclaw.ai/install"
command -v tailscale >/dev/null 2>&1 || err "Tailscale chưa cài. Xem: https://tailscale.com/download/linux"
command -v node >/dev/null 2>&1 || err "Node.js chưa cài. Xem: https://nodejs.org"

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

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Install dependencies ─────────────────────────────────────
echo "📦 Cài dependencies..."
(cd "$PLUGIN_DIR" && npm install --omit dev && npm link openclaw) || err "npm install thất bại"
ok "Dependencies installed"

# ── Install plugin ───────────────────────────────────────────
echo "🔌 Cài plugin..."
# Xóa config cũ để tránh validation lỗi khi uninstall
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
# Uninstall plugin cũ
openclaw plugins uninstall gtalk-openclaw 2>/dev/null || true
rm -rf "$HOME/.openclaw/extensions/gtalk-openclaw" 2>/dev/null || true
openclaw plugins install --link "$PLUGIN_DIR" || err "Cài plugin thất bại"
ok "Plugin installed"

# ── Bật Tailscale Funnel ─────────────────────────────────────
echo "📡 Bật Tailscale Funnel..."
# Chỉ expose /gtalk-openclaw/webhook, không expose toàn bộ port
sudo tailscale funnel --bg --set-path /gtalk-openclaw/webhook http://127.0.0.1:18789/gtalk-openclaw/webhook || err "Bật Tailscale Funnel thất bại. Kiểm tra: sudo tailscale status"
sleep 2

# Lấy webhook URL
FUNNEL_STATUS=$(tailscale funnel status 2>/dev/null)
WEBHOOK_HOST=$(echo "$FUNNEL_STATUS" | grep -o 'https://[^[:space:]]*' | head -1 | sed 's|/$||')
[ -z "$WEBHOOK_HOST" ] && err "Không lấy được Tailscale URL. Kiểm tra: tailscale funnel status"
WEBHOOK_URL="${WEBHOOK_HOST}/gtalk-openclaw/webhook"
ok "Tailscale Funnel: $WEBHOOK_URL"

# ── Cài systemd service (tự bật funnel khi khởi động) ────────
echo "⚙️  Cài systemd service..."
SERVICE_FILE="/etc/systemd/system/gtalk-openclaw-funnel.service"
sudo tee "$SERVICE_FILE" > /dev/null << SERVICE
[Unit]
Description=GTalk OpenClaw Tailscale Funnel
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/tailscale funnel --bg --set-path /gtalk-openclaw/webhook http://127.0.0.1:18789/gtalk-openclaw/webhook
ExecStop=/usr/bin/tailscale funnel off

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable gtalk-openclaw-funnel.service
sudo systemctl start gtalk-openclaw-funnel.service 2>/dev/null || true
ok "Systemd service installed (funnel tự bật khi khởi động)"

# ── Kiểm tra openclaw.json hợp lệ ────────────────────────────
CONFIG="$HOME/.openclaw/openclaw.json"
[ -f "$CONFIG" ] || err "Không tìm thấy $CONFIG"
node -e "JSON.parse(require('fs').readFileSync('$CONFIG','utf8'))" || err "openclaw.json bị lỗi JSON"

# ── Cập nhật openclaw.json ────────────────────────────────────
echo "⚙️  Cập nhật OpenClaw config..."

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

// plugins.allow
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
  # POSIX-compatible: split by comma
  echo "$ALLOW_FROM" | tr ',' '\n' | while read -r USER_ID; do
    USER_ID="$(echo "$USER_ID" | tr -d ' ')"
    [ -z "$USER_ID" ] && continue
    echo "   → userId: $USER_ID"
    RESPONSE=$(curl -s -X POST http://127.0.0.1:18789/gtalk-openclaw/setup-channel \
      -H 'Content-Type: application/json' \
      -d "{\"oaId\": \"$OA_ID\", \"oaToken\": \"$OA_TOKEN\", \"userId\": \"$USER_ID\", \"webhookUrl\": \"$WEBHOOK_URL\"}")
    echo "     $RESPONSE"
    
    # Gửi lời chào cho user
    CHANNEL_ID=$(echo "$RESPONSE" | grep -o '"channelId":"[^"]*"' | cut -d'"' -f4)
    if [ -n "$CHANNEL_ID" ]; then
      curl -s -X POST "$API_URL/api/gtalk/send-message" \
        -H 'Content-Type: application/json' \
        -d "{\"channelId\": \"$CHANNEL_ID\", \"clientMsgId\": \"$(date +%s)\", \"content\": {\"text\": \"👋 Xin chào! Mình là AI Assistant, sẵn sàng hỗ trợ bạn. Hãy nhắn gì đó để bắt đầu nhé!\", \"parseMode\": \"PLAIN_TEXT\"}, \"oaToken\": \"$OA_TOKEN\"}" > /dev/null
      echo "     → Đã gửi lời chào!"
    fi
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
