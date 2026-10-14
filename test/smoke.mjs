// End-to-end smoke test: starts two mock workspaces, runs the built server (dist/index.js)
// over stdio with the MCP client, and checks routing, write protection, auth retry,
// analytics paths, the monthly report and the legacy single-key setup.
// Run with: npm run build && npm run test:smoke
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LEARNER_NAMES, startMock } from "./mock-workademy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, "..", "dist", "index.js");
const keysScript = path.join(here, "..", "scripts", "create-api-keys.mjs");
// async on purpose: the mock servers live in this process and must keep answering
const runScript = async (args, env) =>
  (await promisify(execFile)(process.execPath, [keysScript, ...args], { env: { ...baseEnv, ...env }, encoding: "utf8" })).stdout;
const CLIENT_BASIC = Buffer.from("test-client:test-secret").toString("base64");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "workademy-mcp-smoke-"));

const baseEnv = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? tmp,
  WORKADEMY_OAUTH_CLIENT_ID: "test-client",
  WORKADEMY_OAUTH_CLIENT_SECRET: "test-secret",
  WORKADEMY_POLL_INTERVAL_MS: "20",
  WORKADEMY_TODO_TIMEOUT_MS: "500",
  WORKADEMY_ASSET_CDN: "", // set per run below
  WORKADEMY_EXPORT_DIR: tmp,
  WORKADEMY_REPORTS_DIR: path.join(tmp, "reports"),
  // so the PDF checks find the browser on machines where Chrome is not in a standard place
  ...(process.env.WORKADEMY_CHROME_PATH ? { WORKADEMY_CHROME_PATH: process.env.WORKADEMY_CHROME_PATH } : {}),
  ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}),
};
const pdfLib = await import("../dist/report-pdf.js");
const chrome = pdfLib.findChrome();

