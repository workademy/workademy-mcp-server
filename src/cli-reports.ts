/**
 * npm run reports -- [--month 2026-09] [--only edera,se-ranking] [--all] [--out <folder>]
 *
 * Makes the monthly client PDFs for every workspace in workspaces.json (except "report": { "skip": true })
 * and writes reports/<month>/summary.md: who gets the report, who gets the win-back email, what failed.
 */
import * as fs from "fs/promises";
import * as path from "path";
import { WorkspaceRegistry, oauthClientBasic, type WorkspaceConfig } from "./registry.js";
import { monthlyReport } from "./extended-tools.js";
import { createMonthlyPdf, reportsDir, saveReportData, sendDecision, type MonthlyPdfResult } from "./monthly-pdf.js";
import { launchBrowser } from "./report-pdf.js";

process.env.WORKADEMY_MCP_NO_SERVER = "1";
const { WorkademyClient } = await import("./index.js");

const HELP = `Monthly client reports as PDFs.

  npm run reports -- [options]

  --month YYYY-MM   month to report (default: the previous full month)
  --only a,b        only these workspaces (alias, host, name or id)
  --all             also make PDFs for quiet months (below the completions threshold)
  --out <folder>    where to write (default: reports/ in this folder)

Per-workspace settings go in workspaces.json, e.g.
  "edera": { ..., "report": { "client": "EdEra", "language": "uk" } }
  "demo":  { ..., "report": { "skip": true } }
`;

function parseArgs(argv: string[]) {
  const opts: { month?: string; only?: string[]; all: boolean; out?: string; help: boolean } = { all: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++i];
      if (!v) throw new Error(`${arg} needs a value`);
      return v;
    };
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg.startsWith("--month")) opts.month = value();
    else if (arg.startsWith("--only")) opts.only = value().split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--all") opts.all = true;
    else if (arg.startsWith("--out")) opts.out = value();
    else throw new Error(`Unknown option ${arg} (see --help)`);
  }
  return opts;
}

function previousMonth(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

type Row =
  | { kind: "report"; workspace: string; result: MonthlyPdfResult }
  | { kind: "winback"; workspace: string; client: string; reason: string; result?: MonthlyPdfResult }
  | { kind: "skipped"; workspace: string; reason: string }
  | { kind: "error"; workspace: string; error: string };

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }
  const month = opts.month ?? previousMonth();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`--month must look like 2026-09`);
  if (opts.out) process.env.WORKADEMY_REPORTS_DIR = path.resolve(opts.out);

  const registry = WorkspaceRegistry.load();
  let workspaces: WorkspaceConfig[] = registry.workspaces;
  if (opts.only) workspaces = opts.only.map((selector) => registry.resolve(selector));

  const rows: Row[] = [];
  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;
  try {
    for (const workspace of workspaces) {
      const label = workspace.alias;
      if (workspace.report?.skip && !opts.only) {
        rows.push({ kind: "skipped", workspace: label, reason: '"skip": true in workspaces.json' });
        console.log(`- ${label}: skipped`);
        continue;
      }
      if (!workspace.apiKey) {
        rows.push({ kind: "error", workspace: label, error: `no API key (run npm run keys${workspace.apiKeyEnv ? ` or set ${workspace.apiKeyEnv}` : ""})` });
        console.log(`✗ ${label}: no API key`);
        continue;
      }
      process.stdout.write(`… ${label}: report for ${month}`);
      try {
        const client = new WorkademyClient({
          baseUrl: workspace.baseUrl,
          apiKey: workspace.apiKey,
          clientBasic: oauthClientBasic(),
          workspaceId: workspace.id,
        });
        const ctx = { client, workspace, registry };
        // no 60 s bridge limit here, so large workspaces get the time they need
        const report: any = await monthlyReport(ctx, { month, includeDepartments: false, budgetMs: 150_000 });
        const decision = sendDecision(report, workspace.report);
        const clientName = workspace.report?.client || workspace.name || report.workspace?.name || label;
        if (!decision.send && !opts.all) {
          await saveReportData(label, report);
          rows.push({ kind: "winback", workspace: label, client: clientName, reason: decision.reason });
          console.log(`\r→ ${label}: win-back (${decision.reason})`);
          continue;
        }
        browser ??= await launchBrowser();
        const result = await createMonthlyPdf(ctx, { month }, { browser, report });
        rows.push(
          decision.send
            ? { kind: "report", workspace: label, result }
            : { kind: "winback", workspace: label, client: clientName, reason: decision.reason, result }
        );
        console.log(`\r✓ ${label}: ${path.relative(process.cwd(), result.pdfPath)}${result.fitsOnePage ? "" : "  (CHECK: did not fit one page)"}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        rows.push({ kind: "error", workspace: label, error: message });
        console.log(`\r✗ ${label}: ${message}`);
      }
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }

  const dir = reportsDir(month);
  await fs.mkdir(dir, { recursive: true });
  const md = summaryMarkdown(month, rows);
  await fs.writeFile(path.join(dir, "summary.md"), md);
  await fs.writeFile(path.join(dir, "summary.json"), JSON.stringify({ month, createdAt: new Date().toISOString(), rows }, null, 2));
  console.log(`\nSummary: ${path.relative(process.cwd(), path.join(dir, "summary.md"))}`);
  if (rows.some((r) => r.kind === "error")) process.exitCode = 1;
}

function summaryMarkdown(month: string, rows: Row[]): string {
  const cell = (v: unknown) => String(v ?? "–").replace(/\|/g, "\\|");
  const lines = [`# Monthly client reports, ${month}`, ""];
  const reports = rows.filter((r): r is Extract<Row, { kind: "report" }> => r.kind === "report");
  lines.push(`## Send the report (${reports.length})`, "");
  if (reports.length) {
    lines.push("| Workspace | Client | Lang | Enrolled | Finished | Lead sentence | PDF |", "|---|---|---|---|---|---|---|");
    for (const { result: r } of reports) {
      lines.push(
        `| ${cell(r.workspace)} | ${cell(r.client)} | ${r.language} | ${cell(r.numbers.newEnrollments)} | ${cell(r.numbers.completions)} | ${cell(r.headline)} | ${cell(path.basename(r.pdfPath))}${r.fitsOnePage ? "" : " (did not fit, check)"} |`
      );
    }
  } else lines.push("None.");
  const winback = rows.filter((r): r is Extract<Row, { kind: "winback" }> => r.kind === "winback");
  lines.push("", `## Win-back email instead (${winback.length})`, "");
  for (const r of winback) lines.push(`- **${r.client}** (${r.workspace}): ${r.reason}${r.result ? ` (PDF made anyway: ${path.basename(r.result.pdfPath)})` : ""}`);
  if (!winback.length) lines.push("None.");
  const errors = rows.filter((r): r is Extract<Row, { kind: "error" }> => r.kind === "error");
  if (errors.length) {
    lines.push("", `## Failed (${errors.length})`, "");
    for (const r of errors) lines.push(`- ${r.workspace}: ${r.error}`);
  }
  const skipped = rows.filter((r): r is Extract<Row, { kind: "skipped" }> => r.kind === "skipped");
  if (skipped.length) lines.push("", `Skipped: ${skipped.map((r) => r.workspace).join(", ")}`);
  const warned = reports.filter((r) => r.result.warnings.length);
  if (warned.length) {
    lines.push("", "## Warnings", "");
    for (const { result: r } of warned) for (const w of r.warnings) lines.push(`- ${r.workspace}: ${w}`);
  }
  return lines.join("\n") + "\n";
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
