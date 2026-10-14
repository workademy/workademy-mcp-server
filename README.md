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

## Multiple workspaces

A Workademy API key belongs to exactly one workspace, and the API picks the workspace from the
hostname you call. To work with several workspaces, list them in `workspaces.json` in the project folder
(found automatically) or point `WORKADEMY_WORKSPACES_FILE` at another file. Every tool then takes an optional `workspace` argument
(alias, hostname or id); without it the `default` workspace is used.

```json
{
  "default": "edera",
  "workspaces": {
    "edera":    { "id": 10,  "hostname": "study.ed-era.com",          "apiKeyEnv": "WORKADEMY_API_KEY", "readOnly": false },
    "client-a": { "id": 123, "hostname": "client-a.theworkademy.com", "readOnly": true }
  }
}
```

- **Keys: `npm run keys`.** It asks for your Workademy login (the password is not shown), lists the workspaces your
  account can see, creates an API key in the ones you pick (`POST /api/v1/secured/workspaces/{id}/api-key`, with a
  comment saying who created it, so the client can see and revoke it), adds them to `workspaces.json` and stores the
  keys in `workspaces.keys.json` (permissions 600). Neither the password nor the keys are printed.
  Options: `--list`, `--only "Kognic, Clark"`, `--host`, `--force`. Both files are git-ignored.
- A key can also come from an environment variable named in `apiKeyEnv`; it wins over the keys file.
  `WORKADEMY_WORKSPACES_FILE=none` forces the old single-workspace setup.
- **Read-only by default.** Workspaces from the file refuse tools that change data (create, update, delete,
  enroll, complete, …) unless `"readOnly": false` is set.
- **id** is optional; without it the server looks it up. Setting it avoids one call and allows selecting the workspace by id.
- `list_configured_workspaces` with `verify: true` checks every key.

Claude Desktop:

```json
{
  "mcpServers": {
    "workademy": {
      "command": "node",
      "args": ["/absolute/path/to/workademy-mcp-server/dist/index.js"],
      "env": {
        "WORKADEMY_API_KEY": "… (only for entries that use apiKeyEnv)"
      }
    }
  }
}
```

The old single-workspace setup (`WORKADEMY_API_KEY` + `WORKADEMY_BASE_URL`) still works and shows up as the
workspace `default`. Set `WORKADEMY_READ_ONLY=true` to protect it as well.

**OAuth client.** API-key logins use the built-in OAuth client. If it ever changes, set `WORKADEMY_OAUTH_CLIENT_ID`
and `WORKADEMY_OAUTH_CLIENT_SECRET` (or a base64 `WORKADEMY_OAUTH_CLIENT_BASIC`).

Other optional settings: `WORKADEMY_EXPORT_DIR` (where `export_report` saves CSVs, default: the system temp folder), `WORKADEMY_REPORTS_DIR` (where the client PDFs go, default: `reports/` in the project folder) and `WORKADEMY_CHROME_PATH` (the browser that prints them, if Chrome is not in its usual place).

## Analytics and reporting tools

| Tool | What it returns |
|---|---|
| `list_configured_workspaces` | Configured workspaces (never the keys); `verify: true` tests each key |
| `get_workspace_summary` | Courses (published, active, archived, new in 30 days), users, groups by HR-sync source, learning paths, invitations sent/accepted |
| `get_analytics` | The admin-dashboard numbers from the analytics service: enrollments, certificates, lectures seen, right/wrong answers, logins, activity. Drill down course → module → lecture → question; totals or timeseries |
| `get_course_completion` | Completion per course from enrollment records (finished, in progress, not started, inactive, expired, abandoned, avg minutes, avg quiz score); works without the analytics service |
| `get_group_course_stats` | Completion per department (group) and course; small groups and cells hidden |
| `export_report` | Runs a CSV export (workspace, course, group, user, learning path), waits, downloads it and returns the path. The file has named data |
| `get_admin_todos` | Pending enrollment approvals, ungraded open answers, scheduled runs coming up |
| `get_monthly_report` | Aggregate-only monthly report for a client one-pager: headline numbers, per-course enrollments and completions, the month's busiest courses, the previous month's totals, certificates, logins, most-missed questions, departments, upcoming runs, admin to-dos |
| `get_workspace_branding` | The workspace's logos, theme colours and company name from its `profile.json` |
| `create_monthly_report_pdf` | The client one-pager as a one-page A4 PDF (see below), saved in `reports/<month>/`; says whether the month is worth sending |

