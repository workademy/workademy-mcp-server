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
            daysAhead?: undefined;
            month?: undefined;
            topQuestions?: undefined;
            includeDepartments?: undefined;
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
            daysAhead?: undefined;
            month?: undefined;
            topQuestions?: undefined;
            includeDepartments?: undefined;
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
            daysAhead?: undefined;
            month?: undefined;
            topQuestions?: undefined;
            includeDepartments?: undefined;
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
            daysAhead?: undefined;
            month?: undefined;
            topQuestions?: undefined;
            includeDepartments?: undefined;
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
            daysAhead?: undefined;
            month?: undefined;
            topQuestions?: undefined;
            includeDepartments?: undefined;
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
            verify?: undefined;
            fact?: undefined;
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
            minGroupSize?: undefined;
            maxGroups?: undefined;
            daysAhead?: undefined;
            month?: undefined;
            topQuestions?: undefined;
            includeDepartments?: undefined;
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
            topQuestions?: undefined;
            includeDepartments?: undefined;
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
            daysAhead?: undefined;
        };
        required?: undefined;
    };
})[];
/** Returns null when the tool is not one of the extended tools. */
export declare function handleExtendedTool(name: string, args: Record<string, any>, ctx: ToolContext): Promise<ToolResult | null>;
//# sourceMappingURL=extended-tools.d.ts.map