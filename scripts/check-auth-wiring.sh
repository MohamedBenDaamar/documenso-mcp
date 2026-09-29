#!/usr/bin/env bash
# Checks the running MCP server's sign-in boundary over real HTTP, with no browser and no credentials.
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
  pass "Protected resource metadata names $(jq -r '.authorization_servers[0]' "$BODY")"
else
  fail "Protected resource metadata missing (HTTP $status)"
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

for tool in list-envelopes get-envelope-status list-templates; do
  status="$(mcp -d "$(tool_call "$tool")")"
  challenge="$(grep -i '^www-authenticate:' "$HEADERS" | tr -d '\r' || true)"
  if [ "$status" = 401 ] && [[ "$challenge" == *resource_metadata* ]]; then
    pass "$tool without a token: HTTP 401 with a WWW-Authenticate challenge"
  elif sed -n 's/^data: //p' "$BODY" | jq -e '.result._meta["mcp/www_authenticate"] // .result.isError' >/dev/null 2>&1; then
    pass "$tool without a token: refused with a sign-in error result"
  else
    fail "$tool without a token was not refused (HTTP $status): $(head -c 200 "$BODY")"
  fi
done

b64url() { printf '%s' "$1" | base64 | tr '+/' '-_' | tr -d '='; }
payload="$(b64url '{"sub":"attacker","aud":"authenticated","exp":4102444800}')"

forged_cases=(
  "not a JWT|not-a-jwt"
  "alg none|$(b64url '{"alg":"none","typ":"JWT"}').$payload."
  "HS256 key confusion|$(b64url '{"alg":"HS256","typ":"JWT","kid":"forged"}').$payload.c2ln"
  "ES256 with bad signature|$(b64url '{"alg":"ES256","typ":"JWT","kid":"forged"}').$payload.c2ln"
)

for forged_case in "${forged_cases[@]}"; do
  label="${forged_case%%|*}"
  forged="${forged_case#*|}"
  status="$(mcp -H "Authorization: Bearer $forged" -d "$(tool_call list-envelopes)")"
  if [ "$status" = 401 ]; then
    pass "list-envelopes with a forged token ($label): HTTP 401"
  else
    fail "list-envelopes with a forged token ($label) was not refused with 401 (HTTP $status)"
  fi
done

# Known mcp-use 2.7.0 issue: when the JWKS has several keys of the same type (normal during key rotation),
# a token without `kid` makes jose throw JWKSMultipleMatchingKeys, which mcp-use does not classify as a
# credential failure, so the request fails closed with 500 instead of 401.
status="$(mcp -H "Authorization: Bearer $(b64url '{"alg":"ES256","typ":"JWT"}').$payload.c2ln" -d "$(tool_call list-envelopes)")"
if [ "$status" = 401 ]; then
  pass "list-envelopes with a forged token without kid: HTTP 401"
elif [ "$status" = 500 ]; then
  echo "WARN  list-envelopes with a forged token without kid: HTTP 500, refused but not 401 (known mcp-use issue)"
else
  fail "list-envelopes with a forged token without kid was not refused (HTTP $status)"
fi

status="$(curl -s -o "$BODY" -w '%{http_code}' "$BASE/auth/account")"
if [ "$status" = 200 ] && grep -q 'action="/auth/signin"' "$BODY"; then
  pass "Account page asks signed-out users to sign in"
else
  fail "Account page did not show sign-in (HTTP $status)"
fi

status="$(curl -s -o "$BODY" -w '%{http_code}' -X POST "$BASE/auth/signin" -H 'Origin: https://evil.example' -d 'email=a@b.c&password=x')"
if [ "$status" = 403 ]; then
  pass "Cross-site form post blocked (HTTP 403)"
else
  fail "Cross-site form post was not blocked (HTTP $status)"
fi

exit "$FAILED"
