# Workademy MCP Server - Evaluation Questions

These questions are designed to evaluate the functionality and effectiveness of the Workademy MCP server. Test these with an LLM to ensure proper operation.

## 1. Course Discovery
**Question:** "What courses are available in my Workademy workspace? Show me the first 10 courses."

**Expected Behavior:**
- Uses `list_courses` tool with appropriate pagination
- Returns course names, descriptions, and IDs
- Presents information in readable format

## 2. Course Details
**Question:** "Tell me everything about course ID [insert actual ID]. Include the modules and question answers."

**Expected Behavior:**
- Uses `get_course` tool with include parameter
- Shows comprehensive course information
- Displays module structure and assessments

## 3. User Enrollment Status
**Question:** "Show me all active course enrollments. Which courses am I currently taking?"

**Expected Behavior:**
- Uses `list_user_courses` tool
- Filters for active enrollments
- Shows progress information

## 4. Group Management
**Question:** "Create a new group called 'Data Science Team' with the description 'Team members learning data science and analytics'"

**Expected Behavior:**
- Uses `create_group` tool
- Creates group with provided details
- Returns new group ID

## 5. Course Creation
**Question:** "Create a new course called 'Introduction to Machine Learning' with a description about teaching ML fundamentals. Make it published and certifiable."

**Expected Behavior:**
- Uses `create_course` tool
- Sets appropriate fields
- Returns created course details

## 6. AI Course Generation
**Question:** "Generate a 4-module AI course about 'Cybersecurity Basics' in English. The target audience is IT professionals and the business goal is to improve security awareness."

**Expected Behavior:**
- Uses `generate_ai_course` tool
- Passes all relevant parameters
- Returns operation ID for tracking

## 7. User Administration
**Question:** "Who is the current authenticated user? Show me my profile information."

**Expected Behavior:**
- Uses `get_current_user` tool
- Displays user profile details
- Shows roles and permissions

## 8. Learning Path Creation
**Question:** "Create a learning path called 'Frontend Developer Journey' of type LEARNING_PATH with a description about becoming a frontend developer."

**Expected Behavior:**
- Uses `create_learning_path` tool
- Creates path with correct type
- Returns learning path details

## 9. Reporting
**Question:** "Generate a detailed report for course ID [insert ID] showing all user progress and completion rates."

**Expected Behavior:**
- Uses `generate_user_course_report` tool
- Selects DETAILED type
- Returns operation for async processing

## 10. Complex Workflow
**Question:** "I want to enroll user ID [X] in course ID [Y], then check their enrollment status to confirm it worked."

**Expected Behavior:**
- Uses `enroll_user` tool first
- Then uses `list_user_courses` or `get_user` to verify
- Confirms enrollment was successful

## Success Criteria

The MCP server is functioning correctly if:

1. **Authentication**: All tools can authenticate successfully with provided credentials
2. **Error Handling**: Invalid requests return clear, helpful error messages
3. **Data Retrieval**: List and get operations return properly formatted data
4. **Data Modification**: Create, update, and delete operations work as expected
5. **Pagination**: Large datasets are handled properly with pagination
6. **Parameter Validation**: Tools reject invalid parameters with clear messages
7. **Response Format**: All responses are properly formatted JSON when appropriate
8. **Complex Operations**: Multi-step workflows execute successfully
9. **API Coverage**: All major Workademy features are accessible
10. **Documentation**: Tool descriptions and parameters are clear and accurate

## Performance Benchmarks

- **Simple queries** (list, get): < 2 seconds
- **Creation operations**: < 3 seconds
- **Complex operations** (AI generation): Acknowledged immediately with operation ID
- **Authentication**: Cached and reused efficiently

## Common Issues to Test

1. **Invalid credentials**: Should return clear authentication error
2. **Missing required parameters**: Should specify which parameters are needed
3. **Non-existent IDs**: Should return 404 with helpful message
4. **Permission errors**: Should indicate insufficient permissions
5. **Rate limiting**: Should handle gracefully if implemented

## Notes for Evaluators

- Replace `[insert ID]` with actual IDs from your Workademy instance
- Test both successful and error scenarios
- Verify that tool descriptions accurately match behavior
- Check that returned data matches Workademy API documentation
- Ensure sensitive data (passwords, tokens) is never logged