async function connect(env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: { ...baseEnv, ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "smoke-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(result.content?.[0]?.text ?? "tool error");
  const text = result.content[0].text;
  try {
    return JSON.parse(text);
  } catch {
    return text; // some original tools answer in plain text
  }
}

let passed = 0;
async function check(label, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${label}`);
  } catch (error) {
    console.error(`  FAIL ${label}\n       ${error.stack ?? error}`);
    process.exitCode = 1;
  }
}

const users = { "olga@example.com": "pw-secret" };
const userWorkspaces = []; // filled once both hosts are known
const a = await startMock({ workspaceId: 10, name: "EdEra (mock)", apiKey: "key-a", clientBasic: CLIENT_BASIC, host: "127.0.0.1", users, userWorkspaces });
const b = await startMock({ workspaceId: 20, name: "Client (mock)", apiKey: "key-b", clientBasic: CLIENT_BASIC, analytics: false, host: "localhost", users, slowUngradedMs: 3000 });
userWorkspaces.push(
  { id: 10, name: "EdEra (mock)", hostname: new URL(a.url).host, admin: true },
  { id: 20, name: "Client (mock)", hostname: new URL(b.url).host, admin: true }
);

const workspacesFile = path.join(tmp, "workspaces.json");
fs.writeFileSync(
  workspacesFile,
  JSON.stringify({
    default: "edera",
    workspaces: {
      edera: { id: 10, name: "EdEra", baseUrl: a.url, apiKeyEnv: "KEY_EDERA", readOnly: false },
      client: { name: "Client", baseUrl: b.url }, // key comes from workspaces.keys.json
      missing: { hostname: "missing.example", apiKeyEnv: "KEY_NOT_SET" },
    },
  })
);
fs.writeFileSync(path.join(tmp, "workspaces.keys.json"), JSON.stringify({ client: "key-b" }));

const now = new Date();
const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

console.log("multi-workspace mode");
const mcp = await connect({ WORKADEMY_WORKSPACES_FILE: workspacesFile, KEY_EDERA: "key-a", WORKADEMY_ASSET_CDN: a.url });

await check("every tool except list_configured_workspaces takes `workspace`", async () => {
  const { tools } = await mcp.listTools();
  const names = tools.map((t) => t.name);
  for (const required of ["get_analytics", "get_monthly_report", "get_workspace_summary", "export_report", "list_courses"]) {
    assert.ok(names.includes(required), `missing tool ${required}`);
  }
  for (const tool of tools) {
    const has = Boolean(tool.inputSchema?.properties?.workspace);
    assert.equal(has, tool.name !== "list_configured_workspaces", tool.name);
  }
});

await check("list_configured_workspaces verifies keys and never returns them", async () => {
  const result = await call(mcp, "list_configured_workspaces", { verify: true });
  const text = JSON.stringify(result);
  assert.ok(!text.includes("key-a") && !text.includes("key-b"));
  const byAlias = Object.fromEntries(result.workspaces.map((w) => [w.alias, w]));
  assert.equal(byAlias.edera.verified.ok, true);
  assert.equal(byAlias.client.verified.ok, true);
  assert.equal(byAlias.client.verified.workspaceId, 20, "id resolved from the API when not configured");
  assert.equal(byAlias.client.readOnly, true, "file workspaces are read-only by default");
  assert.equal(byAlias.missing.verified.ok, false);
  assert.match(byAlias.missing.verified.error, /KEY_NOT_SET/);
});

await check("calls go to the selected workspace's host", async () => {
  const beforeA = a.state.log.length;
  const beforeB = b.state.log.length;
  await call(mcp, "list_courses", { size: 5 });
  assert.ok(a.state.log.slice(beforeA).some((r) => r.path === "/api/v1/secured/courses"));
  assert.equal(b.state.log.length, beforeB, "default call must not touch the other workspace");
  await call(mcp, "list_courses", { workspace: "client", size: 5 });
  const lastB = b.state.log.slice(beforeB).find((r) => r.path === "/api/v1/secured/courses");
  assert.ok(lastB, "workspace=client must hit the client host");
  assert.ok(!lastB.query.includes("workspace="), "routing argument must not be forwarded to the API");
  const beforeById = a.state.log.length;
  await call(mcp, "list_courses", { workspace: "10" }); // by configured id
  assert.ok(a.state.log.length > beforeById);
  const beforeByHost = b.state.log.length;
  await call(mcp, "list_courses", { workspace: new URL(b.url).host }); // by hostname
  assert.ok(b.state.log.length > beforeByHost);
  await call(mcp, "list_courses", { workspace: "20" }); // id learned by verify=true above
});

await check("write tools are refused on read-only workspaces", async () => {
  const before = b.state.log.length;
  await assert.rejects(() => call(mcp, "delete_course", { workspace: "client", courseId: 101 }), /read-only/);
  assert.equal(b.state.log.filter((r) => r.method === "DELETE").length, 0);
  assert.equal(b.state.log.length, before, "no request at all");
  await call(mcp, "delete_course", { courseId: 101 }); // edera is writable
  assert.ok(a.state.log.some((r) => r.method === "DELETE" && r.path === "/api/v1/secured/courses/101"));
});

await check("unknown workspace gives a clear error", async () => {
  await assert.rejects(() => call(mcp, "list_courses", { workspace: "nope" }), /Unknown workspace "nope". Configured: edera, client, missing/);
});

await check("expired token: re-authenticates once and succeeds", async () => {
  const tokensBefore = a.state.tokenRequests;
  await fetch(`${a.url}/__control/invalidate`);
  await call(mcp, "list_courses", { size: 1 });
  assert.equal(a.state.tokenRequests, tokensBefore + 1);
});

await check("persistent 401: one retry, then a clear error (no loop)", async () => {
  await fetch(`${a.url}/__control/always401?path=${encodeURIComponent("/api/v1/secured/users/me")}`);
  const before = a.state.log.filter((r) => r.path === "/api/v1/secured/users/me").length;
  await assert.rejects(() => call(mcp, "get_current_user"), /401.*edera.*GET \/api\/v1\/secured\/users\/me/s);
  const after = a.state.log.filter((r) => r.path === "/api/v1/secured/users/me").length;
  assert.equal(after - before, 2, "original request + exactly one retry");
  await fetch(`${a.url}/__control/reset401`);
});

await check("get_analytics builds the dashboard's drill-down path and labels rows", async () => {
  const result = await call(mcp, "get_analytics", {
    fact: "questionanswer",
    courseId: 101,
    moduleId: 11,
    lectureId: 111,
    start: "2026-01-01",
    end: "2026-12-31",
  });
  assert.equal(
    result.request.path,
    "/analytics-api/v1/secured/workspaces/10/courses/101/modules/11/lectures/111/questionanswers/facts/questionanswer"
  );
  assert.equal(result.request.params.start, Date.UTC(2026, 0, 1));
  assert.equal(result.request.params.end, Date.UTC(2026, 11, 31) + 86400000 - 1);
  assert.equal(result.rows[0].question, "Within how many hours must a breach be reported?");
  const series = await call(mcp, "get_analytics", { fact: "usercourse", timeseries: true });
  assert.equal(series.request.path, "/analytics-api/v1/secured/workspaces/10/courses/facts/usercourse/:timeseries");
  assert.equal(series.request.params["timestamp.dir"], "asc");
  const activity = await call(mcp, "get_analytics", { fact: "activity" });
  assert.equal(activity.request.path, "/analytics-api/v1/secured/workspaces-activity/10/facts/activity");
  assert.equal(activity.data.activityCount, 37);
  const countries = await call(mcp, "get_analytics", { fact: "workspace_users", breakdown: "country" });
  assert.equal(countries.request.path, "/analytics-api/v1/secured/workspaces/10/countries/facts/workspace");
  await assert.rejects(() => call(mcp, "get_analytics", { fact: "lecture", moduleId: 3 }), /moduleId needs courseId/);
});

await check("get_workspace_summary counts", async () => {
  const s = await call(mcp, "get_workspace_summary");
  assert.equal(s.courses.total, 3);
  assert.equal(s.courses.published, 2);
  assert.equal(s.users, 120);
  assert.deepEqual(s.groups.bySource, { PERSONIO: 1, WORKADEMY: 1 });
  assert.equal(s.learningPaths, 2);
  assert.deepEqual([s.invitations.total, s.invitations.accepted], [130, 100]);
});

await check("monthly report (analytics): aggregates, hotspots, small groups hidden, no names", async () => {
  const r = await call(mcp, "get_monthly_report", {});
  assert.equal(r.sources.enrollments, "analytics API");
  assert.equal(r.headline.enrollmentsToDate, 170);
  assert.equal(r.headline.completionsToDate, 125);
  assert.equal(r.headline.completionRateToDate, 73.5);
  assert.equal(r.headline.newEnrollmentsThisMonth, 32);
  assert.equal(r.headline.completionsThisMonth, 14);
  assert.equal(r.headline.openToDate, 45, "to date from records: enrolled minus finished");
  assert.match(r.sources.toDate, /enrolment records/);
  assert.ok(a.state.log.some((x) => x.path === "/api/v1/secured/courses/101/usercourses" && x.query.includes("finishTime%3Disnot%3Dnull")));
  assert.equal(r.headline.certificatesThisMonth, 9);
  assert.equal(r.headline.logins, 230);
  assert.equal(r.headline.activeUsers, 37);
  assert.equal(r.courses[0].course, "Data protection refresher", "HTML and trailing colon stripped from names");
  assert.equal(r.courses[1].course, "Safety instruction", "cut-off tag stripped");
  assert.equal(r.courses[0].thisMonth.avgCertificateScorePercent, 88.5, "fraction shown as percent");
  assert.equal(r.departments.shown[0].groupId, 1, "groupId kept to tell same-named groups apart");
  assert.ok(!("hidden" in r.departments.shown[0]));
  assert.deepEqual([r.courses[0].toDate.enrolled, r.courses[0].toDate.finished, r.courses[0].toDate.completionRate], [150, 120, 80]);
  assert.deepEqual([r.headline.courses, r.headline.coursesWithActivity], [3, 2]);
  assert.ok(!("started" in r.courses[0].toDate), "always-zero metric left out");
  assert.equal(r.struggleHotspots.questions.length, 1, "question with fewer than 5 answers left out");
  assert.equal(r.struggleHotspots.questions[0].wrongRate, 64.3);
  assert.equal(r.struggleHotspots.questions[0].lecture, "Reporting a breach");
  assert.deepEqual(r.departments.shown.map((d) => d.group), ["Sales"]);
  assert.equal(r.departments.hiddenGroups, 1);
  assert.deepEqual(r.departments.shown[0].courses.map((c) => c.course), ["Data protection refresher"]);
  assert.equal(r.departments.shown[0].suppressedCourses, 1, "2-person cell hidden");
  assert.equal(r.upcomingScheduledRuns.length, 1);
  assert.deepEqual([r.adminTodos.pendingEnrollmentApprovals, r.adminTodos.ungradedOpenAnswers], [1, 4]);
  const toDateCalls = a.state.log.filter((x) => x.path === "/analytics-api/v1/secured/workspaces/10/facts/usercourse" && x.query.includes("start=0&"));
  assert.ok(toDateCalls.length > 0 && toDateCalls.every((x) => x.query.includes("aggregationType=MONTH")), "to date = monthly buckets from 0");
  assert.equal(r.departments.shown[0].members, 12, "members come from /groups/{id}/users, not the list's userCount");
  const text = JSON.stringify(r);
  for (const name of LEARNER_NAMES) assert.ok(!text.includes(name), `leaked ${name}`);
  assert.ok(!text.includes("@client.example"), "leaked an e-mail");
});

await check("monthly report: this month's busiest courses, previous month, workspace start", async () => {
  const r = await call(mcp, "get_monthly_report", { includeDepartments: false });
  assert.deepEqual(
    r.topCoursesThisMonth.map((c) => [c.course, c.enrolled, c.finished, c.completionRateToDate]),
    [["Safety instruction", 20, 5, 25], ["Data protection refresher", 12, 9, 80]],
    "ordered by this month's enrolments, all-time completion from the records"
  );
  assert.equal(r.topCoursesThisMonth[1].avgCertificateScorePercent, 88.5);
  assert.equal(r.coursesActiveThisMonth, 2);
  assert.deepEqual([r.previousMonth.newEnrollments, r.previousMonth.completions], [32, 14]);
  assert.equal(r.headline.avgCertificateScoreThisMonth, 88.5);
  assert.equal(r.workspace.locale, "de_DE");
  assert.ok(Date.parse(r.workspace.createdAt) < Date.now() - 300 * 864e5);
});

await check("one-pager wording: numbers, plurals, questions, file names, lead sentence", async () => {
  const { formatNumber, formatPercent, ukPlural, questionText, shortCourseName, languageFor, pdfFileName, buildPageModel } = pdfLib;
  assert.deepEqual([formatNumber(23910, "en"), formatNumber(23910, "de"), formatNumber(23910, "uk")], ["23,910", "23.910", "23 910"]);
  assert.deepEqual([formatPercent(15.8, "de", 1), formatPercent(11, "en", 1, true), formatPercent(85, "uk")], ["15,8 %", "11.0%", "85%"]);
  assert.deepEqual([1, 3, 11, 21, 180].map((n) => ukPlural(n, "курс", "курси", "курсів")), ["курс", "курси", "курсів", "курс", "курсів"]);
  assert.equal(questionText("48213"), null, "an id is not a question");
  assert.equal(questionText("<p>Within how many hours must a breach be reported?</p>"), "Within how many hours must a breach be reported?");
  assert.equal(questionText("It makes sense to borrow competitors keywords when"), "It makes sense to borrow competitors keywords when…", "cut text marked");
  assert.equal(questionText('It makes sense to "borrow" competitors\' keywords...'), 'It makes sense to "borrow" competitors\' keywords…');
  assert.equal(shortCourseName("Старша профільна школа: базове навчання для педагогічних працівників"), "Старша профільна школа");
  assert.deepEqual([languageFor(undefined, "uk_UA"), languageFor({ language: "en" }, "de_DE"), languageFor(undefined, "fr_FR")], ["uk", "en", "en"]);
  assert.equal(pdfFileName("SE Ranking", "2026-09", "x"), "SE-Ranking_Workademy_report_2026-09.pdf");
  assert.equal(pdfFileName("Café Rynok", "2026-09", "x"), "Cafe-Rynok_Workademy_report_2026-09.pdf");
  assert.equal(pdfFileName("ЕдЕра", "2026-09", "edera"), "edera_Workademy_report_2026-09.pdf", "Latin file names only");

  const base = (over) => ({
    period: { month: "2026-09", end: "2026-09-30T23:59:59.999Z" },
    sources: { enrollments: "analytics API" },
    headline: { newEnrollmentsThisMonth: 100, completionsThisMonth: 40, certificatesThisMonth: 30, avgCertificateScoreThisMonth: 91, activeUsers: 80 },
    topCoursesThisMonth: [{ course: "Onboarding: first week", enrolled: 30, finished: 20 }, { course: "Safety", enrolled: 25, finished: 10 }],
    coursesActiveThisMonth: 6,
    ...over,
  });
  const kind = (report, language = "en") => buildPageModel(report, { language, client: "X" });
  assert.equal(kind(base({ topCoursesThisMonth: [{ course: "Onboarding: first week", enrolled: 60, finished: 5 }] })).headlineKind, "share");
  assert.match(kind(base({ topCoursesThisMonth: [{ course: "Onboarding: first week", enrolled: 60, finished: 5 }] }), "uk").headline, /^Понад половина вересневих записів \(60%\) — на курс «Onboarding»\.$/);
  assert.equal(kind(base({ previousMonth: { month: "2026-08", newEnrollments: 90, completions: 20 } })).headlineKind, "finished_up");
  assert.equal(kind(base({ previousMonth: { month: "2026-08", newEnrollments: 90, completions: 20 } })).headline, "40 courses finished in September, 100% more than in August.");
  assert.equal(kind(base({ previousMonth: { month: "2026-08", newEnrollments: 50, completions: 40 } })).headlineKind, "enrolled_up");
  assert.equal(kind(base({ previousMonth: { month: "2026-08", newEnrollments: 150, completions: 60 } })).headlineKind, "busiest", "no bad news in the lead");
  assert.equal(kind(base({ headline: { newEnrollmentsThisMonth: 0, completionsThisMonth: 0 }, topCoursesThisMonth: [] })).headlineKind, "quiet");
  assert.equal(buildPageModel(base({}), { language: "de", client: "X", headline: "Eigener Satz." }).headline, "Eigener Satz.");
  const model = kind(base({}));
  assert.deepEqual(model.kpis.map((k) => k.label), ["new enrolments", "courses finished", "certificates, avg. score 91%", "active learners"]);
  assert.equal(model.table.lastColumn, null, "no completion or score column without the data");
  const html = pdfLib.buildHtml({ ...model, client: "<script>x</script>" }, { fontCss: "", workademyLogo: "", clientLogo: null });
  assert.ok(!html.includes("<script>x"), "names are escaped");
  assert.match(html, /6 more courses|4 more courses/);
});

await check("create_monthly_report_pdf: one A4 page in the workspace's language", async () => {
  if (!chrome) return console.log("       (no Chrome or Chromium on this machine: PDF checks skipped)");
  const r = await call(mcp, "create_monthly_report_pdf", {});
  assert.equal(r.language, "de", "the mock workspace's locale is de_DE");
  assert.deepEqual([r.pages, r.fitsOnePage], [1, true]);
  assert.equal(fs.readFileSync(r.pdfPath).subarray(0, 5).toString(), "%PDF-");
  assert.ok(r.pdfPath.startsWith(path.join(tmp, "reports")), "saved in WORKADEMY_REPORTS_DIR");
  assert.match(path.basename(r.pdfPath), /^EdEra_Workademy_report_\d{4}-\d{2}\.pdf$/);
  assert.equal(r.headlineKind, "share");
  assert.match(r.headline, /^Mehr als die Hälfte der Einschreibungen im \S+ \(63 %\) entfiel auf einen Kurs: „Safety instruction“\.$/);
  assert.deepEqual(r.sendRecommendation, { send: true, reason: "14 completions (threshold 5)" });
  assert.ok(r.warnings.some((w) => w.startsWith("No usable client logo")), "unreachable logos fall back to the name");
  const uk = await call(mcp, "create_monthly_report_pdf", { language: "uk", headline: "Свій перший рядок." });
  assert.deepEqual([uk.language, uk.headlineKind, uk.pages], ["uk", "custom", 1]);
});

await check("monthly report without analytics access falls back to the core API", async () => {
  const started = Date.now();
  const r = await call(mcp, "get_monthly_report", { workspace: "client", month: thisMonth });
  assert.ok(Date.now() - started < 2500, "a slow count must not hold up the report");
  assert.equal(r.adminTodos.ungradedOpenAnswers, null);
  assert.ok(r.warnings.some((w) => w === "ungraded open answers: timed out"), "says the count was skipped");
  assert.match(r.sources.enrollments, /core API/);
  assert.equal(r.struggleHotspots, null);
  assert.ok(r.warnings.some((w) => w.includes("Analytics API not available")));
  const dp = r.courses.find((c) => c.courseId === 101);
  assert.deepEqual([dp.toDate.enrolled, dp.toDate.finished, dp.toDate.completionRate], [150, 120, 80]);
  assert.equal(dp.thisMonth.finished, 120);
  assert.equal(r.headline.certificatesThisMonth, null);
  const text = JSON.stringify(r);
  for (const name of LEARNER_NAMES) assert.ok(!text.includes(name), `leaked ${name}`);
});

await check("get_course_completion and get_group_course_stats", async () => {
  const c = await call(mcp, "get_course_completion", { courseId: 102 });
  const s = c.courses[0];
  assert.equal(s.enrolled, 20);
  assert.equal(s.finished + s.inProgress + s.notStarted + s.inactive + s.expired + s.abandoned, 20, "buckets add up");
  const g = await call(mcp, "get_group_course_stats", { minGroupSize: 2 });
  assert.deepEqual(g.groups.map((x) => x.group), ["Sales", "Legal"]);
});

await check("export_report waits, downloads and saves the CSV", async () => {
  const e = await call(mcp, "export_report", { scope: "workspace" });
  assert.equal(e.rows, 5);
  assert.ok(e.columns.includes("Course Name") && e.columns.includes("Finished On"));
  assert.ok(fs.existsSync(e.filePath));
  assert.ok(!JSON.stringify(e).includes(LEARNER_NAMES[0]), "names stay in the file, not the tool output");
  await assert.rejects(() => call(mcp, "export_report", { scope: "course" }), /needs: courseId/);

  // September, finished in the month: only the "after" part goes to the API, the end date is applied here
  const before = a.state.log.length;
  const sept = await call(mcp, "export_report", { scope: "workspace", month: "2026-09", periodFilter: "finished" });
  const sent = a.state.log.slice(before).find((x) => x.method === "POST" && x.path.endsWith("/usercourses/_report"));
  assert.match(decodeURIComponent(sent.query), /q=finishTime=ge=1788220800000$/, "no =le= sent to the API");
  assert.equal(sept.rows, 2, "rows finished after 30 Sep (or not finished) removed locally");
  assert.match(sept.notes[0], /3 of 5 rows removed/);

  const sum = await call(mcp, "summarize_export", { filePath: sept.filePath });
  assert.deepEqual(sum.rows, [{ "Course Name": "Data protection refresher", Status: "OK", enrollments: 2, finished: 2, "avg Quiz Progress": 85 }]);
  assert.ok(!JSON.stringify(sum).includes(LEARNER_NAMES[0]));
  await assert.rejects(() => call(mcp, "summarize_export", { filePath: sept.filePath, groupBy: ["Email"] }), /identifies people/);
  await assert.rejects(() => call(mcp, "summarize_export", { filePath: "/etc/passwd" }), /must be a CSV from export_report/);
});

await check("get_workspace_branding reads the workspace's profile.json", async () => {
  const b = await call(mcp, "get_workspace_branding");
  assert.equal(b.found, true);
  assert.equal(b.company, "EdEra (mock)");
  assert.equal(b.colors.primary, "#006fb9");
  assert.equal(b.logos.header, `http://${new URL(a.url).host}/img/logo_header.png`.replace("http://", "https://"), "relative logo made absolute");
});

