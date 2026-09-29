import { MCPServer } from "mcp-use";

import { oauthDocumensoProvider } from "./src/auth/documenso-oauth.js";
import { loadConfig } from "./src/config.js";
import { createDocumensoClient } from "./src/documenso/client.js";
import { registerEnvelopeTools } from "./src/tools/envelopes.js";
import { registerHealthTool } from "./src/tools/health.js";

const SERVER_INFO = { name: "documenso-mcp", version: "0.3.0" };

const config = loadConfig();

const documenso = createDocumensoClient({
  baseUrl: config.documensoUrl,
  timeoutMs: config.documensoTimeoutMs,
});

const server = new MCPServer({
  ...SERVER_INFO,
  title: "Documenso",
  description: "Team-scoped access to Documenso envelopes: list, inspect, prepare and send documents for signing.",
  // Documenso is the authorization server: users approve access on Documenso's consent page, for one team.
  // Every token is checked with Documenso (active, issued for this server) before any tool code runs.
  oauth: oauthDocumensoProvider({ documensoUrl: config.documensoUrl }),
  // documenso-health stays public; every Documenso tool requires sign-in.
  mixedAuth: true,
});

export const documensoHealth = registerHealthTool(server, { client: documenso, serverInfo: SERVER_INFO });

export const { listEnvelopesTool, getEnvelopeStatusTool, listTemplatesTool } = registerEnvelopeTools(server, {
  client: documenso,
});

export default server;
