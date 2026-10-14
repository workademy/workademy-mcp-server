// Minimal mock of the Workademy core API, analytics API and OAuth token endpoint.
// One mock = one workspace on one host. Used by test/smoke.mjs only.
import http from "node:http";

const DAY = 24 * 60 * 60 * 1000;

// Learner names that must never appear in aggregate outputs
export const LEARNER_NAMES = ["Anna Schmidt", "Ben Mueller", "Carla Rossi", "David Novak", "Eva Lindqvist", "Farid Haddad"];

function userCourses(courseId, courseName, count, { finished = 0, now }) {
  return Array.from({ length: count }, (_, i) => {
    const isFinished = i < finished;
    const started = i < finished + Math.floor((count - finished) / 2);
    return {
      id: courseId * 1000 + i,
      username: `user${i}@client.example`,
      name: LEARNER_NAMES[i % LEARNER_NAMES.length],
      course: { id: courseId, name: courseName },
      createTime: now - (i % 2 === 0 ? 10 : 60) * DAY,
      startTime: started ? now - 9 * DAY : null,
      finishTime: isFinished ? now - 5 * DAY : null,
      progressStatus: isFinished ? "FINISHED" : started ? "IN_PROGRESS" : "INACTIVE",
      abandoned: false,
      completedInMinutes: isFinished ? 30 + i : null,
      rightQuestionAnswers: isFinished ? 8 : 0,
      questionAnswersSize: isFinished ? 10 : 0,
    };
  });
}

function page(items, query) {
  const size = Number(query.get("size") ?? 20);
  const number = Number(query.get("page") ?? 0);
  const content = items.slice(number * size, number * size + size);
  const totalPages = Math.max(Math.ceil(items.length / size), 1);
  return { content, totalElements: items.length, totalPages, number, size, last: number >= totalPages - 1 };
}

const WEBAPP_CLIENT = "d2ViYXBwOnRlc3Q="; // the web app's password-login client

