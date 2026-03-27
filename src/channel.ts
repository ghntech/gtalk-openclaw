import {
  createChatChannelPlugin,
} from "openclaw/plugin-sdk/core";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { GtalkClient } from "./client.js";

type ResolvedAccount = {
  accountId: string | null;
  oaToken: string;
  apiUrl: string;
  allowFrom: string[];
};

function resolveAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedAccount {
  const section = (cfg.channels as Record<string, any>)?.["gtalk-openclaw"];
  if (!section?.oaToken) throw new Error("gtalk-openclaw: oaToken is required");
  if (!section?.apiUrl) throw new Error("gtalk-openclaw: apiUrl is required");
  return {
    accountId: accountId ?? null,
    oaToken: section.oaToken,
    apiUrl: section.apiUrl,
    allowFrom: section.allowFrom ?? [],
  };
}

export const gtalkPlugin = createChatChannelPlugin<ResolvedAccount>({
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
      listAccountIds: (_cfg: OpenClawConfig) => ["default"],
      resolveAccount,
      inspectAccount(cfg: OpenClawConfig, _accountId?: string | null) {
        const section = (cfg.channels as Record<string, any>)?.["gtalk-openclaw"];
        return {
          enabled: Boolean(section?.oaToken),
          configured: Boolean(section?.oaToken && section?.apiUrl),
          tokenStatus: section?.oaToken ? "available" : "missing",
        };
      },
    },
    setup: {
      applyAccountConfig: ({ cfg }: { cfg: OpenClawConfig; accountId: string; input: Record<string, unknown> }) => cfg,
    },
  },

  security: {
    dm: {
      channelKey: "gtalk-openclaw",
      resolvePolicy: (_account: ResolvedAccount) => "allowlist",
      resolveAllowFrom: (account: ResolvedAccount) => account.allowFrom,
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
      sendText: async (params: any) => {
        const cfg = params.cfg;
        const acc = resolveAccount(cfg, params.accountId);
        const client = new GtalkClient(acc.apiUrl, acc.oaToken);
        const result = await client.sendText(params.to, params.text);
        return { messageId: result.globalMsgId };
      },
      // Gửi file/ảnh/video — upload 3 bước rồi send
      sendMedia: async (params: any) => {
        const cfg = params.cfg;
        const acc = resolveAccount(cfg, params.accountId);
        const client = new GtalkClient(acc.apiUrl, acc.oaToken);
        const filePath = (params as any).filePath ?? (params as any).mediaUrl ?? "";
        const caption = (params as any).caption;
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
