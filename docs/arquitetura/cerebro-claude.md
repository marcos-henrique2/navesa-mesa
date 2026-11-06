# Cérebro Claude: arquitetura (fatia 1, Chat IA)

**Autora:** Aria (architect) · **Data:** 2026-11-05 · **Status:** proposta, aguardando as decisões do Marcos listadas na seção 7
**Escopo:** desenho apenas. Não há código de produção aqui. Implementação fica com @dex-dev, DDL com @dara-data-engineer e infra/deploy com @gage-devops.

---

## 0. Decisões já tomadas (premissas, não re-litigar)

| # | Premissa |
|---|---|
| P1 | Sem `ANTHROPIC_API_KEY`. O LLM é o Claude Code logado na **assinatura** do Marcos, dentro de um container Docker. |
| P2 | A ideia vem do core-os (rodar o Claude em modo headless). **Nenhum código copiado**: o repo não tem licença. |
| P3 | O Claude **não** recebe Bash, Write, Edit nem shell. Só ferramentas de leitura de dados. |
| P4 | Fatia 1 = reativar a aba Chat IA com acesso ao estoque completo e às vendas. WhatsApp (Evolution + n8n) e relatórios XLSX/PDF vêm depois. |
| P5 | Ambiente 1: PC Windows do Marcos (Docker Desktop 28) + `npm run dev` local. Ambiente 2: VPS. A Vercel não roda o CLI. |
| P6 | **Q3 decidida pelo Marcos (06/11/2026):** modelo padrão **Haiku 5.5** (`claude-haiku-5-5`, `modelo: "rapido"`); **Sonnet 5.5** (`claude-sonnet-5-5`, `modelo: "avancado"`) só sob demanda. Configurável por `CEREBRO_MODELO_RAPIDO` / `CEREBRO_MODELO_AVANCADO`. |

### O que o código atual mostra (base do desenho)

- `src/app/api/chat/route.ts`: autentica via Supabase (`auth.getUser()`), aplica rate limit Upstash de 10/min por usuário e tenta os providers DeepSeek → Groq → Gemini → Anthropic com fallback. O system prompt recebe `JSON.stringify(bundle)`. A resposta sai como `text/plain` em stream, com o header `x-provider-usado`. `maxDuration = 90`.
- `src/components/Chat.tsx`: monta `montarBundle(...)` **no browser** e envia `compactarBundle(bundle)` (top-3/top-5). Lê o stream como texto puro e persiste em `chat_messages` pelo client.
- `src/lib/analytics/insights.ts` e `margem.ts`: **funções puras** sem React. `calcMargemVenda` é a fórmula canônica validada centavo a centavo contra o NBS. Os imports de `parsers/*` e de `inventory/cautelar` são `import type`, apagados na compilação.
- `src/lib/store/inventoryStore.ts` (linhas ~188-260): pipeline de carga **no client**. Faz `listVendas/listCustos/listCustosEstoque/listVeiculosAtual`, filtra `LOJAS_IGNORADAS` (vendas, veículos, custos por placa, custos de estoque) e monta `custosPorPlaca`.
- `src/lib/data/*.ts`: todos `"use client"`, usam o browser client. **O cérebro não pode reaproveitá-los** como estão.
- RLS (`005_auth_rls.sql`): uma policy `authenticated_all_access FOR ALL` por tabela. Qualquer `authenticated` **lê e escreve** tudo. `veiculos_atual` tem `security_invoker = true` (012/014).
- `020_fila_disparo_whatsapp.sql`: RPCs `SECURITY DEFINER` com grant para `authenticated, service_role`, pensadas para o n8n via service_role. Ficam fora da fatia 1.

Consequência central: **a verdade financeira (margem real, ganhos indiretos, filtro de lojas) vive em TypeScript, não em SQL.** Recalcular margem em SQL dentro do cérebro criaria uma segunda fórmula, e uma divergência de R$ 0,01 é bug crítico (regra 4 do AGENTS.md). Essa restrição guia a escolha da seção 1.

---

## 1. Componentes

### 1.1 Diagrama

```
 Browser (Chat.tsx)
   │  POST /api/chat  {messages, bundle(compacto, só p/ fallback), periodo}
   ▼
 navesa-mesa  /api/chat  (Next 16, Vercel ou npm run dev)
   │  1. auth Supabase (cookie)  2. rate limit Upstash  3. CHAT_BACKEND?
   │
   ├─(cerebro)──►  POST {CEREBRO_URL}/v1/chat   Authorization: Bearer CEREBRO_TOKEN_WEB
   │                 │  (SSE)
   │                 ▼
   │        ┌──────────────────────── container "cerebro" ───────────────────────┐
   │        │ HTTP server Node (porta 8787, só 127.0.0.1 ou rede interna)        │
   │        │  ├─ authn: token → perfil ("web" | futuro "whatsapp")             │
   │        │  ├─ semáforo de concorrência + timeout + fila curta               │
   │        │  └─ Claude Agent SDK  query({ prompt, options })                  │
   │        │        │  spawn do Claude Code CLI (login da assinatura)          │
   │        │        │  tools: SÓ mcp__navesa__*  (in-process SDK MCP server)   │
   │        │        ▼                                                          │
   │        │  Camada de dados (TS)                                            │
   │        │   ├─ loader: Postgres role `cerebro_leitor` (read-only, RLS)    │
   │        │   ├─ cache em memória (TTL + invalidação por snapshot_id)       │
   │        │   └─ funções puras reaproveitadas de src/lib (insights, margem) │
   │        │  Volume: cerebro-claude-home → /home/cerebro/.claude (login)    │
   │        └───────────────────────────────────────────────────────────────────┘
   │                 │ egress: api.anthropic.com (+ OAuth), Supabase pooler
   │
   └─(providers)──► fallback atual (DeepSeek/Groq/Gemini) com bundle compacto

 Futuro (não bloqueado):  n8n ──► POST /v1/chat (token próprio → perfil "whatsapp")
                          n8n ──► POST /v1/relatorios (XLSX/PDF via src/lib/export)
```

