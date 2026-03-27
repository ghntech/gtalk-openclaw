# gtalk-openclaw — OpenClaw Channel Plugin

Plugin kết nối OpenClaw với GHN GTalk qua REST API + Webhook.

---

## Cài đặt nhanh

```bash
# Clone repo
git clone https://github.com/ghntech/gtalk-openclaw.git
cd gtalk-openclaw

# Chạy script setup (tự động làm hết)
bash scripts/install.sh
```

Script sẽ tự động:
- Cài plugin vào OpenClaw
- Bật Tailscale Funnel expose webhook ra internet
- Cài LaunchAgent tự bật funnel khi khởi động Mac
- Cập nhật `~/.openclaw/openclaw.json`
- Restart gateway

---

## Yêu cầu

- OpenClaw đã cài và đang chạy (`openclaw status`)
- macOS với Tailscale app (`/Applications/Tailscale.app`)
- Node.js 18+

---

## Cài đặt thủ công

### Bước 1 — Install plugin

```bash
openclaw plugins install /path/to/gtalk-openclaw
```

### Bước 2 — Bật Tailscale Funnel

Tailscale Funnel expose OpenClaw gateway ra internet để GTalk gọi được webhook.

```bash
# Bật funnel background (không cần giữ terminal)
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel --bg 18789
```

Kiểm tra URL của bạn:
```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel status
```

Output mẫu:
```
https://your-machine.tailXXXX.ts.net/
|-- proxy http://127.0.0.1:18789
```

> **Ghi lại URL này** — dùng làm `webhookUrl` ở bước sau.

Tắt funnel khi không cần:
```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel --bg off
```

### Bước 3 — Tự động bật funnel khi khởi động Mac

```bash
cat > ~/Library/LaunchAgents/com.gtalk-openclaw.funnel.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.gtalk-openclaw.funnel</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Applications/Tailscale.app/Contents/MacOS/Tailscale</string>
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
EOF

launchctl load ~/Library/LaunchAgents/com.gtalk-openclaw.funnel.plist
echo "✅ Funnel sẽ tự bật khi khởi động Mac"
```

### Bước 4 — Cấu hình OpenClaw

Thêm vào `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "gtalk-openclaw": {
        "enabled": true,
        "config": {
          "webhookSecret": "WEBHOOK_SECRET_CHUNG_VỚI_GTALK"
        }
      }
    }
  },
  "channels": {
    "gtalk-openclaw": {
      "oaToken": "OA_ID:OA_PASSWORD",
      "apiUrl": "https://mbff.ghn.vn",
      "allowFrom": [
        "GTALK_USER_ID_ĐƯỢC_PHÉP"
      ]
    }
  }
}
```

> **Môi trường test:** dùng `https://test-api.mbff.ghn.tech` cho `apiUrl`

### Bước 5 — Restart gateway

```bash
openclaw gateway restart
```

Kiểm tra plugin load thành công:
```bash
openclaw plugins list | grep gtalk
# Phải thấy: GTalk | gtalk-openclaw | loaded
```

### Bước 6 — Setup channel cho từng user

```bash
curl -X POST http://127.0.0.1:18789/gtalk-openclaw/setup-channel \
  -H "Content-Type: application/json" \
  -d '{
    "oaId": "OA_ID",
    "oaToken": "OA_ID:OA_PASSWORD",
    "userId": "GTALK_USER_ID",
    "webhookUrl": "https://your-machine.tailXXXX.ts.net/gtalk-openclaw/webhook"
  }'
```

Response thành công:
```json
{ "channelId": "2037112448931287040" }
```

---

## Script setup tự động (Bước 2–5)

Copy và chạy script này sau khi đã điền thông tin:

