import { createChatChannelPlugin, createChannelPluginBase, } from "openclaw/plugin-sdk/core";
import { GtalkClient } from "./client.js";
function getSection(cfg) {
    return cfg.channels?.["gtalk-openclaw"] ?? {};
}
function resolveAccount(cfg, accountId) {
    const section = getSection(cfg);
    if (!section.oaToken)
        throw new Error("gtalk-openclaw: oaToken is required");
    if (!section.apiUrl)
        throw new Error("gtalk-openclaw: apiUrl is required");
    return {
        oaToken: section.oaToken,
        apiUrl: section.apiUrl,
        allowFrom: section.allowFrom ?? [],
    };
}
// Lấy capabilities schema từ Telegram để biết fields cần thiết
const CAPABILITIES = {
    chatTypes: ["direct"],
    media: false,
    reactions: false,
    threads: false,
    nativeCommands: false,
    blockStreaming: false,
    inlineButtons: false,
    ephemeralReplies: false,
    voiceMessages: false,
    locationMessages: false,
    pollMessages: false,
};
export const gtalkPlugin = createChatChannelPlugin({
    base: createChannelPluginBase({
        id: "gtalk-openclaw",
        meta: {
            label: "GTalk",
            blurb: "GHN GTalk channel",
        },
        capabilities: CAPABILITIES,
        setup: {
            applyAccountConfig: (params) => params.cfg,
        },
        config: {
            listAccountIds: (cfg) => {
                const section = getSection(cfg);
                return section.oaToken ? ["default"] : [];
            },
            resolveAccount,
            inspectAccount: (cfg) => {
                const section = getSection(cfg);
                return {
                    enabled: Boolean(section.oaToken),
                    configured: Boolean(section.oaToken && section.apiUrl),
                    tokenStatus: section.oaToken ? "available" : "missing",
                };
            },
        },
    }),
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
        attachedResults: {
            channel: "gtalk-openclaw",
            sendText: async (ctx) => {
                const acc = resolveAccount(ctx.cfg, ctx.accountId);
                const client = new GtalkClient(acc.apiUrl, acc.oaToken);
                const result = await client.sendText(ctx.to, ctx.text);
                return { messageId: result.globalMsgId };
            },
        },
    },
});
