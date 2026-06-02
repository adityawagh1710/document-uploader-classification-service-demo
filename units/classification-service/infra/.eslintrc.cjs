/* eslint-env node */
// infra/.eslintrc.cjs — extends root with restrictions disabled
// (infra/ is a separate package boundary; no domain/port/adapter rules apply)
module.exports = {
  extends: ["../.eslintrc.cjs"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  rules: {
    "no-restricted-imports": "off",
    "no-restricted-syntax": "off",
    "no-restricted-properties": "off",
    "no-restricted-globals": "off",
    "no-console": "off",
    "boundaries/element-types": "off",
  },
};
