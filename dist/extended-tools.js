import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import axios from "axios";
import Papa from "papaparse";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { AGGREGATION_TYPES, FACT_TYPES, fetchFacts, stripHtml, } from "./analytics.js";
const json = (value) => ({
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});
// ---------------------------------------------------------------------------
// Workspace argument + write protection
// ---------------------------------------------------------------------------
/** Tools that change data. They are refused on workspaces marked readOnly. */
export const WRITE_TOOLS = new Set([
    "create_course",
    "update_course",
    "delete_course",
    "clone_course",
    "update_user",
    "enroll_user",
    "complete_user_course",
    "create_group",
    "add_user_to_group",
    "add_course_to_group",
    "create_learning_path",
    "delete_learning_path",
    "create_skill",
    "generate_ai_course",
]);
const NO_WORKSPACE_ARG = new Set(["list_configured_workspaces"]);
export function assertToolAllowed(workspace, toolName) {
    if (workspace.readOnly && WRITE_TOOLS.has(toolName)) {
        throw new McpError(ErrorCode.InvalidRequest, `Workspace "${workspace.alias}" is read-only in this MCP configuration, and "${toolName}" changes data. ` +
            `Set "readOnly": false for this workspace in the workspaces file to allow it.`);
    }
}
/** Adds the optional `workspace` argument to every tool schema. */
export function decorateTools(tools, context) {
    const description = context
        ? `Workspace to use: alias, hostname or id. Defaults to "${context.defaultAlias}". Configured: ${context.aliases.join(", ")}.`
        : "Workspace to use: alias, hostname or id. Defaults to the configured default workspace.";
    return tools.map((tool) => {
        if (NO_WORKSPACE_ARG.has(tool.name))
            return tool;
        const schema = tool.inputSchema ?? { type: "object", properties: {} };
        return {
            ...tool,
            inputSchema: {
                ...schema,
                properties: { workspace: { type: "string", description }, ...(schema.properties ?? {}) },
            },
        };
    });
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;
const num = (value) => {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
};
const round1 = (value) => value === undefined || value === null || !Number.isFinite(Number(value))
    ? null
    : Math.round(Number(value) * 10) / 10;
/** Percentage with one decimal, or null when there is nothing to divide by. */
const rate = (part, whole) => whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
const iso = (ms) => typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null;
const inRange = (ms, start, end) => typeof ms === "number" && ms >= start && ms <= end;
function clampInt(value, fallback, min, max) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(Math.max(n, min), max);
}
/** Accepts epoch ms, "YYYY-MM-DD" or an ISO timestamp. Date-only `end` values mean end of that day (UTC). */
function toEpochMs(value, name, endOfDay = false) {
    if (value === undefined || value === null || value === "")
        return undefined;
    if (typeof value === "number")
        return value;
    const text = String(value).trim();
    if (/^\d{10,}$/.test(text))
        return Number(text);
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
    const ms = Date.parse(dateOnly ? `${text}T00:00:00Z` : text);
    if (Number.isNaN(ms)) {
        throw new McpError(ErrorCode.InvalidParams, `${name} must be a date like 2026-09-30 or an ISO timestamp`);
    }
    return dateOnly && endOfDay ? ms + DAY_MS - 1 : ms;
}
/** Calendar month in UTC. No month = the previous full month. */
function monthRange(month) {
    let year;
    let monthIndex;
    if (month) {
        const match = /^(\d{4})-(\d{2})$/.exec(String(month).trim());
        if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
            throw new McpError(ErrorCode.InvalidParams, `month must look like 2026-09`);
        }
        year = Number(match[1]);
        monthIndex = Number(match[2]) - 1;
    }
    else {
        const now = new Date();
        year = now.getUTCFullYear();
        monthIndex = now.getUTCMonth() - 1;
        if (monthIndex < 0) {
            monthIndex = 11;
            year -= 1;
        }
    }
    return {
        label: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
        start: Date.UTC(year, monthIndex, 1),
        end: Date.UTC(year, monthIndex + 1, 1) - 1,
    };
}
function statusOf(error) {
    return axios.isAxiosError(error) ? error.response?.status : undefined;
}
function messageOf(error) {
    if (axios.isAxiosError(error)) {
        const data = error.response?.data;
        const detail = data?.message ?? data?.error_description ?? data?.error ?? error.message;
        return `${error.response?.status ?? ""} ${detail}`.trim();
    }
    return error instanceof Error ? error.message : String(error);
}
async function safe(label, warnings, fn) {
    try {
        return await fn();
    }
    catch (error) {
        warnings.push(`${label}: ${messageOf(error)}`);
        return null;
    }
}
async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}
async function fetchAllPages(client, apiPath, params = {}, options = {}) {
    const pageSize = options.pageSize ?? 100;
    const maxPages = options.maxPages ?? 50;
    const items = [];
    let total = 0;
    let page = 0;
    let truncated = false;
    for (;;) {
        const response = await client.request("GET", apiPath, {
            params: { ...params, page, size: pageSize },
        });
        const content = response?.content ?? [];
        items.push(...content);
        total = response?.totalElements ?? items.length;
        const lastPage = response?.last ??
            (response?.totalPages !== undefined ? page >= response.totalPages - 1 : content.length < pageSize);
        if (lastPage || content.length === 0)
            break;
        page += 1;
        if (page >= maxPages) {
            truncated = true;
            break;
        }
    }
    return { items, total, truncated };
}
async function countOf(client, apiPath, params = {}) {
    const response = await client.request("GET", apiPath, { params: { ...params, page: 0, size: 1 } });
    return response?.totalElements ?? response?.content?.length ?? 0;
}
async function waitForOperation(client, operationId, timeoutMs = 10 * 60 * 1000) {
    const interval = Number(process.env.WORKADEMY_POLL_INTERVAL_MS ?? 3000);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const operation = await client.request("GET", `/api/v1/secured/operations/${operationId}`);
        if (operation?.status === "FINISHED")
            return operation;
        if (operation?.status === "FAILED") {
            throw new Error(`Export failed: ${operation.description ?? "unknown error"}`);
        }
        if (Date.now() > deadline) {
            throw new Error(`Export ${operationId} is still ${operation?.status} after ${Math.round(timeoutMs / 1000)}s. Check it later with get_operation.`);
        }
        await new Promise((resolve) => setTimeout(resolve, interval));
    }
}
class EnrollmentStats {
    enrolled = 0;
    finished = 0;
    inProgress = 0;
    notStarted = 0;
    inactive = 0;
    expired = 0;
    abandoned = 0;
    enrolledInPeriod = 0;
    startedInPeriod = 0;
    finishedInPeriod = 0;
    minutesSum = 0;
    minutesCount = 0;
    scoreSum = 0;
    scoreCount = 0;
    add(userCourse, period) {
        this.enrolled += 1;
        const status = userCourse?.progressStatus;
        // Mutually exclusive buckets that add up to `enrolled`
        if (status === "FINISHED" || userCourse?.finishTime)
            this.finished += 1;
        else if (userCourse?.abandoned)
            this.abandoned += 1;
        else if (status === "EXPIRED")
            this.expired += 1;
        else if (status === "INACTIVE")
            this.inactive += 1;
        else if (!userCourse?.startTime)
            this.notStarted += 1;
        else
            this.inProgress += 1;
        if (period) {
            if (inRange(userCourse?.createTime, period.start, period.end))
                this.enrolledInPeriod += 1;
            if (inRange(userCourse?.startTime, period.start, period.end))
                this.startedInPeriod += 1;
            if (inRange(userCourse?.finishTime, period.start, period.end))
                this.finishedInPeriod += 1;
        }
        if (typeof userCourse?.completedInMinutes === "number" && userCourse.completedInMinutes > 0) {
            this.minutesSum += userCourse.completedInMinutes;
            this.minutesCount += 1;
        }
        if (num(userCourse?.questionAnswersSize) > 0) {
            this.scoreSum += num(userCourse.rightQuestionAnswers) / num(userCourse.questionAnswersSize);
            this.scoreCount += 1;
        }
    }
    toJSON(includePeriod) {
        return {
            enrolled: this.enrolled,
            finished: this.finished,
            inProgress: this.inProgress,
            notStarted: this.notStarted,
            inactive: this.inactive,
            expired: this.expired,
            abandoned: this.abandoned,
            completionRate: rate(this.finished, this.enrolled),
            avgMinutesToComplete: this.minutesCount ? Math.round(this.minutesSum / this.minutesCount) : null,
            avgQuizScorePercent: this.scoreCount ? Math.round((this.scoreSum / this.scoreCount) * 1000) / 10 : null,
            ...(includePeriod
                ? {
                    enrolledInPeriod: this.enrolledInPeriod,
                    startedInPeriod: this.startedInPeriod,
                    finishedInPeriod: this.finishedInPeriod,
                }
                : {}),
        };
    }
}
async function courseEnrollmentStats(client, courseId, period, maxPages = 30) {
    const { items, truncated } = await fetchAllPages(client, `/api/v1/secured/courses/${courseId}/usercourses`, {}, { maxPages });
    const stats = new EnrollmentStats();
    for (const userCourse of items)
        stats.add(userCourse, period);
    return { stats, truncated };
}
async function loadCourseNames(client) {
    const { items } = await fetchAllPages(client, "/api/v1/secured/courses");
    return { names: new Map(items.map((c) => [c.id, stripHtml(c.name)])), items };
}
/**
 * Per-department (group) completion, aggregated. Groups below `minGroupSize` members and
 * group/course cells below `minGroupSize` enrollments are suppressed so nobody can be singled out.
 */
