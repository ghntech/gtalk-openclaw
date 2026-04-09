import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { gtalkPlugin } from "./src/channel.js";
import { verifySignature, type GtalkWebhookPayload } from "./src/webhook.js";
import { GtalkClient, ReceiptStatus } from "./src/client.js";
import type { IncomingMessage } from "http";

async function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

// Runtime được inject bởi OpenClaw khi plugin load
let gtalkRuntime: any = null;

export function setGtalkRuntime(runtime: any) {
  gtalkRuntime = runtime;
}

export default defineChannelPluginEntry({
  id: "gtalk-openclaw",
  name: "GTalk",
  description: "Channel plugin kết nối OpenClaw với GHN GTalk",
  plugin: gtalkPlugin,
  setRuntime: setGtalkRuntime,
  registerFull(api) {

    // ── Inbound Webhook (GTalk → OpenClaw) ──────────────────────────────────
    api.registerHttpRoute({
      path: "/gtalk-openclaw/webhook",
      auth: "plugin",
      handler: async (req, res) => {
        const payload = await readJsonBody(req) as GtalkWebhookPayload;
        const rawBody = JSON.stringify(payload);

        const signature = req.headers["x-gtalk-event-signature"] as string;
        // webhookSecret lấy từ channels.gtalk-openclaw.webhookSecret
        const chanCfgForSecret = (api.config as any)?.channels?.["gtalk-openclaw"] ?? {};
        const webhookSecret = chanCfgForSecret.webhookSecret as string | undefined;

        // 1. Nếu có webhookSecret → verify signature, log rõ nếu sai
        if (webhookSecret) {
          if (!signature) {
            api.logger.warn("gtalk-openclaw: missing webhook signature header (x-gtalk-event-signature)");
            res.statusCode = 401;
            res.end("Unauthorized");
            return true;
          }
          if (!verifySignature(payload, rawBody, signature, webhookSecret)) {
            api.logger.warn(`gtalk-openclaw: invalid webhook signature. Got: ${signature}`);
            res.statusCode = 401;
            res.end("Unauthorized");
            return true;
          }
        }

        // 2. Trả 200 ngay (GTalk timeout nhanh)
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));

        // 3. Validate payload — so sánh string để tránh lỗi số lớn
        // globalMsgId, channelId, senderId phải là chuỗi số hợp lệ > "0"
        const isNonZeroId = (val: string | undefined) =>
          val && /^\d+$/.test(val) && val !== "0";

        // contentType: 0=text, 1=image, 2=video, 3=file, v.v.
        // Chỉ bỏ qua nếu thiếu ID hoặc không có content
        const isValidPayload =
          isNonZeroId(payload.globalMsgId) &&
          isNonZeroId(payload.channelId) &&
          isNonZeroId(payload.senderId) &&
          payload.content && payload.content.trim().length > 0;

        if (!isValidPayload) {
          api.logger.debug(`gtalk-openclaw: skipping invalid payload globalMsgId=${payload.globalMsgId} channelId=${payload.channelId} senderId=${payload.senderId}`);
          return true;
        }

        api.logger.debug(`gtalk-openclaw: ← inbound payload=${JSON.stringify(payload).slice(0, 500)}`);

        // Xử lý theo contentType
        // contentType: 0=text, 1=image, 2=video, 3=file
        if (payload.contentType !== 0) {
          // Cố gắng parse content để lấy fileId và mô tả cho agent
          let mediaDesc = "[User gửi một tập tin]";
          try {
            const mediaCfg = (api.config as any)?.channels?.["gtalk-openclaw"] ?? {};
            const mediaClient = new GtalkClient(
              mediaCfg.apiUrl ?? "https://mbff.ghn.vn",
              mediaCfg.oaToken ?? "",
              api.logger,
            );
            const parsed = JSON.parse(payload.content);
            const fileId = parsed?.fileId ?? parsed?.id ?? parsed?.Id;
            if (fileId) {
              const detail = await mediaClient.getFileDetail(fileId);
              const typeLabel =
                payload.contentType === 1 ? "🖼️ Ảnh" :
                payload.contentType === 2 ? "🎥 Video" : "📎 File";
              mediaDesc = `[${typeLabel}: ${detail.FileName} (${(parseInt(detail.FileSize)/1024).toFixed(1)} KB)]`;
            }
          } catch {
            const typeLabel =
              payload.contentType === 1 ? "🖼️ Ảnh" :
              payload.contentType === 2 ? "🎥 Video" : "📎 File";
            mediaDesc = `[${typeLabel}]`;
          }
          // Thay content bằng mô tả để agent biết
          payload.content = mediaDesc;
          payload.contentType = 0; // Treat as text để dispatch bình thường
        }

        // 4. Dispatch vào OpenClaw
        try {
          if (!gtalkRuntime) {
            api.logger.warn("gtalk-openclaw: runtime not ready");
            return true;
          }

          const cfg = api.config;
          const channel = "gtalk-openclaw";
          const to = `gtalk-openclaw:${payload.channelId}`;

          // Resolve agent route
          const route = await gtalkRuntime.channel.routing.resolveAgentRoute({
            cfg,
            channel,
            accountId: null,
            from: `gtalk-openclaw:${payload.senderId}`,
            chatType: "direct",
          });

          if (!route) {
            api.logger.warn(`gtalk-openclaw: no route for sender ${payload.senderId}`);
            return true;
          }

          // Build inbound context
          const ctxPayload = gtalkRuntime.channel.reply.finalizeInboundContext({
            Body: payload.content,
            BodyForAgent: payload.content,
            RawBody: payload.content,
            From: `gtalk-openclaw:${payload.senderId}`,
            To: to,
            SessionKey: route.sessionKey,
            AccountId: route.accountId,
            ChatType: "direct",
            Provider: "gtalk-openclaw",
            Surface: "gtalk-openclaw",
            MessageSid: payload.globalMsgId || payload.clientMsgId || String(Date.now()),
            Timestamp: parseInt(payload.timestamp) || Date.now(),
            SenderId: payload.senderId,
          });

          // Lấy config GTalk từ channels section
          const accCfg = (cfg as any)?.channels?.["gtalk-openclaw"] ?? {};
          const gtalkClient = new GtalkClient(
            accCfg.apiUrl ?? "https://mbff.ghn.vn",
            accCfg.oaToken ?? "",
            api.logger,
          );

          // Gửi SEEN + TYPING receipt trong một lần gọi
          gtalkClient.sendReceipt({
            oaId: payload.oaId,
            channelId: payload.channelId,
            receipts: [
              { globalMsgId: payload.globalMsgId, status: ReceiptStatus.SEEN },
              { globalMsgId: payload.globalMsgId, status: ReceiptStatus.TYPING },
            ],
          }).catch((err: any) => {
            api.logger.warn(`gtalk-openclaw: receipts failed: ${err.message}`);
          });

          // TYPING heartbeat — re-send TYPING every 5s, max 10 times while agent is processing
          // GTalk typing indicator expires after ~3s, so we keep refreshing it
          let typingCount = 0;
          const typingInterval = setInterval(() => {
            if (++typingCount > 10) {
              clearInterval(typingInterval);
              return;
            }
            gtalkClient.sendReceipt({
              oaId: payload.oaId,
              channelId: payload.channelId,
              receipts: [{ globalMsgId: payload.globalMsgId, status: ReceiptStatus.TYPING }],
            }).catch(() => {}); // silent — best effort
          }, 5000);

          // Dispatch + deliver reply về GTalk
          // placeholderMsgId: nếu đã gửi placeholder "…" cho block rỗng, lưu globalMsgId ở đây
          // để block tiếp theo có thể edit thay vì gửi mới.
          let placeholderMsgId: string | null = null;

          try {
            await gtalkRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
              ctx: ctxPayload,
              cfg,
              dispatcherOptions: {
                deliver: async (replyPayload: any) => {
                  // 1. Template message — nếu agent gửi object có template field
                  if (replyPayload?.template || replyPayload?.templateId) {
                    const tmpl = replyPayload.template ?? replyPayload;

                    // Nếu đang có placeholder, xóa trước khi gửi template
                    if (placeholderMsgId) {
                      const pid = placeholderMsgId;
                      placeholderMsgId = null;
                      gtalkClient.modifyMessage({
                        channelId: payload.channelId,
                        globalMsgId: pid,
                        action: 2,
                      }).catch((err: any) => {
                        api.logger.warn(`gtalk-openclaw: delete placeholder failed: ${err.message}`);
                      });
                    }

                    const tmplResult = await gtalkClient.sendTemplate(
                      payload.channelId,
                      tmpl.templateId,
                      tmpl.shortMessage ?? tmpl.title ?? "",
                      {
                        icon_url: tmpl.iconUrl ?? tmpl.icon_url,
                        title: tmpl.title ?? "",
                        content: tmpl.content ?? "",
                        actions: tmpl.actions,
                      },
                    );
                    api.logger.debug(`gtalk-openclaw: sent template channelId=${payload.channelId} templateId=${tmpl.templateId} globalMsgId=${tmplResult.globalMsgId}`);
                    return;
                  }

                  // 2. Extract text từ nhiều dạng block OpenClaw có thể gửi
                  let text: string | undefined;
                  if (typeof replyPayload === "string") {
                    text = replyPayload;
                  } else if (replyPayload?.text) {
                    text = replyPayload.text;
                  } else if (replyPayload?.Text) {
                    text = replyPayload.Text;
                  } else if (replyPayload?.body) {
                    text = replyPayload.body;
                  } else if (replyPayload?.content) {
                    text = typeof replyPayload.content === "string"
                      ? replyPayload.content
                      : JSON.stringify(replyPayload.content);
                  } else if (replyPayload && typeof replyPayload === "object") {
                    const s = JSON.stringify(replyPayload);
                    if (s !== "{}" && s !== "null") text = s;
                  }

                  if (text && text.trim()) {
                    // Xác định parseMode: lấy từ replyPayload nếu có, fallback tự detect từ content
                    const rawMode = replyPayload?.parseMode ?? replyPayload?.parse_mode;
                    let parseMode: "PLAIN_TEXT" | "MARKDOWN" | "HTML";
                    if (rawMode === "PLAIN_TEXT" || rawMode === "MARKDOWN" || rawMode === "HTML") {
                      parseMode = rawMode;
                    } else if (/<[a-z][\s\S]*>/i.test(text)) {
                      parseMode = "HTML";
                    } else if (/[*_`#\[\]~>]/.test(text)) {
                      parseMode = "MARKDOWN";
                    } else {
                      parseMode = "PLAIN_TEXT";
                    }

                    if (placeholderMsgId) {
                      // Có placeholder đang chờ → edit thay vì gửi mới
                      const pid = placeholderMsgId;
                      placeholderMsgId = null;
                      try {
                        await gtalkClient.modifyMessage({
                          channelId: payload.channelId,
                          globalMsgId: pid,
                          action: 1,
                          content: { text: text.trim(), parseMode },
                        });
                        api.logger.debug(`gtalk-openclaw: edited placeholder globalMsgId=${pid} channelId=${payload.channelId} preview="${text.trim().slice(0, 80)}"`);
                      } catch (editErr: any) {
                        // Edit thất bại → fallback gửi mới
                        api.logger.debug(`gtalk-openclaw: edit placeholder failed, sending new: ${editErr.message}`);
                        await gtalkClient.sendText(payload.channelId, text.trim(), parseMode);
                      }
                    } else {
                      const sendResult = await gtalkClient.sendText(payload.channelId, text.trim(), parseMode);
                      api.logger.debug(`gtalk-openclaw: sent text channelId=${payload.channelId} globalMsgId=${sendResult.globalMsgId} preview="${text.trim().slice(0, 80)}"`);
                    }
                  } else {
                    // Block rỗng — gửi placeholder "…" nếu chưa có
                    api.logger.debug(`gtalk-openclaw: empty reply block type=${replyPayload?.type ?? "unknown"}, sending placeholder`);
                    if (!placeholderMsgId) {
                      try {
                        const result = await gtalkClient.sendText(payload.channelId, "…");
                        placeholderMsgId = result.globalMsgId;
                      } catch (phErr: any) {
                        api.logger.debug(`gtalk-openclaw: placeholder send failed: ${phErr.message}`);
                      }
                    }
                  }
                },
                onError: (err: any) => {
                  api.logger.error(`gtalk-openclaw: deliver error: ${err.message}`);
                },
              },
            });

            // Nếu sau khi dispatch xong vẫn còn placeholder chưa được edit → xóa đi
            if (placeholderMsgId) {
              const pid = placeholderMsgId;
              placeholderMsgId = null;
              gtalkClient.modifyMessage({
                channelId: payload.channelId,
                globalMsgId: pid,
                action: 2,
              }).catch((err: any) => {
                api.logger.debug(`gtalk-openclaw: cleanup placeholder failed: ${err.message}`);
              });
            }
          } finally {
            // Stop TYPING heartbeat once dispatch is complete (success or error)
            clearInterval(typingInterval);
          }
        } catch (err: any) {
          api.logger.error(`gtalk-openclaw: inbound dispatch failed: ${err.message}`);
        }

        return true;
      },
    });

    // ── Setup Channel API ────────────────────────────────────────────────────
    // POST /gtalk-openclaw/setup-channel
    // Body: { oaId, oaToken?, userId, webhookUrl }
    //   oaId: OA ID (hoặc truyền luôn "oaId:password" vào đây nếu không có oaToken riêng)
    //   oaToken: (optional) override — nếu không truyền thì lấy từ channels.gtalk-openclaw.oaToken
    //   userId: GTalk user ID muốn tạo channel
    //   webhookUrl: URL webhook của OpenClaw, VD: https://your-host/gtalk-openclaw/webhook
    api.registerHttpRoute({
      path: "/gtalk-openclaw/setup-channel",
      auth: "plugin",
      handler: async (req, res) => {
        const body = await readJsonBody(req);
        const { oaId: oaIdRaw, oaToken: oaTokenParam, userId, webhookUrl } = body as {
          oaId?: string;
          oaToken?: string;
          userId?: string;
          webhookUrl?: string;
        };

        if (!oaIdRaw || !userId || !webhookUrl) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "oaId, userId, webhookUrl are required" }));
          return true;
        }

        // Resolve oaId và oaToken
        // Nếu oaId chứa ":" và không có oaToken riêng → coi oaId là oaToken luôn
        let oaId: string;
        let resolvedOaToken: string;
        if (oaIdRaw.includes(":") && !oaTokenParam) {
          resolvedOaToken = oaIdRaw;
          oaId = oaIdRaw.split(":")[0];
        } else {
          oaId = oaIdRaw;
          const chanCfg = (api.config as any)?.channels?.["gtalk-openclaw"] ?? {};
          resolvedOaToken = oaTokenParam ?? chanCfg.oaToken ?? "";
        }

        // Lấy apiUrl từ config (fallback production)
        const chanCfg = (api.config as any)?.channels?.["gtalk-openclaw"] ?? {};
        const apiUrl = chanCfg.apiUrl ?? "https://mbff.ghn.vn";
        const client = new GtalkClient(apiUrl, resolvedOaToken, api.logger);

        // webhookSecret từ plugin config (optional)
        const webhookSecret = (api.config as any)?.channels?.["gtalk-openclaw"]?.webhookSecret as string | undefined;

        try {
          // Step 1: Tạo direct channel
          const channelId = await client.createDirectChannel(oaId, userId);

          // Step 2: Đăng ký webhook
          await client.configChannelWebhook({
            oaId,
            channelId,
            webhookURL: webhookUrl,
            webhookSecret,
            retry: {
              maxRetries: 3,
              retryDelayMs: 1000,
              retryOnStatusCodes: [500, 502, 503],
            },
          });

          api.logger.debug(`gtalk-openclaw: setup channel ${channelId} for user ${userId}`);

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ channelId }));
        } catch (err: any) {
          api.logger.error(`gtalk-openclaw: setup-channel failed: ${err.message}`);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }

        return true;
      },
    });
  },
});