### 1.2 Como o Claude acessa os dados: comparação

| Critério | **1. MCP server stdio próprio** (processo separado, `--mcp-config`) | **2. Ferramentas in-process via Agent SDK** (`createSdkMcpServer` + `tool()`) | **3. Bundle completo no prompt** |
|---|---|---|---|
| Reuso das funções puras TS (margem canônica) | Sim | Sim | Sim (é o `montarBundle` atual) |
| Cobertura de dados | Total, sob demanda | Total, sob demanda | Só o que o bundle agregou. Perguntas tipo "o HB20 placa X" ficam fora |
| Tokens por pergunta | Baixo (só o que a tool devolve) | Baixo | Alto (o bundle completo com estoque inteiro passa de 100k tokens) e consome a cota da assinatura a cada mensagem |
| Latência | +1 processo por request | Menor (mesmo processo) | Primeira resposta lenta (prompt enorme) |
| Superfície de segurança | Processo extra, configuração em arquivo, risco de configurar errado | Ferramentas declaradas em código, allowlist trivial | Mínima (nenhuma tool), mas manda **todo** o custo e margem por mensagem |
| Reuso fora do cérebro (Claude Desktop do Marcos, n8n como MCP client) | **Melhor**: qualquer cliente MCP usa | Exige expor depois como stdio/HTTP | N/A |
| Testabilidade | Boa | **Melhor**: chamada de função direta em `node --test` | Boa |
| Complexidade fatia 1 | Média | **Baixa** | Baixíssima |

**Recomendação: opção 2 agora, desenhada para virar a opção 1 depois sem reescrita.**

- As ferramentas são **funções TS puras** em `cerebro/src/tools/*.ts`, com input/output validados por Zod (o projeto já usa `zod@4`). Um adaptador fino (`cerebro/src/mcp/sdk-server.ts`) registra essas funções no in-process MCP server do Agent SDK.
- Quando o n8n ou o Claude Desktop precisarem, cria-se `cerebro/src/mcp/stdio-server.ts` (ou HTTP MCP) reusando **os mesmos** handlers. Não há lógica duplicada.
- A opção 3 fica descartada como estratégia principal. Ela pode servir de **ferramenta** (`resumo_executivo`, que roda `montarBundle` + `compactarBundle` no servidor), útil para perguntas abertas de diagnóstico.

**Por que Agent SDK e não `claude -p` cru via `child_process`:** o SDK (`@anthropic-ai/claude-agent-sdk`, TypeScript) chama o mesmo CLI por baixo e usa o mesmo login. Em troca, entrega mensagens tipadas em stream (texto, tool_use, result com usage), `AbortController`, `canUseTool` (deny-by-default programático), `maxTurns` e registro de tools in-process, sem parsear stdout. `claude -p --output-format stream-json` continua como **plano B** se o SDK der problema com o login da assinatura (ver R2).

### 1.3 Credencial Supabase dentro do container

| Opção | Read-only de verdade? | Complexidade | Risco se o container vazar |
|---|---|---|---|
| A. `service_role` (PostgREST) | Não. Ignora RLS e escreve tudo | Mínima | **Total**: apagar estoque, ler leads e telefones |
| B. Usuário Supabase Auth dedicado (`authenticated`) | **Não**: a policy 005 é `FOR ALL` | Baixa | Escrita em todas as tabelas |
| C. JWT customizado com `role = cerebro_leitor` via PostgREST | Sim | Alta (assinar JWT com o segredo do projeto, que é tão sensível quanto o service_role) | Baixo, mas o segredo de assinatura mora no container |
| **D. Role Postgres `cerebro_leitor` com LOGIN, conexão direta pelo pooler (Supavisor) com `pg`** | **Sim**, imposto pelo banco | Média (1 migration) | Baixo: só SELECT nas tabelas liberadas, sem PII de leads |

**Recomendação: D.** Forma dos dados para a @dara-data-engineer (ela decide o DDL exato):

- Role `cerebro_leitor` com LOGIN e senha forte, **sem** `BYPASSRLS`. `default_transaction_read_only = on`, `statement_timeout` ≈ 10s, `idle_in_transaction_session_timeout` curto e connection limit baixo (≈ 3).
- `GRANT SELECT` apenas em: `estoque_snapshots`, `veiculos` (e com isso `veiculos_atual`, que é `security_invoker`), `vendas`, `custos_detalhados`, `custos_estoque_detalhado`, `fipe_batch`, `lojas`, `cautelar`, `veiculos_flags` (se usado pela classificação). **Sem acesso** a `leads`, `lead_interesses`, `repasse_interessados`, `chat_messages` nem às RPCs da 020.
- Como RLS está ligado nessas tabelas, cada uma precisa de uma policy `FOR SELECT TO cerebro_leitor USING (true)`.
- PII em `vendas`: avaliar grant por coluna excluindo `vendedor_cpf` e `renavam`. `cliente_nome` é necessário? Está em aberto (Q5).
- Migration idempotente, com o nome seguindo a sequência (`026_...`).

Se a Dara vetar D (por exemplo, por limitação do pooler para roles customizadas no plano atual), o **fallback aceitável é C**. A não ser como medida temporária de horas, documentada, **não aceito A**: o container roda um agente LLM, e é exatamente o componente que não deve ter a chave-mestra.

### 1.4 Camada de dados e cache

