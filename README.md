# 🚗 Navesa Mesa

Mesa de precificação de seminovos do Grupo Navesa — substituindo o Excel por um sistema web com FIPE em tempo real e análise por IA.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind 4 · Supabase (Postgres) · SheetJS · TanStack Table · Vercel AI SDK (Claude)

## Quick start

```powershell
npm install
npm run dev               # http://localhost:3000
npm run parse-test -- "caminho\para\relatorio.xlsx"    # valida parser
```

Para Supabase + Vercel, ver [`docs/SETUP.md`](docs/SETUP.md).
Para escopo, decisões e schema, ver [`docs/PRD.md`](docs/PRD.md).

## Estrutura

```
src/
  app/               Rotas (App Router)
  lib/
    parsers/         Parser do XLSX do NBS
    supabase/        Clients browser/server
    utils.ts
scripts/
  parse-test.ts      CLI para validar parser
supabase/
  migrations/        DDL (rode no SQL Editor do Supabase)
docs/
  PRD.md             Decisões e escopo
  SETUP.md           Passo-a-passo cloud
```

## Status

- **Sprint 0** — scaffold + parser validado contra 680 veículos ✅
- **Sprint 1** — ingestão funcional (upload → Supabase) ⏳
