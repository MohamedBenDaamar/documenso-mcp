#!/usr/bin/env bash
# Checks the running MCP server's sign-in boundary over real HTTP, with no browser and no credentials.
# For the full sign-in flow with real accounts, see scripts/check-oauth-flow.ts.
# Usage: ./scripts/check-auth-wiring.sh [http://localhost:3100]
set -euo pipefail

BASE="${1:-http://localhost:3100}"
BODY="$(mktemp)"
HEADERS="$(mktemp)"
trap 'rm -f "$BODY" "$HEADERS"' EXIT
FAILED=0

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILED=1; }

mcp() {
  curl -s -o "$BODY" -D "$HEADERS" -w '%{http_code}' -X POST "$BASE/mcp" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -H 'MCP-Protocol-Version: 2025-06-18' \
    "$@"
}

tool_call() {
  printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"%s","arguments":{}}}' "$1"
}

status="$(curl -s -o "$BODY" -w '%{http_code}' "$BASE/.well-known/oauth-protected-resource/mcp")"
if [ "$status" = 200 ] && jq -e '.resource and (.authorization_servers | length > 0)' "$BODY" >/dev/null; then
  issuer="$(jq -r '.authorization_servers[0]' "$BODY")"
  pass "Protected resource metadata names $issuer"
else
  fail "Protected resource metadata missing (HTTP $status)"
  issuer=""
fi

if [ -n "$issuer" ]; then
  status="$(curl -s -o "$BODY" -w '%{http_code}' "$issuer/.well-known/oauth-authorization-server")"
  if [ "$status" = 200 ] && jq -e --arg issuer "$issuer" '.issuer == $issuer and (.code_challenge_methods_supported | index("S256"))' "$BODY" >/dev/null; then
    pass "Authorization server metadata at $issuer matches its issuer and supports PKCE S256"
  else
    fail "Authorization server metadata at $issuer is missing or does not match (HTTP $status)"
  fi
fi

status="$(mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
tools="$(sed -n 's/^data: //p' "$BODY" | jq -r '[.result.tools[].name] | join(", ")' 2>/dev/null || true)"
if [ "$status" = 200 ] && [ -n "$tools" ]; then
  pass "Signed-out clients can list tools: $tools"
else
  fail "tools/list without a token failed (HTTP $status)"
fi

status="$(mcp -d "$(tool_call documenso-health)")"
if [ "$status" = 200 ] && sed -n 's/^data: //p' "$BODY" | jq -e '.result.structuredContent.server.name' >/dev/null 2>&1; then
  pass "documenso-health works without signing in"
else
  fail "documenso-health without a token failed (HTTP $status)"
fi

# A protected tool must be refused at the HTTP layer, before any tool code runs. An error result would also
# refuse the call, but only a 401 with a challenge makes MCP clients start the sign-in flow.
for tool in list-envelopes get-envelope-status list-templates; do
  status="$(mcp -d "$(tool_call "$tool")")"
  challenge="$(grep -i '^www-authenticate:' "$HEADERS" | tr -d '\r' || true)"
  if [ "$status" = 401 ] && [[ "$challenge" == *resource_metadata* ]]; then
    pass "$tool without a token: HTTP 401 with a WWW-Authenticate challenge"
  else
    fail "$tool without a token was not refused with 401 and a challenge (HTTP $status)"
  fi
done

forged_cases=(
  "a made-up Documenso token|doa_forgedtoken0000000000000000000000000000"
  "a Documenso refresh token|dor_forgedtoken0000000000000000000000000000"
  "a Documenso API token|api_teamtoken0000000"
  "an unsigned JWT|eyJhbGciOiJub25lIn0.eyJzdWIiOiJhdHRhY2tlciJ9."
  "a malformed value|not-a-token"
)

for forged_case in "${forged_cases[@]}"; do
  label="${forged_case%%|*}"
  forged="${forged_case#*|}"
  status="$(mcp -H "Authorization: Bearer $forged" -d "$(tool_call list-envelopes)")"
  if [ "$status" = 401 ]; then
    pass "list-envelopes with $label: HTTP 401"
  else
    fail "list-envelopes with $label was not refused with 401 (HTTP $status)"
  fi
done

exit "$FAILED"
