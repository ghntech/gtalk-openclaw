/**
 * Stub type declarations for openclaw/plugin-sdk/core
 * Used when openclaw is not installed (e.g. CI environment).
 * The real types come from the locally installed openclaw package.
 */
declare module "openclaw/plugin-sdk/core" {
  export type OpenClawConfig = Record<string, any>;

  export type OpenClawPluginApi = {
    id: string;
    name: string;
    source: string;
    config: OpenClawConfig;
    pluginConfig?: Record<string, unknown>;
    logger: {
      info: (msg: string) => void;
      warn: (msg: string) => void;
      error: (msg: string) => void;
      debug: (msg: string) => void;
    };
    registerHttpRoute: (opts: {
      path: string;
      auth?: string;
      handler: (req: any, res: any) => Promise<boolean | void>;
    }) => void;
  };

  export type PluginRuntime = any;
  export type OpenClawPluginConfigSchema = any;
  export type ChannelPlugin<T = any> = any;

  export function defineChannelPluginEntry(opts: {
    id: string;
    name: string;
    description: string;
    plugin: any;
    configSchema?: any;
    setRuntime?: (runtime: any) => void;
    registerFull?: (api: OpenClawPluginApi) => void;
  }): any;

  export function defineSetupPluginEntry(plugin: any): any;

  export function createChatChannelPlugin<T = any>(params: any): any;

  export function createChannelPluginBase<T = any>(params: any): any;

  export function emptyPluginConfigSchema(): any;
  export function buildChannelConfigSchema(opts: any): any;
  export function buildChannelOutboundSessionRoute(params: any): any;
  export function stripChannelTargetPrefix(raw: string, ...providers: string[]): string;
  export function stripTargetKindPrefix(raw: string): string;
  export function normalizeAccountId(id: string): string;
  export const DEFAULT_ACCOUNT_ID: string;
}
