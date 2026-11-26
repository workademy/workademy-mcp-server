import { ApiClient } from "./analytics.js";
import { WorkspaceConfig, WorkspaceRegistry } from "./registry.js";
export type { ApiClient } from "./analytics.js";
type ToolResult = {
    content: Array<{
        type: "text";
        text: string;
    }>;
};
export interface ToolContext {
    client: ApiClient;
    workspace: WorkspaceConfig;
    registry: WorkspaceRegistry;
}
/** Tools that change data. They are refused on workspaces marked readOnly. */
export declare const WRITE_TOOLS: Set<string>;
export declare function assertToolAllowed(workspace: WorkspaceConfig, toolName: string): void;
/** Adds the optional `workspace` argument to every tool schema. */
export declare function decorateTools<T extends {
    name: string;
    inputSchema?: any;
}>(tools: T[], context: {
    defaultAlias: string;
    aliases: string[];
} | null): T[];
export declare function listConfiguredWorkspaces(registry: WorkspaceRegistry, clientFor: (workspace: WorkspaceConfig) => ApiClient, args: Record<string, any>): Promise<ToolResult>;
/**
 * The workspace's branding as the web app loads it: profile.json on the asset CDN
 * (logos, theme colours, company name). Public files, no API key needed.
 */
export declare function workspaceBranding(ctx: ToolContext): Promise<{
    workspace: string;
    found: boolean;
    tried: string[];
    profileUrl?: undefined;
    company?: undefined;
    title?: undefined;
    companyUrl?: undefined;
    logos?: undefined;
    colors?: undefined;
    note?: undefined;
} | {
    workspace: string;
    found: boolean;
    profileUrl: string | null;
    company: any;
    title: any;
    companyUrl: any;
    logos: {
        logo: string | null;
        header: string | null;
        footer: string | null;
        favicon: string | null;
    };
    colors: {
        primary: any;
        secondary: any;
        accent: any;
    };
    note: string;
    tried?: undefined;
}>;
export declare function monthlyReport(ctx: ToolContext, args: Record<string, any>): Promise<{
    workspace: {
        alias: string;
        id: number;
        name: any;
        hostname: any;
        createdAt: string | null;
        locale: any;
    };
    period: {
        month: string;
        start: string | null;
        end: string | null;
        timezone: string;
    };
    privacy: string;
    sources: Record<string, string>;
    headline: {
        learners: number | null;
        courses: number | null;
        coursesWithActivity: number;
        enrollmentsToDate: number;
        completionsToDate: number;
        completionRateToDate: number | null;
        openToDate: number;
        newEnrollmentsThisMonth: number;
        completionsThisMonth: number;
        certificatesThisMonth: number | null;
        avgCertificateScoreThisMonth: number | null;
        logins: number | null;
        activeUsers: any;
    };
    previousMonth: {
        month: string;
        newEnrollments: number;
        completions: number;
    } | null;
    topCoursesThisMonth: {
        courseId: number;
        course: string;
        enrolled: number;
        finished: number;
        certificatesIssued: number | null;
        avgCertificateScorePercent: number | null;
        completionRateToDate: number | null;
    }[];
    coursesActiveThisMonth: number;
    courses: {
        courseId: number;
        course: string;
        toDate: Record<string, number | null>;
        thisMonth: Record<string, number | null>;
    }[];
    coursesOmitted: number;
    struggleHotspots: Record<string, any> | null;
    departments: Record<string, any> | null;
    engagement: {
        logins: number | null;
        registrations: number | null;
        activeUsers: any;
    } | null;
    upcomingScheduledRuns: {
        item: string | null;
        type: any;
        nextRun: string | null;
        repeats: any;
    }[] | null;
    adminTodos: {
        note: string;
        pendingEnrollmentApprovals: number | null;
        ungradedOpenAnswers: number | null;
    };
    warnings: string[];
}>;
export declare const EXTENDED_TOOLS: ({
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            verify: {
                type: string;
                description: string;
            };
            fact?: undefined;
            courseId?: undefined;
            moduleId?: undefined;
            lectureId?: undefined;
            breakdown?: undefined;
            start?: undefined;
            end?: undefined;
            aggregationType?: undefined;
            timeseries?: undefined;
            page?: undefined;
            size?: undefined;
            sort?: undefined;
            sortDir?: undefined;
            maxCourses?: undefined;
            groupId?: undefined;
            minGroupSize?: undefined;
            maxGroups?: undefined;
            scope?: undefined;
            userId?: undefined;
            learningPathId?: undefined;
            type?: undefined;
            month?: undefined;
            periodFilter?: undefined;
            timezone?: undefined;
            q?: undefined;
            filePath?: undefined;
            groupBy?: undefined;
            daysAhead?: undefined;
            topQuestions?: undefined;
            includeDepartments?: undefined;
            language?: undefined;
            client?: undefined;
            headline?: undefined;
            logo?: undefined;
        };
        required?: undefined;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            verify?: undefined;
            fact?: undefined;
            courseId?: undefined;
            moduleId?: undefined;
            lectureId?: undefined;
            breakdown?: undefined;
            start?: undefined;
            end?: undefined;
            aggregationType?: undefined;
            timeseries?: undefined;
            page?: undefined;
            size?: undefined;
            sort?: undefined;
            sortDir?: undefined;
            maxCourses?: undefined;
            groupId?: undefined;
            minGroupSize?: undefined;
            maxGroups?: undefined;
            scope?: undefined;
            userId?: undefined;
            learningPathId?: undefined;
            type?: undefined;
            month?: undefined;
            periodFilter?: undefined;
            timezone?: undefined;
            q?: undefined;
            filePath?: undefined;
            groupBy?: undefined;
            daysAhead?: undefined;
            topQuestions?: undefined;
            includeDepartments?: undefined;
            language?: undefined;
            client?: undefined;
            headline?: undefined;
            logo?: undefined;
        };
        required?: undefined;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            fact: {
                type: string;
                enum: ("usercourse" | "certificate" | "lecture" | "questionanswer" | "workspace_users" | "campaign" | "modules" | "activity")[];
                description: string;
            };
            courseId: {
                type: string;
                description: string;
            };
            moduleId: {
                type: string;
                description: string;
            };
            lectureId: {
                type: string;
                description: string;
            };
            breakdown: {
                type: string;
                enum: string[];
                description: string;
            };
            start: {
                type: string;
                description: string;
            };
            end: {
                type: string;
                description: string;
            };
            aggregationType: {
                type: string;
                enum: ("YEAR" | "MONTH" | "DAY" | "HOUR")[];
                description: string;
            };
            timeseries: {
                type: string;
                description: string;
            };
            page: {
                type: string;
                description: string;
            };
            size: {
                type: string;
                description: string;
            };
            sort: {
                type: string;
                description: string;
            };
            sortDir: {
                type: string;
                enum: string[];
            };
            verify?: undefined;
            maxCourses?: undefined;
            groupId?: undefined;
            minGroupSize?: undefined;
            maxGroups?: undefined;
            scope?: undefined;
            userId?: undefined;
            learningPathId?: undefined;
            type?: undefined;
            month?: undefined;
            periodFilter?: undefined;
            timezone?: undefined;
            q?: undefined;
            filePath?: undefined;
            groupBy?: undefined;
            daysAhead?: undefined;
            topQuestions?: undefined;
            includeDepartments?: undefined;
            language?: undefined;
            client?: undefined;
            headline?: undefined;
            logo?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            courseId: {
                type: string;
                description: string;
            };
            start: {
                type: string;
                description: string;
            };
            end: {
                type: string;
                description: string;
            };
            maxCourses: {
                type: string;
                description: string;
            };
            verify?: undefined;
            fact?: undefined;
            moduleId?: undefined;
            lectureId?: undefined;
            breakdown?: undefined;
            aggregationType?: undefined;
            timeseries?: undefined;
            page?: undefined;
            size?: undefined;
            sort?: undefined;
            sortDir?: undefined;
            groupId?: undefined;
            minGroupSize?: undefined;
            maxGroups?: undefined;
            scope?: undefined;
            userId?: undefined;
            learningPathId?: undefined;
            type?: undefined;
            month?: undefined;
            periodFilter?: undefined;
            timezone?: undefined;
            q?: undefined;
            filePath?: undefined;
            groupBy?: undefined;
            daysAhead?: undefined;
            topQuestions?: undefined;
            includeDepartments?: undefined;
            language?: undefined;
            client?: undefined;
            headline?: undefined;
            logo?: undefined;
        };
        required?: undefined;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            groupId: {
                type: string;
                description: string;
            };
            courseId: {
                type: string;
                description: string;
            };
            start: {
                type: string;
                description: string;
            };
            end: {
                type: string;
                description: string;
            };
            minGroupSize: {
                type: string;
                description: string;
            };
            maxGroups: {
                type: string;
                description: string;
            };
            verify?: undefined;
            fact?: undefined;
            moduleId?: undefined;
            lectureId?: undefined;
            breakdown?: undefined;
            aggregationType?: undefined;
            timeseries?: undefined;
            page?: undefined;
            size?: undefined;
            sort?: undefined;
            sortDir?: undefined;
            maxCourses?: undefined;
            scope?: undefined;
            userId?: undefined;
            learningPathId?: undefined;
            type?: undefined;
            month?: undefined;
            periodFilter?: undefined;
            timezone?: undefined;
            q?: undefined;
            filePath?: undefined;
            groupBy?: undefined;
            daysAhead?: undefined;
            topQuestions?: undefined;
            includeDepartments?: undefined;
            language?: undefined;
            client?: undefined;
            headline?: undefined;
            logo?: undefined;
        };
        required?: undefined;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            scope: {
                type: string;
                enum: string[];
            };
            courseId: {
                type: string;
                description?: undefined;
            };
            groupId: {
                type: string;
                description?: undefined;
            };
            userId: {
                type: string;
            };
            learningPathId: {
                type: string;
            };
            type: {
                type: string;
                enum: string[];
                description: string;
            };
            month: {
                type: string;
                description: string;
            };
            start: {
                type: string;
                description: string;
            };
            end: {
                type: string;
                description: string;
            };
            periodFilter: {
                type: string;
                enum: string[];
                description: string;
            };
            timezone: {
                type: string;
                description: string;
            };
            q: {
                type: string;
                description: string;
            };
            verify?: undefined;
            fact?: undefined;
            moduleId?: undefined;
            lectureId?: undefined;
            breakdown?: undefined;
            aggregationType?: undefined;
            timeseries?: undefined;
            page?: undefined;
            size?: undefined;
            sort?: undefined;
            sortDir?: undefined;
            maxCourses?: undefined;
            minGroupSize?: undefined;
            maxGroups?: undefined;
            filePath?: undefined;
            groupBy?: undefined;
            daysAhead?: undefined;
            topQuestions?: undefined;
            includeDepartments?: undefined;
            language?: undefined;
            client?: undefined;
            headline?: undefined;
            logo?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            filePath: {
                type: string;
                description: string;
            };
            groupBy: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            verify?: undefined;
            fact?: undefined;
            courseId?: undefined;
            moduleId?: undefined;
            lectureId?: undefined;
            breakdown?: undefined;
            start?: undefined;
            end?: undefined;
            aggregationType?: undefined;
            timeseries?: undefined;
            page?: undefined;
            size?: undefined;
            sort?: undefined;
            sortDir?: undefined;
            maxCourses?: undefined;
            groupId?: undefined;
            minGroupSize?: undefined;
            maxGroups?: undefined;
            scope?: undefined;
            userId?: undefined;
            learningPathId?: undefined;
            type?: undefined;
            month?: undefined;
            periodFilter?: undefined;
            timezone?: undefined;
            q?: undefined;
            daysAhead?: undefined;
            topQuestions?: undefined;
            includeDepartments?: undefined;
            language?: undefined;
            client?: undefined;
            headline?: undefined;
            logo?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            daysAhead: {
                type: string;
                description: string;
            };
            verify?: undefined;
            fact?: undefined;
            courseId?: undefined;
            moduleId?: undefined;
            lectureId?: undefined;
            breakdown?: undefined;
            start?: undefined;
            end?: undefined;
            aggregationType?: undefined;
            timeseries?: undefined;
            page?: undefined;
            size?: undefined;
            sort?: undefined;
            sortDir?: undefined;
            maxCourses?: undefined;
            groupId?: undefined;
            minGroupSize?: undefined;
            maxGroups?: undefined;
            scope?: undefined;
            userId?: undefined;
            learningPathId?: undefined;
            type?: undefined;
            month?: undefined;
            periodFilter?: undefined;
            timezone?: undefined;
            q?: undefined;
            filePath?: undefined;
            groupBy?: undefined;
            topQuestions?: undefined;
            includeDepartments?: undefined;
            language?: undefined;
            client?: undefined;
            headline?: undefined;
            logo?: undefined;
        };
        required?: undefined;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            month: {
                type: string;
                description: string;
            };
            minGroupSize: {
                type: string;
                description: string;
            };
            topQuestions: {
                type: string;
                description: string;
            };
            includeDepartments: {
                type: string;
                description: string;
            };
            verify?: undefined;
            fact?: undefined;
            courseId?: undefined;
            moduleId?: undefined;
            lectureId?: undefined;
            breakdown?: undefined;
            start?: undefined;
            end?: undefined;
            aggregationType?: undefined;
            timeseries?: undefined;
            page?: undefined;
            size?: undefined;
            sort?: undefined;
            sortDir?: undefined;
            maxCourses?: undefined;
            groupId?: undefined;
            maxGroups?: undefined;
            scope?: undefined;
            userId?: undefined;
            learningPathId?: undefined;
            type?: undefined;
            periodFilter?: undefined;
            timezone?: undefined;
            q?: undefined;
            filePath?: undefined;
            groupBy?: undefined;
            daysAhead?: undefined;
            language?: undefined;
            client?: undefined;
            headline?: undefined;
            logo?: undefined;
        };
        required?: undefined;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            month: {
                type: string;
                description: string;
            };
            language: {
                type: string;
                enum: string[];
                description: string;
            };
            client: {
                type: string;
                description: string;
            };
            headline: {
                type: string;
                description: string;
            };
            logo: {
                type: string;
                description: string;
            };
            verify?: undefined;
            fact?: undefined;
            courseId?: undefined;
            moduleId?: undefined;
            lectureId?: undefined;
            breakdown?: undefined;
            start?: undefined;
            end?: undefined;
            aggregationType?: undefined;
            timeseries?: undefined;
            page?: undefined;
            size?: undefined;
            sort?: undefined;
            sortDir?: undefined;
            maxCourses?: undefined;
            groupId?: undefined;
            minGroupSize?: undefined;
            maxGroups?: undefined;
            scope?: undefined;
            userId?: undefined;
            learningPathId?: undefined;
            type?: undefined;
            periodFilter?: undefined;
            timezone?: undefined;
            q?: undefined;
            filePath?: undefined;
            groupBy?: undefined;
            daysAhead?: undefined;
            topQuestions?: undefined;
            includeDepartments?: undefined;
        };
        required?: undefined;
    };
})[];
/** Returns null when the tool is not one of the extended tools. */
export declare function handleExtendedTool(name: string, args: Record<string, any>, ctx: ToolContext): Promise<ToolResult | null>;
//# sourceMappingURL=extended-tools.d.ts.map