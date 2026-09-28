#!/usr/bin/env bash
# Verifies Documenso's own team isolation for two team API tokens, before any MCP code is involved.
# Reads DOCUMENSO_URL, DOCUMENSO_TOKEN_TEAM_A and DOCUMENSO_TOKEN_TEAM_B from .env.test.local. Never prints tokens.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a
source .env.test.local
set +a

API="$DOCUMENSO_URL/api/v2"
BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT
FAILED=0

call() {
  curl -s -o "$BODY" -w '%{http_code}' "$@"
}

expect() {
  local name="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    echo "PASS  $name (HTTP $got)"
  else
    echo "FAIL  $name (expected HTTP $want, got $got): $(head -c 200 "$BODY")"
    FAILED=1
  fi
}

auth_a=(-H "Authorization: Bearer $DOCUMENSO_TOKEN_TEAM_A")
auth_b=(-H "Authorization: Bearer $DOCUMENSO_TOKEN_TEAM_B")

expect "Token A lists envelopes" 200 "$(call "${auth_a[@]}" "$API/envelope?perPage=100")"
teams_a="$(jq -c '[.data[].teamId] | unique' "$BODY")"
expect "Token B lists envelopes" 200 "$(call "${auth_b[@]}" "$API/envelope?type=DOCUMENT&perPage=1")"
teams_b="$(jq -c '[.data[].teamId] | unique' "$BODY")"
b_envelope="$(jq -r '.data[0].id' "$BODY")"
b_team="$(jq -r '.data[0].teamId' "$BODY")"

if [ "$(jq -r 'length' <<<"$teams_a")" = "1" ] && [ "$teams_a" != "$teams_b" ]; then
  echo "PASS  Token A only sees one team $teams_a, different from Team B $teams_b"
else
  echo "FAIL  Token A sees teams $teams_a, Team B sees $teams_b"
  FAILED=1
fi

expect "Token B reads its own envelope" 200 "$(call "${auth_b[@]}" "$API/envelope/$b_envelope")"
expect "Token A reads Team B envelope by ID" 404 "$(call "${auth_a[@]}" "$API/envelope/$b_envelope")"
expect "Token A reads a nonexistent envelope (same answer, no existence leak)" 404 \
  "$(call "${auth_a[@]}" "$API/envelope/envelope_doesnotexist0000")"

call "${auth_a[@]}" -H "x-team-id: $b_team" "$API/envelope?perPage=100" >/dev/null
if [ "$(jq -c '[.data[].teamId] | unique' "$BODY")" = "$teams_a" ]; then
  echo "PASS  Token A with x-team-id: $b_team header still only sees $teams_a"
else
  echo "FAIL  x-team-id header changed Token A's scope: $(jq -c '[.data[].teamId] | unique' "$BODY")"
  FAILED=1
fi

status_code="$(call "${auth_a[@]}" -X POST -H 'content-type: application/json' \
  -d "{\"envelopeId\":\"$b_envelope\"}" "$API/envelope/distribute")"
if [ "$status_code" -ge 400 ]; then
  echo "PASS  Token A cannot distribute Team B envelope (HTTP $status_code)"
else
  echo "FAIL  Token A distributed Team B envelope (HTTP $status_code)"
  FAILED=1
fi
call "${auth_b[@]}" "$API/envelope/$b_envelope" >/dev/null
echo "INFO  Team B envelope status after denied send: $(jq -r '.status' "$BODY")"

expect "Made-up token" 401 "$(call -H 'Authorization: Bearer api_notarealtoken00' "$API/envelope")"
expect "No token" 401 "$(call "$API/envelope")"

exit "$FAILED"
