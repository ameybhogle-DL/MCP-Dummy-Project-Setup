import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import jwt from "jsonwebtoken";
import cors from "cors";
import mongoose from "mongoose";


// Typically handle this in environment variables
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

const app = express();
app.use(cors());

// Visual Manager Dashboard (No Auth needed, purely for Demo visualization!)
app.get("/dashboard", async (req, res) => {
  const projects = await Project.find({});
  let html = `<html style="font-family: Arial; padding: 20px; background: #fdfdfd;">
    <h2>OSM Demo Dashboard (Live DB View)</h2>
    <table border="1" cellpadding="10" style="border-collapse: collapse; width: 100%; max-width: 800px; background: white;">
      <tr><th>ID</th><th>Project Name</th><th>Status</th></tr>`;

  projects.forEach(p => {
    html += `<tr><td>${p._id}</td><td><b>${p.projectName}</b></td><td><span style="background: #eef; padding: 5px; border-radius: 5px;">${p.status}</span></td></tr>`;
  });

  html += `</table><p style="color: gray;">Refresh to see chatbot changes in the database.</p></html>`;
  res.send(html);
});

// Basic JWT middleware
app.use((req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).send("Unauthorized: No token provided");

  jwt.verify(token, JWT_SECRET, (err) => {
    if (err) return res.status(403).send("Forbidden: Invalid token");
    next();
  });
});

// Connect to MongoDB
mongoose.connect("mongodb://localhost:27017/osm_mock")
  .then(() => console.log("Connected to MongoDB (osm_mock)"))
  .catch(err => console.error("MongoDB connection error:", err));

// Define Project Schema and Model
const projectSchema = new mongoose.Schema({
  projectName: { type: String, required: true },
  status: { type: String, default: "Draft" }
});

const Project = mongoose.model("Project", projectSchema);


const server = new Server(
  { name: "mcp-dummy-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "create_project",
      description: "Creates a new project",
      inputSchema: { type: "object", properties: { projectName: { type: "string" } }, required: ["projectName"] },
    },
    {
      name: "list_projects",
      description: "Lists all projects",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "update_project",
      description: "Updates an existing project status",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" }, status: { type: "string" } },
        required: ["id", "status"]
      },
    },
    {
      name: "delete_project",
      description: "Deletes a project by ID",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    }
  ],
}));


server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "create_project") {
    const args = request.params.arguments as { projectName?: string };
    if (typeof args.projectName === "string") {
      const project = await Project.create({ projectName: args.projectName });
      return { content: [{ type: "text", text: `Successfully created project: ${project.projectName} with ID: ${project._id}` }] };
    }
    throw new Error("Invalid arguments");
  }

  if (request.params.name === "list_projects") {
    const projects = await Project.find({});
    return { content: [{ type: "text", text: JSON.stringify(projects, null, 2) }] };
  }

  if (request.params.name === "update_project") {
    const args = request.params.arguments as { id?: string, status?: string };
    if (args.id && args.status) {
      const updated = await Project.findByIdAndUpdate(args.id, { status: args.status }, { new: true });
      return { content: [{ type: "text", text: `Updated project ${args.id} to status: ${updated?.status}` }] };
    }
    throw new Error("Invalid arguments: Need id and status");
  }

  if (request.params.name === "delete_project") {
    const args = request.params.arguments as { id?: string };
    if (args.id) {
      await Project.findByIdAndDelete(args.id);
      return { content: [{ type: "text", text: `Successfully deleted project ${args.id}` }] };
    }
    throw new Error("Invalid arguments: Need id");
  }

  throw new Error("Tool not found");
});

let transport: SSEServerTransport;

app.get("/sse", async (req, res) => {
  transport = new SSEServerTransport("/message", res);
  await server.connect(transport);
});

app.post("/message", async (req, res) => {
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
