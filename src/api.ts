import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import OpenAI from "openai";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "default_secret";
const APP_PASSWORD = process.env.APP_PASSWORD || "admin";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 4000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const LLM_API_KEY = GROQ_API_KEY || GEMINI_API_KEY;
const USE_GROQ = Boolean(GROQ_API_KEY);
const LLM_BASE_URL = USE_GROQ
  ? "https://api.groq.com/openai/v1"
  : "https://generativelanguage.googleapis.com/v1beta/openai/";
const LLM_MODEL = USE_GROQ ? "openai/gpt-oss-20b" : "gemini-flash-latest";

if (!LLM_API_KEY) {
  console.error("❌ Missing GROQ_API_KEY or GEMINI_API_KEY in .env file.");
  process.exit(1);
}

// 1. Connect to MongoDB
mongoose.connect("mongodb://localhost:27017/osm_mock")
  .then(() => console.log("✅ API: Connected to MongoDB (osm_mock)"))
  .catch(err => console.error("❌ API: MongoDB connection error:", err));

// 2. Define Project Schema (Phase 2 uses 'api_projects' collection)
const projectSchema = new mongoose.Schema({
  projectName: { type: String, required: true },
  status: { type: String, default: "Draft" },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'api_projects' });

const ApiProject = mongoose.model("ApiProject", projectSchema);

// 2. Auth Middleware
const authMiddleware = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Access denied" });
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
};

// 3. Auth Endpoints
app.post("/login", (req, res) => {
  const { password } = req.body;
  if (password === APP_PASSWORD) {
    const token = jwt.sign({ auth: true }, JWT_SECRET, { expiresIn: "1h" });
    res.json({ token });
  } else {
    res.status(401).json({ error: "Incorrect password" });
  }
});

