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

const MCP_TOKEN = process.env.MCP_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const LLM_API_KEY = GROQ_API_KEY || GEMINI_API_KEY;
const USE_GROQ = Boolean(GROQ_API_KEY);
const LLM_BASE_URL = USE_GROQ
  ? "https://api.groq.com/openai/v1"
  : "https://generativelanguage.googleapis.com/v1beta/openai/";
const DEFAULT_MODEL = USE_GROQ ? "openai/gpt-oss-20b" : "gemini-flash-latest";

if (!MCP_TOKEN) {
  console.error("❌ Missing MCP_TOKEN in .env file.");
  process.exit(1);
}

if (!LLM_API_KEY) {
  console.error("❌ Missing GROQ_API_KEY or GEMINI_API_KEY in .env file.");
  process.exit(1);
}

// ------------------------------------------------------------
// 1. INITIALIZE LLM (via OpenAI SDK or GROQ-compatible base URL) & MCP CLIENT
// ------------------------------------------------------------
const openai = new OpenAI({
  apiKey: LLM_API_KEY,
  baseURL: LLM_BASE_URL,
  timeout: 120 * 1000,
  maxRetries: 2
});

const buildGroqRequest = (messages: any[]) => {
  const systemMessage = messages.find((m: any) => m.role === 'system');
  const chatText = messages
    .filter((m: any) => m.role !== 'system')
    .map((m: any) => `${m.role.toUpperCase()}: ${m.content ?? ''}`)
    .join('\n\n');

  return {
    model: DEFAULT_MODEL,
    input: chatText,
    instructions: systemMessage?.content ?? undefined,
  };
};

const normalizeGroqResponse = (resp: any) => ({
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: resp.output_text ?? ''
      }
    }
  ]
});

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
// 2. ANIMATED SPINNER UTILITY
// ------------------------------------------------------------
const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function startSpinner(messages: string | string[]): NodeJS.Timeout {
  const phases = Array.isArray(messages) ? messages : [messages];
  let frame = 0, phase = 0, phaseTimer = 0;
  return setInterval(() => {
    if (++phaseTimer > 75 && phase < phases.length - 1) { phase++; phaseTimer = 0; }
    process.stdout.write(`\r${spinnerFrames[frame++ % spinnerFrames.length]}  ${phases[phase]}`);
  }, 80);
}

function stopSpinner(spinner: NodeJS.Timeout): void {
  clearInterval(spinner);
  process.stdout.write("\r" + " ".repeat(60) + "\r"); // Clear the spinner line
}

// ------------------------------------------------------------
// 3. FALLBACK: Parse tool calls from plain text (Mistral quirk)
//    Mistral sometimes outputs [TOOL_CALLS] as text instead of
//    using structured tool_calls. This parser catches that case.
// ------------------------------------------------------------
function parseTextToolCalls(content: string): any[] | null {
  if (!content) return null;

  // Pattern 1: [TOOL_CALLS] [{"name": ..., "arguments": {...}}]
  const toolCallsMatch = content.match(/\[TOOL_CALLS\]\s*(\[[\s\S]*\])/);
  if (toolCallsMatch) {
    try {
      const calls = JSON.parse(toolCallsMatch[1]);
      return calls.map((c: any, i: number) => ({
        id: `fallback-${i}`,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.arguments ?? c.args ?? {}) }
      }));
    } catch { /* fall through */ }
  }

  // Pattern 2: Raw JSON array of tool calls in content
  const jsonMatch = content.match(/(\[{"name":[\s\S]*\}])/);
  if (jsonMatch) {
    try {
      const calls = JSON.parse(jsonMatch[1]);
      if (Array.isArray(calls) && calls[0]?.name) {
        return calls.map((c: any, i: number) => ({
          id: `fallback-${i}`,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.arguments ?? c.args ?? {}) }
        }));
      }
    } catch { /* fall through */ }
  }

  return null;
}

// ------------------------------------------------------------
// 4. REUSABLE TOOL EXECUTOR
// ------------------------------------------------------------
async function executeToolCalls(toolCalls: any[], messages: any[]): Promise<void> {
  for (const call of toolCalls) {
    if (call.type !== "function") continue;

    console.log(`\n🤖 [Calling MCP Tool ---> ${call.function.name}]`);
    const args = typeof call.function.arguments === "string"
      ? JSON.parse(call.function.arguments)
      : call.function.arguments;

    const actionLabel = call.function.name === "list_projects" ? ["Searching the database...", "Fetching all records..."]
      : call.function.name === "create_project" ? ["Creating the project...", "Writing to the database..."]
        : call.function.name === "update_project" ? ["Locating the record...", "Applying the update..."]
          : call.function.name === "delete_project" ? ["Finding the project...", "Removing from the database..."]
            : [`Running ${call.function.name}...`];
    const spinner = startSpinner(actionLabel);
    const result = await mcpClient.callTool({ name: call.function.name, arguments: args });
    stopSpinner(spinner);

    const contentArray = result.content as any[];
    const textResponse = (contentArray && contentArray.length > 0 && contentArray[0].type === 'text')
      ? contentArray[0].text
      : JSON.stringify(result);

    console.log(`📡 [Result ---> ${textResponse}]`);

    messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: textResponse as string
    });
  }
}