await check("get_admin_todos", async () => {
  const t = await call(mcp, "get_admin_todos", { workspace: "edera" });
  assert.equal(t.pendingEnrollmentApprovals, 1);
  assert.equal(t.upcomingScheduledRuns[0].item, "Data protection refresher");
});
await mcp.close();

console.log("legacy single-key mode (WORKADEMY_API_KEY + WORKADEMY_BASE_URL)");
const legacy = await connect({ WORKADEMY_API_KEY: "key-a", WORKADEMY_BASE_URL: a.url, WORKADEMY_WORKSPACES_FILE: "none" });
await check("old configuration keeps working, writes allowed", async () => {
  const ws = await call(legacy, "list_configured_workspaces");
  assert.deepEqual(ws.workspaces.map((w) => [w.alias, w.readOnly]), [["default", false]]);
  const courses = await call(legacy, "list_courses", { size: 2 });
  assert.equal(courses.totalElements, 3);
  await call(legacy, "delete_course", { courseId: 103 });
});
await legacy.close();

console.log("key setup script (npm run keys)");
await check("creates keys without printing them; the server picks them up", async () => {
  const setupDir = path.join(tmp, "setup");
  fs.mkdirSync(setupDir);
  const file = path.join(setupDir, "workspaces.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ default: "edera", workspaces: { edera: { id: 10, name: "EdEra", baseUrl: a.url, apiKeyEnv: "KEY_EDERA", readOnly: false } } })
  );
  const run = (only) =>
    runScript(["--file", file, "--host", new URL(a.url).host, "--only", only], {
      WORKADEMY_KEYS_SCHEME: "http",
      WORKADEMY_LOGIN_EMAIL: "olga@example.com",
      WORKADEMY_LOGIN_PASSWORD: "pw-secret",
    });
  const out = await run("client, edera");
  assert.match(out, /created\s+client-mock \(localhost:\d+, id 20\)/);
  assert.match(out, /skipped\s+edera: already has a key/);
  assert.ok(!out.includes("key-new") && !out.includes("pw-secret"), "no secrets in the output");
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(config.workspaces["client-mock"].readOnly, true);
  assert.ok(!JSON.stringify(config).includes("key-new"), "workspaces.json holds no keys");
  const keysFile = path.join(setupDir, "workspaces.keys.json");
  assert.equal(fs.statSync(keysFile).mode & 0o777, 0o600);
  assert.match(JSON.parse(fs.readFileSync(keysFile, "utf8"))["client-mock"], /^key-new-20-/);
  assert.match(b.state.createdKeys[0].comment, /created by olga@example.com/);

  const server = await connect({ WORKADEMY_WORKSPACES_FILE: file, KEY_EDERA: "key-a" });
  try {
    const listed = await call(server, "list_configured_workspaces", { verify: true });
    assert.deepEqual(listed.workspaces.map((w) => [w.alias, w.verified.ok]), [["edera", true], ["client-mock", true]]);
  } finally {
    await server.close();
  }

  assert.match(await run("client"), /skipped\s+client-mock: already has a key/);
  assert.equal(b.state.createdKeys.length, 1, "no second key");
});

