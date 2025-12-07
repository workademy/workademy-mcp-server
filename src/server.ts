import express, { Request, Response } from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// --- Config (adapt to your real API) ---
const WORKADEMY_API_URL = process.env.WORKADEMY_API_URL ?? "https://api.workademy.com";
const WORKADEMY_API_KEY = process.env.WORKADEMY_API_KEY; // e.g. service token

// --- Create MCP server ---
const mcpServer = new McpServer({
  name: "workademy-mcp",
  version: "0.1.0",
});

// --- Tool: list_courses ---
mcpServer.registerTool(
  "list_courses",
  {
    title: "List Workademy courses",
    description: "Returns a list of courses from the Workademy workspace.",
    inputSchema: {
      search: z.string().optional().describe("Optional search string to filter courses by title"),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    },
    // You *can* also define outputSchema with zod if you want stricter typing for tools
  },
  async ({ search, limit, offset }) => {
    const url = new URL("/courses", WORKADEMY_API_URL);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    if (search) url.searchParams.set("search", search);

    const res = await fetch(url.toString(), {
      headers: {
        "Content-Type": "application/json",
        ...(WORKADEMY_API_KEY ? { Authorization: `Bearer ${WORKADEMY_API_KEY}` } : {}),
      },
    });

    if (!res.ok) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching courses: ${res.status} ${res.statusText}`,
          },
        ],
      };
    }

    const data = await res.json();

    // Normalize to something the model can easily use
    // Adjust structure to match your real API
    const courses = (data.items ?? data.courses ?? []).map((c: any) => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      summary: c.summary ?? c.description ?? null,
      status: c.status ?? null,
      createdAt: c.createdAt ?? null,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              total: data.total ?? courses.length,
              limit,
              offset,
              courses,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Tool: get_course ---
mcpServer.registerTool(
  "get_course",
  {
    title: "Get details of a Workademy course",
    description: "Fetches a single course by ID or slug.",
    inputSchema: {
      id: z.string().optional().describe("Course ID"),
      slug: z.string().optional().describe("Course slug"),
    },
  },
  async ({ id, slug }) => {
    if (!id && !slug) {
      return {
        content: [
          {
            type: "text",
            text: "You must provide either id or slug.",
          },
        ],
      };
    }

    const path = id ? `/courses/${id}` : `/courses/by-slug/${encodeURIComponent(slug!)}`;
    const url = new URL(path, WORKADEMY_API_URL);

    const res = await fetch(url.toString(), {
      headers: {
        "Content-Type": "application/json",
        ...(WORKADEMY_API_KEY ? { Authorization: `Bearer ${WORKADEMY_API_KEY}` } : {}),
      },
    });

    if (!res.ok) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching course: ${res.status} ${res.statusText}`,
          },
        ],
      };
    }

    const course = await res.json();

    // Again, adapt shape to your real API
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              id: course.id,
              slug: course.slug,
              title: course.title,
              summary: course.summary ?? course.description ?? null,
              status: course.status ?? null,
              sections: course.sections ?? [],
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- HTTP server using Streamable HTTP transport ---
const app = express();
app.use(express.json());

const transport = new StreamableHTTPServerTransport({
  // undefined => stateless; or provide a generator to track sessions
  sessionIdGenerator: undefined,
});

app.all("/mcp", async (req: Request, res: Response) => {
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

const port = process.env.PORT || 3000;

async function start() {
  await mcpServer.connect(transport);
  app.listen(port, () => {
    console.log(`Workademy MCP server listening on http://localhost:${port}/mcp`);
  });
}

start().catch((err) => {
  console.error("Failed to start MCP server:", err);
  process.exit(1);
});