- **Loader** (`cerebro/src/data/loader.ts`): `SELECT` das tabelas acima e mapeamento linha → `VendaParsed`/`VeiculoParsed`/`CustoDetalhado`. Os volumes são pequenos (cerca de 1.000 veículos e alguns milhares de vendas), então carregar tudo em memória sai mais barato e simples que uma query por tool.
- **Pré-requisito de refactor (fatia 1a):** extrair para módulos puros, **sem** `"use client"`:
  1. os `fromRow` de `src/lib/data/{veiculos,vendas,custos,custos-estoque,fipe-batch}.ts` → `src/lib/data/mappers/*.ts`;
  2. o trecho de filtragem e montagem de `inventoryStore.ts` (linhas ~222-260: lojas ignoradas, `placasIgnoradas`, `cMap`, custos de estoque) → `src/lib/data/preparar-datasets.ts`.

  Store e cérebro passam a usar a mesma função. Sem isso, o chat mostraria números diferentes da tela, que é o pior bug possível neste produto.
- **Cache:** TTL de 5 min. Antes de servir o cache, uma query barata (`max(id)` de `estoque_snapshots` + `max(atualizado_em)` de `vendas`/`custos_detalhados`) decide se é preciso recarregar. Um upload novo reflete na próxima pergunta.

---

## 2. Restrições de segurança do Claude no container

### 2.1 Opções do Agent SDK (nomes exatos a confirmar pela @dex-dev na versão instalada)

| Controle | Valor | Por quê |
|---|---|---|
| `allowedTools` | `["mcp__navesa__*"]` (lista explícita das tools da fatia) | Allowlist |
| `disallowedTools` | `Bash, Write, Edit, MultiEdit, NotebookEdit, Read, Glob, Grep, WebFetch, WebSearch, Task, TodoWrite, KillShell, BashOutput` e qualquer built-in novo | Defesa em profundidade. Sem leitura de filesystem: nem os arquivos do próprio container |
| conjunto de tools built-in (`tools` / preset, se a versão suportar) | vazio | Melhor que só negar: as built-ins nem são registradas |
| `canUseTool` | callback **deny-by-default**: aprova só nomes com prefixo `mcp__navesa__` que estejam no perfil do token | Garante a regra mesmo se uma flag acima mudar de nome numa atualização |
| `permissionMode` | `dontAsk` (nega o que não estiver em `allowedTools`), mais hook `PreToolUse` programático que nega tudo fora de `mcp__navesa__*` / MCP não-`sdk`, e `canUseTool` exigindo `mcpServer.source === "sdk"` como última rede. **Nunca** `bypassPermissions` nem `acceptEdits` | O core-os usa `acceptEdits`, e é justamente o que não queremos. `canUseTool` sozinho só roda quando o CLI pediria permissão |
| `settingSources` | `[]` | Não carrega `~/.claude/settings.json`, CLAUDE.md, hooks, plugins nem MCPs do usuário |
| `mcpServers` | só `navesa` (in-process), com `strictMcpConfig` se existir | Nenhum MCP externo |
| `systemPrompt` | string própria (persona "gerente sênior" migrada do `route.ts`), **não** o preset `claude_code` | Sem instruções de agente de código |
| `cwd` | diretório vazio e read-only (`/srv/cerebro/empty`) | Mesmo sem tools de arquivo, nada útil por perto |
| `maxTurns` | ~12 | Limita loops de tool |
| `model` | Haiku 5.5 por padrão; Sonnet 5.5 sob demanda (P6/Q3) | Cota da assinatura |
| `abortController` | ligado ao timeout e ao disconnect do cliente | Libera o slot quando o usuário fecha a aba |

Env do container: `DISABLE_AUTOUPDATER=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1`. A versão do CLI fica **pinada** na imagem: atualização é rebuild consciente, não autoupdate.

### 2.2 Container

