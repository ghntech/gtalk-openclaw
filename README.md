# gtalk-openclaw — OpenClaw Channel Plugin

Plugin kết nối OpenClaw với GHN GTalk qua REST API + Webhook.

---

## Cài đặt nhanh

```bash
# Clone repo
git clone https://github.com/ghntech/gtalk-openclaw.git
cd gtalk-openclaw

# Chạy script setup theo OS
```

| OS | Lệnh |
|----|-------|
| **macOS** | `bash scripts/install.sh` |
| **Linux** | `bash scripts/install-linux.sh` |
| **Windows** | `powershell -ExecutionPolicy Bypass -File scripts\install.ps1` |

Script sẽ tự động:
- Cài plugin vào OpenClaw
- Bật Tailscale Funnel expose **chỉ đúng path** `/gtalk-openclaw/webhook` (không ảnh hưởng các channel khác)
- Cài auto-start (macOS: LaunchAgent, Linux: systemd, Windows: Task Scheduler)
- Cập nhật `~/.openclaw/openclaw.json`
- Setup channel cho các user đã nhập
- Restart gateway

---

## Yêu cầu

- OpenClaw đã cài và đang chạy (`openclaw status`)
- Tailscale đã cài và đăng nhập
  - macOS: `/Applications/Tailscale.app`
  - Linux: `tailscale` CLI
  - Windows: Tailscale app
- Node.js 18+

---

## Cài đặt thủ công

### Bước 1 — Install plugin

```bash
openclaw plugins install --link /path/to/gtalk-openclaw
```

### Bước 2 — Bật Tailscale Funnel

Chỉ expose đúng path webhook (an toàn hơn, không ảnh hưởng Telegram/Discord/...):

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel --bg \
  --set-path /gtalk-openclaw/webhook \
  http://127.0.0.1:18789/gtalk-openclaw/webhook
```

Kiểm tra URL của bạn:
```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel status
```

Tắt funnel khi không cần:
```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel reset
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
        "enabled": true
      }
    },
    "allow": ["gtalk-openclaw"]
  },
  "channels": {
    "gtalk-openclaw": {
      "oaToken": "OA_ID:OA_PASSWORD",
      "apiUrl": "https://mbff.ghn.vn",
      "allowFrom": "GTALK_USER_ID_1,GTALK_USER_ID_2",
      "webhookSecret": "WEBHOOK_SECRET_CHUNG_VỚI_GTALK"
    }
  }
}
```

> **Lưu ý:**
> - `allowFrom` là **string**, nhiều ID cách nhau bằng dấu phẩy
> - `webhookSecret` nằm trong channel config, **không phải** plugin config
> - Môi trường test: dùng `https://test-api.mbff.ghn.tech` cho `apiUrl`

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

## Tính năng

### Outbound (Agent → GTalk)

| Loại | Mô tả |
|------|-------|
| Text | Tự detect parseMode (PLAIN_TEXT / MARKDOWN / HTML) |
| Template | Gửi card với icon, title, content, action buttons |
| Photo/Video/File | Upload 3 bước + gửi attachment |

### Inbound (GTalk → Agent)

| Loại | Mô tả |
|------|-------|
| Text | Forward thẳng cho agent |
| Media (ảnh/video/file) | Mô tả `[📷 Ảnh: filename.jpg (120 KB)]` gửi cho agent |

---

## Base URLs

| Môi trường | URL |
|------------|-----|
| Production | `https://mbff.ghn.vn` |
| Test | `https://test-api.mbff.ghn.tech` |

---

## Gỡ lỗi

```bash
# Xem log realtime
openclaw logs --follow | grep gtalk

# Kiểm tra plugin
openclaw plugins list | grep gtalk

# Kiểm tra funnel
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel status

# Test webhook thủ công
curl https://your-machine.tailXXXX.ts.net/gtalk-openclaw/webhook
# Expect: {"ok":true} (nếu không có webhookSecret) hoặc 401 Unauthorized
```

