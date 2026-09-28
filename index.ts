import { MCPServer } from "mcp-use";

import { loadConfig } from "./src/config.js";
import { createDocumensoClient } from "./src/documenso/client.js";
import { registerHealthTool } from "./src/tools/health.js";

const SERVER_INFO = { name: "documenso-mcp", version: "0.1.0" };

const config = loadConfig();

const documenso = createDocumensoClient({
  baseUrl: config.documensoUrl,
  timeoutMs: config.documensoTimeoutMs,
});

const server = new MCPServer({
  ...SERVER_INFO,
  title: "Documenso",
  description: "Team-scoped access to Documenso envelopes: list, inspect, prepare and send documents for signing.",
});

export const documensoHealth = registerHealthTool(server, { client: documenso, serverInfo: SERVER_INFO });

export default server;
