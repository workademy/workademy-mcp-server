/**
 * Client for Workademy's analytics service (the data behind the admin dashboard).
 *
 * The service is not in the public Swagger spec. Paths and parameters mirror what the
 * Workademy web app calls under /analytics-api/v1/secured/workspaces/{workspaceId}/…
 */

export interface ApiClient {
  readonly baseUrl: string;
  request<T = any>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    options?: { params?: Record<string, any>; data?: any; timeoutMs?: number }
  ): Promise<T>;
  /** Downloads a pre-signed export URL (no auth header). */
  download(url: string): Promise<string>;
  /** Numeric id of the workspace this client is bound to. */
  getWorkspaceId(): Promise<number>;
}

export const FACT_TYPES = [
  "usercourse",
  "certificate",
  "lecture",
  "questionanswer",
  "workspace_users",
  "campaign",
  "modules",
  "activity",
] as const;
export type FactType = (typeof FACT_TYPES)[number];

export const AGGREGATION_TYPES = ["YEAR", "MONTH", "DAY", "HOUR"] as const;
export type AggregationType = (typeof AGGREGATION_TYPES)[number];

export interface FactQuery {
  fact: FactType;
  courseId?: number;
  moduleId?: number;
  lectureId?: number;
  /**
   * usercourse / certificate / lecture / questionanswer: "course" (one row per course, default) or "none" (workspace total).
   * workspace_users: "none" (default) or "country". campaign: "none" (default) or "campaign".
   */
  breakdown?: "none" | "course" | "country" | "campaign";
  timeseries?: boolean;
  /** Epoch milliseconds. */
  start?: number;
  end?: number;
  aggregationType?: AggregationType;
  page?: number;
  size?: number;
  sort?: string;
  sortDir?: "asc" | "desc";
}

const BASE = "/analytics-api/v1/secured/workspaces";

const COURSE_FACTS = new Set<FactType>(["usercourse", "certificate", "lecture", "questionanswer"]);

function segments(parts: Array<string | number>): string {
  return parts.map((p) => `/${encodeURIComponent(String(p))}`).join("");
}

export function buildFactPath(workspaceId: number, q: FactQuery): string {
  const ws = encodeURIComponent(String(workspaceId));

  if (q.moduleId != null && q.courseId == null) {
    throw new Error("moduleId needs courseId");
  }
  if (q.lectureId != null && q.moduleId == null) {
    throw new Error("lectureId needs moduleId (and courseId)");
  }

  if (COURSE_FACTS.has(q.fact)) {
    const drilldown: Array<string | number> = [];
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
      } else {
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
    const drilldown =
      q.breakdown === "country" ? ["countries"] : q.breakdown === "campaign" ? ["campaigns"] : [];
    if (!q.timeseries && drilldown.length === 0) {
      return `${BASE}/${ws}/facts/${name}`;
    }
    return `${BASE}/${ws}${segments(drilldown)}/facts/${name}${q.timeseries ? "/:timeseries" : ""}`;
  }

  if (q.fact === "modules") {
    if (q.timeseries) throw new Error("timeseries is not available for the modules fact");
    return `${BASE}/${ws}/facts/modules`;
  }

  // activity lives under a sibling path: /workspaces-activity/{id}/facts/activity
  if (q.timeseries) throw new Error("timeseries is not available for the activity fact");
  return `${BASE}-activity/${ws}/facts/activity`;
}

export function buildFactParams(q: FactQuery): Record<string, any> {
  const params: Record<string, any> = {
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
    if (params[key] === undefined || params[key] === null) delete params[key];
  }
  return params;
}

/** Removes HTML tags and collapses whitespace (course and question names can contain markup). */
export function stripHtml(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/<[^>]*$/, " ") // tag cut off at the end (analytics stores shortened names)
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
const LABELS: Array<[string, string, string]> = [
  ["courseId", "courses", "courseName"],
  ["moduleId", "modules", "moduleName"],
  ["lectureId", "lectures", "lectureName"],
  ["questionAnswerId", "questionAnswers", "question"],
  ["countryId", "countries", "countryName"],
  ["campaignId", "campaigns", "campaignName"],
];

export function labelRow(row: Record<string, any>, extra: Record<string, any> | undefined) {
  const labelled: Record<string, any> = { ...row };
  for (const [idField, mapName, labelField] of LABELS) {
    const id = row[idField];
    if (id === undefined || id === null) continue;
    const name = extra?.[mapName]?.[id]?.name;
    if (name !== undefined) {
      const clean = stripHtml(name);
      // Analytics names are "title: subtitle"; without a subtitle a trailing colon is left over
      labelled[labelField] = idField === "courseId" ? clean.replace(/[\s:]+$/, "") : clean;
    }
  }
  return labelled;
}

export interface FactResult {
  path: string;
  params: Record<string, any>;
  rows: Record<string, any>[] | null;
  /** Non-list responses (e.g. the activity total) are returned as-is. */
  data: any;
  page?: { totalElements?: number; totalPages?: number; number?: number; size?: number };
}

export async function fetchFacts(client: ApiClient, workspaceId: number, q: FactQuery): Promise<FactResult> {
  const path = buildFactPath(workspaceId, q);
  const params = buildFactParams(q);
  const data = await client.request<any>("GET", path, { params });

  if (data && Array.isArray(data.content)) {
    const { totalElements, totalPages, number, size } = data;
    return {
      path,
      params,
      rows: data.content.map((row: Record<string, any>) => labelRow(row, data.extra)),
      data: null,
      page: { totalElements, totalPages, number, size },
    };
  }
  return { path, params, rows: null, data };
}
