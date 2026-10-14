/**
 * Client for Workademy's analytics service (the data behind the admin dashboard).
 *
 * The service is not in the public Swagger spec. Paths and parameters mirror what the
 * Workademy web app calls under /analytics-api/v1/secured/workspaces/{workspaceId}/…
 */
export const FACT_TYPES = [
    "usercourse",
    "certificate",
    "lecture",
    "questionanswer",
    "workspace_users",
    "campaign",
    "modules",
    "activity",
];
export const AGGREGATION_TYPES = ["YEAR", "MONTH", "DAY", "HOUR"];
const BASE = "/analytics-api/v1/secured/workspaces";
const COURSE_FACTS = new Set(["usercourse", "certificate", "lecture", "questionanswer"]);
function segments(parts) {
    return parts.map((p) => `/${encodeURIComponent(String(p))}`).join("");
}
export function buildFactPath(workspaceId, q) {
    const ws = encodeURIComponent(String(workspaceId));
    if (q.moduleId != null && q.courseId == null) {
        throw new Error("moduleId needs courseId");
    }
    if (q.lectureId != null && q.moduleId == null) {
        throw new Error("lectureId needs moduleId (and courseId)");
    }
    if (COURSE_FACTS.has(q.fact)) {
        const drilldown = [];
        if (q.courseId != null) {
            if (q.fact === "lecture" || q.fact === "questionanswer") {
                // course -> modules -> lectures -> questionanswers, as the dashboard drills down
                drilldown.push(q.courseId, "modules");
                if (q.moduleId != null) {
                    drilldown.push(q.moduleId, "lectures");
                    if (q.fact === "questionanswer" && q.lectureId != null) {
                        drilldown.push(q.lectureId, "questionanswers");
                    }
                }
            }
            else {
                drilldown.push(q.courseId);
            }
        }
        const perCourse = q.timeseries || q.courseId != null || (q.breakdown ?? "course") === "course";
        if (!perCourse) {
            return `${BASE}/${ws}/facts/${q.fact}`;
        }
        return `${BASE}/${ws}/courses${segments(drilldown)}/facts/${q.fact}${q.timeseries ? "/:timeseries" : ""}`;
    }
    if (q.fact === "workspace_users" || q.fact === "campaign") {
        const name = q.fact === "workspace_users" ? "workspace" : "campaign";
        const drilldown = q.breakdown === "country" ? ["countries"] : q.breakdown === "campaign" ? ["campaigns"] : [];
        if (!q.timeseries && drilldown.length === 0) {
            return `${BASE}/${ws}/facts/${name}`;
        }
        return `${BASE}/${ws}${segments(drilldown)}/facts/${name}${q.timeseries ? "/:timeseries" : ""}`;
    }
    if (q.fact === "modules") {
        if (q.timeseries)
            throw new Error("timeseries is not available for the modules fact");
        return `${BASE}/${ws}/facts/modules`;
    }
    // activity lives under a sibling path: /workspaces-activity/{id}/facts/activity
    if (q.timeseries)
        throw new Error("timeseries is not available for the activity fact");
    return `${BASE}-activity/${ws}/facts/activity`;
}
export function buildFactParams(q) {
    const params = {
        start: q.start,
        end: q.end,
        aggregationType: q.aggregationType,
        page: q.page,
        size: q.size,
    };
    if (q.sort) {
        params.sort = q.sort;
        params[`${q.sort}.dir`] = q.sortDir ?? "desc";
    }
    for (const key of Object.keys(params)) {
        if (params[key] === undefined || params[key] === null)
            delete params[key];
    }
    return params;
}
/** Removes HTML tags and collapses whitespace (course and question names can contain markup). */
export function stripHtml(value) {
    if (value === undefined || value === null)
        return "";
    return String(value)
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
}
// Row id field -> label map in the response's "extra" -> label field added to the row
const LABELS = [
    ["courseId", "courses", "courseName"],
    ["moduleId", "modules", "moduleName"],
    ["lectureId", "lectures", "lectureName"],
    ["questionAnswerId", "questionAnswers", "question"],
    ["countryId", "countries", "countryName"],
    ["campaignId", "campaigns", "campaignName"],
];
export function labelRow(row, extra) {
    const labelled = { ...row };
    for (const [idField, mapName, labelField] of LABELS) {
        const id = row[idField];
        if (id === undefined || id === null)
            continue;
        const name = extra?.[mapName]?.[id]?.name;
        if (name !== undefined)
            labelled[labelField] = stripHtml(name);
    }
    return labelled;
}
export async function fetchFacts(client, workspaceId, q) {
    const path = buildFactPath(workspaceId, q);
    const params = buildFactParams(q);
    const data = await client.request("GET", path, { params });
    if (data && Array.isArray(data.content)) {
        const { totalElements, totalPages, number, size } = data;
        return {
            path,
            params,
            rows: data.content.map((row) => labelRow(row, data.extra)),
            data: null,
            page: { totalElements, totalPages, number, size },
        };
    }
    return { path, params, rows: null, data };
}
//# sourceMappingURL=analytics.js.map