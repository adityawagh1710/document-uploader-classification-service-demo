// Default runtime config (dev + fallback). In the Docker image this file is
// regenerated from env at container start (see deploy/docker-entrypoint.sh).
// uploadRewrite is a LOCAL-DEV ONLY shim: LocalStack signs presigned PUT URLs
// with the internal docker host (localstack:4566), which the browser can't
// reach — rewrite it to the host-published endpoint. Leave empty on real AWS.
window.__APP_CONFIG__ = {
  graphqlUrl: "http://localhost:8099/graphql",
  uploadRewrite: "localstack:4566=localhost:4566",
};
