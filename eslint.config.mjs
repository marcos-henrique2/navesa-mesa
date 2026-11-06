import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Cérebro: pacote Node próprio (cerebro/package.json). O código-fonte é
    // linted por aqui; build e deps ficam de fora.
    "cerebro/dist/**",
    "cerebro/node_modules/**",
  ]),
]);

export default eslintConfig;
