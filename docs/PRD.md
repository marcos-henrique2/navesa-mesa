# PRD — Navesa Mesa (Mesa de Precificação de Seminovos)

Documento vivo. Reflete o estado das decisões em **2026-05-25**.

---

## 1. Problema

A mesa de precificação de seminovos da Navesa opera hoje com:
- Relatório NBS exportado em XLSX (com 556 colunas, das quais ~15 importam)
- Excel manual para filtrar, cruzar valor de aquisição vs preço de venda vs FIPE
- Consulta separada à tabela FIPE em outra aba do navegador
- Visão consolidada de estoque (com/sem carros "fantasmas") difícil de calcular

**Custo:** tempo. Cada precificação leva minutos. Trava giro de estoque.

---

## 2. Usuários

| Fase | Usuários |
|---|---|
| MVP | 1 — Marcos Henrique (solo) |
| V1 | Mesa toda + gerentes por loja |
| V2 | Acesso multi-loja com permissões |

---

## 3. Objetivo do MVP

> *"Permitir precificar 1 carro do estoque em < 60s, cruzando dados internos (NBS) com FIPE em tempo real, num único sistema web."*

---

## 4. Escopo MoSCoW

### Must (MVP)
- Upload manual de XLSX do NBS → ingestão no banco
- Dashboard com 3 KPIs: estoque real, em PREPARAÇÃO, total — com toggle
- Tabela de veículos com filtros (loja, marca, cor, comb, pátio, situação)
- Cadastro CRUD de lojas (cód → nome)
- Tela de detalhe do veículo
- Consulta FIPE em tempo real com cache mensal
- Sugestão de preço via regra simples (FIPE + margem + custos)

### Should (v1.1)
- Justificativa em texto da sugestão (Claude Sonnet)
- Chat sobre o relatório ("quais carros estão há +60 dias na loja 31?")
- Detecção de outliers (carros 15%+ acima da FIPE)
- Histórico de sugestões de preço por veículo

### Could (futuro)
- Integração direta NBS (API ou banco)
- Scraping Webmotors / iCarros / OLX
- Multi-usuário com permissão por loja
- Dashboard gerencial agregado
- Análise de comprador (lojista vs PF) — requer dados pessoais (LGPD)

### Won't (v0)
- Integração com financeiras
- Workflow de aprovação de preço
- App mobile

---

## 5. Stack escolhida (Opção A — velocidade + custo zero)

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 + TS |
| UI | Tailwind 4 + lucide-react |
| Tabelas | TanStack Table v8 |
| Banco | Supabase (Postgres + Auth + Storage) |
| Auth | Supabase magic link (single user no MVP) |
| Parser XLSX | SheetJS (xlsx) |
| Validação | Zod |
| FIPE | API Parallelum (`parallelum.com.br/fipe/api/v1`) com cache em Postgres |
| IA | Vercel AI SDK + Anthropic (Claude Sonnet 4.6) |
| Hospedagem | Vercel |
| Custo MVP | $0 (free tiers) |

---

## 6. Schema de dados

Ver `supabase/migrations/001_initial.sql`. Tabelas:

- `lojas` — código → nome (preenchido manualmente)
- `snapshots` — uma linha por upload de XLSX
- `veiculos` — registros do estoque (chave: snapshot_id + chassi)
- `fipe_cache` — TTL mensal
- `sugestoes_preco` — histórico/auditoria

Coluna `patio_eh_preparacao` é **generated stored** — UPPER+TRIM da coluna `patio` = `'PREPARAÇÃO'`.

---

## 7. Mapeamento NBS XLSX → schema

| Coluna NBS | Posição | Campo banco |
|---|---:|---|
| Cód Empresa | 0 | `cod_empresa` |
| Modelo | 2 | `modelo` |
| Chassi Completo | 3 | `chassi` |
| Linha | 4 | `marca` |
| Preço Venda | 6 | `preco_venda` |
| Cor Externa | 7 | `cor_externa` (normalizada: PRETA→PRETO) |
| Ano/m | 9 | `ano_fabricacao` + `ano_modelo` (parse "21/22") |
| Dpt | 10 | `dias_patio` |
| Placa | 13 | `placa` |
| Comb | 17 | `combustivel` |
| Patio | 22 | `patio` (TRIM ao salvar; "PREPARAÇÃO" com espaço!) |
| Total Nota Fabrica | 31 | `valor_aquisicao` |
| Vendedor quem Recebeu | 36 | `vendedor_recebeu` |
| Descricao Situação | 37 | `descricao_situacao` |
| Custo Total | 46 | `custo_total` |
| Entrada | 50 | `data_entrada` |

**Header está na linha 3** do XLSX (linhas 1 e 2 são título + data de geração).

**Colunas com dados pessoais** (nome/CPF do comprador) **NÃO são importadas** — fora de escopo, zero exposição LGPD.

---

## 8. Decisões arquiteturais (ADRs)

| # | Decisão | Por quê |
|---|---|---|
| 1 | Monolito Next.js (não microserviços) | Solo dev, 1 repo, 1 deploy |
| 2 | Upload manual no MVP (não integração NBS) | Destrava entrega; integração direta vem depois |
| 3 | Cache FIPE em Postgres com TTL mensal | FIPE muda 1x/mês; > 99% das consultas serão hit |
| 4 | Auth single-user no MVP | Multi-tenant é over-engineering agora |
| 5 | RLS aberta para `authenticated` | MVP single-user; permissão por loja vem na V2 |
| 6 | Snapshot a cada upload | Permite comparar evolução do estoque ao longo do tempo |
| 7 | LLM via Vercel AI SDK + Claude Sonnet 4.6 | Prompt caching reduz custo; tool-use → query SQL |

---

## 9. Métricas de sucesso

- ⏱️ Tempo médio de precificação < 60s (vs N minutos no Excel)
- 📊 100% dos 680 veículos do relatório visíveis e filtráveis
- 💎 FIPE consultada em < 2s na tela
- 💰 KPI "Valor do estoque" disponível em 2 modos (com/sem PREPARAÇÃO) em 1 clique

---

## 10. Roadmap

| Sprint | Foco | Estimativa |
|---|---|---|
| 0 | Setup + scaffold + parser | ✅ Concluído |
| 1 | Ingestão funcional (upload + insert no banco) | 3-5 dias |
| 2 | Dashboard de estoque + filtros + CRUD lojas | 3-5 dias |
| 3 | FIPE + tela detalhe + sugestão por regra | 3-5 dias |
| 4 | IA: justificativa + chat (opcional MVP) | 3-5 dias |

---

## 11. Pendências em aberto

- [ ] Confirmar nomes das 14 outras lojas (preencher dentro do app)
- [ ] Confirmar se `Custo Total` e `Total Nota Fabrica` divergem em algum cenário (no relatório atual são quase iguais)
- [ ] Definir regra exata de sugestão de preço (Sprint 3) — começar com `max(FIPE, custo_total × 1.07)`