**Privacy.** The report and stats tools return counts only — no names, e-mails or user ids. Departments with fewer
than `minGroupSize` members (default 5), department/course cells below that size and questions with fewer answers
are left out, so nobody can be singled out. Named data only comes from the original per-user tools and from
`export_report` files.

The analytics service (`/analytics-api/…`) is not in the public Swagger; the paths follow what the Workademy web app
calls. If a workspace's key cannot reach it, `get_monthly_report` falls back to computing enrollments from the
core API and says so in `warnings`.

### Monthly client reports (PDF)

Each client gets a one-page A4 PDF they can forward to their management: the month's numbers, the courses
people went to, the quiz questions most people got wrong ("Where to look"), in Workademy's brand with the client's
logo. It is made from `get_monthly_report`, so it holds counts only.

```bash
npm run reports                          # last month, every workspace in workspaces.json
npm run reports -- --month 2026-09       # a given month
npm run reports -- --only edera,clark    # some workspaces
npm run reports -- --all                 # also PDFs for quiet months
```

The PDFs land in `reports/<month>/<Client>_Workademy_report_<month>.pdf` (git-ignored), with the numbers each one
was made from (`<workspace>.report.json`, counts only) and `summary.md`:
who gets the report, who gets the win-back email instead (fewer than 5 completions and fewer than 20 new
enrolments in the month), and what failed.
From Claude, `create_monthly_report_pdf` makes one client's PDF.

Workademy's API sits behind a firewall that blocks an IP for a few minutes after a burst of requests (a 403 web page
instead of a JSON error). The run therefore paces itself (about 4 requests a second, `WORKADEMY_MIN_REQUEST_GAP_MS`)
and waits out a block (up to 10 minutes in total, `WORKADEMY_RATE_LIMIT_WAIT_MS`). A workspace whose numbers are
missing or incomplete is listed under "Failed" with a ready-to-paste command to run it again; it never lands on the
win-back list.

Settings per workspace go in a `report` block in `workspaces.json` (all optional):

```json
"edera":   { "...": "...", "report": { "client": "EdEra", "language": "uk" } },
"clark":   { "...": "...", "report": { "language": "de", "logo": "https://…/clark-logo.svg", "minCompletions": 10 } },
"demo":    { "...": "...", "report": { "skip": true } }
```

| Setting | Default |
|---|---|
| `client` | the workspace name; used on the page and in the file name |
| `language` | `en`, `de` or `uk`; default from the workspace's locale, else `en` |
| `logo` | URL or file (relative to this folder); default: the workspace's own logo (white logos are skipped) |
| `headline` | the lead sentence is picked from the data (strong growth on last month, one course with 40%+ of enrolments, smaller growth, or the busiest course; never a decline); set this for a hand-written one |
| `minCompletions` | 5: completions that make the month worth a report… |
| `minEnrollments` | 20: …or new enrolments (a client whose activity grows gets a report, not a win-back email) |
| `skip` | leave the workspace out of `npm run reports` (internal or demo workspaces) |

How it works: the page is printed by the Chrome on this computer (through `playwright-core`; no browser download).
Fonts (Staatliches, Oswald for Cyrillic, Roboto; SIL Open Font License) and the Workademy logo are in `assets/`.
Before printing, the page is measured; if it is too long it gets more compact step by step (tighter spacing,
fewer table rows), and the finished PDF is checked to be exactly one page.

### Testing

`npm run build && npm run test:smoke` starts two mock workspaces and drives the built server over MCP:
routing, read-only protection, token refresh, analytics paths, the monthly report (with and without
analytics access), exports, the legacy single-key setup, `npm run keys`, the one-pager's wording and, when
Chrome or Chromium is installed, the PDFs and `npm run reports`.

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
