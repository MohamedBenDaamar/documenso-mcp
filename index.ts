import { MCPServer } from "mcp-use";
import { oauthSupabaseProvider } from "mcp-use/oauth/supabase";

import { createSupabaseSessionChecker, withSessionCheck } from "./src/auth/session-check.js";
import { createSupabaseConnectionStore } from "./src/connections/store.js";
import { loadConfig } from "./src/config.js";
import { createTokenCipher } from "./src/crypto/token-cipher.js";
import { createDocumensoClient } from "./src/documenso/client.js";
import { registerEnvelopeTools } from "./src/tools/envelopes.js";
import { registerHealthTool } from "./src/tools/health.js";
import { createSupabaseAuthApi } from "./src/web/auth-api.js";
import { createWebHandler } from "./src/web/routes.js";

const SERVER_INFO = { name: "documenso-mcp", version: "0.2.0" };

const config = loadConfig();

const documenso = createDocumensoClient({
  baseUrl: config.documensoUrl,
  timeoutMs: config.documensoTimeoutMs,
});

const store = createSupabaseConnectionStore({
  supabaseUrl: config.supabaseUrl,
  publishableKey: config.supabasePublishableKey,
  cipher: createTokenCipher(config.connectionEncryptionKey),
});

const server = new MCPServer({
  ...SERVER_INFO,
  title: "Documenso",
  description: "Team-scoped access to Documenso envelopes: list, inspect, prepare and send documents for signing.",
  // Signature, issuer, audience and expiry are checked by the Supabase provider; the session check also
  // rejects tokens whose grant was revoked, which would otherwise stay valid until they expire.
  oauth: withSessionCheck(
    oauthSupabaseProvider({ supabaseUrl: config.supabaseUrl }),
    createSupabaseSessionChecker({ supabaseUrl: config.supabaseUrl, publishableKey: config.supabasePublishableKey }),
  ),
  // documenso-health stays public; every Documenso tool requires sign-in.
  mixedAuth: true,
});

const web = createWebHandler({
  auth: createSupabaseAuthApi({ supabaseUrl: config.supabaseUrl, publishableKey: config.supabasePublishableKey }),
  store,
  documenso,
  publicUrl: config.publicUrl,
});

server.all("/auth/*", (c) => web(c.req.raw));

export const documensoHealth = registerHealthTool(server, { client: documenso, serverInfo: SERVER_INFO });

export const { listEnvelopesTool, getEnvelopeStatusTool, listTemplatesTool } = registerEnvelopeTools(server, {
  client: documenso,
  store,
  accountUrl: `${config.publicUrl}/auth/account`,
});

export default server;