- **Imagem:** `node:22-bookworm-slim` + `@anthropic-ai/claude-code` (versão pinada) + bundle do cérebro. Usuário **não-root** (`cerebro`, uid fixo).
- `read_only: true` no rootfs. `tmpfs` em `/tmp`. Único volume gravável: `cerebro-claude-home:/home/cerebro/.claude` (login e estado do CLI).
- **Nenhum bind mount do host.** Nada de `C:\Users\...` montado, nem do repo nem do `.env.local`.
- `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `pids_limit: 256`, `mem_limit: 2g`, `cpus: 2`.
- Rede: `ports: "127.0.0.1:8787:8787"` no PC, para não expor na LAN. Na VPS, sem porta publicada: só a rede interna com o túnel/proxy.
- **Egress:**
  - *Fatia 1 (PC):* o controle principal é não ter tools de rede (sem WebFetch/Bash).
  - *VPS:* rede `internal: true` para o cérebro + sidecar de proxy de saída com allowlist de domínio (Anthropic API/OAuth, host do pooler Supabase) via `HTTPS_PROXY`. A lista exata de domínios do OAuth da assinatura sai de observação (R2).
- **Concorrência:** semáforo com **2** execuções simultâneas (cada uma spawna um CLI de ~200-400 MB), fila de até 4 com espera máxima de 15s, e acima disso `429 ocupado`. Timeout por pergunta: **110s** (abaixo do `maxDuration` do `/api/chat`, ver 3.4). Limite de entrada: 32 KB de corpo e no máximo 30 mensagens de histórico.
- **Segredos** via `env_file` fora do repo (`cerebro/.env`, no `.gitignore`): `CEREBRO_TOKENS`, `SUPABASE_DB_URL` (role `cerebro_leitor`). Nunca o service_role.

### 2.3 Login da assinatura persistido

Ver 4.4. O diretório `~/.claude` do container vive **só** no volume nomeado. Backup desse volume = backup de uma credencial: tratar como segredo.

### 2.4 Prompt injection

Campos de texto do banco (`modelo`, `observacao`, nomes) chegam ao modelo via tool result. Como não existe tool de escrita nem de rede, o pior caso é **resposta errada**, não exfiltração nem dano. O system prompt manda tratar o conteúdo de tools como dado. Esse risco sobe no WhatsApp (entrada de cliente externo): ver perfis em 3.5.

---

## 3. Contrato da API navesa-mesa ↔ cérebro

### 3.1 Endpoint

`POST {CEREBRO_URL}/v1/chat`

Headers:

| Header | Obrigatório | Uso |
|---|---|---|
| `Authorization: Bearer <token>` | sim | Token por cliente. O cérebro mapeia token → perfil (`web`, futuro `whatsapp`). Comparação em tempo constante |
| `X-Request-Id` | sim | UUID gerado no `/api/chat`, aparece nos logs dos dois lados |
| `X-Navesa-User` | sim (web) | `user.id` do Supabase, só para auditoria e log. Não autoriza nada |
| `Accept: text/event-stream` | sim | |

Body (validado com Zod no cérebro):

```json
{
  "messages": [{ "role": "user" | "assistant", "content": "string" }],
  "periodo": { "inicio": "dd/mm/aaaa" | null, "fim": "dd/mm/aaaa" | null } | null,
  "contexto": { "pagina": "/chat", "loja": 12 } | null,
  "canal": "web"
}
```

- **Stateless:** o histórico vai inteiro (truncado nas últimas N mensagens pelo `/api/chat`). O cérebro serializa o histórico como transcrição no prompt. Isso dispensa sessão sticky e retomada de sessão do CLI, e funciona igual para WhatsApp (o n8n manda o histórico do contato).
- `canal` é informativo. **O perfil de ferramentas vem do token, nunca do body.**
- **Não** há campo `bundle`: o cérebro busca os dados sozinho.

`GET /v1/health` → `{ ok, claudeLogado, versaoCli, cache: { snapshotId, carregadoEm } }`, sem auth detalhada além do token. Serve para o `/api/chat` decidir o fallback rápido e para monitoramento.

### 3.2 Resposta: SSE

`200 text/event-stream`, com eventos `event: <tipo>\ndata: <json>\n\n`:

| Evento | Payload | Observação |
|---|---|---|
| `meta` | `{ requestId, modelo }` | Primeiro evento |
| `tool` | `{ nome, fase: "inicio" \| "fim", ms? }` | Para a UI mostrar "consultando estoque…" (opcional, fatia 1c) |
| `delta` | `{ texto }` | Pedaços do markdown |
| `done` | `{ turns, duracaoMs, usage? }` | Fim normal |
| `error` | `{ codigo, mensagem, retryable }` | Erro **depois** de já ter começado o stream |

Por que SSE e não texto puro: o canal precisa carregar `tool`, `done` e `error` em banda sem inventar marcador no texto. O **`/api/chat` traduz SSE → o `text/plain` atual**, então o `Chat.tsx` não precisa mudar na fatia 1a. Ele só lê `delta.texto`, e um `error` vira o sufixo `_⚠️ Resposta interrompida_` que o componente já sabe exibir.

### 3.3 Erros (antes do stream: JSON `{ codigo, mensagem, retryAfter? }`)

| HTTP | `codigo` | Quando | O `/api/chat` faz |
|---|---|---|---|
| 400 | `entrada_invalida` | Zod falhou, corpo > 32 KB | Repassa 400 |
| 401 | `token_invalido` | Bearer ausente ou errado | Loga alto e cai no fallback |
| 429 | `ocupado` | Semáforo e fila cheios (`retry-after`) | Fallback (modo `auto`) ou repassa 429 |
| 503 | `claude_nao_logado` | CLI sem credencial ou expirada | Fallback + alerta (Marcos precisa relogar) |
| 503 | `limite_assinatura` | CLI reportou limite de uso da janela | Fallback; mensagem "cota do Claude esgotada até HH:MM" se o horário vier |
| 504 | `timeout` | Passou dos 110s sem terminar | Se não saiu nada ainda, fallback |
| 500 | `erro_interno` | Resto | Fallback |

### 3.4 Seleção no `/api/chat`

Envs novas no navesa-mesa (`.env.local` / Vercel):

| Env | Valores | Default |
|---|---|---|
| `CHAT_BACKEND` | `providers` \| `cerebro` \| `auto` | `providers` (comportamento de hoje) |
| `CEREBRO_URL` | `http://localhost:8787` (PC) / `https://cerebro.<dominio>` (túnel/VPS) | vazio |
| `CEREBRO_TOKEN` | segredo do perfil `web` | vazio |
| `CEREBRO_TIMEOUT_MS` | 110000 | 110000 |

Semântica:

- `providers`: fluxo atual, intacto.
- `cerebro`: só o cérebro. Erro → resposta de erro clara, sem fallback (útil para testar).
- `auto` (**recomendado em produção**): tenta o cérebro. Se falhar **antes do primeiro `delta`**, cai na lista atual de providers usando o `bundle` compacto que o `Chat.tsx` continua enviando. Se falhar **depois** de já ter mandado texto, não troca de modelo no meio: fecha com o aviso de interrompida.
- Ordem no handler: auth → rate limit (inalterados) → backend. `x-provider-usado: cerebro` no header.
- `maxDuration`: subir de 90 para **120** no `route.ts` (segment config; doc em `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`). Na Vercel, conferir o teto do plano (R6).
- Refactor mínimo sugerido: extrair o loop de providers atual para `src/lib/chat/providers.ts` e criar `src/lib/chat/cerebro-client.ts` (fetch + parser SSE). O `route.ts` fica como orquestrador.
- `CEREBRO_URL` e `CEREBRO_TOKEN` **só no servidor** (sem prefixo `NEXT_PUBLIC_`). O browser nunca fala com o cérebro.
- `src/proxy.ts`: **nenhuma mudança.** `/api/chat` continua protegido (fora de `PUBLIC_PREFIXES`) e o cérebro não é rota do Next. Webhooks futuros do n8n não passam pelo Next: falam direto com o cérebro e o token define o perfil.

