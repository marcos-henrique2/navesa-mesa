<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Navesa Mesa — Agent Squad

Esse projeto usa um **AIOX dev squad** project-local em `.claude/agents/`. Adaptado de `~/aios-core/.aiox-core/development/agents/` com contexto específico do Navesa Mesa (Next 16 + Supabase + concessionária brasileira).

## Os 10 agentes

| Persona | Subagent type | Quando usar |
|---|---|---|
| 🎯 **Morgan** (PM) | `morgan-pm` | Estratégia de produto, PRD, prioridade, roadmap |
| 📋 **Pax** (PO) | `pax-po` | Validação de story (10-point checklist), GO/NO-GO |
| 📝 **River** (SM) | `river-sm` | Criação de story estruturada a partir de pedido bruto |
| 🏛️ **Aria** (Architect) | `aria-architect` | Decisões arquiteturais, tradeoffs, design de sistema |
| 🗄️ **Dara** (Data Engineer) | `dara-data-engineer` | Schema Supabase, RLS, índices, migrations |
| 💻 **Dex** (Dev) | `dex-dev` | Implementação de código, refactor, bug fix |
| ✅ **Quinn** (QA) | `quinn-qa` | Code review, quality gate, verdict PASS/CONCERNS/FAIL |
| 🎨 **Uma** (UX) | `uma-ux` | Design de fluxo/tela, estados, hierarquia de informação |
| 🔬 **Alex** (Analyst) | `alex-analyst` | Pesquisa de mercado/técnica, análise de dados internos |
| 🚀 **Gage** (DevOps) | `gage-devops` | Git push, PR, release, infra (EXCLUSIVO) |

## Workflow padrão (feature nova)

```
Pedido do Marcos
    ↓
@morgan-pm  (define outcome de negócio + RICE/PRD curto)
    ↓
@river-sm   (estrutura como story com AC, scope, edge cases)
    ↓
@pax-po     (valida 10-point checklist → GO/NO-GO)
    ↓
@aria-architect  (decisão arquitetural, se aplicável)
    ↓
@dara-data-engineer  (schema/RLS, se aplicável)
    ↓
@uma-ux     (design de tela/fluxo, se aplicável)
    ↓
@dex-dev    (implementação)
    ↓
@quinn-qa   (review + verdict)
    ↓
@gage-devops  (push/PR)
```

Pra **features pequenas / bug fix simples**: pode pular direto pro `@dex-dev` → `@quinn-qa` → `@gage-devops`.

## Autoridade exclusiva

| Operação | Quem |
|---|---|
| `git push`, `git push --force`, `gh pr create`, `gh pr merge`, `gh release` | **APENAS `@gage-devops`** |
| Vercel/hosting config, MCP server management | **APENAS `@gage-devops`** |
| `git add`, `commit`, `status`, `diff`, `log`, branch local | Qualquer agente |

## Regras transversais

1. **Pt-BR em UI e mensagens pro usuário.** Inglês ok em código/identificadores.
2. **Sem `--no-verify`** em git hook nunca.
3. **`.env.local` NUNCA commitado** — contém Supabase service_role + Google API key.
4. **Precisão financeira centavo-perfect** vs NBS DMS — qualquer divergência R$ 0,01+ é bug crítico.
5. **Imports absolutos** com `@/` — nunca `../../`.
6. **Sem `any`** — use `unknown` + type guard ou tipo apropriado.
7. **Testes:** `node --import tsx --test tests/*.test.ts` (Node 22 built-in).
8. **Schema Supabase canônico:** `supabase/migrations/002_complete_schema.sql` — sempre idempotente.

## Como invocar

- **Via Agent tool (project-local):** `subagent_type: "dex-dev"` (etc.)
- **Via slash command global:** `/AIOX:agents:dev`, `/data-squad:agents:data-chief`, etc. — os squads globais permanecem disponíveis pra trabalho fora do escopo dev (copy, brand, traffic, advisory-board…)
