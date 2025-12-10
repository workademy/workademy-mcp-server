# Workademy MCP Server

A Model Context Protocol (MCP) server that provides comprehensive integration with the Workademy LMS platform. This server enables LLMs like Claude to interact with Workademy's API for course management, user administration, enrollments, learning paths, and more.

## Features

### Course Management
- List, create, update, and delete courses
- Clone courses
- Generate AI-powered courses from topics
- Manage course modules, lectures, and content
- Access course analytics and reports

### User & Enrollment Management
- List and manage users
- Enroll users in courses
- Track course progress and completion
- Generate completion certificates

### Group Management
- Create and manage learner groups
- Assign courses to groups
- Add users to groups
- Generate group-based reports

### Learning Paths
- Create structured learning journeys
- Manage learning path steps
- Track learner progress through paths

### Skills Management
- Define skills and skill levels
- Assign skills to users
- Track skill development

### Reporting & Analytics
- Generate user course reports (overview and detailed)
- Track completion rates
- Monitor learning progress
- Export data for analysis

### Additional Features
- Certificate management and templates
- Workspace management
- Async operation tracking
- Integration support

## Installation

### Prerequisites
- Node.js 18 or higher
- npm or yarn
- Workademy account with API access

### Setup

1. Clone or create the project:
```bash
mkdir workademy-mcp
cd workademy-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Configuration

### Environment Variables

Create a `.env` file or set the following environment variables:

```bash
# REQUIRED: Your Workademy API Key
WORKADEMY_API_KEY=your_api_key_here

# REQUIRED: Your Workademy instance base URL
WORKADEMY_BASE_URL=https://staging.theworkademy.com
```

### Getting Your Credentials

**API Key:**
1. Log in to your Workademy account
2. Go to Account Settings or API Settings
3. Generate or copy your API key
4. Add it to your `.env` file

**Base URL:**
- Use the base URL of your Workademy instance
- Examples:
  - Staging: `https://staging.theworkademy.com`
  - Production: `https://app.theworkademy.com`
  - Custom domain: `https://your-company.theworkademy.com`
- Do not include `/api` or trailing slashes

### Claude Desktop Configuration

Add this to your Claude Desktop config file:

**MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "workademy": {
      "command": "node",
      "args": ["/absolute/path/to/workademy-mcp/dist/index.js"],
      "env": {
        "WORKADEMY_API_KEY": "your_api_key_here",
        "WORKADEMY_BASE_URL": "https://staging.theworkademy.com"
      }
    }
  }
}
```

## Available Tools

### Course Management

#### `list_courses`
List all courses with optional filtering.
```
Parameters:
- page: Page number (0-indexed)
- size: Items per page
- q: RSQL query (e.g., "name=='Data Science'")
- view: GROUPS, LEARNING_PATH_ELIGIBLE_COURSES, OWNED_COURSES, DEFAULT
```

#### `get_course`
Get detailed information about a specific course.
```
Parameters:
- courseId: Course ID (required)
- include: Related entities to include (e.g., "modules,questionAnswers")
```

#### `create_course`
Create a new course.
```
Parameters:
- name: Course name (required)
- description: Course description
- published: Publication status
- certifiable: Whether certificates are offered
- durationMinutes: Expected duration
```

#### `update_course`
Update an existing course.
```
Parameters:
- courseId: Course ID (required)
- courseData: JSON object with fields to update
```

#### `delete_course`
Delete a course.
```
Parameters:
- courseId: Course ID (required)
```

#### `clone_course`
Create a copy of an existing course.
```
Parameters:
- courseId: Course ID (required)
```

#### `generate_ai_course`
Generate a course using AI.
```
Parameters:
- topic: Main topic (required)
- context: Additional context
- locale: Language code (e.g., "en", "uk")
- noModules: Number of modules
- businessGoals: Business objectives
- learningGoal: Learning objectives
```

### User Management

#### `list_users`
List all users in the workspace.
```
Parameters:
- page, size: Pagination
- q: RSQL query filter
- view: LEARNING_PATHS, COURSES, WORKSPACE_ACCESS, GROUPS, SKILLS, DEFAULT
```

#### `get_user`
Get user details.
```
Parameters:
- userId: User ID (required)
```

#### `get_current_user`
Get currently authenticated user information.

#### `update_user`
Update user information.
```
Parameters:
- userId: User ID (required)
- userData: JSON object with fields to update
```

### Enrollment Management

#### `list_user_courses`
List all course enrollments with progress.
```
Parameters:
- page, size: Pagination
- q: RSQL query filter
```

#### `get_user_course`
Get detailed enrollment information.
```
Parameters:
- userCourseId: User course ID (required)
- include: Related entities to include
```

#### `enroll_user`
Enroll a user in a course.
```
Parameters:
- courseId: Course ID (required)
- userId: User ID (required)
```

#### `complete_user_course`
Mark enrollment as completed.
```
Parameters:
- userCourseId: User course ID (required)
```

### Group Management

#### `list_groups`
List all groups.
```
Parameters:
- page, size: Pagination
- search: Search term
```

#### `get_group`
Get group details.
```
Parameters:
- groupId: Group ID (required)
```

#### `create_group`
Create a new group.
```
Parameters:
- name: Group name (required)
- description: Group description
```

#### `add_user_to_group`
Add a user to a group.
```
Parameters:
- groupId: Group ID (required)
- userId: User ID (required)
```

#### `add_course_to_group`
Associate a course with a group.
```
Parameters:
- groupId: Group ID (required)
- courseId: Course ID (required)
```

### Learning Path Management

#### `list_learning_paths`
List all learning paths.
```
Parameters:
- page, size: Pagination
```

#### `create_learning_path`
Create a new learning path.
```
Parameters:
- name: Path name (required)
- description: Path description
- type: LEARNING_PATH or CAREER_PATH (required)
- steps: Array of step definitions
```

#### `delete_learning_path`
Delete a learning path.
```
Parameters:
- learningPathId: Learning path ID (required)
```

### Workspace Management

#### `list_workspaces`
List all accessible workspaces.

#### `get_workspace`
Get workspace details.
```
Parameters:
- workspaceId: Workspace ID or hostname (required)
```

### Skills Management

#### `list_skills`
List all skills and levels.
```
Parameters:
- page, size: Pagination
```

#### `create_skill`
Create a new skill.
```
Parameters:
- name: Skill name (required)
- description: Description
- levels: Array of level definitions
```

### Certificate Management

#### `get_certificate`
Get certificate information.
```
Parameters:
- certificateId: Certificate ID (required)
```

#### `list_certificate_templates`
List templates for a course.
```
Parameters:
- courseId: Course ID (required)
```

### Operations & Reporting

#### `list_operations`
List async operations.
```
Parameters:
- page, size: Pagination
```

#### `get_operation`
Get operation status.
```
Parameters:
- operationId: Operation ID (required)
```

#### `generate_user_course_report`
Generate progress reports.
```
Parameters:
- type: OVERVIEW or DETAILED (required)
- courseId: Filter by course (optional)
- groupId: Filter by group (optional)
- userId: Filter by user (optional)
```

### Survey & Assessment Tools

#### `get_pre_course_survey_report`
Get pre-course survey report with comprehensive analysis of all question answers.

**How it works:**
1. Initiates report generation (async operation)
2. Polls operation status until completion (max 2 minutes)
3. Downloads the CSV file automatically
4. Analyzes data and provides statistics

```
Parameters:
- courseId: Course ID (required)

Returns:
- operation: Operation details (status, URLs, metadata)
- csvUrl: Direct link to download CSV file
- csvData: Raw CSV content
- analysis: Statistical analysis including:
  - Total responses
  - Questions (column headers)
  - Response frequencies for each question
  - Top 10 answers with percentages
  - Summary statistics