### 3.5 Perfis (o desenho que não bloqueia o futuro)

| Perfil | Token | Tools | Observação |
|---|---|---|---|
| `web` | `CEREBRO_TOKEN_WEB` | Todas da fatia 1 (inclui custo e margem) | Usuário interno autenticado no Supabase |
| `whatsapp` (futuro) | `CEREBRO_TOKEN_N8N` | Busca e disponibilidade de veículo e preço de venda. **Sem** custo, margem, vendedor nem FIPE interna | Cliente externo: perfil mínimo, system prompt diferente |
| `relatorios` (futuro) | idem n8n/web | `gerar_relatorio` → usa `src/lib/export/relatorio/motor.ts` + `renderer-xlsx.ts`, devolve arquivo por URL assinada ou base64 | Endpoint próprio `/v1/relatorios`, não precisa do LLM para relatório determinístico |

Cada perfil é um objeto `{ tools: string[], systemPrompt, model, maxTurns }` em `cerebro/src/perfis.ts`.

---

## 4. Estrutura de pastas, Docker e login

### 4.1 Monorepo (`/cerebro` no repo) ou repo separado

| | **1. `/cerebro` dentro do navesa-mesa** | **2. Repo separado** |
|---|---|---|
| Reuso de `src/lib` (margem canônica, insights, export) | Direto via alias `@/` → `../src` no tsconfig do cérebro | Copiar ou publicar pacote. Divergência garantida com o tempo |
| Mudança na fórmula de margem | 1 PR atualiza tela e chat | 2 PRs coordenados |
| Isolamento de build da Vercel | Exige `exclude: ["cerebro"]` no `tsconfig.json` raiz, ignore no ESLint e `.vercelignore` | Natural |
| Deploy | Imagem buildada com contexto da raiz + `.dockerignore` agressivo | Simples |
| Licença e segredo | Mesmo repo privado | Idem |

**Recomendação: 1.** O argumento decisivo é a precisão centavo-perfect: uma única implementação de `calcMargemVenda`. Sem npm workspaces na fatia 1, para não mexer no `package-lock.json` da raiz nem no install da Vercel. O `cerebro/` tem `package.json` próprio, e o build usa `esbuild`/`tsup`, que resolve `@/` e embute os módulos de `src/lib` usados no `dist/`.

```
navesa-mesa/
├─ cerebro/
│  ├─ package.json            # deps só do cérebro: claude-agent-sdk, pg, zod, (hono|node:http)
│  ├─ tsconfig.json           # paths: "@/*" → "../src/*"
│  ├─ build.mjs               # esbuild → dist/server.js
│  ├─ Dockerfile
│  ├─ docker-compose.yml
│  ├─ .env.example            # CEREBRO_TOKENS, SUPABASE_DB_URL, CEREBRO_MAX_CONC...
│  ├─ src/
│  │  ├─ server.ts            # HTTP: /v1/chat, /v1/health; authn; semáforo; SSE
│  │  ├─ perfis.ts            # web | whatsapp (futuro)
│  │  ├─ agente.ts            # wrapper do Agent SDK (options da seção 2.1)
│  │  ├─ prompt.ts            # system prompt "gerente sênior" (migrado do route.ts)
│  │  ├─ mcp/sdk-server.ts    # registra tools no in-process MCP
│  │  ├─ data/loader.ts       # pg (cerebro_leitor) → mappers → preparar-datasets
│  │  ├─ data/cache.ts
│  │  └─ tools/
│  │     ├─ estoque.ts        # resumo_estoque, carros_parados, buscar_veiculo
│  │     ├─ vendas.ts         # vendas_periodo
│  │     ├─ fipe.ts           # comparar_fipe
│  │     └─ diagnostico.ts    # resumo_executivo (montarBundle server-side)
│  └─ tests/                  # node --test, tools com fixtures (sem Claude)
├─ src/lib/data/mappers/*.ts          # NOVO (refactor 1a), puro
├─ src/lib/data/preparar-datasets.ts  # NOVO (refactor 1a), puro
├─ src/lib/chat/{providers,cerebro-client}.ts  # NOVO (1b)
└─ docs/arquitetura/cerebro-claude.md
```

Arquivos existentes afetados: `src/app/api/chat/route.ts`, `src/lib/store/inventoryStore.ts` (passa a usar `preparar-datasets`), `src/lib/data/{veiculos,vendas,custos,custos-estoque,fipe-batch}.ts` (passam a importar os mappers), `src/components/AppShell.tsx:39-41` (descomentar o item Chat IA), `tsconfig.json` (exclude `cerebro`), `eslint.config.mjs` (ignore `cerebro/dist`), `.gitignore` (`cerebro/.env`, `cerebro/dist`) e `supabase/migrations/026_*` (Dara).

### 4.2 Dockerfile (alto nível)

1. **Stage build** (`node:22-bookworm-slim`): copia `cerebro/` + `src/lib/` (só o necessário) + `tsconfig.json`, roda `npm ci` em `cerebro/` e `node build.mjs` → `dist/server.js`.
2. **Stage runtime** (`node:22-bookworm-slim`): `npm i -g @anthropic-ai/claude-code@<versão-pinada>`. Cria o usuário `cerebro`, copia `dist/` + `node_modules` de produção. Cria `/srv/cerebro/empty`. `USER cerebro`, `EXPOSE 8787`, `HEALTHCHECK` em `/v1/health`, `CMD ["node","dist/server.js"]`.
3. `.dockerignore` na raiz: exclui `node_modules`, `.next`, `.env*`, `samples/`, `public/`, `docs/`, `tests/` e `supabase/`.