await check("wrong password: clear message, password not echoed", async () => {
  let output = "";
  try {
    await runScript(["--list", "--file", path.join(tmp, "x.json"), "--host", new URL(a.url).host], {
      WORKADEMY_KEYS_SCHEME: "http",
      WORKADEMY_LOGIN_EMAIL: "olga@example.com",
      WORKADEMY_LOGIN_PASSWORD: "wrong-pass",
    });
  } catch (error) {
    output = `${error.stdout}${error.stderr}`;
  }
  assert.match(output, /login at .* failed \(400\): Bad credentials/);
  assert.ok(!output.includes("wrong-pass"));
});

console.log("monthly run (npm run reports)");
await check("makes the PDFs, sends quiet accounts to win-back, reports failures, skips internal workspaces", async () => {
  if (!chrome) return console.log("       (no Chrome or Chromium on this machine: skipped)");
  const runDir = path.join(tmp, "run");
  fs.mkdirSync(runDir);
  const file = path.join(runDir, "workspaces.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      workspaces: {
        edera: { id: 10, name: "EdEra", baseUrl: a.url, apiKeyEnv: "KEY_EDERA", report: { client: "EdEra", language: "uk", logo: "assets/workademy-logo.png" } },
        client: { name: "Client", baseUrl: b.url, apiKeyEnv: "KEY_CLIENT", report: { minCompletions: 100000 } },
        // a key the API refuses: every call fails, which must not look like a quiet month
        refused: { id: 20, name: "Refused", baseUrl: b.url, apiKeyEnv: "KEY_REFUSED" },
        demo: { name: "Demo", hostname: "demo.example", report: { skip: true } },
        missing: { hostname: "missing.example", apiKeyEnv: "KEY_NOT_SET" },
      },
    })
  );
  const out = path.join(runDir, "out");
  let stdout = "";
  try {
    ({ stdout } = await promisify(execFile)(process.execPath, [path.join(here, "..", "dist", "cli-reports.js"), "--month", "2026-09", "--out", out], {
      env: { ...baseEnv, WORKADEMY_WORKSPACES_FILE: file, KEY_EDERA: "key-a", KEY_CLIENT: "key-b", KEY_REFUSED: "not-a-key", WORKADEMY_ASSET_CDN: a.url },
      encoding: "utf8",
    }));
    assert.fail("a workspace without a key should make the run exit with an error code");
  } catch (error) {
    if (error.code === "ERR_ASSERTION") throw error;
    stdout = error.stdout ?? "";
  }
  const summary = JSON.parse(fs.readFileSync(path.join(out, "2026-09", "summary.json"), "utf8"));
  assert.deepEqual(
    summary.rows.map((r) => [r.workspace, r.kind]),
    [["edera", "report"], ["client", "winback"], ["refused", "error"], ["demo", "skipped"], ["missing", "error"]],
    stdout
  );
  const edera = summary.rows[0].result;
  assert.deepEqual([edera.language, edera.pages, path.basename(edera.pdfPath)], ["uk", 1, "EdEra_Workademy_report_2026-09.pdf"]);
  assert.ok(fs.existsSync(edera.pdfPath));
  assert.ok(!edera.warnings.some((w) => w.startsWith("No usable client logo")), "logo file from workspaces.json used");
  const md = fs.readFileSync(path.join(out, "2026-09", "summary.md"), "utf8");
  assert.match(md, /## Win-back email instead \(1\)[\s\S]*\*\*Client\*\* \(client\): \d+ completions, below the threshold of 100000/);
  assert.match(md, /## Failed \(2\)\n\n- refused: Workademy refused access \(401\)[^\n]*--only refused\.\n- missing: no API key/);
  assert.ok(md.includes("npm run reports -- --month 2026-09 --only refused,missing"), "ready-to-paste rerun command");
  assert.ok(!fs.existsSync(path.join(out, "2026-09", "refused.report.json")), "no data file for a failed workspace");
  assert.ok(!fs.existsSync(path.join(out, "2026-09", "Client_Workademy_report_2026-09.pdf")), "no PDF for a win-back account");
  for (const alias of ["edera", "client"]) {
    const data = JSON.parse(fs.readFileSync(path.join(out, "2026-09", `${alias}.report.json`), "utf8"));
    assert.equal(data.period.month, "2026-09", "the numbers behind each decision are kept");
    for (const name of LEARNER_NAMES) assert.ok(!JSON.stringify(data).includes(name), `leaked ${name}`);
  }
});

await a.close();
await b.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(process.exitCode ? "\nSMOKE TEST FAILED" : `\nall ${passed} checks passed`);
