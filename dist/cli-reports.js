/**
 * npm run reports -- [--month 2026-09] [--only edera,se-ranking] [--all] [--pause 60] [--rate 1] [--summary] [--out <folder>]
 *
 * Makes the monthly client PDFs for every workspace in workspaces.json (except "report": { "skip": true })
 * and writes reports/<month>/summary.md: who gets the report, who gets the win-back email, what failed,
 * what has not run yet. The summary is rebuilt from the data saved in the month's folder after every
 * workspace (and on Ctrl+C), so a run can be stopped and continued with --only.
 */
import { existsSync, readFileSync, realpathSync } from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { WorkspaceRegistry, oauthClientBasic } from "./registry.js";
import { monthlyReport } from "./extended-tools.js";
import { createMonthlyPdf, reportProblem, reportsDir, saveReportData, sendDecision, } from "./monthly-pdf.js";
import { REPO_ROOT, buildPageModel, countPdfPages, languageFor, launchBrowser, pdfFileName } from "./report-pdf.js";
import { sleep } from "./pacing.js";
process.env.WORKADEMY_MCP_NO_SERVER = "1";
const { WorkademyClient } = await import("./index.js");
const HELP = `Monthly client reports as PDFs.

  npm run reports -- [options]

  --month YYYY-MM   month to report (default: the previous full month)
  --only a,b        only these workspaces (alias, host, name or id)
  --all             also make PDFs for quiet months (below the thresholds)
  --pause <seconds> pause between workspaces (default 20)
  --rate <n>        requests per second (default 1)
  --summary         only rebuild summary.md from the data already saved (no calls to Workademy)
  --out <folder>    where to write (default: reports/ in this folder)

Workademy's firewall blocks a computer for a while after too many requests, so the run is slow on
purpose. If it is blocked anyway, it stops; the summary lists what is left and the command to continue.

Per-workspace settings go in workspaces.json, e.g.
  "edera": { ..., "report": { "client": "EdEra", "language": "uk" } }
  "demo":  { ..., "report": { "skip": true } }
`;
function parseArgs(argv) {
    const opts = { all: false, summary: false, help: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = () => {
            const v = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++i];
            if (!v)
                throw new Error(`${arg} needs a value`);
            return v;
        };
        const number = (name, v, min) => {
            const n = Number(v);
            if (!Number.isFinite(n) || n < min)
                throw new Error(`${name} must be a number of at least ${min}`);
            return n;
        };
        if (arg === "--help" || arg === "-h")
            opts.help = true;
        else if (arg.startsWith("--month"))
            opts.month = value();
        else if (arg.startsWith("--only"))
            opts.only = value().split(",").map((s) => s.trim()).filter(Boolean);
        else if (arg === "--all")
            opts.all = true;
        else if (arg === "--summary")
            opts.summary = true;
        else if (arg.startsWith("--pause"))
            opts.pause = number("--pause", value(), 0);
        else if (arg.startsWith("--rate"))
            opts.rate = number("--rate", value(), 0.05);
        else if (arg.startsWith("--out"))
            opts.out = value();
        else
            throw new Error(`Unknown option ${arg} (see --help)`);
    }
    return opts;
}
/**
 * Keys that only live in the Claude app's config (workspaces with "apiKeyEnv", like EdEra's
 * WORKADEMY_API_KEY) are read from there, so the terminal run needs no copied keys.
 * Only the variables the workspaces file names are taken, and only from this server's entry.
 */
