#!/bin/sh
# Render the runtime config (GRAPHQL_URL, UPLOAD_REWRITE) into the served html
# dir before nginx starts. Runs via nginx:alpine's /docker-entrypoint.d/ hook.
# envsubst ships in the nginx image.
set -e
: "${GRAPHQL_URL:=http://localhost:8099/graphql}"
: "${UPLOAD_REWRITE:=}"
export GRAPHQL_URL UPLOAD_REWRITE
envsubst '${GRAPHQL_URL} ${UPLOAD_REWRITE}' \
  < /etc/nginx/templates/config.js.template \
  > /usr/share/nginx/html/config.js
echo "[app-config] graphqlUrl=${GRAPHQL_URL} uploadRewrite=${UPLOAD_REWRITE}"
