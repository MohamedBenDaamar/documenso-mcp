/**
 * End-to-end check of the whole sign-in path, as an MCP client sees it, against a running server:
 *
 *   discovery -> client registration -> Documenso sign-in -> consent -> token -> tool calls
 *
 * With a second user it also checks team isolation through the MCP server, and it finishes by revoking
 * access and checking that the token stops working.
 *
 * Usage:
 *   node scripts/check-oauth-flow.ts [http://localhost:3100]
 *
 * Environment (for example in .env.test.local, loaded with `node --env-file=.env.test.local ...`):
 *   DOCUMENSO_TEST_EMAIL_A, DOCUMENSO_TEST_PASSWORD_A   required: a Documenso user without 2FA
 *   DOCUMENSO_TEST_EMAIL_B, DOCUMENSO_TEST_PASSWORD_B   optional: a user in another team
 *
 * These are ordinary Documenso accounts: no API tokens are needed anymore.
 */

const MCP_BASE = (process.argv[2] ?? "http://localhost:3100").replace(/\/+$/, "");
const REDIRECT_URI = "http://127.0.0.1:47823/callback";

let failed = false;

function pass(message: string) {
  console.log(`PASS  ${message}`);
}

function fail(message: string): never {
  console.log(`FAIL  ${message}`);
  process.exit(1);
}

function check(condition: unknown, message: string, detail = "") {
  if (condition) {
    pass(message);
  } else {
    console.log(`FAIL  ${message}${detail ? `: ${detail}` : ""}`);
    failed = true;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    fail(`${name} is not set. See the usage notes at the top of this script.`);
  }

  return value;
}

/** Minimal cookie jar for one Documenso browser session. */
function cookieJar() {
  const cookies = new Map<string, string>();

  return {
    store(response: Response) {
      for (const header of response.headers.getSetCookie()) {
        const [pair] = header.split(";");
        const index = pair.indexOf("=");
        cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1));
      }
    },
    header() {
      return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    },
  };
}

