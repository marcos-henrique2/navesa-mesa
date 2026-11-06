// Build do cérebro: esbuild resolve "@/..." (→ ../src, módulos puros do app) e
// "@cerebro/..." (→ ./src) pelo tsconfig e embute tudo em dist/server.js.
// Ficam de fora só as deps de runtime com binário/arquivos próprios (instaladas
// em node_modules na imagem): o Agent SDK localiza o CLI nativo relativo a si.
import { build } from "esbuild";

await build({
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  tsconfig: "tsconfig.json",
  external: ["@anthropic-ai/claude-agent-sdk", "pg", "pg-native"],
  sourcemap: true,
  legalComments: "none",
  logLevel: "info",
  banner: {
    // `pg`/deps CJS usam require dinâmico; garante `require` no bundle ESM.
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
