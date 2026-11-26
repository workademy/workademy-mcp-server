import { AxiosError, Method } from "axios";
import { ApiClient } from "./extended-tools.js";
interface WorkademyConfig {
    baseUrl: string;
    apiKey?: string;
    accessToken?: string;
    /** Base64 client_id:client_secret for the token endpoint. */
    clientBasic: string;
    workspaceId?: number;
}
interface PaginatedResponse<T> {
    content: T[];
    totalPages: number;
    totalElements: number;
    size: number;
    number: number;
    first: boolean;
    last: boolean;
}
export declare class WorkademyClient implements ApiClient {
    private axiosInstance;
    private config;
    private tokenExpiresAt?;
    private authPromise?;
    constructor(config: WorkademyConfig);
    get baseUrl(): string;
    authenticate(): Promise<void>;
    ensureAuthenticated(): Promise<void>;
    /** Authenticated request on this workspace's host (core API or analytics API). */
    request<T = any>(method: Method, path: string, options?: {
        params?: Record<string, any>;
        data?: any;
        timeoutMs?: number;
    }): Promise<T>;
    /** Downloads a pre-signed export file (no auth header). */
    download(url: string): Promise<string>;
    /** Numeric id of the workspace this API key belongs to. */
    getWorkspaceId(): Promise<number>;
    listCourses(params?: {
        page?: number;
        size?: number;
        q?: string;
        view?: string;
    }): Promise<PaginatedResponse<any>>;
    getCourse(courseId: number, include?: string): Promise<any>;
    createCourse(courseData: any): Promise<any>;
    updateCourse(courseId: number, courseData: any): Promise<any>;
    patchCourse(courseId: number, courseData: any): Promise<any>;
    /**
     * Changes one lecture. The API has no lecture endpoint and PATCH ignores modules, so this reads the
     * whole course, changes the one lecture and sends the whole course back (PUT needs every module).
     */
    updateLecture(courseId: number, lectureId: number, changes: any): Promise<any>;
    deleteCourse(courseId: number): Promise<void>;
    cloneCourse(courseId: number): Promise<any>;
    listUsers(params?: {
        page?: number;
        size?: number;
        q?: string;
        view?: string;
        entityId?: number;
    }): Promise<PaginatedResponse<any>>;
    getUser(userId: number): Promise<any>;
    getCurrentUser(): Promise<any>;
    updateUser(userId: number, userData: any): Promise<any>;
    listUserCourses(params?: {
        page?: number;
        size?: number;
        q?: string;
    }): Promise<PaginatedResponse<any>>;
    getUserCourse(userCourseId: number, include?: string): Promise<any>;
    enrollUser(courseId: number, userId: number): Promise<void>;
    completeUserCourse(userCourseId: number): Promise<any>;
    listGroups(params?: {
        page?: number;
        size?: number;
        search?: string;
        view?: string;
        entityId?: number;
    }): Promise<PaginatedResponse<any>>;
    getGroup(groupId: number): Promise<any>;
    listGroupUsers(groupId: number, params?: {
        page?: number;
        size?: number;
    }): Promise<PaginatedResponse<any>>;
    createGroup(groupData: any): Promise<any>;
    addUserToGroup(groupId: number, userId: number): Promise<any>;
    addCourseToGroup(groupId: number, courseId: number): Promise<any>;
    listLearningPaths(params?: {
        page?: number;
        size?: number;
        view?: string;
        entityId?: number;
    }): Promise<PaginatedResponse<any>>;
    createLearningPath(learningPathData: any): Promise<any>;
    deleteLearningPath(learningPathId: number): Promise<void>;
    getCertificate(certificateId: number): Promise<any>;
    listCertificateTemplates(courseId: number): Promise<PaginatedResponse<any>>;
    listWorkspaces(): Promise<PaginatedResponse<any>>;
    getWorkspace(workspaceId: string): Promise<any>;
    updateWorkspace(workspaceId: number, workspaceData: any): Promise<any>;
    listSkills(params?: {
        page?: number;
        size?: number;
    }): Promise<PaginatedResponse<any>>;
    createSkill(skillData: any): Promise<any>;
    listOperations(params?: {
        page?: number;
        size?: number;
    }): Promise<PaginatedResponse<any>>;
    getOperation(operationId: number): Promise<any>;
    generateUserCourseReport(params: {
        courseId?: number;
        groupId?: number;
        userId?: number;
    }, type: "OVERVIEW" | "DETAILED"): Promise<any>;
    generateAICourse(params: {
        topic: string;
        context?: string;
        locale?: string;
        noModules?: number;
        businessGoals?: string;
        learningGoal?: string;
    }): Promise<any>;
    analyzePreCourseSurvey(courseId: number): Promise<any>;
    getPreCourseSurveyReport(courseId: number): Promise<any>;
    private analyzeCsvLightweight;
    private analyzeCSV;
}
/** Module and lecture names with their ids, without the content: what is needed to pick a lecture. */
export declare function courseOutline(course: any): any;
/** Finds a lecture in a course fetched with its modules, by its `id` or its `lectureId`. */
export declare function findLecture(course: any, lectureId: number): {
    module: any;
    lecture: any;
};
/**
 * Applies changes to one lecture inside a full course object (in place) and says what changed.
 * Plain fields (name, description, mediaSource, …) are replaced; `sections` and `questionAnswers`
 * are lists of partial objects matched to the existing ones by id. Ids cannot be changed.
 */
export declare function applyLectureChanges(course: any, lectureId: number, changes: any): any;
/**
 * What the API said about a failed call: its message, reason and error code when it names them,
 * otherwise the start of the response body, so a bare "Request failed with status code 412"
 * is never all there is to go on.
 */
export declare function describeApiError(error: AxiosError): string;
export {};
//# sourceMappingURL=index.d.ts.map