### 4.3 docker-compose (alto nível)

```yaml
services:
  cerebro:
    build: { context: .., dockerfile: cerebro/Dockerfile }
    env_file: ./.env
    ports: ["127.0.0.1:8787:8787"]
    volumes: ["cerebro-claude-home:/home/cerebro/.claude"]
    read_only: true
    tmpfs: ["/tmp"]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    mem_limit: 2g
    pids_limit: 256
    restart: unless-stopped
  # futuro: cloudflared (túnel), evolution-api, n8n — cada um na sua rede
volumes:
  cerebro-claude-home:
```

### 4.4 Passo manual: login da assinatura

**Opção A, recomendada: login interativo dentro do container, persistido no volume.**

1. `docker compose -f cerebro/docker-compose.yml build`
2. `docker compose -f cerebro/docker-compose.yml run --rm --entrypoint claude cerebro`
3. No prompt do Claude Code, rodar `/login`, escolher a conta da **assinatura** (não Console/API), abrir a URL no navegador do PC, autorizar e colar o código de volta.
4. Sair (`/exit`). A credencial fica em `cerebro-claude-home`.
5. `docker compose -f cerebro/docker-compose.yml up -d` e conferir `curl http://127.0.0.1:8787/v1/health` → `claudeLogado: true`.

Na VPS: mesmo procedimento via SSH (o fluxo é por URL + código, não exige browser na VPS).

**Opção B, alternativa:** `claude setup-token` no host gera um token OAuth de longa duração da assinatura, que entra no container como `CLAUDE_CODE_OAUTH_TOKEN` via `env_file`. É mais simples de automatizar, mas o token vira um segredo de env (mais fácil de vazar em log ou `docker inspect`). Usar se a opção A tiver problema de refresh dentro de rootfs read-only (R2).

Rotina de manutenção: quando o `/v1/health` reportar `claudeLogado: false` ou o código `claude_nao_logado`, repetir os passos 2-4.

---

## 5. Ferramentas de dados (fatia 1)

Convenções para todas:

- Prefixo MCP `mcp__navesa__<nome>`. Input validado por Zod.
- **Saída JSON com números crus** (sem formatar). A formatação R$ fica com o modelo, conforme o prompt. Datas em ISO `YYYY-MM-DD`.
- Fonte: datasets do cache (seção 1.4), já filtrados por `LOJAS_IGNORADAS` via `preparar-datasets`.
- Teto de linhas por resposta (`limite`, default 20, máx 100) + campo `total` + `truncado: boolean`, para o modelo saber que existe mais.
- Margem **sempre** via `calcMargemVenda` / funções de `insights.ts`. Nenhuma tool recalcula margem com fórmula própria.
- Lojas aceitam `cod_empresa` ou nome parcial case-insensitive ("aeroporto"). Resolução por uma função comum `resolverLoja`, que devolve as candidatas se o nome for ambíguo.

| # | Tool | Parâmetros | Retorna | Fonte |
|---|---|---|---|---|
| 1 | `resumo_estoque` | `loja?`, `marca?`, `situacao?` (disponível/preparação/reservado...) | Total de carros, custo total (capital travado = `valor_aquisicao`/custo), preço de venda total, dias de pátio médio, faixas 0-30/31-60/61-90/91-180/180+ (qtd e custo), quebra por loja e por marca, reservados (`cod_proposta` não nulo), data do snapshot | `veiculos_atual` + `estoque_snapshots`. Reusa `estoquePorLoja`, `estoquePorMarca`, `classificarPatio`, `estaReservado` |
| 2 | `carros_parados` | `dias_min` (default 60), `loja?`, `marca?`, `modelo?` (contém), `ordenar` (`dias` \| `custo`), `limite` | Lista: placa, chassi (final), marca, modelo, ano, km, loja, pátio/situação, dias de pátio, custo, preço de venda, FIPE (se houver), desvio vs FIPE, classificação (show room/repasse), cautelar, reservado. Mais o total e o custo somado do filtro | `veiculos_atual` + `fipe_batch` + `cautelar` + `custos_estoque_detalhado`. Reusa `estoqueEmRisco`, `classificarVeiculo`, `precoFipeConfiavel` |
| 3 | `buscar_veiculo` | `termo` (placa, chassi ou parte do modelo), `incluir_vendidos` (default false), `limite` | Ficha completa do(s) veículo(s) em estoque. Com `incluir_vendidos`, também vendas do mesmo chassi/placa: data, valor, margem real, vendedor | `veiculos_atual`, `vendas`, `custos_detalhados`, `fipe_batch` |
| 4 | `vendas_periodo` | `inicio`, `fim` (ISO; default = período carregado), `agrupar_por` (`loja` \| `vendedor` \| `modelo` \| `marca` \| `mes` \| `nenhum`), `loja?`, `marca?`, `modelo?`, `vendedor?`, `ordenar` (`margem` \| `margem_pct` \| `qtd` \| `faturamento`), `limite` | Por grupo: qtd, faturamento, custo total, margem real, margem %, ganhos indiretos, margem sem bônus, dias médios de estoque, % com troca. Mais o sumário do recorte (o mesmo do `sumarioGlobal`, incluindo `dependeDeBonus`) | `vendas` + `custos_detalhados`. Reusa `sumarioGlobal`, `margemPorLoja/Marca/Modelo/Vendedor`, `vendasPorMes` aplicados ao subconjunto filtrado |
| 5 | `comparar_fipe` | `escopo` (`estoque` \| `vendas`), `direcao` (`acima` \| `abaixo` \| `ambos`), `desvio_min_pct` (default 10), `loja?`, `marca?`, `modelo?`, `inicio?`/`fim?` (vendas), `limite` | Estoque: preço anunciado vs FIPE confiável, desvio R$ e %, dias de pátio. Vendas: valor vendido vs FIPE do carro, quando houver match. Itens sem FIPE confiável contados à parte (`sem_fipe`) | `fipe_batch` (+ score/referência das migrations 021/022) + `veiculos_atual`/`vendas`. Reusa `calcularDesvioFipe`, `itemFipeConfiavel`, `validarPlausibilidadeFipe` |
| 6 | `resumo_executivo` | `inicio?`, `fim?` | `compactarBundle(montarBundle(...))` calculado **no servidor**. É o ponto de partida para "faça uma análise completa" | Todas acima |
| 7 | `listar_lojas` | nenhum | `cod_empresa`, nome, cidade, ativo (sem as ignoradas) | `lojas` |

