import type { EnvConfig } from "./types.js";
import devConfig from "./dev.js";
import stagingConfig from "./staging.js";
import prodConfig from "./prod.js";

export function loadEnvConfig(envName: string): EnvConfig {
  switch (envName) {
    case "dev":
      return devConfig;
    case "staging":
      return stagingConfig;
    case "prod":
      return prodConfig;
    default:
      throw new Error(
        `Unknown environment "${envName}". Expected one of: dev, staging, prod. ` +
          `Pass via -c env=<name> or set CDK_DEFAULT_ENV.`,
      );
  }
}
