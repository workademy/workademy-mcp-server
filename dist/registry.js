import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
/** workspaces.json in the project folder (next to package.json) is picked up without any env setting. */
export const DEFAULT_WORKSPACES_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "workspaces.json");
// Built-in OAuth client used for API-key logins. Override with WORKADEMY_OAUTH_CLIENT_ID and
// WORKADEMY_OAUTH_CLIENT_SECRET (or WORKADEMY_OAUTH_CLIENT_BASIC) if it ever changes.
const DEFAULT_CLIENT_BASIC = "c3lzdGVtOkViNFRRaXpEdFlpYndJTHI=";
/** Base64 "client_id:client_secret" used as Basic auth on /oauth/token. */
export function oauthClientBasic(env = process.env) {
    if (env.WORKADEMY_OAUTH_CLIENT_BASIC) {
        return env.WORKADEMY_OAUTH_CLIENT_BASIC;
    }
    if (env.WORKADEMY_OAUTH_CLIENT_ID && env.WORKADEMY_OAUTH_CLIENT_SECRET) {
        return Buffer.from(`${env.WORKADEMY_OAUTH_CLIENT_ID}:${env.WORKADEMY_OAUTH_CLIENT_SECRET}`).toString("base64");
    }
    return DEFAULT_CLIENT_BASIC;
}
function normalizeBaseUrl(entry, alias) {
    let url = entry.baseUrl?.trim();
    if (!url && entry.hostname) {
        url = `https://${entry.hostname.trim()}`;
    }
    if (!url) {
        throw new McpError(ErrorCode.InvalidRequest, `Workspace "${alias}" needs "hostname" or "baseUrl" in the workspaces file`);
    }
    return url.replace(/\/+$/, "");
}
function hostOf(baseUrl) {
    try {
        return new URL(baseUrl).host.toLowerCase();
    }
    catch {
        return baseUrl.toLowerCase();
    }
}
export class WorkspaceRegistry {
    workspaces;
    defaultAlias;
    constructor(workspaces, defaultAlias) {
        this.workspaces = workspaces;
        this.defaultAlias = defaultAlias;
    }
    /**
     * Loads workspaces from WORKADEMY_WORKSPACES_FILE, or from workspaces.json in the project folder.
     * Otherwise falls back to the original single-workspace env setup
     * (WORKADEMY_API_KEY + WORKADEMY_BASE_URL), exposed under the alias "default".
     * WORKADEMY_WORKSPACES_FILE=none forces the single-workspace setup.
     */
    static load(env = process.env) {
        const file = env.WORKADEMY_WORKSPACES_FILE;
        if (file && file !== "none") {
            return WorkspaceRegistry.fromFile(file, env);
        }
        if (file !== "none" && fs.existsSync(DEFAULT_WORKSPACES_FILE)) {
            return WorkspaceRegistry.fromFile(DEFAULT_WORKSPACES_FILE, env);
        }
        return WorkspaceRegistry.fromLegacyEnv(env);
    }
    static fromFile(file, env) {
        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        }
        catch (error) {
            throw new McpError(ErrorCode.InvalidRequest, `Could not read WORKADEMY_WORKSPACES_FILE (${file}): ${error.message}`);
        }
        const entries = Object.entries(parsed?.workspaces ?? {});
        if (entries.length === 0) {
            throw new McpError(ErrorCode.InvalidRequest, `No workspaces defined in ${file}`);
        }
        // Keys live in a separate file (never in workspaces.json itself, so that one can be shared and edited)
        const keysPath = path.resolve(path.dirname(file), parsed.keysFile ?? "workspaces.keys.json");
        let keys = {};
        if (fs.existsSync(keysPath)) {
            try {
                keys = JSON.parse(fs.readFileSync(keysPath, "utf8"));
            }
            catch (error) {
                throw new McpError(ErrorCode.InvalidRequest, `Could not read keys file ${keysPath}: ${error.message}`);
            }
        }
        const workspaces = entries.map(([alias, entry]) => {
            // Order: environment variable, keys file, inline apiKey
            const apiKey = (entry.apiKeyEnv ? env[entry.apiKeyEnv] : undefined) || keys[alias] || entry.apiKey || "";
            return {
                alias,
                id: entry.id,
                name: entry.name,
                baseUrl: normalizeBaseUrl(entry, alias),
                apiKey,
                apiKeyEnv: entry.apiKeyEnv,
                // Safe default: workspaces from the file are read-only unless stated otherwise.
                readOnly: entry.readOnly ?? true,
                source: "file",
            };
        });
        const defaultAlias = parsed.default ?? workspaces[0].alias;
        if (!workspaces.some((w) => w.alias === defaultAlias)) {
            throw new McpError(ErrorCode.InvalidRequest, `Default workspace "${defaultAlias}" is not defined in ${file}`);
        }
        return new WorkspaceRegistry(workspaces, defaultAlias);
    }
    static fromLegacyEnv(env) {
        if (!env.WORKADEMY_API_KEY) {
            throw new McpError(ErrorCode.InvalidRequest, "Set WORKADEMY_WORKSPACES_FILE (several workspaces) or WORKADEMY_API_KEY (one workspace)");
        }
        if (!env.WORKADEMY_BASE_URL) {
            console.error("[workademy-mcp] WORKADEMY_BASE_URL not set, using default: https://staging.theworkademy.com");
        }
        const workspace = {
            alias: "default",
            baseUrl: (env.WORKADEMY_BASE_URL || "https://staging.theworkademy.com").replace(/\/+$/, ""),
            apiKey: env.WORKADEMY_API_KEY,
            apiKeyEnv: "WORKADEMY_API_KEY",
            readOnly: env.WORKADEMY_READ_ONLY === "true",
            source: "env",
        };
        return new WorkspaceRegistry([workspace], workspace.alias);
    }
    get aliases() {
        return this.workspaces.map((w) => w.alias);
    }
    /** Finds a workspace by alias, hostname, name or numeric id. No selector = default workspace. */
    resolve(selector) {
        if (selector === undefined || selector === null || String(selector).trim() === "") {
            return this.workspaces.find((w) => w.alias === this.defaultAlias);
        }
        const wanted = String(selector).trim().toLowerCase();
        const match = this.workspaces.find((w) => w.alias.toLowerCase() === wanted) ??
            this.workspaces.find((w) => hostOf(w.baseUrl) === wanted.replace(/^https?:\/\//, "").replace(/\/+$/, "")) ??
            this.workspaces.find((w) => (w.name ?? "").toLowerCase() === wanted) ??
            this.workspaces.find((w) => w.id !== undefined && String(w.id) === wanted);
        if (!match) {
            throw new McpError(ErrorCode.InvalidParams, `Unknown workspace "${selector}". Configured: ${this.aliases.join(", ")}` +
                (/^\d+$/.test(wanted) ? ` (selecting by id needs "id" in the workspaces file)` : ""));
        }
        return match;
    }
    /** Public description of a workspace — never includes the API key. */
    describe(workspace) {
        return {
            alias: workspace.alias,
            id: workspace.id ?? null,
            name: workspace.name ?? null,
            host: hostOf(workspace.baseUrl),
            readOnly: workspace.readOnly,
            default: workspace.alias === this.defaultAlias,
            apiKeyConfigured: Boolean(workspace.apiKey),
        };
    }
}
//# sourceMappingURL=registry.js.map