Observação sobre a FIPE em vendas (tool 5, `escopo: vendas`): hoje `fipe_batch` é por chassi **do estoque**. Para carros já vendidos, a FIPE só existe se o chassi passou pelo batch antes da venda. A @dex-dev deve confirmar a cobertura real; se for baixa, a fatia 1 entrega só `escopo: estoque` e o caso de vendas vira pergunta (Q6).

Fora da fatia 1 (de propósito): leads/CRM, repasses e interessados, fila de WhatsApp (RPCs 020), qualquer escrita, SQL livre.

---

## 6. Riscos

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| R1 | **Termos de uso da assinatura.** A assinatura (Pro/Max) é de uso pessoal. Usar o login dela por trás de um produto acessado por outras pessoas (gerentes das lojas, e depois clientes no WhatsApp) pode violar os termos da Anthropic. As regras da Anthropic para o Agent SDK pedem API key para produtos de terceiros | Média | **Alto** (bloqueio da conta pessoal do Marcos) | Decisão do Marcos (Q1). Desenho pronto para trocar só a credencial: a opção do SDK aceita API key sem mudar nada do resto. Sugestão: assinatura apenas para uso do próprio Marcos/piloto; API key (ou plano Team/Enterprise) antes de abrir para a equipe ou o WhatsApp |
| R2 | Login OAuth no container: refresh do token, compatibilidade com rootfs read-only, mudanças de versão do CLI | Média | Médio (chat cai para o fallback) | Volume gravável só em `~/.claude`, CLI pinado, `/v1/health` com `claudeLogado`, plano B `CLAUDE_CODE_OAUTH_TOKEN` |
| R3 | **Cota da assinatura compartilhada** com o uso do Marcos no Claude Code (janela de 5h e limite semanal). Um dia de muitas perguntas trava o trabalho dele, ou o contrário | Alta | Médio | Modelo Haiku 5.5 por default (Sonnet 5.5 sob demanda), `maxTurns`, rate limit Upstash mantido, erro `limite_assinatura` → fallback automático (`auto`) |
| R4 | Divergência de números entre chat e telas | Média | **Crítico** (regra centavo-perfect) | Refactor 1a (`preparar-datasets` + mappers compartilhados). Teste que compara `resumo_executivo` do cérebro com `montarBundle` do client sobre os mesmos fixtures |
| R5 | Produção depende do PC do Marcos ligado (túnel) | Alta enquanto estiver no PC | Médio | `CHAT_BACKEND=auto` → fallback para providers. Migrar para VPS na fatia 2 |
| R6 | Timeout na Vercel: o agente com várias tools pode passar de 90-120s | Média | Médio | Timeout de 110s no cérebro, `maxTurns`, tools agregadas (não forçar o modelo a paginar). Conferir o teto de `maxDuration` do plano Vercel |
| R7 | Prompt injection via campos do banco e, no futuro, via mensagem de cliente no WhatsApp | Baixa (web) / Média (WA) | Baixo (web) / Médio (WA) | Sem tools de escrita ou rede. Perfil `whatsapp` sem custo/margem e com prompt separado |
| R8 | Vazamento do volume `~/.claude` ou do `.env` do cérebro | Baixa | Alto (uso da assinatura por terceiros, leitura de custos) | Volume nomeado, sem bind mount, `cerebro_leitor` read-only, rotação de tokens |
| R9 | Concorrência: 16 lojas perguntando ao mesmo tempo | Média | Baixo | Semáforo 2 + fila 4 + 429 → fallback |
| R10 | Build da Vercel tenta typecheckar `cerebro/` | Alta se esquecer | Baixo | `exclude` no tsconfig raiz e ignore no ESLint. Critério de pronto da 1b |

---

## 7. Perguntas em aberto (decisão do Marcos)

- **Q1 (bloqueante para abrir a outros usuários):** quem vai usar o chat na fatia 1? Só você (piloto pessoal) ou os gerentes também? Considerando R1, você aceita o plano "assinatura no piloto, API key ou plano empresarial antes de abrir para a equipe ou o WhatsApp"?
- **Q2:** em produção (Vercel), na fase do PC, prefere **Cloudflare Tunnel** (recomendado: sem porta aberta, TLS automático, mesmo arranjo depois na VPS; exige um domínio na Cloudflare) ou **Tailscale Funnel**? Ou fica só no `npm run dev` local até existir a VPS?
- ~~**Q3:** modelo padrão: **Sonnet** (recomendado pela cota) com Opus só sob demanda ("análise completa"), ou Opus sempre?~~ **Decidida (06/11/2026): Haiku 5.5 padrão, Sonnet 5.5 sob demanda** (ver P6 no §0).
- **Q4:** aprova a role Postgres read-only `cerebro_leitor` (opção D, migration nova pela Dara) em vez do `service_role` no container?
- **Q5:** o chat precisa ver **nome de cliente** nas vendas (útil para "clientes recorrentes") ou podemos esconder nome, CPF de vendedor e renavam?
- **Q6:** "comparação FIPE" em **vendas já realizadas** é obrigatória na fatia 1, ou basta o estoque? (A cobertura de FIPE para vendidos pode ser baixa.)
- **Q7:** o histórico em `chat_messages` hoje é global (sem `user_id`). Mantém assim na fatia 1 ou cada usuário passa a ter o próprio? Se for por usuário, é migration da Dara e a ordem muda.

