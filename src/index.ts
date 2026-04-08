import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import jwt from "jsonwebtoken";
import cors from "cors";

// Typically handle this in environment variables
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key"; 

const app = express();
app.use(cors());

// Basic JWT middleware
app.use((req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).send("Unauthorized: No token provided");
  
  jwt.verify(token, JWT_SECRET, (err) => {
    if (err) return res.status(403).send("Forbidden: Invalid token");
    next();
  });
});

const server = new Server(
  { name: "mcp-dummy-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "add_numbers",
    description: "Adds two numbers",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "add_numbers") {
    const args = request.params.arguments as { a?: number; b?: number };
    if (typeof args.a === 'number' && typeof args.b === 'number') {
      return { content: [{ type: "text", text: String(args.a + args.b) }] };
    }
  }
  throw new Error("Tool not found or invalid arguments");
});

let transport: SSEServerTransport;

app.get("/sse", async (req, res) => {
  transport = new SSEServerTransport("/message", res);
  await server.connect(transport);
});

app.post("/message", express.json(), async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("No valid SSE connection");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP SSE Server running on port ${PORT} with JWT authentication`);
  console.log(`\nTest token (use in Authorization header: Bearer <token>):\n${jwt.sign({ user: 'demo' }, JWT_SECRET)}\n`);
});
