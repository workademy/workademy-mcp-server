#!/usr/bin/env node
/**
 * Builds the client package: one .mcpb file a customer installs in the Claude desktop app with a
 * double-click. It holds the built server, its runtime dependencies and mcpb/manifest.json, and
 * nothing from this folder that belongs to us: no workspaces.json, no keys, no reports.
 * The customer enters their own workspace address and API key when installing.
 *
 *   npm run pack        → release/workademy-<version>.mcpb
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "mcpb", "manifest.json"), "utf8"));
manifest.version = pkg.version;

// Only what is listed here goes in. cli-reports.js is our own monthly run over every client.
const SKIP_DIST = new Set(["cli-reports.js"]);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "workademy-mcpb-"));
try {
  const dist = path.join(root, "dist");
  if (!fs.existsSync(path.join(dist, "index.js"))) {
    throw new Error("dist/index.js is missing. Run `npm run build` first (npm run pack does it for you).");
  }
  fs.mkdirSync(path.join(stage, "dist"));
  for (const name of fs.readdirSync(dist)) {
    if (name.endsWith(".js") && !SKIP_DIST.has(name)) {
      fs.copyFileSync(path.join(dist, name), path.join(stage, "dist", name));
    }
  }
  fs.cpSync(path.join(root, "assets"), path.join(stage, "assets"), { recursive: true });
  fs.copyFileSync(path.join(root, "package.json"), path.join(stage, "package.json"));
  fs.copyFileSync(path.join(root, "package-lock.json"), path.join(stage, "package-lock.json"));
  fs.writeFileSync(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  console.log("Installing runtime dependencies…");
  execSync("npm ci --omit=dev --ignore-scripts --no-audit --no-fund", { cwd: stage, stdio: "inherit" });
  fs.rmSync(path.join(stage, "package-lock.json"));

  // Last check before it leaves the building: nothing of ours outside node_modules.
  const forbidden = /^(workspaces.*\.json|\.env.*|.*\.keys\.json)$/i;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (forbidden.test(entry.name)) {
        throw new Error(`Refusing to pack: ${path.relative(stage, full)} must not be in a client package.`);
      }
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(stage);

  const outDir = path.join(root, "release");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `workademy-${pkg.version}.mcpb`);
  fs.rmSync(out, { force: true });
  execSync(`npx -y @anthropic-ai/mcpb pack "${stage}" "${out}"`, { stdio: "inherit" });
  const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
  console.log(`\nClient package: ${path.relative(root, out)} (${mb} MB)`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