async function groupStats(client, group, options) {
    const { items, truncated } = await fetchAllPages(client, `/api/v1/secured/groups/${group.id}/usercourses`, {}, { maxPages: 20 });
    const members = typeof group.userCount === "number"
        ? group.userCount
        : new Set(items.map((uc) => uc.username ?? uc.name ?? uc.id)).size;
    if (members < options.minGroupSize) {
        return { hidden: true };
    }
    const byCourse = new Map();
    for (const userCourse of items) {
        const courseId = userCourse?.course?.id ?? userCourse?.courseId;
        if (courseId === undefined || courseId === null)
            continue;
        if (options.courseId !== undefined && courseId !== options.courseId)
            continue;
        if (!byCourse.has(courseId))
            byCourse.set(courseId, new EnrollmentStats());
        byCourse.get(courseId).add(userCourse, options.period);
    }
    let suppressedCourses = 0;
    const courses = [];
    for (const [courseId, stats] of byCourse) {
        if (stats.enrolled < options.minGroupSize) {
            suppressedCourses += 1;
            continue;
        }
        const s = stats.toJSON(Boolean(options.period));
        courses.push({
            courseId,
            course: options.courseNames.get(courseId) ?? String(courseId),
            enrolled: s.enrolled,
            finished: s.finished,
            open: s.enrolled - s.finished - s.abandoned,
            completionRate: s.completionRate,
            ...(options.period ? { finishedInPeriod: s.finishedInPeriod } : {}),
        });
    }
    courses.sort((a, b) => b.enrolled - a.enrolled);
    return {
        hidden: false,
        groupId: group.id,
        group: stripHtml(group.name),
        source: group.source ?? null,
        members,
        courses,
        suppressedCourses,
        truncated,
    };
}
async function upcomingSchedules(client, daysAhead) {
    const { items } = await fetchAllPages(client, "/api/v1/secured/schedules", {}, { maxPages: 5 });
    const now = Date.now();
    const until = now + daysAhead * DAY_MS;
    return items
        .filter((s) => typeof s.nextExecutionTime === "number" && s.nextExecutionTime >= now && s.nextExecutionTime <= until)
        .sort((a, b) => a.nextExecutionTime - b.nextExecutionTime)
        .map((s) => ({
        item: stripHtml(s.course?.name ?? s.learningPath?.name ?? s.name ?? "") || null,
        type: s["@type"] ?? (s.course ? "COURSE" : s.learningPath ? "LEARNING_PATH" : null),
        nextRun: iso(s.nextExecutionTime),
        repeats: s.period ?? null,
    }));
}
async function adminTodoCounts(client, warnings) {
    const approvals = await safe("enrollment approvals", warnings, () => fetchAllPages(client, "/api/v1/secured/enrollment-approvals", {}, { maxPages: 5 }));
    const ungraded = await safe("ungraded answers", warnings, () => countOf(client, "/api/v1/secured/ucqas/_ungraded-open-ended-answers"));
    return {
        pendingEnrollmentApprovals: approvals ? approvals.items.filter((a) => a.approved !== true).length : null,
        ungradedOpenAnswers: ungraded,
    };
}
// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------
export async function listConfiguredWorkspaces(registry, clientFor, args) {
    const workspaces = await Promise.all(registry.workspaces.map(async (workspace) => {
        const described = registry.describe(workspace);
        if (args?.verify) {
            try {
                const client = clientFor(workspace);
                const id = await client.getWorkspaceId();
                if (workspace.id === undefined)
                    workspace.id = id; // lets later calls select it by id
                const me = await client.request("GET", "/api/v1/secured/users/me");
                described.verified = { ok: true, workspaceId: id, roles: (me?.roles ?? []).map((r) => r.name) };
            }
            catch (error) {
                described.verified = { ok: false, error: messageOf(error) };
            }
        }
        return described;
    }));
    return json({ default: registry.defaultAlias, workspaces });
}
async function workspaceSummary(ctx) {
    const { client } = ctx;
    const warnings = [];
    const id = await client.getWorkspaceId();
    const info = await safe("workspace", warnings, () => client.request("GET", `/api/v1/secured/workspaces/${id}`));
    const courses = await safe("courses", warnings, () => fetchAllPages(client, "/api/v1/secured/courses"));
    const users = await safe("users", warnings, () => countOf(client, "/api/v1/secured/users"));
    const groups = await safe("groups", warnings, () => fetchAllPages(client, "/api/v1/secured/groups"));
    const learningPaths = await safe("learning paths", warnings, () => countOf(client, "/api/v1/secured/learningpaths"));
    const invitations = await safe("invitations", warnings, () => fetchAllPages(client, `/api/v1/secured/workspaces/${id}/usersaccess`, {}, { maxPages: 20 }));
    const courseItems = courses?.items ?? [];
    const countCourses = (test) => courseItems.filter(test).length;
    const since30 = Date.now() - 30 * DAY_MS;
    const bySource = {};
    for (const g of groups?.items ?? []) {
        const source = g.source ?? "WORKADEMY";
        bySource[source] = (bySource[source] ?? 0) + 1;
    }
    return {
        workspace: {
            alias: ctx.workspace.alias,
            id,
            name: info?.name ?? ctx.workspace.name ?? null,
            hostname: info?.hostname ?? null,
            createdAt: iso(info?.createTime),
            locale: info?.locale ?? null,
        },
        courses: courses
            ? {
                total: courses.total,
                published: countCourses((c) => c.published === true),
                active: countCourses((c) => c.active === true),
                archived: countCourses((c) => c.archived === true),
                templates: countCourses((c) => c.template === true),
                createdLast30Days: countCourses((c) => num(c.createTime) >= since30),
            }
            : null,
        users,
        groups: groups ? { total: groups.total, bySource } : null,
        learningPaths,
        invitations: invitations
            ? {
                total: invitations.total,
                accepted: invitations.items.filter((i) => i.accepted === true).length,
                sent: invitations.items.filter((i) => i.sent === true).length,
                countedFromFirst: invitations.truncated ? invitations.items.length : undefined,
            }
            : null,
        warnings,
    };
}
async function analyticsQuery(ctx, args) {
    const fact = args.fact;
    if (!FACT_TYPES.includes(fact)) {
        throw new McpError(ErrorCode.InvalidParams, `fact must be one of: ${FACT_TYPES.join(", ")}`);
    }
    const end = toEpochMs(args.end, "end", true) ?? Date.now();
    const start = toEpochMs(args.start, "start") ?? end - 30 * DAY_MS;
    const query = {
        fact,
        courseId: args.courseId,
        moduleId: args.moduleId,
        lectureId: args.lectureId,
        breakdown: args.breakdown,
        timeseries: Boolean(args.timeseries),
        start,
        end,
        aggregationType: args.aggregationType ?? (args.timeseries ? "DAY" : "MONTH"),
        page: args.page,
        size: args.size ?? 50,
        sort: args.sort ?? (args.timeseries ? "timestamp" : undefined),
        sortDir: args.sortDir ?? (args.timeseries ? "asc" : undefined),
    };
    let result;
    try {
        result = await fetchFacts(ctx.client, await ctx.client.getWorkspaceId(), query);
    }
    catch (error) {
        if (error instanceof Error && !axios.isAxiosError(error)) {
            throw new McpError(ErrorCode.InvalidParams, error.message);
        }
        throw error;
    }
    return {
        workspace: ctx.workspace.alias,
        period: { start: iso(start), end: iso(end) },
        request: { path: result.path, params: result.params },
        rows: result.rows,
        data: result.data,
        page: result.page,
    };
}
async function courseCompletion(ctx, args) {
    const { client } = ctx;
    const end = toEpochMs(args.end, "end", true);
    const start = toEpochMs(args.start, "start");
    const period = start !== undefined || end !== undefined ? { start: start ?? 0, end: end ?? Date.now() } : undefined;
    const warnings = [];
    const { names, items } = await loadCourseNames(client);
    const courseIds = args.courseId !== undefined ? [Number(args.courseId)] : items.map((c) => c.id);
    const limit = clampInt(args.maxCourses, 50, 1, 200);
    if (courseIds.length > limit) {
        warnings.push(`Only the first ${limit} of ${courseIds.length} courses were included (maxCourses).`);
    }
    const rows = await mapLimit(courseIds.slice(0, limit), 4, async (courseId) => {
        const result = await safe(`course ${courseId}`, warnings, () => courseEnrollmentStats(client, courseId, period));
        if (!result)
            return null;
        if (result.truncated)
            warnings.push(`course ${courseId}: more than 3,000 enrollments, counted the first 3,000`);
        return { courseId, course: names.get(courseId) ?? String(courseId), ...result.stats.toJSON(Boolean(period)) };
    });
    const courses = rows
        .filter((r) => r !== null && (args.courseId !== undefined || r.enrolled > 0))
        .sort((a, b) => b.enrolled - a.enrolled);
    return {
        workspace: ctx.workspace.alias,
        period: period ? { start: iso(period.start), end: iso(period.end) } : null,
        note: "Counts only. Buckets (finished, inProgress, notStarted, inactive, expired, abandoned) add up to enrolled.",
        courses,
        coursesWithoutEnrollments: args.courseId !== undefined ? undefined : rows.filter((r) => r && r.enrolled === 0).length,
        warnings,
    };
}
async function groupCourseStats(ctx, args) {
    const { client } = ctx;
    const warnings = [];
    const minGroupSize = clampInt(args.minGroupSize, 5, 1, 100);
    const end = toEpochMs(args.end, "end", true);
    const start = toEpochMs(args.start, "start");
    const period = start !== undefined || end !== undefined ? { start: start ?? 0, end: end ?? Date.now() } : undefined;
    const { names } = await loadCourseNames(client);
    let groups;
    if (args.groupId !== undefined) {
        groups = [await client.request("GET", `/api/v1/secured/groups/${args.groupId}`)];
    }
    else {
        groups = (await fetchAllPages(client, "/api/v1/secured/groups")).items;
    }
    const limit = clampInt(args.maxGroups, 25, 1, 100);
    const ordered = [...groups].sort((a, b) => num(b.userCount) - num(a.userCount));
    if (ordered.length > limit)
        warnings.push(`Only the ${limit} largest of ${ordered.length} groups were included (maxGroups).`);
    const results = await mapLimit(ordered.slice(0, limit), 3, (group) => safe(`group ${group.id}`, warnings, () => groupStats(client, group, {
        period,
        minGroupSize,
        courseNames: names,
        courseId: args.courseId !== undefined ? Number(args.courseId) : undefined,
    })));
    const shown = results.filter((r) => r !== null && !r.hidden);
    return {
        workspace: ctx.workspace.alias,
        period: period ? { start: iso(period.start), end: iso(period.end) } : null,
        privacy: `Aggregates only. Groups with fewer than ${minGroupSize} members and group/course cells with fewer than ${minGroupSize} enrollments are hidden.`,
        groups: shown,
        hiddenGroups: results.filter((r) => r !== null && r.hidden).length,
        warnings,
    };
}
const EXPORT_SCOPES = {
    workspace: { needs: [], path: (_a, id) => `/api/v1/secured/workspaces/${id}/usercourses/_report` },
    course: { needs: ["courseId"], path: (a) => `/api/v1/secured/courses/${a.courseId}/usercourses/_report` },
    group: { needs: ["groupId"], path: (a) => `/api/v1/secured/groups/${a.groupId}/usercourses/_report` },
    group_course: {
        needs: ["groupId", "courseId"],
        path: (a) => `/api/v1/secured/groups/${a.groupId}/courses/${a.courseId}/usercourses/_report`,
    },
    user: { needs: ["userId"], path: (a) => `/api/v1/secured/users/${a.userId}/usercourses/_report` },
    learning_path: {
        needs: ["learningPathId"],
        path: (a) => `/api/v1/secured/learningpaths/${a.learningPathId}/userlearningpaths/_report`,
    },
    group_learning_path: {
        needs: ["learningPathId", "groupId"],
        path: (a) => `/api/v1/secured/learningpaths/${a.learningPathId}/groups/${a.groupId}/userlearningpaths/_report`,
    },
};
async function exportReport(ctx, args) {
    const scope = EXPORT_SCOPES[args.scope];
    if (!scope) {
        throw new McpError(ErrorCode.InvalidParams, `scope must be one of: ${Object.keys(EXPORT_SCOPES).join(", ")}`);
    }
    const missing = scope.needs.filter((key) => args[key] === undefined || args[key] === null);
    if (missing.length) {
        throw new McpError(ErrorCode.InvalidParams, `scope "${args.scope}" needs: ${missing.join(", ")}`);
    }
    const { client } = ctx;
    const workspaceId = await client.getWorkspaceId();
    const operation = await client.request("POST", scope.path(args, workspaceId), {
        params: args.type ? { type: args.type } : undefined,
        data: { outputType: "CSV" },
    });
    const finished = await waitForOperation(client, operation.id);
    if (!finished.url) {
        return { workspace: ctx.workspace.alias, operation: finished, note: "Export finished but returned no download URL." };
    }
    const csv = await client.download(finished.url);
    const dir = process.env.WORKADEMY_EXPORT_DIR || path.join(os.tmpdir(), "workademy-mcp-exports");
    await fs.mkdir(dir, { recursive: true });
    const ids = scope.needs.map((key) => args[key]).join("_");
    const filePath = path.join(dir, `${ctx.workspace.alias}_${args.scope}${ids ? "_" + ids : ""}_${Date.now()}.csv`);
    await fs.writeFile(filePath, csv, "utf8");
    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
    return {
        workspace: ctx.workspace.alias,
        scope: args.scope,
        filePath,
        rows: parsed.data.length,
        columns: parsed.meta.fields ?? [],
        note: "The file contains named learner data. It stays on this computer; share aggregates, not the file.",
    };
}
async function adminTodos(ctx, args) {
    const warnings = [];
    const daysAhead = clampInt(args.daysAhead, 31, 1, 366);
    const counts = await adminTodoCounts(ctx.client, warnings);
    const upcoming = await safe("schedules", warnings, () => upcomingSchedules(ctx.client, daysAhead));
    return { workspace: ctx.workspace.alias, ...counts, upcomingScheduledRuns: upcoming, warnings };
}
async function monthlyReport(ctx, args) {
    const { client } = ctx;
    const period = monthRange(args.month);
    const minGroupSize = clampInt(args.minGroupSize, 5, 1, 100);
    const topQuestions = clampInt(args.topQuestions, 3, 1, 20);
    const includeDepartments = args.includeDepartments !== false;
    const warnings = [];
    const sources = {};
    const workspaceId = await client.getWorkspaceId();
    const info = await safe("workspace", warnings, () => client.request("GET", `/api/v1/secured/workspaces/${workspaceId}`));
    const since = typeof info?.createTime === "number" ? info.createTime : 0;
    const courseList = await safe("courses", warnings, () => loadCourseNames(client));
    const courseNames = courseList?.names ?? new Map();
    const userCount = await safe("users", warnings, () => countOf(client, "/api/v1/secured/users"));
    const groupList = await safe("groups", warnings, () => fetchAllPages(client, "/api/v1/secured/groups"));
    // --- Analytics service (same numbers the client sees on their dashboard) ---
    let analyticsAvailable = true;
    const facts = async (label, query) => {
        if (!analyticsAvailable)
            return null;
        try {
            return await fetchFacts(client, workspaceId, query);
        }
        catch (error) {
            const status = statusOf(error);
            if (status === 401 || status === 403 || status === 404) {
                analyticsAvailable = false;
                warnings.push(`Analytics API not available for this workspace (${messageOf(error)}). ` +
                    "Enrollment numbers were computed from the core API; logins, activity and question hotspots are missing.");
            }
            else {
                warnings.push(`analytics ${label}: ${messageOf(error)}`);
            }
            return null;
        }
    };
    const periodWindow = { start: period.start, end: period.end };
    const toDateWindow = { start: since, end: period.end };
    const enrollToDate = await facts("enrollments to date", {
        fact: "usercourse",
        breakdown: "course",
        ...toDateWindow,
        aggregationType: "YEAR",
        size: 500,
    });
    const enrollPeriod = await facts("enrollments this month", {
        fact: "usercourse",
        breakdown: "course",
        ...periodWindow,
        aggregationType: "MONTH",
        size: 500,
    });
    const certsPeriod = await facts("certificates", {
        fact: "certificate",
        breakdown: "course",
        ...periodWindow,
        aggregationType: "MONTH",
        size: 500,
    });
    const usersPeriod = await facts("logins", { fact: "workspace_users", ...periodWindow, aggregationType: "MONTH" });
    const activity = await facts("activity", { fact: "activity", ...periodWindow, aggregationType: "MONTH" });
    let courses = [];
    if (enrollToDate?.rows) {
        sources.enrollments = "analytics API";
        const periodByCourse = new Map((enrollPeriod?.rows ?? []).map((r) => [r.courseId, r]));
        const certsByCourse = new Map((certsPeriod?.rows ?? []).map((r) => [r.courseId, r]));
        courses = enrollToDate.rows.map((r) => {
            const p = periodByCourse.get(r.courseId) ?? {};
            const c = certsByCourse.get(r.courseId) ?? {};
            const enrolled = num(r.amountStarted);
            const finished = num(r.amountEnded);
            const abandoned = num(r.amountAbandoned);
            return {
                courseId: r.courseId,
                course: r.courseName ?? courseNames.get(r.courseId) ?? String(r.courseId),
                toDate: {
                    enrolled,
                    started: num(r.amountMsCourseStarted),
                    finished,
                    abandoned,
                    open: Math.max(enrolled - finished - abandoned, 0),
                    completionRate: rate(finished, enrolled),
                    avgDaysToFinish: round1(r.avgDaysBetweenEnded),
                },
                thisMonth: {
                    enrolled: num(p.amountStarted),
                    started: num(p.amountMsCourseStarted),
                    finished: num(p.amountEnded),
                    abandoned: num(p.amountAbandoned),
                    certificatesIssued: num(c.amountIssued),
                    avgCertificateScore: round1(c.avgScore),
                },
            };
        });
    }
    else if (courseList) {
        sources.enrollments = "core API (computed from enrollment records)";
        const ids = courseList.items.map((c) => c.id);
        if (ids.length > 60)
            warnings.push(`Only the first 60 of ${ids.length} courses were counted.`);
        const results = await mapLimit(ids.slice(0, 60), 4, async (courseId) => ({
            courseId,
            result: await safe(`course ${courseId} enrollments`, warnings, () => courseEnrollmentStats(client, courseId, periodWindow)),
        }));
        for (const { courseId, result } of results) {
            if (!result)
                continue;
            if (result.truncated)
                warnings.push(`course ${courseId}: counted the first 3,000 enrollments only`);
            const s = result.stats.toJSON(true);
            courses.push({
                courseId,
                course: courseNames.get(courseId) ?? String(courseId),
                toDate: {
                    enrolled: s.enrolled,
                    started: s.enrolled - s.notStarted,
                    finished: s.finished,
                    abandoned: s.abandoned,
                    open: s.enrolled - s.finished - s.abandoned,
                    completionRate: s.completionRate,
                    avgQuizScorePercent: s.avgQuizScorePercent,
                },
                thisMonth: {
                    enrolled: s.enrolledInPeriod ?? 0,
                    started: s.startedInPeriod ?? 0,
                    finished: s.finishedInPeriod ?? 0,
                },
            });
        }
    }
    const withoutEnrollments = (courseList?.items.length ?? 0) - courses.filter((c) => num(c.toDate.enrolled) > 0).length;
    courses = courses.filter((c) => num(c.toDate.enrolled) > 0).sort((a, b) => num(b.toDate.enrolled) - num(a.toDate.enrolled));
    const sum = (pick) => courses.reduce((total, c) => total + num(pick(c)), 0);
    const enrolledToDate = sum((c) => c.toDate.enrolled);
    const finishedToDate = sum((c) => c.toDate.finished);
    // --- Where people struggle: drill course -> module -> lecture -> question on wrong answers ---
    let hotspots = null;
    if (analyticsAvailable && courses.length > 0) {
        sources.questions = "analytics API";
        const candidates = courses.slice(0, 5).map((c) => c.courseId);
        const quiet = (query) => safe(`questions ${query.courseId}/${query.moduleId ?? ""}/${query.lectureId ?? ""}`, warnings, () => fetchFacts(client, workspaceId, query));
        const byWrong = (a, b) => num(b.amountWrong) - num(a.amountWrong);
        const collect = async (window) => {
            const found = [];
            const base = { fact: "questionanswer", ...window, aggregationType: "MONTH", size: 200 };
            await mapLimit(candidates, 2, async (courseId) => {
                const modules = await quiet({ ...base, courseId });
                const topModules = (modules?.rows ?? []).filter((r) => num(r.amountWrong) > 0).sort(byWrong).slice(0, 2);
                for (const module of topModules) {
                    const lectures = await quiet({ ...base, courseId, moduleId: module.moduleId });
                    const topLectures = (lectures?.rows ?? []).filter((r) => num(r.amountWrong) > 0).sort(byWrong).slice(0, 2);
                    for (const lecture of topLectures) {
                        const questions = await quiet({ ...base, courseId, moduleId: module.moduleId, lectureId: lecture.lectureId });
                        for (const q of questions?.rows ?? []) {
                            const correct = num(q.amountCorrect);
                            const wrong = num(q.amountWrong);
                            if (correct + wrong < minGroupSize || wrong === 0)
                                continue;
                            found.push({
                                course: courseNames.get(courseId) ?? q.courseName ?? String(courseId),
                                module: module.moduleName ?? String(module.moduleId),
                                lecture: lecture.lectureName ?? String(lecture.lectureId),
                                question: q.question ?? String(q.questionAnswerId),
                                correctAnswers: correct,
                                wrongAnswers: wrong,
                                wrongRate: rate(wrong, correct + wrong),
                                avgAttempts: round1(q.avgWrongAttempts),
                            });
                        }
                    }
                }
            });
            return found.sort((a, b) => b.wrongAnswers - a.wrongAnswers || num(b.wrongRate) - num(a.wrongRate));
        };
        let window = "this month";
        let found = await collect(periodWindow);
        if (found.length === 0) {
            window = "since the workspace started (too few answers this month)";
            found = await collect(toDateWindow);
        }
        hotspots = {
            window,
            minAnswers: minGroupSize,
            questions: found.slice(0, topQuestions),
        };
    }
    // --- Departments (groups) ---
    let departments = null;
    if (includeDepartments && groupList) {
        sources.departments = "core API (group enrollments)";
        const ordered = [...groupList.items]
            .filter((g) => typeof g.userCount !== "number" || g.userCount >= minGroupSize)
            .sort((a, b) => num(b.userCount) - num(a.userCount));
        const limited = ordered.slice(0, 25);
        const results = await mapLimit(limited, 3, (group) => safe(`group ${group.id}`, warnings, () => groupStats(client, group, { period: periodWindow, minGroupSize, courseNames })));
        const shown = results.filter((r) => r !== null && !r.hidden);
        departments = {
            shown: shown.map(({ groupId, truncated, ...rest }) => rest),
            hiddenGroups: groupList.items.length - shown.length - (ordered.length - limited.length),
            notIncluded: ordered.length - limited.length,
        };
    }
    // --- Engagement, upcoming, admin to-dos ---
    const engagement = usersPeriod || activity
        ? {
            logins: usersPeriod?.rows ? usersPeriod.rows.reduce((t, r) => t + num(r.amountLogin), 0) : null,
            registrations: usersPeriod?.rows ? usersPeriod.rows.reduce((t, r) => t + num(r.amountRegister), 0) : null,
            activeUsers: activity?.data?.activityCount ?? activity?.rows?.[0]?.activityCount ?? null,
        }
        : null;
    const upcoming = await safe("schedules", warnings, () => upcomingSchedules(client, 31));
    const todos = await adminTodoCounts(client, warnings);
    const certificatesThisMonth = sum((c) => c.thisMonth.certificatesIssued);
    return {
        workspace: {
            alias: ctx.workspace.alias,
            id: workspaceId,
            name: info?.name ?? ctx.workspace.name ?? null,
            hostname: info?.hostname ?? null,
        },
        period: { month: period.label, start: iso(period.start), end: iso(period.end), timezone: "UTC" },
        privacy: `Aggregates only: no names, e-mails or user ids. Departments with fewer than ${minGroupSize} members, ` +
            `department/course cells with fewer than ${minGroupSize} enrollments and questions with fewer than ` +
            `${minGroupSize} answers are left out.`,
        sources,
        headline: {
            learners: userCount,
            coursesWithEnrollments: courses.length,
            enrollmentsToDate: enrolledToDate,
            completionsToDate: finishedToDate,
            completionRateToDate: rate(finishedToDate, enrolledToDate),
            openToDate: sum((c) => c.toDate.open),
            newEnrollmentsThisMonth: sum((c) => c.thisMonth.enrolled),
            completionsThisMonth: sum((c) => c.thisMonth.finished),
            certificatesThisMonth: sources.enrollments === "analytics API" ? certificatesThisMonth : null,
            logins: engagement?.logins ?? null,
            activeUsers: engagement?.activeUsers ?? null,
        },
        courses: courses.slice(0, 25),
        coursesOmitted: Math.max(courses.length - 25, 0),
        coursesWithoutEnrollments: Math.max(withoutEnrollments, 0),
        struggleHotspots: hotspots,
        departments,
        engagement,
        upcomingScheduledRuns: upcoming,
        adminTodos: { ...todos, note: "For the admin's cover email, not for the shareable page." },
        warnings: warnings.slice(0, 20),
    };
}
// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const dateParam = (what) => ({
    type: "string",
    description: `${what} as YYYY-MM-DD (UTC) or an ISO timestamp`,
});
export const EXTENDED_TOOLS = [
    {
        name: "list_configured_workspaces",
        description: "List the workspaces this server is configured for (alias, id, host, read-only flag). Never returns API keys. Use verify=true to test each key.",
        inputSchema: {
            type: "object",
            properties: {
                verify: { type: "boolean", description: "Call each workspace to check the API key works" },
            },
        },
    },
    {
        name: "get_workspace_summary",
        description: "Counts for one workspace: courses (published, active, archived, new in 30 days), users, groups by HR-sync source, learning paths, invitations sent and accepted.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "get_analytics",
        description: "Query Workademy's analytics service (the numbers on the admin dashboard). Facts: usercourse (enrolled amountStarted, started amountMsCourseStarted, finished amountEnded, abandoned amountAbandoned, avgDaysBetweenEnded), certificate (amountIssued, avg/min/maxScore), lecture (amountSeen), questionanswer (amountCorrect, amountWrong, min/avg/maxWrongAttempts), workspace_users (amountLogin, amountRegister), campaign (amountRedeemed), modules, activity (activityCount). Drill down with courseId → moduleId → lectureId. Rows come with names (courseName, moduleName, lectureName, question).",
        inputSchema: {
            type: "object",
            properties: {
                fact: { type: "string", enum: [...FACT_TYPES], description: "Which fact table to query" },
                courseId: { type: "number", description: "Drill into one course" },
                moduleId: { type: "number", description: "Drill into one module (needs courseId); lecture and questionanswer only" },
                lectureId: { type: "number", description: "Drill into one lecture (needs moduleId); questionanswer only" },
                breakdown: {
                    type: "string",
                    enum: ["none", "course", "country", "campaign"],
                    description: "course (default for course facts) = one row per course; none = workspace total; country for workspace_users; campaign for campaign",
                },
                start: dateParam("Period start (default: 30 days before end)"),
                end: dateParam("Period end, inclusive (default: now)"),
                aggregationType: { type: "string", enum: [...AGGREGATION_TYPES], description: "Bucket size, mainly for timeseries" },
                timeseries: { type: "boolean", description: "Return one row per time bucket instead of totals" },
                page: { type: "number", description: "Page number (0-indexed)" },
                size: { type: "number", description: "Rows per page (default 50)" },
                sort: { type: "string", description: "Field to sort by, e.g. amountWrong, amountStarted, timestamp" },
                sortDir: { type: "string", enum: ["asc", "desc"] },
            },
            required: ["fact"],
        },
    },
    {
        name: "get_course_completion",
        description: "Completion per course computed from enrollment records (core API, counts only): enrolled, finished, in progress, not started, inactive, expired, abandoned, completion rate, average minutes to complete, average quiz score. Optional period adds enrolled/started/finished in that period. Works even when the analytics service is unavailable.",
        inputSchema: {
            type: "object",
            properties: {
                courseId: { type: "number", description: "One course (default: all courses with enrollments)" },
                start: dateParam("Optional period start"),
                end: dateParam("Optional period end, inclusive"),
                maxCourses: { type: "number", description: "Cap on courses scanned (default 50)" },
            },
        },
    },
    {
        name: "get_group_course_stats",
        description: "Completion per department (group) and course, aggregated. Groups and cells below minGroupSize are hidden so no individual can be identified.",
        inputSchema: {
            type: "object",
            properties: {
                groupId: { type: "number", description: "One group (default: the largest groups)" },
                courseId: { type: "number", description: "Only this course" },
                start: dateParam("Optional period start (adds finishedInPeriod)"),
                end: dateParam("Optional period end, inclusive"),
                minGroupSize: { type: "number", description: "Minimum group/cell size to show (default 5)" },
                maxGroups: { type: "number", description: "Cap on groups scanned (default 25)" },
            },
        },
    },
    {
        name: "export_report",
        description: "Run a Workademy CSV export, wait for it, download it to this computer and return the file path, row count and columns. Scopes: workspace (all enrollments), course, group, group_course, user, learning_path, group_learning_path. The file contains named learner data.",
        inputSchema: {
            type: "object",
            properties: {
                scope: { type: "string", enum: Object.keys(EXPORT_SCOPES) },
                courseId: { type: "number" },
                groupId: { type: "number" },
                userId: { type: "number" },
                learningPathId: { type: "number" },
                type: { type: "string", enum: ["OVERVIEW", "DETAILED"], description: "Report type where supported" },
            },
            required: ["scope"],
        },
    },
    {
        name: "get_admin_todos",
        description: "Counts the admin should act on: pending enrollment approvals, ungraded open answers, and scheduled course/learning-path runs coming up.",
        inputSchema: {
            type: "object",
            properties: {
                daysAhead: { type: "number", description: "Window for upcoming scheduled runs (default 31)" },
            },
        },
    },
    {
        name: "get_monthly_report",
        description: "Aggregate-only monthly report for one workspace, ready to turn into a client one-pager: headline numbers, per-course enrollments/completions (to date and this month), certificates, logins and active users, the most-missed quiz questions, completion by department (small groups hidden), upcoming scheduled runs, and admin to-dos. No names or user ids.",
        inputSchema: {
            type: "object",
            properties: {
                month: { type: "string", description: "Month as YYYY-MM (UTC). Default: the previous full month" },
                minGroupSize: { type: "number", description: "Hide departments, cells and questions below this size (default 5)" },
                topQuestions: { type: "number", description: "How many most-missed questions to return (default 3)" },
                includeDepartments: { type: "boolean", description: "Include the per-department section (default true)" },
            },
        },
    },
];
const HANDLERS = {
    get_workspace_summary: (ctx) => workspaceSummary(ctx),
    get_analytics: analyticsQuery,
    get_course_completion: courseCompletion,
    get_group_course_stats: groupCourseStats,
    export_report: exportReport,
    get_admin_todos: adminTodos,
    get_monthly_report: monthlyReport,
};
/** Returns null when the tool is not one of the extended tools. */
export async function handleExtendedTool(name, args, ctx) {
    const handler = HANDLERS[name];
    if (!handler)
        return null;
    return json(await handler(ctx, args ?? {}));
}
//# sourceMappingURL=extended-tools.js.map