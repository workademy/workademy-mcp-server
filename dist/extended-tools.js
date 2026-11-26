import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import axios from "axios";
import Papa from "papaparse";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { AGGREGATION_TYPES, FACT_TYPES, fetchFacts, stripHtml, } from "./analytics.js";
import { isRateLimited } from "./pacing.js";
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
    "patch_course",
    "update_lecture",
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
/** Certificate scores come as fractions (0.9) in production; show them as percentages. */
const scorePercent = (value) => value === undefined || value === null || !Number.isFinite(Number(value))
    ? null
    : Number(value) <= 1
        ? Math.round(Number(value) * 1000) / 10
        : Math.round(Number(value) * 10) / 10;
const round1 = (value) => value === undefined || value === null || !Number.isFinite(Number(value))
    ? null
    : Math.round(Number(value) * 10) / 10;
/** Percentage with one decimal, or null when there is nothing to divide by. */
const rate = (part, whole) => whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
const iso = (ms) => typeof ms === "number" && ms >= 0 ? new Date(ms).toISOString() : null;
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
/** Offset of `timeZone` from UTC at instant `ms`, in milliseconds. */
function zoneOffsetMs(ms, timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).formatToParts(new Date(ms));
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - ms;
}
/** UTC instant of local midnight on the given day in `timeZone`. */
function zonedMidnight(year, monthIndex, day, timeZone) {
    if (timeZone === "UTC")
        return Date.UTC(year, monthIndex, day);
    const guess = Date.UTC(year, monthIndex, day);
    let ms = guess - zoneOffsetMs(guess, timeZone);
    ms = guess - zoneOffsetMs(ms, timeZone); // second pass for DST changes
    return ms;
}
function checkTimeZone(timeZone) {
    const zone = typeof timeZone === "string" && timeZone.trim() ? timeZone.trim() : "UTC";
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone });
    }
    catch {
        throw new McpError(ErrorCode.InvalidParams, `Unknown timezone "${zone}" (use an IANA name like Europe/Berlin)`);
    }
    return zone;
}
/** Calendar month (default UTC). No month = the previous full month. */
function monthRange(month, timeZone = "UTC") {
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
        start: zonedMidnight(year, monthIndex, 1, timeZone),
        end: zonedMidnight(year, monthIndex + 1, 1, timeZone) - 1,
    };
}
function statusOf(error) {
    return axios.isAxiosError(error) ? error.response?.status : undefined;
}
function messageOf(error) {
    if (axios.isAxiosError(error) && error.code === "ECONNABORTED") {
        return "timed out";
    }
    if (isRateLimited(error)) {
        return `${statusOf(error)} blocked by Workademy's firewall (too many requests); try again in a few minutes`;
    }
    if (axios.isAxiosError(error)) {
        const data = error.response?.data;
        const detail = data?.message ?? data?.error_description ?? data?.reason ?? data?.error ?? error.message;
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
        if (page >= maxPages || (options.deadline !== undefined && Date.now() > options.deadline)) {
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
/** Members of a group. The group list's userCount is not filled (always 0), so ask the group itself. */
async function memberCount(client, group) {
    if (typeof group.userCount === "number" && group.userCount > 0)
        return group.userCount;
    return countOf(client, `/api/v1/secured/groups/${group.id}/users`);
}
async function groupStats(client, group, options) {
    const members = typeof group.members === "number" ? group.members : await memberCount(client, group);
    if (members < options.minGroupSize) {
        return { hidden: true };
    }
    const { items, truncated } = await fetchAllPages(client, `/api/v1/secured/groups/${group.id}/usercourses`, {}, { maxPages: 20, deadline: options.deadline });
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
        if (!options.courseNames.has(courseId) && userCourse?.course?.name) {
            options.courseNames.set(courseId, stripHtml(userCourse.course.name));
        }
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
/**
 * Completion per department for the largest groups. Member counts first (cheap), then
 * enrollments only for groups big enough to show. Stops at the deadline.
 */
async function departmentStats(client, groups, options) {
    const counted = await mapLimit(groups.slice(0, 200), 6, async (group) => ({
        ...group,
        members: (await safe(`group ${group.id} members`, options.warnings, () => memberCount(client, group))) ?? 0,
    }));
    const eligible = counted.filter((g) => g.members >= options.minGroupSize).sort((a, b) => b.members - a.members);
    const limited = eligible.slice(0, options.limit);
    let skippedForTime = 0;
    const results = await mapLimit(limited, 4, async (group) => {
        if (options.deadline !== undefined && Date.now() > options.deadline) {
            skippedForTime += 1;
            return null;
        }
        return safe(`group ${group.id}`, options.warnings, () => groupStats(client, group, options));
    });
    if (skippedForTime > 0) {
        options.warnings.push(`Departments: ${skippedForTime} group(s) skipped to stay within the time limit.`);
    }
    const shown = results.filter((r) => r !== null && !r.hidden);
    return {
        shown,
        hiddenGroups: counted.length - eligible.length,
        notIncluded: eligible.length - limited.length + skippedForTime,
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
    // This count can take minutes on large workspaces, so it gets its own short limit
    const ungraded = await safe("ungraded open answers", warnings, () => client
        .request("GET", "/api/v1/secured/ucqas/_ungraded-open-ended-answers", {
        params: { page: 0, size: 1 },
        timeoutMs: Number(process.env.WORKADEMY_TODO_TIMEOUT_MS ?? 10_000),
    })
        .then((r) => r?.totalElements ?? 0));
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
    let names = new Map();
    let courseIds;
    if (args.courseId !== undefined) {
        courseIds = [Number(args.courseId)];
        const course = await safe("course", warnings, () => client.request("GET", `/api/v1/secured/courses/${courseIds[0]}`));
        if (course?.name)
            names.set(courseIds[0], stripHtml(course.name));
    }
    else {
        const list = await loadCourseNames(client);
        names = list.names;
        courseIds = list.items.map((c) => c.id);
    }
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
    const names = new Map(); // filled from the enrollment records
    let groups;
    if (args.groupId !== undefined) {
        groups = [await client.request("GET", `/api/v1/secured/groups/${args.groupId}`)];
    }
    else {
        groups = (await fetchAllPages(client, "/api/v1/secured/groups")).items;
    }
    const limit = clampInt(args.maxGroups, 25, 1, 100);
    const result = await departmentStats(client, groups, {
        period,
        minGroupSize,
        courseNames: names,
        courseId: args.courseId !== undefined ? Number(args.courseId) : undefined,
        limit,
        deadline: Date.now() + Number(process.env.WORKADEMY_REPORT_BUDGET_MS ?? 40_000),
        warnings,
    });
    if (result.notIncluded > 0)
        warnings.push(`${result.notIncluded} large enough group(s) were not included (maxGroups or time limit).`);
    return {
        workspace: ctx.workspace.alias,
        period: period ? { start: iso(period.start), end: iso(period.end) } : null,
        privacy: `Aggregates only. Groups with fewer than ${minGroupSize} members and group/course cells with fewer than ${minGroupSize} enrollments are hidden.`,
        groups: result.shown,
        hiddenGroups: result.hiddenGroups,
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
    // Period filter, same RSQL as the admin "Download full report" dialog
    const timeZone = checkTimeZone(args.timezone);
    let start;
    let end;
    if (args.month) {
        ({ start, end } = monthRange(args.month, timeZone));
    }
    else {
        start = toEpochMs(args.start, "start");
        end = toEpochMs(args.end, "end", true);
    }
    // The API currently treats "before" (=lt= / =le=) like "after" on enrollment dates (found Oct 2026),
    // so by default only the "after" part goes to the server and the end date is applied here.
    // Set WORKADEMY_RSQL_BEFORE_FIXED=true once the backend is fixed.
    const serverEnd = process.env.WORKADEMY_RSQL_BEFORE_FIXED === "true";
    const conditions = [];
    const mode = args.periodFilter ?? "started_and_finished";
    let localEnd = null;
    if (start !== undefined || end !== undefined) {
        if (mode === "started_and_finished") {
            // "enrolments started from <start> and finished by <end>" (the dialog's wording)
            if (start !== undefined)
                conditions.push(`createTime=gt=${start}`);
            if (end !== undefined) {
                if (serverEnd)
                    conditions.push(`finishTime=lt=${end}`);
                else
                    localEnd = { column: "Finished On", end };
            }
        }
        else if (mode === "enrolled") {
            if (start !== undefined)
                conditions.push(`createTime=ge=${start}`);
            if (end !== undefined) {
                if (serverEnd)
                    conditions.push(`createTime=le=${end}`);
                else
                    localEnd = { column: "Started On", end };
            }
        }
        else if (mode === "finished") {
            if (start !== undefined)
                conditions.push(`finishTime=ge=${start}`);
            if (end !== undefined) {
                if (serverEnd)
                    conditions.push(`finishTime=le=${end}`);
                else
                    localEnd = { column: "Finished On", end };
            }
        }
        else {
            throw new McpError(ErrorCode.InvalidParams, "periodFilter must be started_and_finished, enrolled or finished");
        }
    }
    if (args.q)
        conditions.push(String(args.q));
    const params = {};
    if (args.type)
        params.type = args.type;
    if (conditions.length)
        params.q = conditions.join(";");
    const operation = await client.request("POST", scope.path(args, workspaceId), {
        params: Object.keys(params).length ? params : undefined,
        data: { outputType: "CSV" },
    });
    const finished = await waitForOperation(client, operation.id);
    if (!finished.url) {
        return { workspace: ctx.workspace.alias, operation: finished, note: "Export finished but returned no download URL." };
    }
    let csv = await client.download(finished.url);
    const notes = [];
    if (localEnd) {
        const all = Papa.parse(csv, { header: true, skipEmptyLines: true });
        if ((all.meta.fields ?? []).includes(localEnd.column)) {
            const kept = all.data.filter((row) => {
                const ms = parseExportDate(row[localEnd.column]);
                return ms !== null && ms <= localEnd.end;
            });
            csv = Papa.unparse(kept, { columns: all.meta.fields });
            notes.push(`End date applied on this side ("${localEnd.column}" <= ${iso(localEnd.end)}): ${all.data.length - kept.length} of ${all.data.length} rows removed. ` +
                "The API's \"before\" filter on enrollment dates returns \"after\" instead.");
        }
        else {
            notes.push(`This export has no "${localEnd.column}" column, so the end date was NOT applied.`);
        }
    }
    const dir = exportDir();
    await fs.mkdir(dir, { recursive: true });
    const ids = scope.needs.map((key) => args[key]).join("_");
    const filePath = path.join(dir, `${ctx.workspace.alias}_${args.scope}${ids ? "_" + ids : ""}_${Date.now()}.csv`);
    await fs.writeFile(filePath, csv, "utf8");
    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
    return {
        workspace: ctx.workspace.alias,
        scope: args.scope,
        filter: params.q ?? null,
        period: start !== undefined || end !== undefined ? { start: iso(start), end: iso(end), timezone: timeZone } : null,
        filePath,
        rows: parsed.data.length,
        columns: parsed.meta.fields ?? [],
        notes,
        note: "The file contains named learner data. It stays on this computer; use summarize_export for counts.",
    };
}
function exportDir() {
    return path.resolve(process.env.WORKADEMY_EXPORT_DIR || path.join(os.tmpdir(), "workademy-mcp-exports"));
}
/** Export dates look like "06.10.2026 11:08:16" and are UTC. */
function parseExportDate(value) {
    const match = /^(\d{2})\.(\d{2})\.(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? "").trim());
    if (!match)
        return null;
    const [, dd, mm, yyyy, hh, mi, ss] = match;
    return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss ?? 0));
}
// Columns that identify a person; summarize_export never groups by them
const PERSONAL_COLUMN = /(^|\b)(name|e-?mail|user ?id|user ?name|username|enrollment ?id|certificate|phone|first ?name|last ?name|login)(\b|$)/i;
const ALLOWED_NAME_COLUMNS = /^(course name|course author|group name|learning path name|module name)$/i;
async function summarizeExport(_ctx, args) {
    const dir = exportDir();
    const filePath = path.resolve(String(args.filePath ?? ""));
    if (!filePath.startsWith(dir + path.sep) || !filePath.endsWith(".csv")) {
        throw new McpError(ErrorCode.InvalidParams, `filePath must be a CSV from export_report (in ${dir})`);
    }
    const parsed = Papa.parse(await fs.readFile(filePath, "utf8"), {
        header: true,
        skipEmptyLines: true,
    });
    const fields = parsed.meta.fields ?? [];
    const groupBy = Array.isArray(args.groupBy) && args.groupBy.length ? args.groupBy : ["Course Name", "Status"];
    for (const column of groupBy) {
        if (!fields.includes(column)) {
            throw new McpError(ErrorCode.InvalidParams, `No column "${column}". Columns: ${fields.join(", ")}`);
        }
        if (PERSONAL_COLUMN.test(column) && !ALLOWED_NAME_COLUMNS.test(column)) {
            throw new McpError(ErrorCode.InvalidParams, `"${column}" identifies people; summarize_export only groups by non-personal columns`);
        }
    }
    // numeric columns get averages per group (progress, minutes)
    const numeric = fields.filter((f) => !groupBy.includes(f) && !PERSONAL_COLUMN.test(f) && /progress|minutes|score/i.test(f));
    const groups = new Map();
    for (const row of parsed.data) {
        const key = Object.fromEntries(groupBy.map((c) => [c, stripHtml(row[c] ?? "")]));
        const id = JSON.stringify(key);
        if (!groups.has(id))
            groups.set(id, { key, count: 0, finished: 0, sums: {} });
        const g = groups.get(id);
        g.count += 1;
        if (row["Finished On"])
            g.finished += 1;
        for (const f of numeric) {
            const n = Number(row[f]);
            if (row[f] !== "" && Number.isFinite(n)) {
                const [s, c] = g.sums[f] ?? [0, 0];
                g.sums[f] = [s + n, c + 1];
            }
        }
    }
    const rows = [...groups.values()]
        .sort((a, b) => b.count - a.count)
        .map((g) => ({
        ...g.key,
        enrollments: g.count,
        ...(fields.includes("Finished On") ? { finished: g.finished } : {}),
        ...Object.fromEntries(Object.entries(g.sums).map(([f, [s, c]]) => [`avg ${f}`, Math.round((s / c) * 10) / 10])),
    }));
    return { file: path.basename(filePath), totalRows: parsed.data.length, groupBy, rows };
}
/**
 * The workspace's branding as the web app loads it: profile.json on the asset CDN
 * (logos, theme colours, company name). Public files, no API key needed.
 */
export async function workspaceBranding(ctx) {
    const { client } = ctx;
    const cdn = (process.env.WORKADEMY_ASSET_CDN || "https://d18lcb7860whbu.cloudfront.net").replace(/\/+$/, "");
    const workspaceId = await client.getWorkspaceId();
    const info = await client.request("GET", `/api/v1/secured/workspaces/${workspaceId}`).catch(() => null);
    const host = String(info?.hostname || new URL(client.baseUrl).host).toLowerCase();
    const candidates = [
        ...(info?.uuid ? [`${cdn}/workspaces/${info.uuid}/assets/profile.json`] : []),
        `${cdn}/workspace-assets/${host.replace(/\./g, "_")}/profile.json`,
    ];
    let profile = null;
    let profileUrl = null;
    for (const url of candidates) {
        try {
            profile = (await axios.get(url, { timeout: 10_000 })).data;
            profileUrl = url;
            break;
        }
        catch {
            // try the next location
        }
    }
    if (!profile) {
        return { workspace: ctx.workspace.alias, found: false, tried: candidates };
    }
    const absolute = (value) => typeof value === "string" && value ? new URL(value, `https://${host}/`).toString() : null;
    const light = profile.theme?.themes?.light ?? {};
    return {
        workspace: ctx.workspace.alias,
        found: true,
        profileUrl,
        company: profile.company ?? info?.name ?? null,
        title: profile.title ?? null,
        companyUrl: profile.companyUrl ?? null,
        logos: {
            logo: absolute(profile.logo),
            header: absolute(profile.logoHeader),
            footer: absolute(profile.logoFooter),
            favicon: absolute(profile.favicon),
        },
        colors: { primary: light.primary ?? null, secondary: light.secondary ?? null, accent: light.accent ?? null },
        note: "Logo variants can be white (for dark backgrounds); check before placing one on a light page.",
    };
}
async function adminTodos(ctx, args) {
    const warnings = [];
    const daysAhead = clampInt(args.daysAhead, 31, 1, 366);
    const counts = await adminTodoCounts(ctx.client, warnings);
    const upcoming = await safe("schedules", warnings, () => upcomingSchedules(ctx.client, daysAhead));
    return { workspace: ctx.workspace.alias, ...counts, upcomingScheduledRuns: upcoming, warnings };
}
/** The month before `label` (YYYY-MM). */
function previousMonthLabel(label) {
    const [year, month] = label.split("-").map(Number);
    return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}
export async function monthlyReport(ctx, args) {
    const { client } = ctx;
    const period = monthRange(args.month);
    const previous = monthRange(previousMonthLabel(period.label));
    const minGroupSize = clampInt(args.minGroupSize, 5, 1, 100);
    const topQuestions = clampInt(args.topQuestions, 3, 1, 20);
    const includeDepartments = args.includeDepartments !== false;
    const warnings = [];
    const sources = {};
    // Large workspaces can be slow: the report has a time budget so it always answers
    // (the device bridge gives a tool 60 s). Sections that run out of time say so in warnings.
    // (args.budgetMs is for internal callers such as the PDF tool and the monthly run, not in the schema)
    const deadline = Date.now() + Number(args.budgetMs ?? process.env.WORKADEMY_REPORT_BUDGET_MS ?? 40_000);
    const timeLeft = () => Date.now() < deadline;
    const workspaceId = await client.getWorkspaceId();
    const courseNames = new Map();
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
            if (isRateLimited(error)) {
                // a firewall block, not "this workspace has no analytics": do not switch to other numbers
                warnings.push(`analytics ${label}: ${messageOf(error)}`);
                return null;
            }
            if (status === 401 || status === 403 || status === 404) {
                if (analyticsAvailable) {
                    warnings.push(`Analytics API not available for this workspace (${messageOf(error)}). ` +
                        "Enrollment numbers were computed from the core API; logins, activity and question hotspots are missing.");
                }
                analyticsAvailable = false;
            }
            else {
                warnings.push(`analytics ${label}: ${messageOf(error)}`);
            }
            return null;
        }
    };
    const periodWindow = { start: period.start, end: period.end };
    // The analytics service only counts whole buckets that lie inside the window, and yearly buckets
    // only exist for finished years. So "to date" = monthly buckets from the very beginning.
    const toDateWindow = { start: 0, end: period.end };
    const perCourse = { breakdown: "course", size: 100, sort: "amountStarted", sortDir: "desc" };
    const month = { aggregationType: "MONTH" };
    // Independent calls run in parallel (the slowest take a few seconds on large workspaces)
    const [info, courseCount, userCount, groupList, totalsToDate, totalsPeriod, certTotalsPeriod, enrollToDate, enrollPeriod, certsPeriod, usersPeriod, activity, upcoming, todos, totalsPrevious,] = await Promise.all([
        safe("workspace", warnings, () => client.request("GET", `/api/v1/secured/workspaces/${workspaceId}`)),
        safe("course count", warnings, () => countOf(client, "/api/v1/secured/courses")),
        safe("users", warnings, () => countOf(client, "/api/v1/secured/users")),
        safe("groups", warnings, () => fetchAllPages(client, "/api/v1/secured/groups")),
        facts("totals to date", { fact: "usercourse", breakdown: "none", ...toDateWindow, ...month }),
        facts("totals this month", { fact: "usercourse", breakdown: "none", ...periodWindow, ...month }),
        facts("certificates this month", { fact: "certificate", breakdown: "none", ...periodWindow, ...month }),
        facts("enrollments to date", { fact: "usercourse", ...perCourse, ...toDateWindow, ...month }),
        facts("enrollments this month", { fact: "usercourse", ...perCourse, ...periodWindow, ...month }),
        facts("certificates", { fact: "certificate", ...perCourse, sort: "amountIssued", ...periodWindow, ...month }),
        facts("logins", { fact: "workspace_users", ...periodWindow, ...month }),
        facts("activity", { fact: "activity", ...periodWindow, ...month }),
        safe("schedules", warnings, () => upcomingSchedules(client, 31)),
        adminTodoCounts(client, warnings),
        facts("totals previous month", {
            fact: "usercourse",
            breakdown: "none",
            start: previous.start,
            end: previous.end,
            ...month,
        }),
    ]);
    let courses = [];
    let coursesWithActivity = null;
    if (enrollToDate?.rows) {
        sources.enrollments = "analytics API";
        const periodByCourse = new Map((enrollPeriod?.rows ?? []).map((r) => [r.courseId, r]));
        const certsByCourse = new Map((certsPeriod?.rows ?? []).map((r) => [r.courseId, r]));
        coursesWithActivity = enrollToDate.page?.totalElements ?? enrollToDate.rows.length;
        // Note: amountMsCourseStarted is not filled in production data, so "started" is left out here.
        courses = enrollToDate.rows.map((r) => {
            const p = periodByCourse.get(r.courseId) ?? {};
            const c = certsByCourse.get(r.courseId) ?? {};
            const enrolled = num(r.amountStarted);
            const finished = num(r.amountEnded);
            const abandoned = num(r.amountAbandoned);
            const name = r.courseName ?? String(r.courseId);
            courseNames.set(r.courseId, name);
            return {
                courseId: r.courseId,
                course: name,
                toDate: {
                    enrolled,
                    finished,
                    abandoned,
                    open: Math.max(enrolled - finished - abandoned, 0),
                    completionRate: rate(finished, enrolled),
                    avgDaysToFinish: round1(r.avgDaysBetweenEnded),
                },
                thisMonth: {
                    enrolled: num(p.amountStarted),
                    finished: num(p.amountEnded),
                    abandoned: num(p.amountAbandoned),
                    certificatesIssued: num(c.amountIssued),
                    avgCertificateScorePercent: scorePercent(c.avgScore),
                },
            };
        });
    }
    else {
        sources.enrollments = "core API (computed from enrollment records)";
        const courseList = await safe("courses", warnings, () => loadCourseNames(client));
        for (const [id, name] of courseList?.names ?? [])
            courseNames.set(id, name);
        const ids = (courseList?.items ?? []).map((c) => c.id);
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
        coursesWithActivity = courses.filter((c) => num(c.toDate.enrolled) > 0).length;
    }
    // "To date" from the enrolment records when the workspace is small enough: the analytics
    // history is incomplete for older courses (SE Ranking's SEO Basics: 4,611 records, 1,465 in
    // analytics). Two counts per course, so only up to 100 courses; larger ones keep analytics.
    let recordsToDate = null;
    if (sources.enrollments === "analytics API" && num(courseCount) > 0 && num(courseCount) <= 100 && timeLeft()) {
        const list = await safe("courses", warnings, () => fetchAllPages(client, "/api/v1/secured/courses"));
        // A course shared from another workspace can refuse its enrolments to this key
        // (403 {"reason":"Forbidden: User cannot access this course…","code":2100}, Child Rescue, Oct 2026):
        // count it from analytics instead of giving up on the records.
        const counted = list
            ? await mapLimit(list.items, 6, (course) => safe(`course ${course.id} totals`, warnings, async () => {
                const id = course.id;
                const name = stripHtml(course.name);
                try {
                    return {
                        id,
                        name,
                        enrolled: await countOf(client, `/api/v1/secured/courses/${id}/usercourses`),
                        finished: await countOf(client, `/api/v1/secured/courses/${id}/usercourses`, {
                            q: "finishTime=isnot=null",
                        }),
                    };
                }
                catch (error) {
                    if (statusOf(error) === 403 && !isRateLimited(error))
                        return { id, name, enrolled: null, finished: null };
                    throw error;
                }
            }))
            : [];
        if (list && counted.every((c) => c !== null)) {
            const byId = new Map(counted.map((c) => [c.id, c]));
            let enrolledTotal = 0;
            let finishedTotal = 0;
            let refused = 0;
            for (const row of courses) {
                const rec = byId.get(row.courseId);
                if (!rec)
                    continue;
                byId.delete(row.courseId);
                if (rec.enrolled === null || rec.finished === null) {
                    // no access to the records: keep this course's analytics numbers
                    refused += 1;
                    enrolledTotal += num(row.toDate.enrolled);
                    finishedTotal += num(row.toDate.finished);
                    continue;
                }
                row.course = rec.name || row.course;
                courseNames.set(row.courseId, row.course);
                row.toDate = {
                    enrolled: rec.enrolled,
                    finished: rec.finished,
                    completionRate: rate(rec.finished, rec.enrolled),
                    avgDaysToFinish: row.toDate.avgDaysToFinish ?? null,
                };
                enrolledTotal += rec.enrolled;
                finishedTotal += rec.finished;
            }
            // courses with records but no analytics activity
            for (const rec of byId.values()) {
                if (rec.enrolled === null || rec.finished === null) {
                    refused += 1;
                    continue;
                }
                enrolledTotal += rec.enrolled;
                finishedTotal += rec.finished;
                if (rec.enrolled === 0)
                    continue;
                courses.push({
                    courseId: rec.id,
                    course: rec.name,
                    toDate: { enrolled: rec.enrolled, finished: rec.finished, completionRate: rate(rec.finished, rec.enrolled) },
                    thisMonth: { enrolled: 0, finished: 0 },
                });
            }
            if (refused) {
                warnings.push(`${refused} shared course${refused === 1 ? "" : "s"} could not be read from the enrolment records (no access with this key); counted from analytics instead.`);
            }
            recordsToDate = { enrolled: enrolledTotal, finished: finishedTotal };
            sources.toDate = "enrolment records (analytics history is incomplete for older courses)";
        }
    }
    courses = courses.filter((c) => num(c.toDate.enrolled) > 0).sort((a, b) => num(b.toDate.enrolled) - num(a.toDate.enrolled));
    const sum = (pick) => courses.reduce((total, c) => total + num(pick(c)), 0);
    // Prefer the workspace-total rows: per-course rows are capped at the 100 biggest courses
    const totalToDate = totalsToDate?.rows?.[0];
    const totalPeriod = totalsPeriod?.rows?.[0];
    const enrolledToDate = recordsToDate
        ? recordsToDate.enrolled
        : totalToDate
            ? num(totalToDate.amountStarted)
            : sum((c) => c.toDate.enrolled);
    const finishedToDate = recordsToDate
        ? recordsToDate.finished
        : totalToDate
            ? num(totalToDate.amountEnded)
            : sum((c) => c.toDate.finished);
    // records have no cheap abandoned count, so "open" then means "not finished"
    const abandonedToDate = recordsToDate ? 0 : totalToDate ? num(totalToDate.amountAbandoned) : sum((c) => c.toDate.abandoned);
    const enrolledThisMonth = totalPeriod ? num(totalPeriod.amountStarted) : sum((c) => c.thisMonth.enrolled);
    const finishedThisMonth = totalPeriod ? num(totalPeriod.amountEnded) : sum((c) => c.thisMonth.finished);
    const toDateById = new Map(courses.map((c) => [c.courseId, c]));
    let monthRows;
    let coursesActiveThisMonth;
    if (enrollPeriod?.rows) {
        const certsByCourse = new Map((certsPeriod?.rows ?? []).map((r) => [r.courseId, r]));
        const active = enrollPeriod.rows.filter((r) => num(r.amountStarted) > 0 || num(r.amountEnded) > 0);
        coursesActiveThisMonth = Math.max(num(enrollPeriod.page?.totalElements), active.length);
        monthRows = active.map((r) => ({
            courseId: r.courseId,
            course: courseNames.get(r.courseId) ?? r.courseName ?? String(r.courseId),
            enrolled: num(r.amountStarted),
            finished: num(r.amountEnded),
            certificatesIssued: certsByCourse.has(r.courseId) ? num(certsByCourse.get(r.courseId).amountIssued) : null,
            avgCertificateScorePercent: scorePercent(certsByCourse.get(r.courseId)?.avgScore),
            completionRateToDate: null,
        }));
    }
    else {
        const active = courses.filter((c) => num(c.thisMonth.enrolled) > 0 || num(c.thisMonth.finished) > 0);
        coursesActiveThisMonth = active.length;
        monthRows = active.map((c) => ({
            courseId: c.courseId,
            course: c.course,
            enrolled: num(c.thisMonth.enrolled),
            finished: num(c.thisMonth.finished),
            certificatesIssued: null,
            avgCertificateScorePercent: null,
            completionRateToDate: null,
        }));
    }
    monthRows.sort((a, b) => b.enrolled - a.enrolled || b.finished - a.finished);
    const topCoursesThisMonth = monthRows.slice(0, 10);
    for (const row of topCoursesThisMonth) {
        // all-time completion only where the to-date numbers are complete (records, or the core API path)
        if (sources.toDate || sources.enrollments !== "analytics API") {
            row.completionRateToDate = toDateById.get(row.courseId)?.toDate.completionRate ?? null;
        }
    }
    // Analytics shortens course names; large workspaces did not get the real names from the records
    if (!sources.toDate && sources.enrollments === "analytics API" && timeLeft()) {
        await mapLimit(topCoursesThisMonth, 5, async (row) => {
            const course = await safe(`course ${row.courseId} name`, warnings, () => client.request("GET", `/api/v1/secured/courses/${row.courseId}`));
            const name = stripHtml(course?.name ?? "");
            if (name) {
                row.course = name;
                courseNames.set(row.courseId, name);
            }
        });
    }
    // --- Where people struggle: drill course -> module -> lecture -> question on wrong answers ---
    const computeHotspots = async () => {
        let hotspots = null;
        if (analyticsAvailable && courses.length > 0) {
            sources.questions = "analytics API";
            const candidates = [...courses]
                .sort((a, b) => num(b.thisMonth.enrolled) - num(a.thisMonth.enrolled) || num(b.toDate.enrolled) - num(a.toDate.enrolled))
                .slice(0, 5)
                .map((c) => c.courseId);
            let outOfTime = false;
            const quiet = async (query) => {
                if (!timeLeft()) {
                    outOfTime = true;
                    return null;
                }
                return safe(`questions ${query.courseId}/${query.moduleId ?? ""}/${query.lectureId ?? ""}`, warnings, () => fetchFacts(client, workspaceId, query));
            };
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
            if (found.length === 0 && timeLeft()) {
                window = "since the workspace started (too few answers this month)";
                found = await collect(toDateWindow);
            }
            if (outOfTime)
                warnings.push("Question hotspots: stopped early to stay within the time limit.");
            hotspots = {
                window,
                minAnswers: minGroupSize,
                questions: found.slice(0, topQuestions),
            };
        }
        return hotspots;
    };
    // --- Departments (groups) ---
    const computeDepartments = async () => {
        if (!includeDepartments || !groupList)
            return null;
        sources.departments = "core API (group enrollments)";
        const result = await departmentStats(client, groupList.items, {
            period: periodWindow,
            minGroupSize,
            courseNames,
            limit: 25,
            deadline,
            warnings,
        });
        return {
            // groupId stays: different groups can share a name
            shown: result.shown.map(({ hidden, truncated, ...rest }) => rest),
            hiddenGroups: result.hiddenGroups,
            notIncluded: result.notIncluded,
        };
    };
    const [hotspots, departments] = await Promise.all([computeHotspots(), computeDepartments()]);
    // --- Engagement, upcoming, admin to-dos ---
    const engagement = usersPeriod || activity
        ? {
            logins: usersPeriod?.rows ? usersPeriod.rows.reduce((t, r) => t + num(r.amountLogin), 0) : null,
            registrations: usersPeriod?.rows ? usersPeriod.rows.reduce((t, r) => t + num(r.amountRegister), 0) : null,
            activeUsers: activity?.data?.activityCount ?? activity?.rows?.[0]?.activityCount ?? null,
        }
        : null;
    const certificatesThisMonth = certTotalsPeriod?.rows?.[0]
        ? num(certTotalsPeriod.rows[0].amountIssued)
        : sum((c) => c.thisMonth.certificatesIssued);
    const analyticsNumbers = sources.enrollments === "analytics API";
    const previousTotals = totalsPrevious?.rows?.[0];
    return {
        workspace: {
            alias: ctx.workspace.alias,
            id: workspaceId,
            name: info?.name ?? ctx.workspace.name ?? null,
            hostname: info?.hostname ?? null,
            createdAt: iso(typeof info?.createTime === "number" ? info.createTime : null),
            locale: info?.locale ?? null,
        },
        period: { month: period.label, start: iso(period.start), end: iso(period.end), timezone: "UTC" },
        privacy: `Aggregates only: no names, e-mails or user ids. Departments with fewer than ${minGroupSize} members, ` +
            `department/course cells with fewer than ${minGroupSize} enrollments and questions with fewer than ` +
            `${minGroupSize} answers are left out.`,
        sources,
        headline: {
            learners: userCount,
            courses: courseCount,
            coursesWithActivity,
            enrollmentsToDate: enrolledToDate,
            completionsToDate: finishedToDate,
            completionRateToDate: rate(finishedToDate, enrolledToDate),
            openToDate: Math.max(enrolledToDate - finishedToDate - abandonedToDate, 0),
            newEnrollmentsThisMonth: enrolledThisMonth,
            completionsThisMonth: finishedThisMonth,
            certificatesThisMonth: analyticsNumbers ? certificatesThisMonth : null,
            avgCertificateScoreThisMonth: analyticsNumbers ? scorePercent(certTotalsPeriod?.rows?.[0]?.avgScore) : null,
            logins: engagement?.logins ?? null,
            activeUsers: engagement?.activeUsers ?? null,
        },
        previousMonth: analyticsNumbers && previousTotals
            ? {
                month: previous.label,
                newEnrollments: num(previousTotals.amountStarted),
                completions: num(previousTotals.amountEnded),
            }
            : null,
        topCoursesThisMonth,
        coursesActiveThisMonth,
        courses: courses.slice(0, 25),
        coursesOmitted: Math.max(num(coursesWithActivity) - Math.min(courses.length, 25), 0),
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
                month: { type: "string", description: "Only this month, YYYY-MM (in `timezone`)" },
                start: dateParam("Period start (instead of month)"),
                end: dateParam("Period end, inclusive (instead of month)"),
                periodFilter: {
                    type: "string",
                    enum: ["started_and_finished", "enrolled", "finished"],
                    description: "started_and_finished (default, same as the admin dialog: enrolled after start and finished before end), enrolled (enrolled in the period), finished (finished in the period)",
                },
                timezone: { type: "string", description: "IANA timezone for month boundaries, e.g. Europe/Berlin (the admin UI uses the browser's). Default UTC" },
                q: { type: "string", description: "Extra RSQL filter, e.g. course.id==658" },
            },
            required: ["scope"],
        },
    },
    {
        name: "summarize_export",
        description: "Count a CSV saved by export_report, grouped by non-personal columns (default: Course Name and Status), with finished counts and averages of progress/minutes columns. Refuses to group by names, e-mails or ids.",
        inputSchema: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "filePath returned by export_report" },
                groupBy: { type: "array", items: { type: "string" }, description: "Columns to group by" },
            },
            required: ["filePath"],
        },
    },
    {
        name: "get_workspace_branding",
        description: "Branding of a workspace as its learners see it: company name, logo variants (logo, header, footer, favicon), theme colours and company URL, from the workspace's profile.json. Use it to brand client reports.",
        inputSchema: { type: "object", properties: {} },
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
    {
        name: "create_monthly_report_pdf",
        description: "Make the client's monthly one-pager as a PDF (one A4 page, Workademy brand with the client's logo) from get_monthly_report, and save it in the reports folder. Returns the file path, the lead sentence used, whether the page fit, and whether the month is worth sending (completions threshold) or should get the win-back email instead. Needs Google Chrome on this computer.",
        inputSchema: {
            type: "object",
            properties: {
                month: { type: "string", description: "Month as YYYY-MM (UTC). Default: the previous full month" },
                language: { type: "string", enum: ["en", "de", "uk"], description: "Page language (default: the workspace's report setting, else its locale, else en)" },
                client: { type: "string", description: "Client name on the page and in the file name (default: the workspace name)" },
                headline: { type: "string", description: "Own lead sentence instead of the automatic one" },
                logo: { type: "string", description: "Logo URL or file path instead of the workspace's own logo" },
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
    summarize_export: summarizeExport,
    get_workspace_branding: (ctx) => workspaceBranding(ctx),
    get_admin_todos: adminTodos,
    get_monthly_report: monthlyReport,
    // loaded on first use: it brings the PDF renderer (and playwright-core) with it
    create_monthly_report_pdf: async (ctx, args) => (await import("./monthly-pdf.js")).createMonthlyPdf(ctx, args),
};
/** Returns null when the tool is not one of the extended tools. */
export async function handleExtendedTool(name, args, ctx) {
    const handler = HANDLERS[name];
    if (!handler)
        return null;
    return json(await handler(ctx, args ?? {}));
}
//# sourceMappingURL=extended-tools.js.map