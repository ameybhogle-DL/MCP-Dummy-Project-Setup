# MCP Server Setup & Requirements Research

## 1. Overview
The specific purpose of this Model Context Protocol (MCP) server is yet to be determined. Currently, this document outlines the infrastructure, dependencies, and architectural requirements needed to host a secure, HTTP-based MCP server.

## 2. System Level Prerequisites
- **Node.js**: The JavaScript runtime environment needed to execute the server.
- **Windows PowerShell**: Requires the Execution Policy to be set to `RemoteSigned` (or bypassed) to allow NPM to execute local module scripts on Windows.

## 3. NPM Dependencies Needed
- **`@modelcontextprotocol/sdk`**: The core SDK that handles the underlying MCP logic, JSON-RPC communication, and tool registration.
- **`express`**: The HTTP web server framework used to expose the server over a network rather than local standard I/O (stdio).
- **`jsonwebtoken`**: The cryptographic library used to issue and decode the JSON Web Tokens for authentication.
- **`cors`**: Middleware to allow external clients and web apps to make API requests to the server without being blocked by Cross-Origin Resource Sharing rules.
- **TypeScript & TSX**: Used (`@types/...`) to provide static typing during development and dynamically compile the code when running the `dev` script.

## 4. Architectural Requirements
To support a secure MCP implementation:
1. **Transport Protocol**: The server had to be migrated from `StdioServerTransport` (which runs via command-line pipes) to `SSEServerTransport` (Server-Sent Events) to allow HTTP headers.
2. **Security Gateway**: An authentication middleware must intercept all requests. It specifically looks for the `Authorization: Bearer <token>` header, rejecting any connections that lack valid credentials.
3. **Endpoint Structure**: 
   - `GET /sse`: Required to hold open the real-time event stream.
   - `POST /message`: Required to receive the actual JSON-RPC tool/call executions from the client.
