#!/usr/bin/env node
// Creates Workademy API keys for the workspaces you pick and registers them for the MCP server.
//
// Your password and the keys are never printed. Keys are written to workspaces.keys.json
// (readable only by you); workspaces.json gets the workspace details without secrets.
// Both files are git-ignored.
//
//   npm run keys                              log in, pick workspaces from a numbered list
//   npm run keys -- --list                    only show the workspaces your account can see
//   npm run keys -- --only "Kognic, Clark"    pick by name or hostname, no prompt
//   npm run keys -- --host app.theworkademy.com   where to log in (default)
//   npm run keys -- --force                   replace a key that is already configured
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---- options ---------------------------------------------------------------
const opts = { file: path.join(root, "workspaces.json"), host: "app.theworkademy.com", only: null, list: false, force: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--file") opts.file = path.resolve(argv[++i]);
  else if (arg === "--host") opts.host = argv[++i].replace(/^https?:\/\//, "").replace(/\/+$/, "");
  else if (arg === "--only") opts.only = argv[++i];
  else if (arg === "--list") opts.list = true;
  else if (arg === "--force") opts.force = true;
  else {
    console.error(`Unknown option ${arg}`);
    process.exit(2);
  }
}
const scheme = process.env.WORKADEMY_KEYS_SCHEME || "https"; // the smoke test uses http
// The Workademy web app's own OAuth client, which is the one allowed to log in with a password
const loginClient = process.env.WORKADEMY_LOGIN_CLIENT_BASIC || "d2ViYXBwOnRlc3Q=";

// ---- helpers ---------------------------------------------------------------
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = () => {}; // do not echo what is typed
    process.stdout.write(question);
    rl.question("", (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function login(host, email, password) {
  const res = await fetch(`${scheme}://${host}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${loginClient}` },
    body: new URLSearchParams({ grant_type: "password", username: email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(`login at ${host} failed (${res.status}): ${body.error_description ?? body.error ?? res.statusText}`);
    error.status = res.status;
    throw error;
  }
  return (await res.json()).access_token;
}

async function api(host, token, method, apiPath, body) {
  const res = await fetch(`${scheme}://${host}${apiPath}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const error = new Error(`${method} ${apiPath} returned ${res.status} ${data?.message ?? data?.error_description ?? ""}`.trim());
    error.status = res.status;
    throw error;
  }
  return data;
}

async function listWorkspaces(host, token) {
  const all = [];
  for (let page = 0; page < 50; page++) {
    const data = await api(host, token, "GET", `/api/v1/secured/workspaces?page=${page}&size=100`);
    all.push(...(data?.content ?? []));
    if (data?.last !== false || !data?.content?.length) break;
  }
  return all;
}

const slug = (text) =>
  String(text).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";

// ---- main ------------------------------------------------------------------
const config = readJson(opts.file, { default: null, workspaces: {} });
config.workspaces ??= {};
const keysPath = path.resolve(path.dirname(opts.file), config.keysFile ?? "workspaces.keys.json");
const keys = readJson(keysPath, {});
const aliasById = new Map(Object.entries(config.workspaces).map(([alias, w]) => [w.id, alias]));

const email = process.env.WORKADEMY_LOGIN_EMAIL || (await ask("Workademy e-mail: "));
const password = process.env.WORKADEMY_LOGIN_PASSWORD || (await askHidden("Password (not shown): "));
const tokens = new Map();
try {
  tokens.set(opts.host, await login(opts.host, email, password));
} catch (error) {
  console.error(error.message);
  console.error("If you sign in with Google or SSO, this account has no password login; set one in your profile first.");
  process.exit(1);
}

const workspaces = (await listWorkspaces(opts.host, tokens.get(opts.host)))
  .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
console.log(`\nWorkspaces visible to ${email}:\n`);
workspaces.forEach((w, i) => {
  const alias = aliasById.get(w.id);
  const status = alias ? (keys[alias] || config.workspaces[alias]?.apiKeyEnv ? `configured as "${alias}"` : `listed as "${alias}", no key`) : "";
  console.log(
    `${String(i + 1).padStart(3)}. ${String(w.name ?? "?").padEnd(32)} ${String(w.hostname ?? "-").padEnd(36)} ${w.admin ? "admin" : "     "}  ${status}`
  );
});
if (opts.list) process.exit(0);

let selected = [];
if (opts.only) {
  for (const term of opts.only.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)) {
    const matches = workspaces.filter(
      (w) => String(w.name ?? "").toLowerCase().includes(term) || String(w.hostname ?? "").toLowerCase().includes(term)
    );
    const exact = matches.filter((w) => String(w.name ?? "").toLowerCase() === term);
    const pick = exact.length === 1 ? exact : matches;
    if (pick.length === 1) selected.push(pick[0]);
    else if (pick.length === 0) console.log(`  "${term}": no matching workspace`);
    else console.log(`  "${term}" matches several workspaces (${pick.map((w) => w.name).join(", ")}); be more specific`);
  }
} else {
  const answer = await ask("\nCreate keys for which workspaces? Numbers separated by commas (e.g. 2,5,7): ");
  for (const part of answer.split(",").map((p) => p.trim()).filter(Boolean)) {
    const index = Number(part) - 1;
    if (Number.isInteger(index) && workspaces[index]) selected.push(workspaces[index]);
    else console.log(`  ignoring "${part}"`);
  }
}
selected = [...new Map(selected.map((w) => [w.id, w])).values()];
if (selected.length === 0) {
  console.log("Nothing selected.");
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
const usedAliases = new Set(Object.keys(config.workspaces));
const results = [];
for (const w of selected) {
  let alias = aliasById.get(w.id);
  if (!alias) {
    alias = slug(w.name ?? w.hostname);
    if (usedAliases.has(alias)) alias = `${alias}-${w.id}`;
    usedAliases.add(alias);
  }
  const existing = config.workspaces[alias] ?? {};
  if (!w.hostname) {
    results.push(`  skipped  ${w.name}: the workspace has no hostname`);
    continue;
  }
  if ((keys[alias] || existing.apiKeyEnv) && !opts.force) {
    results.push(`  skipped  ${alias}: already has a key (use --force to replace it)`);
    continue;
  }
  try {
    const body = { comment: `Workademy reporting (MCP), created by ${email} on ${today}` };
    const create = async () =>
      api(w.hostname, tokens.get(w.hostname) ?? tokens.get(opts.host), "POST", `/api/v1/secured/workspaces/${w.id}/api-key`, body);
    let created;
    try {
      created = await create();
    } catch (error) {
      if ((error.status === 401 || error.status === 403) && !tokens.has(w.hostname)) {
        tokens.set(w.hostname, await login(w.hostname, email, password)); // tokens can be bound to one host
        created = await create();
      } else {
        throw error;
      }
    }
    if (!created?.apiKey) throw new Error("the response contained no key");
    keys[alias] = created.apiKey;
    const { apiKeyEnv, apiKey, ...rest } = existing; // the new key in the keys file takes over
    config.workspaces[alias] = {
      ...rest,
      id: w.id,
      name: w.name,
      hostname: w.hostname,
      ...(scheme !== "https" ? { baseUrl: `${scheme}://${w.hostname}` } : {}),
      readOnly: existing.readOnly ?? true,
    };
    results.push(`  created  ${alias} (${w.hostname}, id ${w.id})`);
  } catch (error) {
    results.push(`  FAILED   ${alias}: ${error.message}`);
  }
}

config.default ??= Object.keys(config.workspaces)[0] ?? null;
fs.writeFileSync(opts.file, JSON.stringify(config, null, 2) + "\n");
fs.writeFileSync(keysPath, JSON.stringify(keys, null, 2) + "\n", { mode: 0o600 });
fs.chmodSync(keysPath, 0o600);

console.log(`\n${results.join("\n")}\n`);
console.log(`Workspaces: ${opts.file}`);
console.log(`Keys:       ${keysPath} (only readable by you)`);
console.log("New workspaces are read-only for the MCP server. Restart the Claude app to load them.");
