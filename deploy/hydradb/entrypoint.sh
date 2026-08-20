#!/bin/sh
# Turn an environment variable into the token file HydraDB expects, then start it.
#
# Deliberately tiny. Everything here happens before the database does anything,
# so a mistake in this file looks like "the database will not start" with no
# further explanation — which is the worst kind of failure to debug on a host
# whose only output is a log tail.
set -e

TOKEN_FILE="${GRAPH_AUTH_TOKEN_FILE:-/data/auth-token}"

mkdir -p "$(dirname "$TOKEN_FILE")" "${LOCAL_PATH:-/data/store}" "${GRAPH_DATA_CACHE_DIR:-/data/cache}"

# Checked here so the failure names the cause. HydraDB requires at least 32
# characters and rejects a shorter one with "graph auth token must contain at
# least 32 non-placeholder characters" — accurate, but it arrives after the
# container has already claimed to be starting, buried in a log tail, on a host
# where nobody can attach a shell to look around.
if [ -n "$GRAPH_AUTH_TOKEN" ] && [ "${#GRAPH_AUTH_TOKEN}" -lt 32 ]; then
  echo "GRAPH_AUTH_TOKEN is ${#GRAPH_AUTH_TOKEN} characters. HydraDB requires at least 32." >&2
  echo "Generate one with: node -e \"console.log(require('crypto').randomBytes(24).toString('base64url'))\"" >&2
  exit 1
fi

if [ -n "$GRAPH_AUTH_TOKEN" ]; then
  # printf rather than echo: echo appends a newline on most shells, and a token
  # with a trailing newline is a token that does not match, which surfaces much
  # later as an authentication failure nobody connects back to here.
  printf '%s' "$GRAPH_AUTH_TOKEN" > "$TOKEN_FILE"
  chmod 0600 "$TOKEN_FILE"
elif [ ! -f "$TOKEN_FILE" ]; then
  # Refused rather than started open. A graph database reachable from the
  # internet with no token is worse than one that failed to boot, and this is a
  # security product — shipping an accidental open instance would be its own
  # kind of joke.
  echo "GRAPH_AUTH_TOKEN is not set and $TOKEN_FILE does not exist." >&2
  echo "Refusing to start without authentication." >&2
  exit 1
fi

exec /usr/local/bin/graph-node "$@"