function keysFromClaudeConfig(names) {
    const files = process.env.WORKADEMY_CLAUDE_CONFIG
        ? [process.env.WORKADEMY_CLAUDE_CONFIG]
        : [
            path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
            path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json"),
            path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json"),
        ];
    const entry = path.join(REPO_ROOT, "dist", "index.js");
    const real = (p) => {
        try {
            return realpathSync(p);
        }
        catch {
            return path.resolve(p);
        }
    };
    for (const file of files) {
        if (!existsSync(file))
            continue;
        let servers;
        try {
            servers = Object.values(JSON.parse(readFileSync(file, "utf8"))?.mcpServers ?? {});
        }
        catch {
            continue;
        }
        const ours = servers.filter((s) => Array.isArray(s.args) && s.args.some((a) => typeof a === "string" && real(a) === real(entry)));
        const found = [];
        for (const name of names) {
            const value = ours.map((s) => s.env?.[name]).find((v) => typeof v === "string" && v.length > 0);
            if (value && !process.env[name]) {
                process.env[name] = value;
                found.push(name);
            }
        }
        if (found.length)
            return found;
    }
    return [];
}
function previousMonth() {
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const dataFile = (month, alias) => path.join(reportsDir(month), `${alias.replace(/[^A-Za-z0-9_-]+/g, "-")}.report.json`);
/** The row for a workspace from what an earlier run saved (no calls to Workademy). */
async function rowFromFiles(workspace, month) {
    const alias = workspace.alias;
    const file = dataFile(month, alias);
    if (!existsSync(file))
        return null;
    let report;
    try {
        report = JSON.parse(await fs.readFile(file, "utf8"));
    }
    catch {
        return { kind: "error", workspace: alias, error: `the saved data (${path.basename(file)}) cannot be read: run again with --only ${alias}` };
    }
    const problem = reportProblem(report, alias);
    if (problem)
        return { kind: "error", workspace: alias, error: problem };
    const settings = workspace.report;
    const decision = sendDecision(report, settings);
    const client = settings?.client || workspace.name || report.workspace?.name || alias;
    if (!decision.send)
        return { kind: "winback", workspace: alias, client, reason: decision.reason };
    const pdfPath = path.join(reportsDir(month), pdfFileName(client, month, alias));
    if (!existsSync(pdfPath)) {
        return { kind: "error", workspace: alias, error: `the numbers are saved but the PDF is missing: run again with --only ${alias}` };
    }
    const language = languageFor(settings, report.workspace?.locale);
    const model = buildPageModel(report, { language, client, headline: settings?.headline });
    const pages = countPdfPages(await fs.readFile(pdfPath));
    const h = report.headline ?? {};
    return {
        kind: "report",
        workspace: alias,
        result: {
            workspace: alias,
            client,
            month,
            language,
            pdfPath,
            pages,
            fitsOnePage: pages === 1,
            layoutStep: -1,
            headline: model.headline,
            headlineKind: model.headlineKind,
            sendRecommendation: decision,
            numbers: {
                newEnrollments: h.newEnrollmentsThisMonth ?? null,
                completions: h.completionsThisMonth ?? null,
                certificates: h.certificatesThisMonth ?? null,
                activeLearners: h.activeUsers ?? null,
                previousMonth: report.previousMonth ?? null,
            },
            warnings: report.warnings ?? [],
        },
    };
}
/** Every configured workspace: this run's result, else what an earlier run saved, else "not run yet". */
async function summaryRows(all, month, thisRun) {
    const rows = [];
    for (const workspace of all) {
        const alias = workspace.alias;
        const row = thisRun.get(alias) ??
            (workspace.report?.skip
                ? { kind: "skipped", workspace: alias, reason: '"skip": true in workspaces.json' }
                : await rowFromFiles(workspace, month)) ??
            { kind: "notrun", workspace: alias, reason: "not run yet for this month" };
        rows.push(row);
    }
    return rows;
}
async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        console.log(HELP);
        return;
    }
    const month = opts.month ?? previousMonth();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
        throw new Error(`--month must look like 2026-09`);
    if (opts.out)
        process.env.WORKADEMY_REPORTS_DIR = path.resolve(opts.out);
    // Slow on purpose: the firewall in front of the API blocks a computer after too many requests (pacing.ts).
    if (opts.rate)
        process.env.WORKADEMY_MIN_REQUEST_GAP_MS = String(Math.round(1000 / opts.rate));
    process.env.WORKADEMY_MIN_REQUEST_GAP_MS ??= "1000";
    process.env.WORKADEMY_RATE_LIMIT_WAIT_MS ??= "300000";
    const pauseMs = (opts.pause ?? 20) * 1000;
    let registry = WorkspaceRegistry.load();
    const unset = registry.workspaces.filter((w) => !w.apiKey && w.apiKeyEnv).map((w) => w.apiKeyEnv);
    if (unset.length) {
        const found = keysFromClaudeConfig([...new Set(unset)]);
        if (found.length) {
            console.log(`(${found.join(", ")} taken from the Claude app's config)`);
            registry = WorkspaceRegistry.load();
        }
    }
    const all = registry.workspaces;
    const selected = opts.only ? opts.only.map((selector) => registry.resolve(selector)) : all;
    const dir = reportsDir(month);
    await fs.mkdir(dir, { recursive: true });
    const thisRun = new Map();
    const writeSummary = async () => {
        const rows = await summaryRows(all, month, thisRun);
        await fs.writeFile(path.join(dir, "summary.md"), summaryMarkdown(month, rows));
        await fs.writeFile(path.join(dir, "summary.json"), JSON.stringify({ month, updatedAt: new Date().toISOString(), rows }, null, 2));
        return rows;
    };
    let interrupted = false;
    process.on("SIGINT", () => {
        if (interrupted)
            process.exit(130);
        interrupted = true;
        console.log("\nStopped. Writing the summary…");
        writeSummary()
            .then(() => console.log(`Summary: ${path.relative(process.cwd(), path.join(dir, "summary.md"))}`))
            .finally(() => process.exit(130));
    });
    if (!opts.summary) {
        let browser = null;
        let stoppedBy = null;
        let started = 0;
        try {
            for (const workspace of selected) {
                const label = workspace.alias;
                if (stoppedBy) {
                    thisRun.set(label, { kind: "notrun", workspace: label, reason: stoppedBy });
                    continue;
                }
                if (workspace.report?.skip && !opts.only) {
                    thisRun.set(label, { kind: "skipped", workspace: label, reason: '"skip": true in workspaces.json' });
                    console.log(`- ${label}: skipped`);
                    continue;
                }
                if (!workspace.apiKey) {
                    thisRun.set(label, {
                        kind: "error",
                        workspace: label,
                        error: `no API key (run npm run keys${workspace.apiKeyEnv ? ` or set ${workspace.apiKeyEnv}` : ""})`,
                    });
                    console.log(`✗ ${label}: no API key`);
                    continue;
                }
                if (started > 0 && pauseMs > 0) {
                    console.log(`  (pause of ${Math.round(pauseMs / 1000)} s, so the firewall does not block us)`);
                    await sleep(pauseMs);
                }
                started += 1;
                process.stdout.write(`… ${label}: report for ${month}`);
                let row;
                try {
                    const client = new WorkademyClient({
                        baseUrl: workspace.baseUrl,
                        apiKey: workspace.apiKey,
                        clientBasic: oauthClientBasic(),
                        workspaceId: workspace.id,
                    });
                    const ctx = { client, workspace, registry };
                    // no 60 s bridge limit here: large workspaces and firewall pauses get the time they need
                    const report = await monthlyReport(ctx, { month, includeDepartments: false, budgetMs: 900_000 });
                    // missing or incomplete numbers are a failure, never a quiet month
                    const problem = reportProblem(report, label);
                    if (problem) {
                        row = { kind: "error", workspace: label, error: problem };
                    }
                    else {
                        const decision = sendDecision(report, workspace.report);
                        const clientName = workspace.report?.client || workspace.name || report.workspace?.name || label;
                        if (!decision.send && !opts.all) {
                            await saveReportData(label, report);
                            row = { kind: "winback", workspace: label, client: clientName, reason: decision.reason };
                        }
                        else {
                            browser ??= await launchBrowser();
                            const result = await createMonthlyPdf(ctx, { month }, { browser, report });
                            row = decision.send
                                ? { kind: "report", workspace: label, result }
                                : { kind: "winback", workspace: label, client: clientName, reason: decision.reason, result };
                        }
                    }
                }
                catch (error) {
                    row = { kind: "error", workspace: label, error: error instanceof Error ? error.message : String(error) };
                }
                thisRun.set(label, row);
                if (row.kind === "report") {
                    console.log(`\r✓ ${label}: ${path.relative(process.cwd(), row.result.pdfPath)}${row.result.fitsOnePage ? "" : "  (CHECK: did not fit one page)"}`);
                }
                else if (row.kind === "winback") {
                    console.log(`\r→ ${label}: win-back (${row.reason})`);
                }
                else if (row.kind === "error") {
                    console.log(`\r✗ ${label}: ${row.error}`);
                    // blocked even after waiting: more requests would only keep the block going
                    if (row.error.includes("firewall")) {
                        stoppedBy = `not run: the run stopped when Workademy's firewall blocked ${label}`;
                        console.log("  Stopping here; the rest can run later (see the summary).");
                    }
                }
                await writeSummary();
            }
        }
        finally {
            await browser?.close().catch(() => undefined);
        }
    }
    const rows = await writeSummary();
    console.log(`\nSummary: ${path.relative(process.cwd(), path.join(dir, "summary.md"))}`);
    const todo = rows.filter((r) => r.kind === "error" || r.kind === "notrun").map((r) => r.workspace);
    if (todo.length) {
        console.log(`Still to do (${todo.length}): ${rerunCommand(month, todo)}`);
        process.exitCode = 1;
    }
}
function rerunCommand(month, workspaces) {
    return `npm run reports -- --month ${month} --only ${workspaces.join(",")}`;
}
function summaryMarkdown(month, rows) {
    const cell = (v) => String(v ?? "–").replace(/\|/g, "\\|");
    const lines = [`# Monthly client reports, ${month}`, ""];
    const reports = rows.filter((r) => r.kind === "report");
    lines.push(`## Send the report (${reports.length})`, "");
    if (reports.length) {
        lines.push("| Workspace | Client | Lang | Enrolled | Finished | Lead sentence | PDF |", "|---|---|---|---|---|---|---|");
        for (const { result: r } of reports) {
            lines.push(`| ${cell(r.workspace)} | ${cell(r.client)} | ${r.language} | ${cell(r.numbers.newEnrollments)} | ${cell(r.numbers.completions)} | ${cell(r.headline)} | ${cell(path.basename(r.pdfPath))}${r.fitsOnePage ? "" : " (did not fit, check)"} |`);
        }
    }
    else
        lines.push("None.");
    const winback = rows.filter((r) => r.kind === "winback");
    lines.push("", `## Win-back email instead (${winback.length})`, "");
    for (const r of winback)
        lines.push(`- **${r.client}** (${r.workspace}): ${r.reason}${r.result ? ` (PDF made anyway: ${path.basename(r.result.pdfPath)})` : ""}`);
    if (!winback.length)
        lines.push("None.");
    const errors = rows.filter((r) => r.kind === "error");
    if (errors.length) {
        lines.push("", `## Failed (${errors.length})`, "");
        for (const r of errors)
            lines.push(`- ${r.workspace}: ${r.error}`);
    }
    const notrun = rows.filter((r) => r.kind === "notrun");
    if (notrun.length) {
        lines.push("", `## Not run yet (${notrun.length})`, "");
        for (const r of notrun)
            lines.push(`- ${r.workspace}: ${r.reason}`);
    }
    if (errors.length || notrun.length) {
        lines.push("", "Run these next:", "", "```", rerunCommand(month, [...errors, ...notrun].map((r) => r.workspace)), "```");
    }
    const skipped = rows.filter((r) => r.kind === "skipped");
    if (skipped.length)
        lines.push("", `Skipped: ${skipped.map((r) => r.workspace).join(", ")}`);
    const warned = reports.filter((r) => r.result.warnings.length);
    if (warned.length) {
        lines.push("", "## Warnings", "");
        for (const { result: r } of warned)
            for (const w of r.warnings)
                lines.push(`- ${r.workspace}: ${w}`);
    }
    return lines.join("\n") + "\n";
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
//# sourceMappingURL=cli-reports.js.map