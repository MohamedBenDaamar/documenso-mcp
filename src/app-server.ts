import type { MCPServer } from "mcp-use";

import type { DocumensoUser } from "./auth/documenso-oauth.js";

/** The MCP server, with Documenso as its OAuth authorization server. */
export type AppServer = MCPServer<DocumensoUser>;
