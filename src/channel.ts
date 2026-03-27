import {
  createChatChannelPlugin,
  createChannelPluginBase,
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
  base: createChannelPluginBase({
    id: "gtalk-openclaw",
    setup: {
      resolveAccount,
      inspectAccount(cfg, _accountId) {
        const section = (cfg.channels as Record<string, any>)?.["gtalk-openclaw"];
        return {
          enabled: Boolean(section?.oaToken),
          configured: Boolean(section?.oaToken && section?.apiUrl),
          tokenStatus: section?.oaToken ? "available" : "missing",
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
      // Gửi text message
      sendText: async (params) => {
        const acc = params.account;
        const client = new GtalkClient(acc.apiUrl, acc.oaToken);
        const result = await client.sendText(params.to, params.text);
        return { messageId: result.globalMsgId };
      },
    },
    base: {
      // Gửi file/ảnh/video — upload 3 bước rồi send
      sendMedia: async (params) => {
        const acc = params.account;
        const client = new GtalkClient(acc.apiUrl, acc.oaToken);
        await client.uploadAndSend({
          channelId: params.to,
          filePath: params.filePath,
          caption: params.caption,
        });
      },
    },
  },
});