async function mcpCall(name: string, args: Record<string, unknown>, token?: string) {
  const response = await fetch(`${MCP_BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });

  const text = await response.text();
  const payload = text.includes("data: ") ? text.split("\n").find((line) => line.startsWith("data: "))?.slice(6) : text;
  let body: { result?: { isError?: boolean; structuredContent?: any; content?: { text: string }[] } } = {};

  try {
    body = JSON.parse(payload ?? "{}");
  } catch {
    // Non-JSON bodies are fine for 401s.
  }

  return { status: response.status, headers: response.headers, result: body.result };
}

type Discovery = { resource: string; issuer: string; metadata: Record<string, string> };

async function discover(): Promise<Discovery> {
  const unsigned = await mcpCall("list-envelopes", {});
  const challenge = unsigned.headers.get("www-authenticate") ?? "";

  check(
    unsigned.status === 401 && challenge.includes("resource_metadata"),
    "Unsigned tool call gets HTTP 401 with a resource_metadata challenge",
    `HTTP ${unsigned.status}`,
  );

  const prmUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1] ?? `${MCP_BASE}/.well-known/oauth-protected-resource/mcp`;
  const prm = await (await fetch(prmUrl)).json();
  const issuer = prm.authorization_servers?.[0];

  if (!issuer) {
    fail("Protected resource metadata names no authorization server");
  }

  pass(`Protected resource metadata: resource ${prm.resource}, authorization server ${issuer}`);

  const metadata = await (await fetch(`${issuer}/.well-known/oauth-authorization-server`)).json();

  check(
    metadata.issuer === issuer && metadata.code_challenge_methods_supported?.includes("S256"),
    "Documenso authorization server metadata matches the issuer and supports S256",
  );

  return { resource: prm.resource, issuer, metadata };
}

async function register(discovery: Discovery): Promise<string> {
  const response = await fetch(discovery.metadata.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "documenso-mcp flow check", redirect_uris: [REDIRECT_URI] }),
  });
  const body = await response.json();

  if (response.status !== 201 || !body.client_id) {
    fail(`Client registration failed (HTTP ${response.status})`);
  }

  pass("Registered an OAuth client with dynamic client registration");

  return body.client_id;
}

/** Signs in to Documenso, approves the first team on the consent page and returns a token pair. */
async function connect(
  discovery: Discovery,
  clientId: string,
  email: string,
  password: string,
  label: string,
  scope = "envelopes:read",
) {
  const jar = cookieJar();

  const csrfResponse = await fetch(`${discovery.issuer}/api/auth/csrf`);
  jar.store(csrfResponse);
  const { csrfToken } = await csrfResponse.json();

  const signIn = await fetch(`${discovery.issuer}/api/auth/email-password/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.header(), Origin: discovery.issuer },
    body: JSON.stringify({ email, password, csrfToken }),
  });
  jar.store(signIn);

  if (!signIn.ok) {
    fail(`${label}: Documenso sign-in failed (HTTP ${signIn.status}). Check the credentials; 2FA accounts are not supported.`);
  }

  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");

  const authorizeUrl = new URL(discovery.metadata.authorization_endpoint);
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope,
    state: `check-${label}`,
    resource: discovery.resource,
  }).toString();

  const authorize = await fetch(authorizeUrl, { redirect: "manual", headers: { Cookie: jar.header() } });
  const consentUrl = new URL(authorize.headers.get("location") ?? "", discovery.issuer);
  const requestId = consentUrl.searchParams.get("request");

  if (!requestId) {
    fail(`${label}: /authorize did not lead to the consent page (${consentUrl.search})`);
  }

  // The consent page lists the user's teams; approve the first one, as a user clicking Allow would.
  const consentPage = await (await fetch(consentUrl, { headers: { Cookie: jar.header() } })).text();
  const teamId = Number(/id="team-(\d+)"/.exec(consentPage)?.[1]);

  if (!teamId) {
    fail(`${label}: the consent page listed no team`);
  }

  const decision = await fetch(`${discovery.issuer}/api/oauth/authorize/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.header(), Origin: discovery.issuer },
    body: JSON.stringify({ requestId, decision: "approve", teamId }),
  });
  const redirectTo = new URL((await decision.json()).redirectTo ?? "about:blank");
  const code = redirectTo.searchParams.get("code");

  check(
    code && redirectTo.searchParams.get("state") === `check-${label}` && redirectTo.searchParams.get("iss") === discovery.issuer,
    `${label}: consent approved for team ${teamId}; redirect carries code, state and iss`,
  );

  const tokenResponse = await fetch(discovery.metadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: code ?? "",
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
      resource: discovery.resource,
    }),
  });
  const tokens = await tokenResponse.json();

  if (!tokens.access_token) {
    fail(`${label}: token exchange failed (HTTP ${tokenResponse.status}: ${tokens.error})`);
  }

  pass(`${label}: exchanged the code for an access token (scope "${tokens.scope}")`);
  createdGrants.push(tokens.refresh_token);

  return { accessToken: tokens.access_token as string, refreshToken: tokens.refresh_token as string, teamId };
}

/** Refresh tokens of every grant this run creates, revoked at the end so no test connection lingers. */
const createdGrants: string[] = [];

async function revoke(discovery: Discovery, clientId: string, refreshToken: string) {
  return fetch(discovery.metadata.revocation_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, token: refreshToken }),
  });
}

async function main() {
  console.log(`Checking ${MCP_BASE}\n`);

  const emailA = requireEnv("DOCUMENSO_TEST_EMAIL_A");
  const passwordA = requireEnv("DOCUMENSO_TEST_PASSWORD_A");

  const discovery = await discover();
  const clientId = await register(discovery);

  const userA = await connect(discovery, clientId, emailA, passwordA, "User A");

  const listA = await mcpCall("list-envelopes", { perPage: 50 }, userA.accessToken);
  const envelopesA: { id: string }[] = listA.result?.structuredContent?.envelopes ?? [];

  check(listA.status === 200 && !listA.result?.isError, `User A: list-envelopes works (${envelopesA.length} document${envelopesA.length === 1 ? "" : "s"})`);

  const templatesA = await mcpCall("list-templates", {}, userA.accessToken);

  check(templatesA.status === 200 && !templatesA.result?.isError, "User A: list-templates works");

  if (envelopesA[0]) {
    const status = await mcpCall("get-envelope-status", { envelopeId: envelopesA[0].id }, userA.accessToken);

    check(!status.result?.isError, `User A: get-envelope-status works for ${envelopesA[0].id}`);
  }

  if (process.env.DOCUMENSO_TEST_EMAIL_B) {
    const userB = await connect(
      discovery,
      clientId,
      requireEnv("DOCUMENSO_TEST_EMAIL_B"),
      requireEnv("DOCUMENSO_TEST_PASSWORD_B"),
      "User B",
    );

    const listB = await mcpCall("list-envelopes", { perPage: 50 }, userB.accessToken);
    const idsB = new Set((listB.result?.structuredContent?.envelopes ?? []).map((envelope: { id: string }) => envelope.id));

    check(
      userA.teamId === userB.teamId || !envelopesA.some((envelope) => idsB.has(envelope.id)),
      "User B's list contains none of user A's team documents",
    );

    if (envelopesA[0] && userA.teamId !== userB.teamId) {
      const crossTeam = await mcpCall("get-envelope-status", { envelopeId: envelopesA[0].id }, userB.accessToken);

      check(
        crossTeam.result?.isError && crossTeam.result.content?.[0]?.text.includes("does not exist"),
        "User B asking for user A's envelope gets the same answer as for a missing one",
      );
    }
  } else {
    console.log("SKIP  Team isolation (DOCUMENSO_TEST_EMAIL_B is not set)");
  }

  // A genuine Documenso token that lacks envelopes:read must not reach the read tools.
  const sendOnly = await connect(discovery, clientId, emailA, passwordA, "User A (send scope only)", "envelopes:send");
  const withoutRead = await mcpCall("list-envelopes", {}, sendOnly.accessToken);
  const scopeChallenge = withoutRead.headers.get("www-authenticate") ?? "";

  check(
    withoutRead.status === 403 && scopeChallenge.includes("insufficient_scope"),
    "A token without envelopes:read gets HTTP 403 insufficient_scope",
    `HTTP ${withoutRead.status} ${scopeChallenge}`,
  );

  const forged = await mcpCall("list-envelopes", {}, "doa_forgedtoken0000000000000000000000000000");

  check(forged.status === 401, "A made-up access token gets HTTP 401", `HTTP ${forged.status}`);

  const legacy = await mcpCall("list-envelopes", {}, "api_legacyteamtoken");

  check(legacy.status === 401, "A Documenso API token is not accepted as an OAuth token (HTTP 401)", `HTTP ${legacy.status}`);

  const revoked = await revoke(discovery, clientId, userA.refreshToken);

  check(revoked.status === 200, "Revoked user A's grant at Documenso");

  // The MCP server may reuse its token check for up to 30 seconds, but Documenso refuses the token at once,
  // so the call fails either way: with HTTP 401, or with a reconnect message.
  const afterRevoke = await mcpCall("list-envelopes", {}, userA.accessToken);

  check(
    afterRevoke.status === 401 || afterRevoke.result?.content?.[0]?.text.includes("Reconnect Documenso"),
    "User A's token stops working right after revocation",
    `HTTP ${afterRevoke.status}`,
  );

  // Leave nothing behind in the test accounts' Connected apps.
  await Promise.all(createdGrants.map((refreshToken) => revoke(discovery, clientId, refreshToken)));

  console.log(failed ? "\nSome checks failed." : "\nAll checks passed.");
  process.exit(failed ? 1 : 0);
}

await main();
