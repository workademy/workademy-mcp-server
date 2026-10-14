/**
 * One Workademy workspace the server can talk to.
 *
 * Workademy resolves the workspace from the request hostname, and an API key
 * belongs to exactly one workspace (it signs in as that workspace's system user).
 * So every workspace needs its own base URL and its own API key.
 */
export interface WorkspaceConfig {
    alias: string;
    id?: number;
    name?: string;
    baseUrl: string;
    apiKey: string;
    /** Name of the env var the key was read from (for error messages, never the key itself). */
    apiKeyEnv?: string;
    readOnly: boolean;
    source: "file" | "env";
}
/** workspaces.json in the project folder (next to package.json) is picked up without any env setting. */
export declare const DEFAULT_WORKSPACES_FILE: string;
/** Base64 "client_id:client_secret" used as Basic auth on /oauth/token. */
export declare function oauthClientBasic(env?: NodeJS.ProcessEnv): string;
export declare class WorkspaceRegistry {
    readonly workspaces: WorkspaceConfig[];
    readonly defaultAlias: string;
    private constructor();
    /**
     * Loads workspaces from WORKADEMY_WORKSPACES_FILE, or from workspaces.json in the project folder.
     * Otherwise falls back to the original single-workspace env setup
     * (WORKADEMY_API_KEY + WORKADEMY_BASE_URL), exposed under the alias "default".
     * WORKADEMY_WORKSPACES_FILE=none forces the single-workspace setup.
     */
    static load(env?: NodeJS.ProcessEnv): WorkspaceRegistry;
    private static fromFile;
    private static fromLegacyEnv;
    get aliases(): string[];
    /** Finds a workspace by alias, hostname, name or numeric id. No selector = default workspace. */
    resolve(selector?: string | number | null): WorkspaceConfig;
    /** Public description of a workspace — never includes the API key. */
    describe(workspace: WorkspaceConfig): {
        alias: string;
        id: number | null;
        name: string | null;
        host: string;
        readOnly: boolean;
        default: boolean;
        apiKeyConfigured: boolean;
    };
}
//# sourceMappingURL=registry.d.ts.map