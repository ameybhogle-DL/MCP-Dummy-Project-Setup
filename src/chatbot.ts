import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import OpenAI from "openai";
import dotenv from "dotenv";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const EventSourceRaw = require("eventsource");
const EventSource = EventSourceRaw.EventSource || EventSourceRaw.default || EventSourceRaw;
import readline from "readline";

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MCP_TOKEN = process.env.MCP_TOKEN;

if (!GEMINI_API_KEY || !MCP_TOKEN) {
  console.error("❌ Missing GEMINI_API_KEY or MCP_TOKEN in .env file.");
  process.exit(1);
}

// ------------------------------------------------------------
// 1. INITIALIZE GROK & MCP CLIENT
// ------------------------------------------------------------
// Using the OpenAI library structure but pointing it to Google Gemini's infrastructure!
const openai = new OpenAI({ apiKey: GEMINI_API_KEY, baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/" });

const mcpClient = new Client({ name: "osm-chatbot", version: "1.0.0" }, { capabilities: {} });

// Natively inject the required JWT Authorization header into both the SSE stream and POST requests
const transport = new SSEClientTransport(new URL("http://localhost:3000/sse"), {
  eventSourceInit: {
    headers: { Authorization: `Bearer ${MCP_TOKEN}` }
  } as any,
  requestInit: {
    headers: { Authorization: `Bearer ${MCP_TOKEN}` }
  }
});

// ------------------------------------------------------------
// 3. CHATBOT LOGIC
// ------------------------------------------------------------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function chat() {
  console.log("🔌 Connecting to OSM MCP Server...");
  await mcpClient.connect(transport);
  console.log("✅ Ready! I am the OSM Chatbot. Ask me to manage forms/projects in the database.\n");

  const mcptoolsResponse = await mcpClient.listTools();

  // Convert MCP Tools standard format into OpenAI/Grok Tool format
  const aiTools = mcptoolsResponse.tools.map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as any
    }
  }));

  const messages: any[] = [
    { role: "system", content: "You are the exclusive OSM Project Manager Chatbot built for Divergent Insights. Your ONLY job is to manage projects directly in the MongoDB database using the given tools. Be highly concise, professional, and confident." }
  ];

  const askUser = () => {
    rl.question("You: ", async (input) => {
      if (input.toLowerCase() === "exit") process.exit(0);

      messages.push({ role: "user", content: input });

      try {
        const response = await openai.chat.completions.create({
          model: "gemini-2.5-flash", // Using Gemini!
          messages: messages,
          tools: aiTools,
          tool_choice: "auto"
        });

        const resMessage = response.choices[0].message;
        messages.push(resMessage);

        if (resMessage.tool_calls) {
          for (const call of resMessage.tool_calls) {
            if (call.type !== "function") continue;

            console.log(`\n🤖 [Gemini is calling your MCP Server tool ---> ${call.function.name}]`);
            const args = JSON.parse(call.function.arguments);

            // Execute the MCP tool remotely via our newly built Client API
            const result = await mcpClient.callTool({ name: call.function.name, arguments: args });

            // Send the Database Result successfully back to Grok
            const contentArray = result.content as any[];
            const textResponse = (contentArray && contentArray.length > 0 && contentArray[0].type === 'text') ? contentArray[0].text : JSON.stringify(result);
            console.log(`📡 [MCP Server Responded ---> ${textResponse}]`);

            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: textResponse as string
            });
          }

          // Let Gemini summarize what just happened in the database
          const finalResponse = await openai.chat.completions.create({
            model: "gemini-2.5-flash",
            messages: messages
          });
          const summary = finalResponse.choices[0].message;
          messages.push(summary);
          console.log(`\n🤖 Gemini: ${summary.content}\n`);
        } else {
          console.log(`\n🤖 Gemini: ${resMessage.content}\n`);
        }
      } catch (err) {
        console.error("❌ Gemini API Error:", err);
      }

      askUser();
    });
  };

  askUser();
}

chat().catch(console.error);