// ------------------------------------------------------------
// 5. CHATBOT LOGIC
// ------------------------------------------------------------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function chat() {
  console.log("🔌 Connecting to OSM MCP Server...");
  await mcpClient.connect(transport);
  console.log("✅ Ready! I am the OSM Chatbot. Ask me to manage forms/projects in the database.\n");

  const mcptoolsResponse = await mcpClient.listTools();

  // Convert MCP Tools standard format into OpenAI Tool format
  const aiTools = mcptoolsResponse.tools.map(t => {
    const parameters = t.inputSchema as any;

    // Gemini 1.5 Flash (via OpenAI shim) can be sensitive to empty properties.
    // Ensure we send a valid object or omit if empty.
    const hasProperties = parameters.properties && Object.keys(parameters.properties).length > 0;

    return {
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: hasProperties ? parameters : { type: "object", properties: {} }
      }
    };
  });

  const messages: any[] = [
    {
      role: "system",
      content: `You are the exclusive OSM Project Manager Chatbot for Divergent Insights.
Your ONLY job is to manage projects in MongoDB using the provided tools.
Rules:
- Always use tools to perform actions. NEVER describe or simulate a tool call in text.
- If asked to update/delete ALL projects, ALWAYS call list_projects first to get real IDs, then update/delete each one individually using those IDs.
- Be concise and professional in your final responses.`
    }
  ];

  const askUser = () => {
    rl.question("You: ", async (input) => {
      if (input.toLowerCase() === "exit") process.exit(0);

      messages.push({ role: "user", content: input });

      // --- Instant greeting handler (no LLM call needed) ---
      const greetings = /^(hi|hello|hey|sup|howdy|yo|hiya|greetings)[!?.,]*$/i;
      const thanks = /^(thanks|thank you|thank you so much|ty|thx|cheers|appreciate it)[!?.,]*$/i;
      const bye = /^(bye|goodbye|see you|see ya|cya|later|take care|exit chat)[!?.,]*$/i;
      if (greetings.test(input.trim())) {
        console.log(`\n🤖 Assistant: Hello! I'm the OSM Chatbot. Ask me to create, list, update, or delete projects.\n`);
        askUser();
        return;
      }
      if (thanks.test(input.trim())) {
        console.log(`\n🤖 Assistant: You're welcome! Is there anything else I can help you with?\n`);
        askUser();
        return;
      }
      if (bye.test(input.trim())) {
        console.log(`\n🤖 Assistant: Goodbye! Have a great day.\n`);
        process.exit(0);
      }

      const thinkingSteps = [
        "Reading your message...",
        "Analyzing the request...",
        "Deciding what to do...",
        "Preparing the response..."
      ];
      let spinner = startSpinner(thinkingSteps);

      try {
        const completionBody: any = USE_GROQ
          ? buildGroqRequest(messages)
          : {
              model: DEFAULT_MODEL,
              messages: messages,
            };

        if (aiTools && aiTools.length > 0) {
          completionBody.tools = aiTools;
          completionBody.tool_choice = "auto";
        }

        const response = USE_GROQ
          ? normalizeGroqResponse(await openai.responses.create(completionBody))
          : await openai.chat.completions.create(completionBody);

        stopSpinner(spinner);

        const resMessage = response.choices[0].message;
        messages.push({
          role: "assistant",
          content: resMessage.content ?? null,
          ...(resMessage.tool_calls ? { tool_calls: resMessage.tool_calls } : {})
        });

        // Check for structured tool_calls first (normal path)
        let toolCalls = resMessage.tool_calls && resMessage.tool_calls.length > 0
          ? resMessage.tool_calls
          : null;

        // Fallback: detect tool calls embedded as plain text (Mistral quirk)
        if (!toolCalls && resMessage.content) {
          toolCalls = parseTextToolCalls(resMessage.content);
          if (toolCalls) {
            console.log(`\n⚠️  [Detected text-format tool call — parsing and executing anyway]`);
            // Replace the pushed message with a clean version
            messages[messages.length - 1] = { ...resMessage, content: null, tool_calls: toolCalls };
          }
        }

        if (toolCalls) {
          await executeToolCalls(toolCalls, messages);

          // Let Gemini summarize what happened
          spinner = startSpinner(["Reviewing the result...", "Preparing your response..."]);
          if (USE_GROQ) {
            const finalResponse = await openai.responses.create({
              model: DEFAULT_MODEL,
              input: messages
                .filter((m: any) => m.role !== 'system')
                .map((m: any) => `${m.role.toUpperCase()}: ${m.content ?? ''}`)
                .join('\n\n'),
              instructions: messages.find((m: any) => m.role === 'system')?.content,
              tools: aiTools,
              tool_choice: 'auto'
            });
            stopSpinner(spinner);
            const content = finalResponse.output_text ?? '';
            process.stdout.write(`\n🤖 Assistant: ${content}\n\n`);
            messages.push({ role: 'assistant', content });
          } else {
            const finalResponse = await openai.chat.completions.create({
              model: "gemini-flash-latest",
              messages: messages,
              tools: aiTools,
              tool_choice: "auto",
              stream: true
            });
            stopSpinner(spinner);

            process.stdout.write("\n🤖 Assistant: ");
            let fullContent = "";
            for await (const chunk of finalResponse) {
              const delta = chunk.choices[0]?.delta?.content || "";
              fullContent += delta;
              process.stdout.write(delta);
            }
            process.stdout.write("\n\n");
            messages.push({ role: 'assistant', content: fullContent });
          }
        } else {
          console.log(`\n🤖 Assistant: ${resMessage.content}\n`);
        }
      } catch (err) {
        stopSpinner(spinner);
        console.error("❌ Chatbot Error:", err);
      }

      askUser();
    });
  };

  askUser();
}

chat().catch(console.error);
