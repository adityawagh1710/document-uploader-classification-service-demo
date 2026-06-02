import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    // The classifier wiring imports from ../src — make sure those files are
    // traced into the standalone bundle so the Docker image actually contains
    // the domain code.
    outputFileTracingRoot: path.resolve(__dirname, ".."),
    serverComponentsExternalPackages: ["file-type"],
  },
  transpilePackages: [],
  webpack: (config) => {
    // The project's src/ uses ESM-style `.js` extensions in imports
    // (e.g. `from "./Foo.js"`) even though the source is `.ts`. Webpack
    // doesn't strip `.js` by default — `extensionAlias` tells it to also
    // try `.ts`/`.tsx` when resolving a `.js` import. Required for any
    // `@svc/*` path to resolve.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    // Webpack walks up from the importing file's directory looking for
    // node_modules. src/ lives at `../src` (sibling of ui/), so its
    // upward walk misses `ui/node_modules`. Force the UI's node_modules
    // onto the resolution path so src/'s `import "zod"` etc. work.
    config.resolve.modules = [
      path.resolve(__dirname, "node_modules"),
      ...(config.resolve.modules ?? ["node_modules"]),
    ];
    return config;
  },
};

export default nextConfig;
