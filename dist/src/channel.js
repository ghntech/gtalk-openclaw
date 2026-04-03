import { createChatChannelPlugin, } from "openclaw/plugin-sdk/core";
import { GtalkClient } from "./client.js";
function resolveAccount(cfg, accountId) {
    const section = cfg.channels?.["gtalk-openclaw"];
    if (!section?.oaToken)
        throw new Error("gtalk-openclaw: oaToken is required");
    if (!section?.apiUrl)
        throw new Error("gtalk-openclaw: apiUrl is required");
    // allowFrom có thể là string (comma-separated) hoặc array
    const rawAllowFrom = section.allowFrom ?? "";
    const allowFrom = Array.isArray(rawAllowFrom)
        ? rawAllowFrom
        : rawAllowFrom.split(",").map((s) => s.trim()).filter(Boolean);
    return {
        accountId: accountId ?? null,
        oaToken: section.oaToken,
        apiUrl: section.apiUrl,
        allowFrom,
    };
}
export const gtalkPlugin = createChatChannelPlugin({
    base: {
        id: "gtalk-openclaw",
        meta: {
            id: "gtalk-openclaw",
            label: "GTalk",
            selectionLabel: "GTalk",
            docsPath: "/channels/gtalk",
            blurb: "GHN GTalk channel",
        },
        capabilities: {
            chatTypes: ["direct"],
            media: true,
        },
        config: {
            listAccountIds: (_cfg) => ["default"],
            resolveAccount,
            inspectAccount(cfg, _accountId) {
                const section = cfg.channels?.["gtalk-openclaw"];
                return {
                    enabled: Boolean(section?.oaToken),
                    configured: Boolean(section?.oaToken && section?.apiUrl),
                    tokenStatus: section?.oaToken ? "available" : "missing",
                };
            },
        },
        setup: {
            applyAccountConfig: ({ cfg }) => cfg,
        },
    },
    security: {
        dm: {
            channelKey: "gtalk-openclaw",
            resolvePolicy: (_account) => "allowlist",
            resolveAllowFrom: (account) => account.allowFrom,
            defaultPolicy: "allowlist",
        },
    },
    threading: { topLevelReplyToMode: "reply" },
    outbound: {
        base: {
            deliveryMode: "direct",
        },
        attachedResults: {
            channel: "gtalk-openclaw",
            // Gửi text message
            sendText: async (params) => {
                const cfg = params.cfg;
                const acc = resolveAccount(cfg, params.accountId);
                const client = new GtalkClient(acc.apiUrl, acc.oaToken);
                const result = await client.sendText(params.to, params.text);
                return { messageId: result.globalMsgId };
            },
            // Gửi file/ảnh/video — upload 3 bước rồi send
            sendMedia: async (params) => {
                const cfg = params.cfg;
                const acc = resolveAccount(cfg, params.accountId);
                const client = new GtalkClient(acc.apiUrl, acc.oaToken);
                const filePath = params.filePath ?? params.mediaUrl ?? "";
                const caption = params.caption;
                await client.uploadAndSend({
                    channelId: params.to,
                    filePath,
                    caption,
                });
                return { messageId: "" };
            },
        },
    },
});
