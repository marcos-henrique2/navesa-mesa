# Roadmap — Navesa Mesa

> Próximos passos priorizados, baseados nas decisões do Marcos.
> Atualizado em 2026-06-11.

---

## ✅ Concluído

### Sprint 1 — Repasses (cadastro + XLSX)
- Schema (4 tabelas) + RLS + triggers
- Telas `/repasses` (lista + KPIs + filtros) e `/repasses/[id]` (detalhe editável)
- Geração XLSX com 4 abas + fórmulas vivas (Excel/Sheets recalcula sozinho)
- Integração com `/veiculos/[chassi]` e widget "Carros pra repassar" no dashboard
- Botão "Subir pra repasse" direto na tabela do estoque (`/veiculos`) — ponto de entrada principal
- Filtro `repasse=sim` em `/veiculos` pra triagem rápida
- Rota `/repassar` removida (substituída pelo widget no dashboard + filtro `repasse=sim` no estoque)
- 25 testes novos (111/111 verde), CI green

---

## 🚦 Em revisão (Marcos avaliando)

### Revisão pós-Sprint 1
- _(nada pendente — itens consolidados acima)_

---

## 🔜 Próximos passos sugeridos

### 1. Usar Sprint 1 com 1-2 carros reais — Marcos
- Cadastrar primeiro repasse end-to-end
- Baixar XLSX, abrir no Excel/Sheets, editar gasto, ver margem recalcular
- Listar o que faltou descobrir
- Output: lista de ajustes pra Sprint 2

### 2. Sprint 2 — Refinamentos Repasses (6-8h)
Débitos técnicos da revisão Quinn:
- **F3** Helper `hojeLocal()` pra evitar UTC-shift de data (queries + 3 modais)
- **F4** Modal de "subir" via `/repasses` passa valor sugerido
- **F5** Spinner por linha no checklist de documentação
- **+ ajustes do uso real** (lista do passo 1)

### 3. Sprint 3 — Gerador de Anúncio Auto Avaliar (8-10h)
- Marcos envia modelos de anúncio do Auto Avaliar (templates)
- Sistema gera anúncio automático a partir dos dados do repasse
- Campos extras já preparados no schema: `descricao`, `opcionais`, fotos
- Possível integração com OpenAI/Anthropic pra gerar texto atrativo

### 4. Hotfix CI (~10min)
- Subir `actions/checkout@v4` → `@v5` e `actions/setup-node@v4` → `@v5`
- **Prazo**: antes de 16/jun/2026 (deprecation forçada do Node 20)

---

## 🧠 Backlog (sem data definida)

### Débitos técnicos
- **F7** RLS multi-tenant — quando Marcos contratar vendedor/assistente
- Warning `useMemo` faltando dep `lojas` em `src/components/HeatmapLojas.tsx:97`
- 2 `<img>` em vez de `next/image` (`AppShell.tsx:221`, `login/page.tsx:53`)
- Consolidar libs XLSX (atualmente `xlsx`/SheetJS + `exceljs`)
- Range `SUM(D2:D100)` migrado pra dinâmico no XLSX (já resolvido)

### Ideias futuras
- **Integração API Auto Avaliar** — Marcos vai investigar (depende de credenciais/docs)
- **Manual de carros** (manutenção, pintura, recondicionamento) — Marcos sinalizou que vai usar Auto Avaliar como fonte por enquanto
- **2FA Supabase** — task manual do Marcos pendente
- **Sentry DSN** no Vercel — task manual do Marcos pendente
- **Anúncios em outros canais** — futuro pós Sprint 3 (Marketplace, OLX, etc.)

---

## 📊 KPIs do sistema (alvos informais)

- 86 testes pré-Sprint-1 → 111 após → objetivo: ≥150 ao fim de Sprint 3
- Cobertura de tipos: 0 `any` em todo `src/`
- Pre-flight pipeline: tsc 0 + lint 0 + tests 100% verde
- CI: green em main sempre