---

## 8. Plano em fatias (para @dex-dev)

Cada fatia é um PR pequeno. Push e PR são exclusivos da @gage-devops. QA pela @quinn-qa ao fim de cada uma.

### 1a: Base compartilhada (sem Claude ainda)
- Extrair `src/lib/data/mappers/*.ts` e `src/lib/data/preparar-datasets.ts` (puros). `inventoryStore` e `src/lib/data/*.ts` passam a usá-los, sem mudança de comportamento.
- @dara-data-engineer: migration `026_*` com a role `cerebro_leitor` (se Q4 = sim).
- **Pronto quando:** `npm test` verde; novo teste mostra que `preparar-datasets` + `montarBundle` sobre fixtures dá o mesmo resultado do pipeline antigo; telas `/`, `/vendas` e `/insights` com números idênticos antes e depois (conferência manual de 3 KPIs); a role conecta pelo pooler, `SELECT` funciona e `INSERT/UPDATE/DELETE` falham.

### 1b: Esqueleto do cérebro + tools (sem LLM)
- `cerebro/` com `server.ts` (`/v1/health`, auth por token, semáforo), `data/loader.ts` + cache, as 7 tools como funções puras, Dockerfile e compose.
- `tsconfig.json` raiz com `exclude: ["cerebro"]`, ESLint ignore e `.gitignore`.
- **Pronto quando:** `docker compose up` sobe no PC; `/v1/health` responde 200 só com token válido e 401 sem token; testes `node --test` das tools com fixtures cobrem filtros de loja (cod e nome), `dias_min`, período e truncamento; `npm run build` do Next continua verde.

### 1c: Agente Claude no cérebro
- `agente.ts` com as options da seção 2.1, `prompt.ts` (persona migrada), `/v1/chat` com SSE (`meta/tool/delta/done/error`), timeout, abort em disconnect e erros da 3.3. Passo de login documentado em `cerebro/README.md`.
- **Pronto quando:** com login feito, `curl -N` em `/v1/chat` responde em streaming "quantos carros parados há mais de 90 dias na loja X?" com o número igual ao da tela Estoque; teste de segurança: pedir "rode `ls /`", "leia /etc/passwd" e "acesse https://example.com" → recusa, sem nenhuma tool built-in executada (verificado no log de tool_use); 3 requisições simultâneas → a terceira espera na fila e a quinta recebe 429; sem login → `503 claude_nao_logado`.

### 1d: Integração no `/api/chat` + reativar a aba
- `src/lib/chat/providers.ts` (extração do loop atual) e `src/lib/chat/cerebro-client.ts` (SSE → text/plain). `CHAT_BACKEND/CEREBRO_URL/CEREBRO_TOKEN/CEREBRO_TIMEOUT_MS`, `maxDuration = 120`. Descomentar Chat IA em `AppShell.tsx:39-41`. Textos do `Chat.tsx` ajustados ("Claude está pensando…" já existe; o EmptyState deixa de dizer que usa só os 3 relatórios subidos).
- **Pronto quando:** `CHAT_BACKEND=providers` funciona exatamente como hoje (regressão); `CHAT_BACKEND=cerebro` responde via container com `x-provider-usado: cerebro`; `CHAT_BACKEND=auto` com o container parado cai nos providers sem erro visível; erro no meio do stream mostra o aviso de interrompida; rate limit 429 continua funcionando; nenhuma env do cérebro com prefixo `NEXT_PUBLIC_`.

### 1e: UX de ferramentas (opcional, com @uma-ux)
- O evento `tool` vira um indicador "consultando estoque…" no `Chat.tsx`, o que pede um formato de stream web próprio (ndjson) em vez de text/plain.
- **Pronto quando:** o indicador aparece e some corretamente e o fallback para providers continua funcionando.

### Fatia 2 (depois; não bloqueada pelo desenho)
- 2a: VPS + Cloudflare Tunnel ou Caddy com TLS, proxy de egress com allowlist, `CHAT_BACKEND=auto` na Vercel.
- 2b: perfil `whatsapp` + token do n8n + Evolution API (tools mínimas, sem custo/margem).
- 2c: `/v1/relatorios` reusando `src/lib/export/relatorio/*` (determinístico, sem LLM), e o agente pode sugerir ou disparar relatório.
- 2d: expor as tools também como MCP stdio/HTTP para o Claude Desktop do Marcos e o n8n.

---

## 9. Handoffs

- **@dara-data-engineer:** role `cerebro_leitor` (seção 1.3): grants por tabela e coluna, policies `FOR SELECT`, timeouts, conexão pelo pooler. Q5 e Q7 afetam o desenho.
- **@dex-dev:** fatias 1a → 1d nesta ordem. Antes de mexer em `route.ts`, ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` e o `maxDuration.md` (Next 16). Confirmar os nomes exatos das options na versão instalada do `@anthropic-ai/claude-agent-sdk`.
- **@gage-devops:** túnel/VPS (Q2), segredos na Vercel, PRs.
- **@morgan-pm:** Q1 (termos da assinatura × abertura para a equipe) impacta o roadmap do WhatsApp.
