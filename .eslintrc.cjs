/* eslint-env node */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["./tsconfig.json", "./tests/tsconfig.json"],
    ecmaVersion: 2022,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint", "boundaries"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  settings: {
    "boundaries/elements": [
      { type: "domain", pattern: "src/domain/*" },
      { type: "ports", pattern: "src/ports/*" },
      { type: "adapters", pattern: "src/adapters/*" },
      { type: "application", pattern: "src/application/*" },
      { type: "handler-entry", pattern: "src/handler/*" },
      { type: "shared", pattern: "src/shared/*" },
    ],
  },
  rules: {
    "boundaries/element-types": ["error", {
      default: "disallow",
      rules: [
        { from: "domain", allow: ["domain", "shared"] },
        { from: "ports", allow: ["domain", "ports", "shared"] },
        { from: "adapters", allow: ["ports", "adapters", "shared"] },
        { from: "application", allow: ["domain", "ports", "application", "shared"] },
        { from: "handler-entry", allow: ["domain", "ports", "adapters", "application", "handler-entry", "shared"] },
        { from: "shared", allow: ["shared"] },
      ],
    }],
    "@typescript-eslint/switch-exhaustiveness-check": "error",
    "@typescript-eslint/consistent-type-imports": "error",
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    "no-console": "error",
    "no-throw-literal": "error",
    "no-restricted-syntax": ["error", {
      selector: "ThrowStatement",
      message: "Domain code does not throw — return Result.error instead.",
    }],
    "no-restricted-globals": ["error",
      { name: "Date", message: "Domain code is pure (NFR-5). Pass timestamps as inputs." },
      { name: "performance", message: "Domain code is pure (NFR-5)." },
    ],
    "no-restricted-properties": ["error",
      { object: "Date", property: "now", message: "NFR-5: pure domain code." },
      { object: "Math", property: "random", message: "NFR-5: pure domain code." },
    ],
    "no-restricted-imports": ["error", {
      paths: [
        { name: "@aws-sdk/client-s3", message: "AWS SDK forbidden in domain; use a port." },
        { name: "@aws-sdk/client-dynamodb", message: "AWS SDK forbidden in domain; use a port." },
        { name: "@aws-sdk/client-sfn", message: "AWS SDK forbidden in domain; use a port." },
        { name: "@aws-lambda-powertools/logger", message: "Use the Logger port." },
      ],
    }],
  },
  overrides: [
    {
      files: ["src/adapters/**/*.ts", "infra/**/*.ts"],
      rules: {
        "no-restricted-imports": "off",
        "no-restricted-syntax": "off",
        "no-restricted-properties": "off",
        "no-restricted-globals": "off",
      },
    },
    {
      // Application layer: no AWS SDK imports; no Date.now/Math.random (NFR-5 determinism)
      files: ["src/application/**/*.ts"],
      rules: {
        "no-restricted-imports": ["error", {
          paths: [
            { name: "@aws-sdk/client-s3", message: "AWS SDK forbidden in application; use a port." },
            { name: "@aws-sdk/client-dynamodb", message: "AWS SDK forbidden in application; use a port." },
            { name: "@aws-sdk/client-sfn", message: "AWS SDK forbidden in application; use a port." },
            { name: "@aws-sdk/lib-dynamodb", message: "AWS SDK forbidden in application; use a port." },
          ],
        }],
        "no-restricted-globals": ["error",
          { name: "Date", message: "Use injected nowProvider() — NFR-5 determinism." },
          { name: "performance", message: "Pure logic; pass timing as input if needed." },
        ],
        "no-restricted-properties": ["error",
          { object: "Date", property: "now", message: "Use nowProvider()." },
          { object: "Math", property: "random", message: "Inject random source." },
        ],
        "no-restricted-syntax": "off",
        "no-throw-literal": "off",
      },
    },
    {
      // Handler entry layer: wiring; everything allowed including AWS SDK + Date
      files: ["src/handler/**/*.ts"],
      rules: {
        "no-restricted-imports": "off",
        "no-restricted-syntax": "off",
        "no-restricted-properties": "off",
        "no-restricted-globals": "off",
      },
    },
    {
      files: ["tests/**/*.ts"],
      parserOptions: { project: "./tests/tsconfig.json" },
      rules: {
        "no-restricted-imports": "off",
        "no-restricted-syntax": "off",
        "no-restricted-properties": "off",
        "no-restricted-globals": "off",
        "no-console": "off",
        "boundaries/element-types": "off",
      },
    },
  ],
  ignorePatterns: [
    "node_modules",
    "dist",
    "coverage",
    "cdk.out",
    // UI has its own ESLint setup (Next.js's eslint-next) — keep it out of
    // the root type-aware ESLint pass which references the service tsconfigs.
    "ui",
    // Worker is its own self-contained package under worker/ — own deps,
    // own tsconfig (worker/tsconfig.json + worker/tsconfig.test.json), own
    // vitest config. Same treatment as ui/: the root type-aware ESLint
    // pass cannot resolve worker/**/*.ts against the root tsconfigs.
    "worker",
    // Root-level config files that aren't in any service tsconfig include.
    "vitest.config.ts",
    "cdk.json",
    "*.config.cjs",
  ],
};
