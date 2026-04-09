# Standalone MCP Chatbot CRUD Demo (OSM Proof of Concept)

## 1. Overview
The goal of this proof-of-concept is to demonstrate how an AI chatbot can act as a bridge to perform CRUD operations on database entries (e.g., forms/projects) within the OSM ecosystem. We built a dual-system: a secure Model Context Protocol (MCP) Server and an autonomous Chatbot Client.

## 2. Requirements & Prerequisites
- **Node.js**: The runtime environment executing both the server (`index.ts`) and the client (`chatbot.ts`).
- **MongoDB**: A local MongoDB database (`mongodb://localhost:27017/osm_mock`) used to securely persist 'Project/Form' documents.
- **LLM API Key**: A Google Gemini API key to serve as the "brain" of the chatbot. (The client utilizes OpenAI SDK compatibility to interact with Gemini).

## 3. Architecture Breakdown

### The MCP Server (`index.ts`)
- **Transport**: Utilizes `SSEServerTransport` (Server-Sent Events) over an Express.js HTTP server.
- **Security**: Secured strictly with a custom `jsonwebtoken` (JWT) middleware demanding an `Authorization` header.
- **Tools**: Registers 4 Native Database Tools (`create_project`, `list_projects`, `update_project`, `delete_project`) that directly execute Mongoose commands on the DB.
- **Visualization**: Exposes a basic HTML UI at `/dashboard` to let managers visually monitor live database changes without seeing terminal commands.

### The Chatbot Client (`chatbot.ts`)
- **Transport**: Uses `SSEClientTransport` to bind securely to the MCP server.
- **Execution Loop**: Ingests the 4 MCP tools, maps them instantly to LLM-compatible function definitions, processes natural language input, triggers the MCP server, and summarizes the DB results.

## 4. Problems Faced & Solutions
1. **Express Body-Parser Conflict**: We initially used `express.json()` on the POST `/message` routing endpoint. Since the SDK’s `handlePostMessage` expects to read the raw HTTP stream natively, Express was preemptively consuming and closing the data stream, triggering a `400 Bad Request`. **Fix:** Removed `express.json()` to allow the MCP package to parse the stream itself.
2. **ES Modules vs CommonJS**: Attempting to invoke the base `eventsource` polyfill in the client clashed with our TypeScript ES Module configs (`require is not defined`). **Fix:** Overrode the module loading by utilizing Node's native `module.createRequire` bridge.
3. **TypeScript DOM Polling Constraints**: The TypeScript DOM library refused to acknowledge HTTP `headers` inside `EventSourceInit` because standard web browsers deny headers on SSE streams. **Fix:** Used a brute-force `as any` typecast allowing the Node `eventsource` backend to flawlessly accept the JWT token regardless.
4. **xAI Billing Restriction**: Attempted to use the `grok-beta`/`grok-2` models natively, but the OpenAI SDK abstracted the failure to a basic "Model not found" error because the developer account lacked a prepaid balance. **Fix:** Migrated to Google Gemini's free-tier utilizing the `generativelanguage` proxy.

## 5. Next Steps
- Execute Phase 2 (Dummy API Connection) to compare direct MongoDB modification with REST API modification architectures.
