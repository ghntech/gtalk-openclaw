export declare function setGtalkRuntime(runtime: any): void;
declare const _default: {
    id: string;
    name: string;
    description: string;
    configSchema: import("openclaw/plugin-sdk").OpenClawPluginConfigSchema;
    register: NonNullable<import("openclaw/plugin-sdk/core").OpenClawPluginDefinition["register"]>;
} & Pick<import("openclaw/plugin-sdk/core").OpenClawPluginDefinition, "kind">;
export default _default;
