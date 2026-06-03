import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    // Keep the standalone file-tracing root at the monorepo `units/` dir so the
    // Docker image's entrypoint stays `document-uploader-ui/server.js`. The UI no
    // longer imports the classification engine from ../src — it is a pure
    // HTTP/GraphQL client of the wundergraph-router — so the old @svc webpack
    // resolution hacks are gone.
    outputFileTracingRoot: path.resolve(__dirname, ".."),
  },
};

export default nextConfig;
