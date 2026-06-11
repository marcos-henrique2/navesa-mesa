# Roadmap — Navesa Mesa

> Próximos passos priorizados, baseados nas decisões do Marcos.
> Atualizado em 2026-06-11.

---

## ✅ Concluído

### Sprint 1 — Repasses (refatorado em 11/jun/2026)

**Versão original (substituída):** schema com gastos/documentação/valores; tela de detalhe editável; XLSX 4 abas com fórmulas vivas.

**Versão atual (vigente):** fluxo enxuto — marcar carros pra subir, exportar XLSX profissional, marcar como subidos. Gestão de valor/margem/venda fica no Auto Avaliar.

- Status novo: `marcado` (default) → `subido` (pós envio Auto Avaliar) — migration 010
- Lista `/repasses` apenas-leitura + filtros (status/período/loja) + seleção em lote
- Modal `MarcarRepasseModal` mínimo (sem campos de valor) + bulk silencioso
- XLSX profissional (1 aba): cabeçalho NAVESA, header colorido, zebra, AutoFilter, frozen header, dropdowns IPVA/Doc/Cautelar pra preencher no Excel
- Página detalhe `/repasses/[id]` e modais MarcarVendido/MarcarNaoVendido deletados
- Colunas legacy do schema (`valor_subiu`, `valor_vendido`, gastos, etc.) mantidas como zumbis pra zero risco
- Widget dashboard mantido (top 5 candidatos a repasse)
- 125 testes verdes

### Sprint Caminho B — Inline edit dos 5 campos manuais no /repasses (11/jun/2026)

**Problema:** preencher dados no XLSX = perde tudo a cada nova exportação. Solução: dados vivem no SISTEMA, XLSX vem pré-preenchido.

- Migration 011: `ipva_status` (NEW), `cautelar_status_manual` (NEW), `valor_subir` (NEW); `documentacao_status` legacy relaxado (NULL ok + valor `nao_verificado`); `observacoes` legacy reusada
- Tipos `IpvaStatus`, `DocStatus`, `CautelarStatus` + LABEL pt-BR + type guards (defesa em profundidade)
- `updateRepasseCampos(id, patch)` — patch parcial com validação antes do banco
- `RepassesLista` ganha 5 colunas editáveis inline (selects + inputs com debounce 600ms pra texto)
- Patch otimista: UI atualiza imediato, rollback em erro
- XLSX 18 colunas (+1 "Valor pra subir"): cells preenchidas sem dropdown e com cor de fundo de status; cells vazias mantêm dropdown fallback
- 149 testes verdes (+ 24 desde Sprint 1)

---

## 🚦 Em revisão (Marcos avaliando)

### Revisão pós-Caminho B
- _(usar com carros reais e listar gaps)_

---

## 🔜 Próximos passos sugeridos

### 1. Usar Caminho B com 1-2 carros reais — Marcos
- Marcar carro → preencher os 5 campos inline → exportar → conferir XLSX pré-preenchido
- Persistir dados ao re-exportar (não perder)
- Output: lista de ajustes pra Sprint 2

### 2. Sprint 2 — Refinamentos Repasses (6-8h)
Débitos técnicos:
- **Pré-preencher cautelar manual a partir do sistema** (mapeamento `aprovado→limpa`, `com_restricao→com_restricao`) — pulado nesta sprint pra evitar acoplamento client-side
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
