import type { MCPServer } from "mcp-use";
import type { SupabaseOAuthUser } from "mcp-use/oauth/supabase";

/** The MCP server, with Supabase as its OAuth provider. */
export type AppServer = MCPServer<SupabaseOAuthUser>;
