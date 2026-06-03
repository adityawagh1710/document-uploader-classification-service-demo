import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    // Root the standalone file-tracing at the REPO ROOT (../..), not units/.
    // Under the pnpm workspace, dependencies hoist to the repo-root node_modules
    // (node-linker=hoisted); tracing must start there or the standalone bundle
    // misses them. Consequence: the standalone entry is
    // `units/document-uploader-ui/server.js` (see the Dockerfile CMD).
    outputFileTracingRoot: path.resolve(__dirname, "../.."),
  },
};

export default nextConfig;
