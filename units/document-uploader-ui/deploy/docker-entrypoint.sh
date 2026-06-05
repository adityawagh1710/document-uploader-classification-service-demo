#!/bin/sh
# Render the runtime config into the served html dir + the optional same-origin
# GraphQL proxy snippet, before nginx starts. Runs via nginx:alpine's
# /docker-entrypoint.d/ hook. envsubst ships in the nginx image.
set -e

# ── 1. Runtime app config (GRAPHQL_URL, UPLOAD_REWRITE) ───────────────────────
# The SPA reads window.__APP_CONFIG__ at runtime, so one built image is
# repointable per environment without a rebuild. uploadRewrite is a local-dev-
# only shim for LocalStack's internal presigned-URL host (empty on real AWS).
: "${GRAPHQL_URL:=http://localhost:8099/graphql}"
: "${UPLOAD_REWRITE:=}"
export GRAPHQL_URL UPLOAD_REWRITE
envsubst '${GRAPHQL_URL} ${UPLOAD_REWRITE}' \
  < /etc/nginx/templates/config.js.template \
  > /usr/share/nginx/html/config.js
echo "[app-config] graphqlUrl=${GRAPHQL_URL} uploadRewrite=${UPLOAD_REWRITE}"

# ── 2. Same-origin GraphQL proxy snippet (dev05/prod) ─────────────────────────
# When GRAPHQL_UPSTREAM is set (e.g. the in-cluster router base
# http://ingestion-subgraph.<ns>.svc.cluster.local:8080), write a /graphql
# location that proxies to it; nginx preserves the /graphql URI (no path on
# proxy_pass). When unset (local browser-direct), write an EMPTY snippet so
# nginx starts without depending on an upstream name resolving.
PROXY_SNIPPET=/etc/nginx/graphql-proxy.conf
if [ -n "${GRAPHQL_UPSTREAM:-}" ]; then
  cat > "$PROXY_SNIPPET" <<EOF
location /graphql {
    proxy_pass ${GRAPHQL_UPSTREAM};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;        # WS subscriptions
    proxy_set_header Connection "upgrade";
}
EOF
  echo "[app-config] graphql same-origin proxy → ${GRAPHQL_UPSTREAM}"
else
  : > "$PROXY_SNIPPET"
  echo "[app-config] graphql same-origin proxy disabled (browser-direct)"
fi