```

**Example response structure:**
```json
{
  "operation": {
    "id": 3177,
    "status": "FINISHED",
    "courseName": "Course Name",
    "url": "https://...csv"
  },
  "analysis": {
    "totalResponses": 150,
    "totalColumns": 5,
    "headers": ["Question 1", "Question 2", ...],
    "columnAnalysis": {
      "Question 1": {
        "totalResponses": 150,
        "uniqueValues": 12,
        "frequency": {...},
        "topResponses": [
          {"value": "Answer A", "count": 75, "percentage": "50%"},
          ...
        ]
      }
    }
  }
}
```

## Usage Examples

### Example 1: List All Courses
```
Use the list_courses tool to show me all published courses
```

### Example 2: Create a New Course
```
Create a course called "Introduction to Python" with the description "Learn Python programming basics" and mark it as published
```

### Example 3: Enroll a User
```
Enroll user ID 123 in course ID 456
```

### Example 4: Generate an AI Course
```
Generate an AI course about "Data Science Fundamentals" in English with 5 modules, focused on business analytics
```

### Example 5: Create a Learning Path
```
Create a learning path called "Full Stack Developer" of type LEARNING_PATH with steps for frontend, backend, and database courses
```

### Example 6: Generate Report
```
Generate a detailed user course report for course ID 789
```

### Example 7: Get Pre-Course Survey Report
```
Get the pre-course survey report for course ID 4221 with analysis

This will:
- Generate the report
- Wait for it to complete
- Download the CSV
- Provide statistical analysis showing:
  - How many people responded
  - Top answers for each question
  - Response percentages
  - Frequency distributions
```

## Authentication

The server uses a simple API key authentication flow:

1. **Token Request**: 
   - Sends `grant_type=api_key` and your API key
   - Uses Basic authentication with system credentials (`Basic c3lzdGVtOkViNFRRaXpEdFlpYndJTHI=`)
   - Receives an access token

2. **API Requests**: 
   - Uses Bearer authentication with the obtained access token
   - Header: `Authorization: Bearer {{access_token}}`

Tokens are automatically:
- Obtained on first API call using your API key
- Cached for reuse
- Refreshed before expiration
- Retried on 401 errors

You only need to provide your Workademy API key - everything else is handled automatically!

## Error Handling

The server provides detailed error messages including:
- HTTP status codes
- API error messages
- Validation errors
- Authentication failures

## Data Visualization

The survey report tool provides analyzed data that can be easily visualized:

**Using Claude's Artifacts:**
Ask Claude to create charts from the survey data:
- "Create a bar chart showing the top responses for Question 1"
- "Make a pie chart of the response distribution"
- "Build a dashboard with all survey statistics"

**Export Options:**
- CSV data is available for import into Google Sheets, Excel, or Tableau
- Analysis includes pre-calculated percentages and frequencies
- Direct CSV download URL provided for external tools

## API Coverage

This MCP server implements the following Workademy API endpoints:

**Secured Endpoints:**
- `/api/v1/secured/courses/*` - Course management
- `/api/v1/secured/users/*` - User management
- `/api/v1/secured/usercourses/*` - Enrollment management
- `/api/v1/secured/groups/*` - Group management
- `/api/v1/secured/learningpaths/*` - Learning path management
- `/api/v1/secured/workspaces/*` - Workspace management
- `/api/v1/secured/skills/*` - Skills management
- `/api/v1/secured/certificates/*` - Certificate management
- `/api/v1/secured/operations/*` - Async operations
- Various reporting endpoints

## Development

### Running in Development Mode
```bash
npm run dev
```

### Building for Production
```bash
npm run build
npm start
```

### Project Structure
```
workademy-mcp/
├── src/
│   └── index.ts          # Main server implementation
├── dist/                 # Compiled JavaScript
├── package.json
├── tsconfig.json
└── README.md
```

## Troubleshooting

### Authentication Errors
- Verify username and password are correct
- Check if using correct base URL (staging vs production)
- Ensure account has necessary permissions

### Connection Issues
- Verify WORKADEMY_BASE_URL is accessible
- Check network/firewall settings
- Ensure API is not rate-limited

### Tool Errors
- Check tool parameter types and requirements
- Review error messages for specific guidance
- Verify IDs exist before operations

## Contributing

This MCP server is designed for integration with the Workademy LMS platform. For feature requests or issues related to the Workademy API itself, please contact Workademy support.

## License

MIT

## Related Resources

- [Workademy Platform](https://theworkademy.com)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [MCP Specification](https://spec.modelcontextprotocol.io)
