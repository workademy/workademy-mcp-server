/**
 * Client for Workademy's analytics service (the data behind the admin dashboard).
 *
 * The service is not in the public Swagger spec. Paths and parameters mirror what the
 * Workademy web app calls under /analytics-api/v1/secured/workspaces/{workspaceId}/…
 */
export interface ApiClient {
    readonly baseUrl: string;
    request<T = any>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, options?: {
        params?: Record<string, any>;
        data?: any;
    }): Promise<T>;
    /** Downloads a pre-signed export URL (no auth header). */
    download(url: string): Promise<string>;
    /** Numeric id of the workspace this client is bound to. */
    getWorkspaceId(): Promise<number>;
}
export declare const FACT_TYPES: readonly ["usercourse", "certificate", "lecture", "questionanswer", "workspace_users", "campaign", "modules", "activity"];
export type FactType = (typeof FACT_TYPES)[number];
export declare const AGGREGATION_TYPES: readonly ["YEAR", "MONTH", "DAY", "HOUR"];
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
export declare function buildFactPath(workspaceId: number, q: FactQuery): string;
export declare function buildFactParams(q: FactQuery): Record<string, any>;
/** Removes HTML tags and collapses whitespace (course and question names can contain markup). */
export declare function stripHtml(value: unknown): string;
export declare function labelRow(row: Record<string, any>, extra: Record<string, any> | undefined): Record<string, any>;
export interface FactResult {
    path: string;
    params: Record<string, any>;
    rows: Record<string, any>[] | null;
    /** Non-list responses (e.g. the activity total) are returned as-is. */
    data: any;
    page?: {
        totalElements?: number;
        totalPages?: number;
        number?: number;
        size?: number;
    };
}
export declare function fetchFacts(client: ApiClient, workspaceId: number, q: FactQuery): Promise<FactResult>;
//# sourceMappingURL=analytics.d.ts.map