export async function startMock({
  workspaceId,
  name,
  apiKey,
  clientBasic,
  analytics = true,
  host = "127.0.0.1",
  users = {}, // e-mail -> password, for the password grant
  userWorkspaces = null, // what GET /workspaces returns for a logged-in user
  slowUngradedMs = 0, // simulate the slow ungraded-answers count of large workspaces
}) {
  const now = Date.now();
  const state = {
    log: [],
    tokens: new Set(),
    userTokens: new Set(),
    apiKeys: new Set([apiKey]),
    createdKeys: [],
    tokenRequests: 0,
    always401: new Set(),
    polls: 0,
  };

  const courses = [
    { id: 101, name: "<p>Data protection refresher</p>", published: true, active: true, createTime: now - 40 * DAY },
    { id: 102, name: "Safety instruction", published: true, active: true, createTime: now - 10 * DAY },
    { id: 103, name: "Draft course", published: false, active: false, createTime: now - 5 * DAY },
  ];
  const byCourse = {
    101: userCourses(101, "Data protection refresher", 150, { finished: 120, now }),
    102: userCourses(102, "Safety instruction", 20, { finished: 5, now }),
    103: [],
  };
  const groups = [
    { id: 1, name: "Sales", userCount: 0, source: "PERSONIO", workspaceId }, // the list never fills userCount
    { id: 2, name: "Legal", userCount: 0, source: "WORKADEMY", workspaceId },
  ];
  const byGroup = {
    1: [
      ...userCourses(101, "Data protection refresher", 12, { finished: 8, now }),
      ...userCourses(102, "Safety instruction", 2, { finished: 1, now }),
    ],
    2: userCourses(101, "Data protection refresher", 3, { finished: 1, now }),
  };
  const usersAccess = Array.from({ length: 130 }, (_, i) => ({ id: i, accepted: i < 100, sent: true }));

  let base = "";

  const analyticsRoute = (path, query) => {
    const start = Number(query.get("start") ?? 0);
    const toDate = start < now - 100 * DAY;
    const ws = `/analytics-api/v1/secured/workspaces/${workspaceId}`;
    const courseExtra = { courses: { 101: { name: "<p>Data protection refresher</p>" }, 102: { name: "Safety instruction" } } };
    switch (path) {
      case `${ws}/courses/facts/usercourse`:
        return {
          content: toDate
            ? [
                { courseId: 101, amountStarted: 150, amountMsCourseStarted: 140, amountEnded: 120, amountAbandoned: 2, avgDaysBetweenEnded: 3.24 },
                { courseId: 102, amountStarted: 20, amountMsCourseStarted: 12, amountEnded: 5, amountAbandoned: 0, avgDaysBetweenEnded: 6 },
              ]
            : [
                { courseId: 101, amountStarted: 12, amountMsCourseStarted: 10, amountEnded: 9, amountAbandoned: 0 },
                { courseId: 102, amountStarted: 20, amountMsCourseStarted: 12, amountEnded: 5, amountAbandoned: 0 },
              ],
          extra: courseExtra,
          totalElements: 2,
        };
      case `${ws}/facts/usercourse`:
        return {
          content: [
            toDate
              ? { courseId: null, amountStarted: 170, amountEnded: 125, amountAbandoned: 2 }
              : { courseId: null, amountStarted: 32, amountEnded: 14, amountAbandoned: 0 },
          ],
          totalElements: 1,
        };
      case `${ws}/facts/certificate`:
        return { content: [{ courseId: null, amountIssued: 9, avgScore: 88.46 }], totalElements: 1 };
      case `${ws}/courses/facts/certificate`:
        return { content: [{ courseId: 101, amountIssued: 9, avgScore: 88.46, minScore: 70, maxScore: 100 }], extra: courseExtra };
      case `${ws}/courses/101/modules/facts/questionanswer`:
        return {
          content: [
            { moduleId: 11, amountCorrect: 30, amountWrong: 12 },
            { moduleId: 12, amountCorrect: 40, amountWrong: 2 },
          ],
          extra: { modules: { 11: { name: "Incidents" }, 12: { name: "Basics" } } },
        };
      case `${ws}/courses/101/modules/11/lectures/facts/questionanswer`:
        return { content: [{ lectureId: 111, amountCorrect: 20, amountWrong: 10 }], extra: { lectures: { 111: { name: "Reporting a breach" } } } };
      case `${ws}/courses/101/modules/11/lectures/111/questionanswers/facts/questionanswer`:
        return {
          content: [
            { questionAnswerId: 9001, amountCorrect: 5, amountWrong: 9, avgWrongAttempts: 1.84 },
            { questionAnswerId: 9002, amountCorrect: 2, amountWrong: 1, avgWrongAttempts: 1 },
          ],
          extra: { questionAnswers: { 9001: { name: "<p>Within how many hours must a breach be reported?</p>" }, 9002: { name: "Tiny sample question" } } },
        };
      case `${ws}/facts/workspace`:
        return { content: [{ amountLogin: 230, amountRegister: 4 }], extra: {} };
      case `/analytics-api/v1/secured/workspaces-activity/${workspaceId}/facts/activity`:
        return { activityCount: 37 };
      default:
        if (path.startsWith(ws)) return { content: [], extra: {} };
        return undefined;
    }
  };

  const coreRoute = (method, path, query, isUser, body) => {
    let m;
    if (method === "GET" && path === "/api/v1/secured/workspaces")
      return page(isUser && userWorkspaces ? userWorkspaces : [{ id: workspaceId, name, hostname: new URL(base).host }], query);
    if (method === "POST" && path === `/api/v1/secured/workspaces/${workspaceId}/api-key`) {
      if (!isUser) return { __status: 403, message: "admins only" };
      const key = `key-new-${workspaceId}-${state.createdKeys.length + 1}`;
      state.apiKeys.add(key);
      state.createdKeys.push({ key, comment: body?.comment });
      return { id: state.createdKeys.length, comment: body?.comment, apiKey: key };
    }
    if (method === "GET" && (m = path.match(/^\/api\/v1\/secured\/courses\/(\d+)$/)))
      return courses.find((c) => String(c.id) === m[1]);
    if (method === "GET" && path === `/api/v1/secured/workspaces/${workspaceId}`)
      return { id: workspaceId, name, hostname: new URL(base).host, createTime: now - 365 * DAY, locale: "de_DE" };
    if (method === "GET" && path === "/api/v1/secured/users/me")
      return { id: 1, username: `WORKSPACE_ID_${workspaceId}@system.example`, roles: [{ name: "ROLE_ADMIN" }] };
    if (method === "GET" && path === "/api/v1/secured/courses") return page(courses, query);
    if (method === "GET" && (m = path.match(/^\/api\/v1\/secured\/courses\/(\d+)\/usercourses$/)))
      return page(byCourse[m[1]] ?? [], query);
    if (method === "DELETE" && (m = path.match(/^\/api\/v1\/secured\/courses\/(\d+)$/))) return null;
    if (method === "GET" && path === "/api/v1/secured/users")
      return page(Array.from({ length: 120 }, (_, i) => ({ id: i })), query);
    if (method === "GET" && path === "/api/v1/secured/groups") return page(groups, query);
    if (method === "GET" && (m = path.match(/^\/api\/v1\/secured\/groups\/(\d+)$/)))
      return groups.find((g) => String(g.id) === m[1]);
    if (method === "GET" && (m = path.match(/^\/api\/v1\/secured\/groups\/(\d+)\/users$/)))
      return page(Array.from({ length: { 1: 12, 2: 3 }[m[1]] ?? 0 }, (_, i) => ({ id: i })), query);
    if (method === "GET" && (m = path.match(/^\/api\/v1\/secured\/groups\/(\d+)\/usercourses$/)))
      return page(byGroup[m[1]] ?? [], query);
    if (method === "GET" && path === "/api/v1/secured/learningpaths") return page([{ id: 1 }, { id: 2 }], query);
    if (method === "GET" && path === `/api/v1/secured/workspaces/${workspaceId}/usersaccess`) return page(usersAccess, query);
    if (method === "GET" && path === "/api/v1/secured/enrollment-approvals")
      return page([{ id: 1, approved: false }, { id: 2, approved: true }], query);
    if (method === "GET" && path === "/api/v1/secured/ucqas/_ungraded-open-ended-answers")
      return { content: [], totalElements: 4 };
    if (method === "GET" && path === "/api/v1/secured/schedules")
      return page(
        [
          { "@type": "COURSE", course: { id: 101, name: "Data protection refresher" }, nextExecutionTime: now + 10 * DAY, period: "YEARLY" },
          { "@type": "COURSE", course: { id: 102, name: "Safety instruction" }, nextExecutionTime: now + 100 * DAY, period: "YEARLY" },
        ],
        query
      );
    if (method === "POST" && path === `/api/v1/secured/workspaces/${workspaceId}/usercourses/_report`)
      return { id: 77, status: "SCHEDULED" };
    if (method === "GET" && path === "/api/v1/secured/operations/77") {
      state.polls += 1;
      return state.polls < 2
        ? { id: 77, status: "PROGRESSING" }
        : { id: 77, status: "FINISHED", url: `${base}/files/77.csv` };
    }
    return undefined;
  };

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const url = new URL(req.url, base);
      const path = url.pathname;
      const auth = req.headers.authorization ?? "";
      state.log.push({ method: req.method, path, query: url.search });
      const send = (status, payload, type = "application/json") => {
        res.writeHead(status, { "Content-Type": type });
        res.end(payload === undefined || payload === null ? "" : type === "application/json" ? JSON.stringify(payload) : payload);
      };

      if (path === "/__control/invalidate") {
        state.tokens.clear();
        return send(200, { ok: true });
      }
      if (path === "/__control/reset401") {
        state.always401.clear();
        return send(200, { ok: true });
      }
      if (path === "/__control/always401") {
        state.always401.add(url.searchParams.get("path"));
        return send(200, { ok: true });
      }
      if (path === "/oauth/token" && req.method === "POST") {
        state.tokenRequests += 1;
        const form = new URLSearchParams(body);
        if (form.get("grant_type") === "password") {
          if (auth !== `Basic ${WEBAPP_CLIENT}`) return send(401, { error: "invalid_client" });
          if (!users[form.get("username")] || users[form.get("username")] !== form.get("password"))
            return send(400, { error: "invalid_grant", error_description: "Bad credentials" });
          const token = `user-${workspaceId}-${state.tokenRequests}`;
          state.tokens.add(token);
          state.userTokens.add(token);
          return send(200, { access_token: token, token_type: "bearer", expires_in: 3600 });
        }
        if (auth !== `Basic ${clientBasic}`) return send(401, { error: "invalid_client" });
        if (form.get("grant_type") !== "api_key" || !state.apiKeys.has(form.get("api_key")))
          return send(401, { error: "invalid_grant" });
        const token = `tok-${workspaceId}-${state.tokenRequests}`;
        state.tokens.add(token);
        return send(200, { access_token: token, token_type: "bearer", expires_in: 3600 });
      }
      if (path === "/files/77.csv") {
        return send(200, `User,Email,Course,Status\n${LEARNER_NAMES[0]},a@x,Data protection refresher,FINISHED\n${LEARNER_NAMES[1]},b@x,Data protection refresher,IN_PROGRESS\n`, "text/csv");
      }

      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (state.always401.has(path) || !state.tokens.has(token)) {
        return send(401, { error: "invalid_token", error_description: "Full authentication is required to access this resource" });
      }
      if (path.startsWith("/analytics-api/")) {
        if (!analytics) return send(403, { error: "access_denied", error_description: "Access is denied" });
        const result = analyticsRoute(path, url.searchParams);
        return result === undefined ? send(404, { error: "Not Found" }) : send(200, result);
      }
      let parsedBody = null;
      try { parsedBody = body ? JSON.parse(body) : null; } catch { parsedBody = null; }
      if (path === "/api/v1/secured/ucqas/_ungraded-open-ended-answers" && slowUngradedMs) {
        return setTimeout(() => send(200, { content: [], totalElements: 4 }), slowUngradedMs);
      }
      const result = coreRoute(req.method, path, url.searchParams, state.userTokens.has(token), parsedBody);
      if (result === undefined) return send(404, { message: `mock: no route for ${req.method} ${path}` });
      if (result && result.__status) return send(result.__status, { message: result.message });
      return result === null ? send(204, null) : send(200, result);
    });
  });

  await new Promise((resolve) => server.listen(0, host, resolve));
  base = `http://${host}:${server.address().port}`;
  return { url: base, state, close: () => new Promise((resolve) => server.close(resolve)) };
}