```bash
#!/bin/bash
set -e

# ══════════════════════════════════════════
# Điền thông tin của bạn vào đây
OA_TOKEN="OA_ID:OA_PASSWORD"          # oaToken GTalk
API_URL="https://mbff.ghn.vn"          # hoặc test-api.mbff.ghn.tech
WEBHOOK_SECRET="your_webhook_secret"   # secret chung với GTalk
ALLOW_FROM="GTALK_USER_ID"             # user ID được phép dùng
# ══════════════════════════════════════════

TAILSCALE="/Applications/Tailscale.app/Contents/MacOS/Tailscale"

echo "🚀 Bắt đầu setup gtalk-openclaw..."

# 1. Bật Tailscale Funnel
echo "📡 Bật Tailscale Funnel..."
"$TAILSCALE" funnel --bg 18789
sleep 2

# 2. Lấy webhook URL
WEBHOOK_HOST=$("$TAILSCALE" funnel status 2>/dev/null | grep "https://" | awk '{print $1}' | tr -d '/')
if [ -z "$WEBHOOK_HOST" ]; then
  echo "❌ Không lấy được Tailscale URL. Kiểm tra Tailscale đã login chưa."
  exit 1
fi
WEBHOOK_URL="${WEBHOOK_HOST}/gtalk-openclaw/webhook"
echo "✅ Webhook URL: $WEBHOOK_URL"

# 3. Cài LaunchAgent tự động bật funnel khi khởi động
echo "⚙️  Cài LaunchAgent..."
cat > ~/Library/LaunchAgents/com.gtalk-openclaw.funnel.plist << PLIST
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
PLIST
launchctl load ~/Library/LaunchAgents/com.gtalk-openclaw.funnel.plist 2>/dev/null || true
echo "✅ LaunchAgent installed"

# 4. Patch openclaw.json
echo "⚙️  Cập nhật openclaw config..."
CONFIG="$HOME/.openclaw/openclaw.json"
node - << NODE
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('$CONFIG', 'utf8'));
cfg.plugins = cfg.plugins || {};
cfg.plugins.entries = cfg.plugins.entries || {};
cfg.plugins.entries['gtalk-openclaw'] = {
  enabled: true,
  config: { webhookSecret: '$WEBHOOK_SECRET' }
};
cfg.channels = cfg.channels || {};
cfg.channels['gtalk-openclaw'] = {
  oaToken: '$OA_TOKEN',
  apiUrl: '$API_URL',
  allowFrom: ['$ALLOW_FROM']
};
fs.writeFileSync('$CONFIG', JSON.stringify(cfg, null, 2));
console.log('Config updated');
NODE

# 5. Restart gateway
echo "🔄 Restart OpenClaw gateway..."
openclaw gateway restart
sleep 5

# 6. Kiểm tra
STATUS=$(openclaw plugins list 2>/dev/null | grep gtalk-openclaw | grep -c loaded || true)
if [ "$STATUS" -gt 0 ]; then
  echo "✅ Plugin loaded thành công!"
else
  echo "⚠️  Plugin chưa load — kiểm tra: openclaw plugins list"
fi

echo ""
echo "════════════════════════════════════════"
echo "✅ Setup hoàn tất!"
echo "Webhook URL: $WEBHOOK_URL"
echo ""
echo "Tiếp theo: setup channel cho user"
echo "curl -X POST http://127.0.0.1:18789/gtalk-openclaw/setup-channel \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"oaId\":\"OA_ID\",\"oaToken\":\"$OA_TOKEN\",\"userId\":\"USER_ID\",\"webhookUrl\":\"$WEBHOOK_URL\"}'"
echo "════════════════════════════════════════"
```

---

## Luồng hoạt động

```
User nhắn GTalk
    → GTalk POST webhook → https://your-host/gtalk-openclaw/webhook
    → Verify x-gtalk-event-signature
    → Validate payload (globalMsgId/channelId/senderId > 0, content không rỗng)
    → Dispatch vào AI agent
    → AI reply → GtalkClient.sendText()
    → User nhận tin nhắn
```

## Base URLs

| Môi trường | URL |
|------------|-----|
| Production | `https://mbff.ghn.vn` |
| Test | `https://test-api.mbff.ghn.tech` |

---

## Gỡ lỗi

```bash
# Xem log realtime
tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log | grep gtalk

# Kiểm tra plugin
openclaw plugins list | grep gtalk

# Kiểm tra funnel
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel status

# Test webhook thủ công
curl https://your-machine.tailXXXX.ts.net/gtalk-openclaw/webhook
# Expect: Unauthorized (nếu có webhookSecret) hoặc {"ok":true}
```
