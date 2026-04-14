import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import cors from "cors";

const API_BASE_URL = "http://localhost:4000";

const app = express();
app.use(cors());

const createMcpServer = () => {
  const server = new Server(
    { name: "mcp-api-bridge", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "create_project",
        description: "Creates a new project via the REST API",
        inputSchema: { type: "object", properties: { projectName: { type: "string" } }, required: ["projectName"] },
      },
      {
        name: "list_projects",
        description: "Lists all projects from the REST API",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "update_project",
        description: "Updates a project status via the REST API",
        inputSchema: { 
          type: "object", 
          properties: { id: { type: "string" }, status: { type: "string" } }, 
          required: ["id", "status"] 
        },
      },
      {
        name: "delete_project",
        description: "Deletes a project by ID via the REST API",
        inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      }
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === "create_project") {
        const response = await fetch(`${API_BASE_URL}/projects`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args)
        });
        const data = await response.json();
        return { content: [{ type: "text", text: `API Created: ${data.projectName} (${data._id})` }] };
      }

      if (name === "list_projects") {
        const response = await fetch(`${API_BASE_URL}/projects`);
        const data = await response.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      if (name === "update_project") {
        const { id, status } = args as { id: string, status: string };
        const response = await fetch(`${API_BASE_URL}/projects/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status })
        });
        const data = await response.json();
        return { content: [{ type: "text", text: `API Updated ${id} to ${data.status}` }] };
      }

      if (name === "delete_project") {
        const { id } = args as { id: string };
        await fetch(`${API_BASE_URL}/projects/${id}`, { method: "DELETE" });
        return { content: [{ type: "text", text: `API Deleted ${id}` }] };
      }
    } catch (err: any) {
      throw new Error(`API Bridge Error: ${err.message}`);
    }

    throw new Error("Tool not found");
  });

  return server;
};

const activeSessions = new Map<string, { transport: SSEServerTransport; server: Server }>();

app.get("/sse", async (req, res) => {
  const server = createMcpServer();
  const transport = new SSEServerTransport("/message", res);
  activeSessions.set(transport.sessionId, { transport, server });

  res.on("close", async () => {
    const session = activeSessions.get(transport.sessionId);
    if (session) {
      activeSessions.delete(transport.sessionId);
      await session.server.close();
    }
  });

  await server.connect(transport);
});

app.post("/message", async (req, res) => {
  const sessionId = String(req.query.sessionId || "");
  const session = activeSessions.get(sessionId);

  if (session) {
    await session.transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("No valid SSE session");
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🔗 MCP API Bridge running at http://localhost:${PORT}`);
});
