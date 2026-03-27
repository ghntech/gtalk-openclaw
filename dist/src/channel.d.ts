type ResolvedAccount = {
    accountId: string | null;
    oaToken: string;
    apiUrl: string;
    allowFrom: string[];
};
export declare const gtalkPlugin: import("openclaw/plugin-sdk").ChannelPlugin<ResolvedAccount, unknown, unknown>;
export {};