// 4. REST API Endpoints (Protected)
app.get("/projects", authMiddleware, async (req, res) => {
  try {
    const projects = await ApiProject.find().sort({ createdAt: -1 });
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// POST new project
app.post("/projects", authMiddleware, async (req, res) => {
  try {
    const project = await ApiProject.create(req.body);
    res.status(201).json(project);
  } catch (err) {
    res.status(400).json({ error: "Failed to create project" });
  }
});

// PATCH update project
app.patch("/projects/:id", authMiddleware, async (req, res) => {
  try {
    const project = await ApiProject.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(project);
  } catch (err) {
    res.status(400).json({ error: "Failed to update project" });
  }
});

// DELETE project
app.delete("/projects/:id", authMiddleware, async (req, res) => {
  try {
    await ApiProject.findByIdAndDelete(req.params.id);
    res.json({ message: "Project deleted" });
  } catch (err) {
    res.status(400).json({ error: "Failed to delete project" });
  }
});

// 5. LLM Proxy Endpoint (Protected)
// Supports GROQ and Gemini/OpenAI keys.
const openai = new OpenAI({
  apiKey: LLM_API_KEY,
  baseURL: LLM_BASE_URL
});

console.log(`✅ API: Using ${USE_GROQ ? "GROQ" : "Gemini/OpenAI"} for LLM calls`);

app.post("/chat", authMiddleware, async (req, res) => {
  try {
    const { messages, tools, tool_choice } = req.body;

    const cleanHistory = messages.filter((m: any) => m.role !== 'system');

    const systemPromptMessage = `You are a high-performance OSM Task Agent. 
      Rules:
      1. ALWAYS use the provided tools to perform actions in the database. 
      2. If a user asks to create/list/update/delete, CALL THE TOOL FIRST. 
      3. NEVER explain how to use a tool in code blocks. JUST CALL IT.
      4. Only provide a brief natural language confirmation AFTER the tool responds.`;

    // Define available tools that the LLM can call
    const mcpTools = [
      {
        type: "function" as const,
        function: {
          name: "list_projects",
          description: "Lists all projects from the database",
          parameters: { type: "object", properties: {} }
        }
      },
      {
        type: "function" as const,
        function: {
          name: "create_project",
          description: "Creates a new project in the database",
          parameters: {
            type: "object",
            properties: {
              projectName: { type: "string" },
              status: { type: "string", description: "optional status like Draft, In Progress, Completed" }
            },
            required: ["projectName"]
          }
        }
      },
      {
        type: "function" as const,
        function: {
          name: "update_project",
          description: "Updates a project's status by ID",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string" },
              status: { type: "string" }
            },
            required: ["id", "status"]
          }
        }
      },
      {
        type: "function" as const,
        function: {
          name: "delete_project",
          description: "Deletes a project by ID",
          parameters: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"]
          }
        }
      }
    ];

    const completionBody: any = {
      model: LLM_MODEL,
      messages: [{ role: "system", content: systemPromptMessage }, ...cleanHistory],
      tools: mcpTools,
      tool_choice: tool_choice || "auto"
    };

    console.log(`📤 /chat request body:`, JSON.stringify(completionBody, null, 2));

    const response = await openai.chat.completions.create(completionBody);
    console.log(`📥 /chat response:`, JSON.stringify(response, null, 2));

    let resMessage = response.choices[0].message;

    // Handle Tool Calling (Execute locally with proper auth)
    if (resMessage.tool_calls) {
      const toolMessages = [...messages, resMessage];

      for (const call of resMessage.tool_calls) {
        let result = "";
        const toolCall = call as any;
        const args = JSON.parse(toolCall.function.arguments);

        if (toolCall.function.name === "list_projects") {
          const list = await ApiProject.find().sort({ createdAt: -1 });
          result = JSON.stringify(list);
        } else if (toolCall.function.name === "create_project") {
          const created = await ApiProject.create({
            projectName: args.projectName,
            status: args.status || "Draft"
          });
          result = `✅ Successfully created project: "${created.projectName}" with status: ${created.status} (ID: ${created._id})`;
        } else if (toolCall.function.name === "update_project") {
          const updated = await ApiProject.findByIdAndUpdate(args.id, { status: args.status }, { new: true });
          result = `✅ Successfully updated project ID ${args.id} to status: ${updated?.status}`;
        } else if (toolCall.function.name === "delete_project") {
          await ApiProject.findByIdAndDelete(args.id);
          result = `✅ Successfully deleted project ${args.id}`;
        }

        toolMessages.push({ role: "tool", tool_call_id: call.id, content: result });
      }

      // Final summary call to generate natural language response
      const finalCompletion = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: "You are a helpful assistant. Summarize the completed action in a friendly, professional way. Be concise." },
          ...toolMessages.filter(m => m.role !== 'system')
        ]
      });

      console.log(`📥 /chat final response:`, JSON.stringify(finalCompletion, null, 2));
      return res.json(finalCompletion);
    }

    res.json(response);
  } catch (err: any) {
    console.error("❌ LLM Proxy Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 6. DIRECT PATH (Legacy Phase 1 Simulation) (Protected)
 * This endpoint processes chatbot requests without an MCP Bridge.
 * It maps tools directly to local Mongoose functions.
 */
app.post("/chat-direct", authMiddleware, async (req, res) => {
  try {
    const { messages } = req.body;

    // Direct Tool Definitions (Bypassing MCP)
    const directTools = [
      {
        type: "function" as const,
        function: {
          name: "list_projects",
          description: "Lists all projects directly from MongoDB",
          parameters: { type: "object", properties: {} }
        }
      },
      {
        type: "function" as const,
        function: {
          name: "create_project",
          description: "Creates a project directly in the DB",
          parameters: {
            type: "object",
            properties: { projectName: { type: "string" } },
            required: ["projectName"]
          }
        }
      },
      {
        type: "function" as const,
        function: {
          name: "update_project",
          description: "Updates a project's status by ID",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string" },
              status: { type: "string" }
            },
            required: ["id", "status"]
          }
        }
      },
      {
        type: "function" as const,
        function: {
          name: "delete_project",
          description: "Deletes a project by ID",
          parameters: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"]
          }
        }
      }
    ];

    const cleanHistory = messages.filter((m: any) => m.role !== 'system');

    const completionBody = {
      model: LLM_MODEL,
      messages: [
        { role: "system", content: "You are the Phase 1 DIRECT Assistant. You have direct access to internal DB functions. Call them immediately if needed." },
        ...cleanHistory
      ],
      tools: directTools,
      tool_choice: "auto" as const
    };

    console.log(`📤 /chat-direct request body:`, JSON.stringify(completionBody, null, 2));

    const completion = await openai.chat.completions.create(completionBody);
    console.log(`📥 /chat-direct response:`, JSON.stringify(completion, null, 2));

    let resMessage = completion.choices[0].message;

    // Handle Direct Tool Calling (No Bridge involved)
    if (resMessage.tool_calls) {
      const toolMessages = [...messages, resMessage];

      for (const call of resMessage.tool_calls) {
        let result = "";
        const toolCall = call as any;
        const args = JSON.parse(toolCall.function.arguments);

        if (toolCall.function.name === "list_projects") {
          const list = await ApiProject.find().sort({ createdAt: -1 });
          result = JSON.stringify(list);
        } else if (toolCall.function.name === "create_project") {
          const created = await ApiProject.create({ projectName: args.projectName });
          result = `Created directly in DB: ${created.projectName} (${created._id})`;
        } else if (toolCall.function.name === "update_project") {
          const updated = await ApiProject.findByIdAndUpdate(args.id, { status: args.status }, { new: true });
          result = `Updated project ${args.id} status to: ${updated?.status}`;
        } else if (toolCall.function.name === "delete_project") {
          await ApiProject.findByIdAndDelete(args.id);
          result = `Deleted project ${args.id}`;
        }

        toolMessages.push({ role: "tool", tool_call_id: call.id, content: result });
      }

      // Final summary using the same logic
      const finalCompletion = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: "Summarize the direct DB action." },
          ...toolMessages.filter(m => m.role !== 'system')
        ],
        tools: directTools,
        tool_choice: "auto"
      });

      console.log(`📥 /chat-direct final response:`, JSON.stringify(finalCompletion, null, 2));
      return res.json(finalCompletion);
    }

    res.json(completion);
  } catch (err: any) {
    console.error("❌ Direct Path Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Dummy CRM API running at http://localhost:${PORT}`);
});
