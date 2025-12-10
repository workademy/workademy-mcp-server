import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError, } from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosError } from "axios";
import * as fs from 'fs/promises';
import * as path from 'path';
import Papa from 'papaparse';
import os from 'os';
const claudeTmpDir = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'tmp');
// Workademy API Client
class WorkademyClient {
    axiosInstance;
    config;
    tokenExpiresAt;
    constructor(config) {
        this.config = config;
        this.axiosInstance = axios.create({
            baseURL: config.baseUrl,
            headers: {
                "Content-Type": "application/json",
            },
        });
        // Add response interceptor for error handling
        this.axiosInstance.interceptors.response.use((response) => response, async (error) => {
            if (error.response?.status === 401 && this.config.apiKey) {
                // Try to refresh token
                await this.authenticate();
                // Retry original request
                if (error.config) {
                    return this.axiosInstance.request(error.config);
                }
            }
            throw error;
        });
    }
    async authenticate() {
        if (!this.config.apiKey) {
            throw new Error("API key required for authentication");
        }
        const params = new URLSearchParams({
            grant_type: "api_key",
            api_key: this.config.apiKey,
        });
        // Use Basic auth with the system credentials for token request
        const response = await axios.post(`${this.config.baseUrl}/oauth/token`, params, {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": "Basic c3lzdGVtOkViNFRRaXpEdFlpYndJTHI=",
            },
        });
        this.config.accessToken = response.data.access_token;
        this.tokenExpiresAt = Date.now() + response.data.expires_in * 1000;
        // Set Bearer token for subsequent API requests
        this.axiosInstance.defaults.headers.common["Authorization"] =
            `Bearer ${this.config.accessToken}`;
    }
    async ensureAuthenticated() {
        if (!this.config.accessToken) {
            await this.authenticate();
        }
        else if (this.tokenExpiresAt && Date.now() >= this.tokenExpiresAt - 60000) {
            // Refresh if token expires in less than 1 minute
            await this.authenticate();
        }
    }
    // Course Management
    async listCourses(params) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.get("/api/v1/secured/courses", {
            params,
        });
        return response.data;
    }
    async getCourse(courseId, include) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.get(`/api/v1/secured/courses/${courseId}`, { params: { include } });
        return response.data;
    }
    async createCourse(courseData) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.post("/api/v1/secured/courses", courseData);
        return response.data;
    }
    async updateCourse(courseId, courseData) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.put(`/api/v1/secured/courses/${courseId}`, courseData);
        return response.data;
    }
    async deleteCourse(courseId) {
        await this.ensureAuthenticated();
        await this.axiosInstance.delete(`/api/v1/secured/courses/${courseId}`);
    }
    async cloneCourse(courseId) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.post(`/api/v1/secured/courses/${courseId}/_clone`);
        return response.data;
    }
    // User Management
    async listUsers(params) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.get("/api/v1/secured/users", {
            params,
        });
        return response.data;
    }
    async getUser(userId) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.get(`/api/v1/secured/users/${userId}`);
        return response.data;
    }
    async getCurrentUser() {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.get("/api/v1/secured/users/me");
        return response.data;
    }
    async updateUser(userId, userData) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.patch(`/api/v1/secured/users/${userId}`, userData);
        return response.data;
    }
    // User Course Management (Enrollments)
    async listUserCourses(params) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.get("/api/v1/secured/usercourses", { params });
        return response.data;
    }
    async getUserCourse(userCourseId, include) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.get(`/api/v1/secured/usercourses/${userCourseId}`, { params: { include } });
        return response.data;
    }
    async enrollUser(courseId, userId) {
        await this.ensureAuthenticated();
        await this.axiosInstance.post(`/api/v1/secured/courses/${courseId}/users/${userId}/_enroll`);
    }
    async completeUserCourse(userCourseId) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.post(`/api/v1/secured/usercourses/${userCourseId}/_complete`);
        return response.data;
    }
    // Group Management
    async listGroups(params) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.get("/api/v1/secured/groups", {
            params,
        });
        return response.data;
    }
    async getGroup(groupId) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.get(`/api/v1/secured/groups/${groupId}`);
        return response.data;
    }
    async createGroup(groupData) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.post("/api/v1/secured/groups", groupData);
        return response.data;
    }
    async addUserToGroup(groupId, userId) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.post(`/api/v1/secured/groups/${groupId}/users/${userId}`);
        return response.data;
    }
    async addCourseToGroup(groupId, courseId) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.post(`/api/v1/secured/groups/${groupId}/courses/${courseId}`);
        return response.data;
    }
    // Learning Path Management
    async listLearningPaths(params) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.get("/api/v1/secured/learningpaths", { params });
        return response.data;
    }
    async createLearningPath(learningPathData) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.post("/api/v1/secured/learningpaths", learningPathData);
        return response.data;
    }
    async deleteLearningPath(learningPathId) {
        await this.ensureAuthenticated();
        await this.axiosInstance.delete(`/api/v1/secured/learningpaths/${learningPathId}`);
    }
    // Certificate Management
    async getCertificate(certificateId) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.get(`/api/v1/secured/certificates/${certificateId}`);
        return response.data;
    }
    async listCertificateTemplates(courseId) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.get(`/api/v1/secured/courses/${courseId}/certificate-templates`);
        return response.data;
    }
    // Workspace Management
    async listWorkspaces() {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.get("/api/v1/secured/workspaces");
        return response.data;
    }
    async getWorkspace(workspaceId) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.get(`/api/v1/secured/workspaces/${workspaceId}`);
        return response.data;
    }
    async updateWorkspace(workspaceId, workspaceData) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.patch(`/api/v1/secured/workspaces/${workspaceId}`, workspaceData);
        return response.data;
    }
    // Skills Management
    async listSkills(params) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.get("/api/v1/secured/skills", {
            params,
        });
        return response.data;
    }
    async createSkill(skillData) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.post("/api/v1/secured/skills", skillData);
        return response.data;
    }
    // Operations (Async Tasks)
    async listOperations(params) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.get("/api/v1/secured/operations", { params });
        return response.data;
    }
    async getOperation(operationId) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.get(`/api/v1/secured/operations/${operationId}`);
        return response.data;
    }
    // Reports
    async generateUserCourseReport(params, type) {
        await this.ensureAuthenticated();
        let endpoint = "";
        if (params.courseId && params.groupId) {
            endpoint = `/api/v1/secured/groups/${params.groupId}/courses/${params.courseId}/usercourses/_report`;
        }
        else if (params.courseId) {
            endpoint = `/api/v1/secured/courses/${params.courseId}/usercourses/_report`;
        }
        else if (params.userId) {
            endpoint = `/api/v1/secured/users/${params.userId}/usercourses/_report`;
        }
        else {
            endpoint = "/api/v1/secured/usercourses/_report";
        }
        const response = await this.axiosInstance.post(endpoint, {}, {
            params: { type },
        });
        return response.data;
    }
    // AI Course Generation
    async generateAICourse(params) {
        await this.ensureAuthenticated();
        const response = await this.axiosInstance.post("/api/v1/secured/courses/_generate", params);
        return response.data;
    }
    // Add this import at the top of your file
    // NEW METHOD: Analyze saved CSV file and return statistics
    async analyzePreCourseSurvey(courseId) {
        console.error(`[MCP] Starting CSV analysis for course ${courseId}`);
        try {
            // Find the most recent CSV file for this course in claudeTmpDir
            const files = await fs.readdir(claudeTmpDir);
            const surveyFiles = files
                .filter(f => f.startsWith(`pre_course_survey_${courseId}_`))
                .sort()
                .reverse();
            if (surveyFiles.length === 0) {
                throw new Error(`No survey CSV found for course ${courseId}. Please run getPreCourseSurveyReport first.`);
            }
            const csvPath = path.join(claudeTmpDir, surveyFiles[0]);
            console.error(`[MCP] Reading CSV from: ${csvPath}`);
            const csvContent = await fs.readFile(csvPath, 'utf8');
            // Parse CSV
            const parsed = Papa.parse(csvContent, {
                header: true,
                skipEmptyLines: true
            });
            console.error(`[MCP] Parsed ${parsed.data.length} rows`);
            // Group responses by question
            const questionStats = {};
            parsed.data.forEach((row) => {
                const question = row.Question;
                const userAnswer = row['User Answer'];
                const options = row.Options;
                if (!question)
                    return;
                if (!questionStats[question]) {
                    questionStats[question] = {
                        questionText: question,
                        options: options || null,
                        responses: {},
                        totalResponses: 0,
                        uniqueUsers: new Set()
                    };
                }
                questionStats[question].totalResponses++;
                questionStats[question].uniqueUsers.add(row['User ID']);
                // Count responses
                if (userAnswer) {
                    if (!questionStats[question].responses[userAnswer]) {
                        questionStats[question].responses[userAnswer] = 0;
                    }
                    questionStats[question].responses[userAnswer]++;
                }
            });
            // Calculate percentages and format results
            const results = {};
            Object.keys(questionStats).forEach(question => {
                const stats = questionStats[question];
                const total = stats.totalResponses;
                // Sort responses by count
                const sortedResponses = Object.entries(stats.responses)
                    .map(([answer, count]) => ({
                    answer,
                    count,
                    percentage: ((count / total) * 100).toFixed(2)
                }))
                    .sort((a, b) => b.count - a.count);
                results[question] = {
                    questionText: question,
                    options: stats.options,
                    totalResponses: total,
                    uniqueUsers: stats.uniqueUsers.size,
                    topAnswers: sortedResponses.slice(0, 20), // Top 20 answers
                    allResponses: sortedResponses.length
                };
            });
            console.error(`[MCP] Analysis complete for ${Object.keys(results).length} questions`);
            return {
                courseId,
                analyzedAt: new Date().toISOString(),
                totalRows: parsed.data.length,
                questionsAnalyzed: Object.keys(results).length,
                questions: results,
                csvFilePath: csvPath
            };
        }
        catch (error) {
            console.error(`[MCP] Error in analyzePreCourseSurvey:`, error.message);
            throw error;
        }
    }
    // Pre-Course Survey Report
    async getPreCourseSurveyReport(courseId) {
        await this.ensureAuthenticated();
        console.error(`[MCP] Starting report generation for course ${courseId}`);
        try {
            // Step 1: Initiate the report generation with CSV output type
            const initResponse = await this.axiosInstance.post(`/api/v1/secured/courses/${courseId}/question-answers/_report?q=questionAnswer.courseId=isnot=null`, { outputType: 'CSV' });
            console.error(`[MCP] Report initiated, operation ID: ${initResponse.data.id}`);
            console.error(`[MCP] Initial status: ${initResponse.data.status}`);
            const operationId = initResponse.data.id;
            let operation = initResponse.data;
            let attempts = 0;
            const maxAttempts = 240;
            const pollInterval = 3000;
            // Step 2: Poll the operation until it's finished
            while (operation.status !== "FINISHED" && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, pollInterval));
                const pollResponse = await this.axiosInstance.get(`/api/v1/secured/operations/${operationId}`);
                operation = pollResponse.data;
                attempts++;
                console.error(`[MCP] Poll attempt ${attempts}: status=${operation.status}`);
                if (operation.status === "FAILED") {
                    console.error(`[MCP] Report generation failed: ${operation.description}`);
                    throw new Error(`Report generation failed: ${operation.description || 'Unknown error'}`);
                }
            }
            if (operation.status !== "FINISHED") {
                console.error(`[MCP] Report timed out after ${attempts} attempts`);
                throw new Error(`Report generation timed out after ${maxAttempts * pollInterval / 1000} seconds`);
            }
            console.error(`[MCP] Report finished, downloading from: ${operation.url}`);
            // Step 3: Download the CSV file
            const csvResponse = await axios.get(operation.url, {
                responseType: 'text',
            });
            console.error(`[MCP] CSV downloaded, size: ${csvResponse.data.length} bytes`);
            // Step 4: Save CSV to claudeTmpDir
            const timestamp = Date.now();
            const filePath = path.join(claudeTmpDir, `pre_course_survey_${courseId}_${timestamp}.csv`);
            await fs.writeFile(filePath, csvResponse.data, 'utf8');
            console.error(`[MCP] CSV saved to: ${filePath}`);
            // Step 5: Lightweight analysis
            const csvData = csvResponse.data;
            const lightweightAnalysis = this.analyzeCsvLightweight(csvData);
            console.error(`[MCP] Analysis complete`);
            return {
                courseId: courseId,
                csvUrl: operation.url,
                filePath: filePath,
                csvSizeBytes: csvResponse.data.length,
                totalResponses: lightweightAnalysis.totalResponses,
                generatedAt: new Date().toISOString(),
                analysis: lightweightAnalysis,
                message: `Full CSV data saved to ${filePath}. Use analyzePreCourseSurvey for detailed statistics.`
            };
        }
        catch (error) {
            console.error(`[MCP] Error in getPreCourseSurveyReport:`, error.message);
            if (error.response) {
                console.error(`[MCP] Response status: ${error.response.status}`);
                console.error(`[MCP] Response data:`, JSON.stringify(error.response.data));
            }
            throw error;
        }
    }
    analyzeCsvLightweight(csvData) {
        const lines = csvData.split('\n').filter(line => line.trim());
        const totalResponses = lines.length - 1;
        return {
            totalResponses: totalResponses,
            csvLines: lines.length,
            header: lines[0],
            summary: `CSV contains ${totalResponses} responses. Full data available in saved file.`
        };
    }
    // Helper method to parse and analyze CSV data
    analyzeCSV(csvText) {
        const lines = csvText.trim().split('\n');
        if (lines.length === 0) {
            return { error: 'Empty CSV file' };
        }
        // Parse CSV (simple parser, assumes comma-separated)
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        const rows = lines.slice(1).map(line => {
            const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index] || '';
            });
            return row;
        });
        // Basic statistics
        const totalResponses = rows.length;
        // Analyze each column
        const columnAnalysis = {};
        headers.forEach(header => {
            const values = rows.map(row => row[header]).filter(v => v !== '');
            const uniqueValues = [...new Set(values)];
            // Count frequency of each value
            const frequency = {};
            values.forEach(value => {
                frequency[value] = (frequency[value] || 0) + 1;
            });
            columnAnalysis[header] = {
                totalResponses: values.length,
                uniqueValues: uniqueValues.length,
                frequency: frequency,
                topResponses: Object.entries(frequency)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 10)
                    .map(([value, count]) => ({ value, count, percentage: (count / values.length * 100).toFixed(2) + '%' })),
            };
        });
        return {
            totalResponses,
            totalColumns: headers.length,
            headers,
            columnAnalysis,
            summary: `Survey has ${totalResponses} responses across ${headers.length} questions`,
        };
    }
}
// MCP Server Setup
const server = new Server({
    name: "workademy-mcp",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
// Global client instance
let workademyClient = null;
// Initialize client
function getClient() {
    if (!workademyClient) {
        const config = {
            baseUrl: process.env.WORKADEMY_BASE_URL || "https://staging.theworkademy.com",
            apiKey: process.env.WORKADEMY_API_KEY,
        };
        if (!config.apiKey) {
            throw new McpError(ErrorCode.InvalidRequest, "WORKADEMY_API_KEY environment variable is required");
        }
        if (!process.env.WORKADEMY_BASE_URL) {
            console.warn("WORKADEMY_BASE_URL not set, using default: https://staging.theworkademy.com");
        }
        workademyClient = new WorkademyClient(config);
    }
    return workademyClient;
}
// Tool Definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "analyze_pre_course_survey",
                description: "Analyze pre-course survey results from saved CSV file. Returns statistics including response frequencies, percentages, and top answers for each question.",
                inputSchema: {
                    type: "object",
                    properties: {
                        courseId: {
                            type: "number",
                            description: "The ID of the course"
                        }
                    },
                    required: ["courseId"]
                }
            },
            // Course Management Tools
            {
                name: "list_courses",
                description: "List all courses in the workspace with optional filtering and pagination",
                inputSchema: {
                    type: "object",
                    properties: {
                        page: {
                            type: "number",
                            description: "Page number (0-indexed)",
                        },
                        size: {
                            type: "number",
                            description: "Number of items per page",
                        },
                        q: {
                            type: "string",
                            description: "RSQL query for filtering (e.g., name=='My Course')",
                        },
                        view: {
                            type: "string",
                            enum: ["GROUPS", "LEARNING_PATH_ELIGIBLE_COURSES", "OWNED_COURSES", "DEFAULT"],
                            description: "View type for filtering results",
                        },
                    },
                },
            },
            {
                name: "get_course",
                description: "Get detailed information about a specific course",
                inputSchema: {
                    type: "object",
                    properties: {
                        courseId: {
                            type: "number",
                            description: "The ID of the course to retrieve",
                        },
                        include: {
                            type: "string",
                            description: "Comma-separated list of related entities to include (e.g., 'modules,questionAnswers')",
                        },
                    },
                    required: ["courseId"],
                },
            },
            {
                name: "create_course",
                description: "Create a new course in the workspace",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: {
                            type: "string",
                            description: "Course name",
                        },
                        description: {
                            type: "string",
                            description: "Course description",
                        },
                        published: {
                            type: "boolean",
                            description: "Whether the course is published",
                        },
                        certifiable: {
                            type: "boolean",
                            description: "Whether the course offers certificates",
                        },
                        durationMinutes: {
                            type: "number",
                            description: "Expected duration in minutes",
                        },
                    },
                    required: ["name"],
                },
            },
            {
                name: "update_course",
                description: "Update an existing course",
                inputSchema: {
                    type: "object",
                    properties: {
                        courseId: {
                            type: "number",
                            description: "The ID of the course to update",
                        },
                        courseData: {
                            type: "object",
                            description: "Course data to update (JSON object)",
                        },
                    },
                    required: ["courseId", "courseData"],
                },
            },
            {
                name: "delete_course",
                description: "Delete a course",
                inputSchema: {
                    type: "object",
                    properties: {
                        courseId: {
                            type: "number",
                            description: "The ID of the course to delete",
                        },
                    },
                    required: ["courseId"],
                },
            },
            {
                name: "clone_course",
                description: "Clone an existing course to create a copy",
                inputSchema: {
                    type: "object",
                    properties: {
                        courseId: {
                            type: "number",
                            description: "The ID of the course to clone",
                        },
                    },
                    required: ["courseId"],
                },
            },
            // User Management Tools
            {
                name: "list_users",
                description: "List all users in the workspace with optional filtering",
                inputSchema: {
                    type: "object",
                    properties: {
                        page: {
                            type: "number",
                            description: "Page number (0-indexed)",
                        },
                        size: {
                            type: "number",
                            description: "Number of items per page",
                        },
                        q: {
                            type: "string",
                            description: "RSQL query for filtering",
                        },
                        view: {
                            type: "string",
                            enum: ["LEARNING_PATHS", "COURSES", "WORKSPACE_ACCESS", "GROUPS", "SKILLS", "DEFAULT"],
                            description: "View type for filtering results",
                        },
                    },
                },
            },
            {
                name: "get_user",
                description: "Get detailed information about a specific user",
                inputSchema: {
                    type: "object",
                    properties: {
                        userId: {
                            type: "number",
                            description: "The ID of the user to retrieve",
                        },
                    },
                    required: ["userId"],
                },
            },
            {
                name: "get_current_user",
                description: "Get information about the currently authenticated user",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "update_user",
                description: "Update user information",
                inputSchema: {
                    type: "object",
                    properties: {
                        userId: {
                            type: "number",
                            description: "The ID of the user to update",
                        },
                        userData: {
                            type: "object",
                            description: "User data to update (JSON object)",
                        },
                    },
                    required: ["userId", "userData"],
                },
            },
            // Enrollment Tools
            {
                name: "list_user_courses",
                description: "List all user course enrollments (with progress and status)",
                inputSchema: {
                    type: "object",
                    properties: {
                        page: {
                            type: "number",
                            description: "Page number (0-indexed)",
                        },
                        size: {
                            type: "number",
                            description: "Number of items per page",
                        },
                        q: {
                            type: "string",
                            description: "RSQL query for filtering",
                        },
                    },
                },
            },
            {
                name: "get_user_course",
                description: "Get detailed information about a user's enrollment in a course",
                inputSchema: {
                    type: "object",
                    properties: {
                        userCourseId: {
                            type: "number",
                            description: "The ID of the user course to retrieve",
                        },
                        include: {
                            type: "string",
                            description: "Comma-separated list of related entities to include",
                        },
                    },
                    required: ["userCourseId"],
                },
            },
            {
                name: "enroll_user",
                description: "Enroll a user in a course",
                inputSchema: {
                    type: "object",
                    properties: {
                        courseId: {
                            type: "number",
                            description: "The ID of the course",
                        },
                        userId: {
                            type: "number",
                            description: "The ID of the user to enroll",
                        },
                    },
                    required: ["courseId", "userId"],
                },
            },
            {
                name: "complete_user_course",
                description: "Mark a user course as completed (generates certificate if applicable)",
                inputSchema: {
                    type: "object",
                    properties: {
                        userCourseId: {
                            type: "number",
                            description: "The ID of the user course to complete",
                        },
                    },
                    required: ["userCourseId"],
                },
            },
            // Group Management Tools
            {
                name: "list_groups",
                description: "List all groups in the workspace",
                inputSchema: {
                    type: "object",
                    properties: {
                        page: {
                            type: "number",
                            description: "Page number (0-indexed)",
                        },
                        size: {
                            type: "number",
                            description: "Number of items per page",
                        },
                        search: {
                            type: "string",
                            description: "Search term for group names",
                        },
                    },
                },
            },
            {
                name: "get_group",
                description: "Get detailed information about a specific group",
                inputSchema: {
                    type: "object",
                    properties: {
                        groupId: {
                            type: "number",
                            description: "The ID of the group to retrieve",
                        },
                    },
                    required: ["groupId"],
                },
            },
            {
                name: "create_group",
                description: "Create a new group",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: {
                            type: "string",
                            description: "Group name",
                        },
                        description: {
                            type: "string",
                            description: "Group description",
                        },
                    },
                    required: ["name"],
                },
            },
            {
                name: "add_user_to_group",
                description: "Add a user to a group",
                inputSchema: {
                    type: "object",
                    properties: {
                        groupId: {
                            type: "number",
                            description: "The ID of the group",
                        },
                        userId: {
                            type: "number",
                            description: "The ID of the user to add",
                        },
                    },
                    required: ["groupId", "userId"],
                },
            },
            {
                name: "add_course_to_group",
                description: "Associate a course with a group",
                inputSchema: {
                    type: "object",
                    properties: {
                        groupId: {
                            type: "number",
                            description: "The ID of the group",
                        },
                        courseId: {
                            type: "number",
                            description: "The ID of the course to associate",
                        },
                    },
                    required: ["groupId", "courseId"],
                },
            },
            // Learning Path Tools
            {
                name: "list_learning_paths",
                description: "List all learning paths in the workspace",
                inputSchema: {
                    type: "object",
                    properties: {
                        page: {
                            type: "number",
                            description: "Page number (0-indexed)",
                        },
                        size: {
                            type: "number",
                            description: "Number of items per page",
                        },
                    },
                },
            },
            {
                name: "create_learning_path",
                description: "Create a new learning path",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: {
                            type: "string",
                            description: "Learning path name",
                        },
                        description: {
                            type: "string",
                            description: "Learning path description",
                        },
                        type: {
                            type: "string",
                            enum: ["LEARNING_PATH", "CAREER_PATH"],
                            description: "Type of learning path",
                        },
                        steps: {
                            type: "array",
                            description: "Array of learning path steps (JSON)",
                        },
                    },
                    required: ["name", "type"],
                },
            },
            {
                name: "delete_learning_path",
                description: "Delete a learning path",
                inputSchema: {
                    type: "object",
                    properties: {
                        learningPathId: {
                            type: "number",
                            description: "The ID of the learning path to delete",
                        },
                    },
                    required: ["learningPathId"],
                },
            },
            // Workspace Tools
            {
                name: "list_workspaces",
                description: "List all workspaces the user has access to",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "get_workspace",
                description: "Get detailed information about a workspace",
                inputSchema: {
                    type: "object",
                    properties: {
                        workspaceId: {
                            type: "string",
                            description: "The ID or hostname of the workspace",
                        },
                    },
                    required: ["workspaceId"],
                },
            },
            // Skills Tools
            {
                name: "list_skills",
                description: "List all skills and skill levels in the workspace",
                inputSchema: {
                    type: "object",
                    properties: {
                        page: {
                            type: "number",
                            description: "Page number (0-indexed)",
                        },
                        size: {
                            type: "number",
                            description: "Number of items per page",
                        },
                    },
                },
            },
            {
                name: "create_skill",
                description: "Create a new skill with levels",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: {
                            type: "string",
                            description: "Skill name",
                        },
                        description: {
                            type: "string",
                            description: "Skill description",
                        },
                        levels: {
                            type: "array",
                            description: "Array of skill levels (JSON)",
                        },
                    },
                    required: ["name"],
                },
            },
            // Certificate Tools
            {
                name: "get_certificate",
                description: "Get certificate information",
                inputSchema: {
                    type: "object",
                    properties: {
                        certificateId: {
                            type: "number",
                            description: "The ID of the certificate",
                        },
                    },
                    required: ["certificateId"],
                },
            },
            {
                name: "list_certificate_templates",
                description: "List certificate templates for a course",
                inputSchema: {
                    type: "object",
                    properties: {
                        courseId: {
                            type: "number",
                            description: "The ID of the course",
                        },
                    },
                    required: ["courseId"],
                },
            },
            // Operations Tools
            {
                name: "list_operations",
                description: "List async operations (reports, imports, etc.)",
                inputSchema: {
                    type: "object",
                    properties: {
                        page: {
                            type: "number",
                            description: "Page number (0-indexed)",
                        },
                        size: {
                            type: "number",
                            description: "Number of items per page",
                        },
                    },
                },
            },
            {
                name: "get_operation",
                description: "Get status and details of an async operation",
                inputSchema: {
                    type: "object",
                    properties: {
                        operationId: {
                            type: "number",
                            description: "The ID of the operation",
                        },
                    },
                    required: ["operationId"],
                },
            },
            // Reporting Tools
            {
                name: "generate_user_course_report",
                description: "Generate a report of user course progress and completion",
                inputSchema: {
                    type: "object",
                    properties: {
                        courseId: {
                            type: "number",
                            description: "Filter by course ID (optional)",
                        },
                        groupId: {
                            type: "number",
                            description: "Filter by group ID (optional)",
                        },
                        userId: {
                            type: "number",
                            description: "Filter by user ID (optional)",
                        },
                        type: {
                            type: "string",
                            enum: ["OVERVIEW", "DETAILED"],
                            description: "Report type",
                        },
                    },
                    required: ["type"],
                },
            },
            // AI Tools
            {
                name: "generate_ai_course",
                description: "Generate a course using AI based on topic and context",
                inputSchema: {
                    type: "object",
                    properties: {
                        topic: {
                            type: "string",
                            description: "Main topic of the course",
                        },
                        context: {
                            type: "string",
                            description: "Additional context for course generation",
                        },
                        locale: {
                            type: "string",
                            description: "Language/locale for the course (e.g., 'en', 'uk')",
                        },
                        noModules: {
                            type: "number",
                            description: "Number of modules to generate",
                        },
                        businessGoals: {
                            type: "string",
                            description: "Business goals for the course",
                        },
                        learningGoal: {
                            type: "string",
                            description: "Learning objectives",
                        },
                    },
                    required: ["topic"],
                },
            },
            // Survey Tools
            {
                name: "get_pre_course_survey_report",
                description: "Get pre-course survey report with all question answers for a specific course. This tool initiates report generation, polls until completion, downloads the CSV, and provides statistical analysis including response frequencies and top answers for each question.",
                inputSchema: {
                    type: "object",
                    properties: {
                        courseId: {
                            type: "number",
                            description: "The ID of the course",
                        },
                    },
                    required: ["courseId"],
                },
            },
        ],
    };
});
// Tool Execution Handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const client = getClient();
    try {
        switch (request.params.name) {
            // Course Management
            case "list_courses": {
                const result = await client.listCourses(request.params.arguments);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "get_course": {
                const { courseId, include } = request.params.arguments;
                const result = await client.getCourse(courseId, include);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "create_course": {
                const result = await client.createCourse(request.params.arguments);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "update_course": {
                const { courseId, courseData } = request.params.arguments;
                const result = await client.updateCourse(courseId, courseData);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "delete_course": {
                const { courseId } = request.params.arguments;
                await client.deleteCourse(courseId);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Course ${courseId} deleted successfully`,
                        },
                    ],
                };
            }
            case "clone_course": {
                const { courseId } = request.params.arguments;
                const result = await client.cloneCourse(courseId);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            // User Management
            case "list_users": {
                const result = await client.listUsers(request.params.arguments);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "get_user": {
                const { userId } = request.params.arguments;
                const result = await client.getUser(userId);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "get_current_user": {
                const result = await client.getCurrentUser();
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "update_user": {
                const { userId, userData } = request.params.arguments;
                const result = await client.updateUser(userId, userData);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            // Enrollment Management
            case "list_user_courses": {
                const result = await client.listUserCourses(request.params.arguments);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "get_user_course": {
                const { userCourseId, include } = request.params.arguments;
                const result = await client.getUserCourse(userCourseId, include);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "enroll_user": {
                const { courseId, userId } = request.params.arguments;
                await client.enrollUser(courseId, userId);
                return {
                    content: [
                        {
                            type: "text",
                            text: `User ${userId} enrolled in course ${courseId} successfully`,
                        },
                    ],
                };
            }
            case "complete_user_course": {
                const { userCourseId } = request.params.arguments;
                const result = await client.completeUserCourse(userCourseId);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            // Group Management
            case "list_groups": {
                const result = await client.listGroups(request.params.arguments);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "get_group": {
                const { groupId } = request.params.arguments;
                const result = await client.getGroup(groupId);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "create_group": {
                const result = await client.createGroup(request.params.arguments);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "add_user_to_group": {
                const { groupId, userId } = request.params.arguments;
                const result = await client.addUserToGroup(groupId, userId);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "add_course_to_group": {
                const { groupId, courseId } = request.params.arguments;
                const result = await client.addCourseToGroup(groupId, courseId);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            // Learning Paths
            case "list_learning_paths": {
                const result = await client.listLearningPaths(request.params.arguments);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "create_learning_path": {
                const result = await client.createLearningPath(request.params.arguments);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "delete_learning_path": {
                const { learningPathId } = request.params.arguments;
                await client.deleteLearningPath(learningPathId);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Learning path ${learningPathId} deleted successfully`,
                        },
                    ],
                };
            }
            // Workspaces
            case "list_workspaces": {
                const result = await client.listWorkspaces();
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "get_workspace": {
                const { workspaceId } = request.params.arguments;
                const result = await client.getWorkspace(workspaceId);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            // Skills
            case "list_skills": {
                const result = await client.listSkills(request.params.arguments);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "create_skill": {
                const result = await client.createSkill(request.params.arguments);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            // Certificates
            case "get_certificate": {
                const { certificateId } = request.params.arguments;
                const result = await client.getCertificate(certificateId);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "list_certificate_templates": {
                const { courseId } = request.params.arguments;
                const result = await client.listCertificateTemplates(courseId);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            // Operations
            case "list_operations": {
                const result = await client.listOperations(request.params.arguments);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "get_operation": {
                const { operationId } = request.params.arguments;
                const result = await client.getOperation(operationId);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            // Reporting
            case "generate_user_course_report": {
                const { courseId, groupId, userId, type } = request.params.arguments;
                const result = await client.generateUserCourseReport({ courseId, groupId, userId }, type);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            // AI Tools
            case "generate_ai_course": {
                const result = await client.generateAICourse(request.params.arguments);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            // Survey Tools
            case "get_pre_course_survey_report": {
                const { courseId } = request.params.arguments;
                const result = await client.getPreCourseSurveyReport(courseId);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "analyze_pre_course_survey": {
                const { courseId } = request.params.arguments;
                const result = await client.analyzePreCourseSurvey(courseId);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
        }
    }
    catch (error) {
        if (error instanceof AxiosError) {
            const errorMessage = error.response?.data?.message || error.message;
            const errorStatus = error.response?.status;
            throw new McpError(ErrorCode.InternalError, `Workademy API error (${errorStatus}): ${errorMessage}`);
        }
        throw error;
    }
});
// Start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Workademy MCP Server running on stdio");
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map