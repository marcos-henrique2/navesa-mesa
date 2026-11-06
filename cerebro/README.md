# Cérebro Navesa

Serviço Node (Docker) que responde o **Chat IA** com o Claude Agent SDK usando o
**login da assinatura** do Marcos (sem API key). O Claude só enxerga as
ferramentas de leitura `mcp__navesa__*`; os dados vêm do Postgres pela role
somente leitura `cerebro_leitor` (migration 051). Desenho completo:
[docs/arquitetura/cerebro-claude.md](../docs/arquitetura/cerebro-claude.md).

## Subir no PC (Windows + Docker Desktop)

Comandos a partir da raiz do repo (`navesa-mesa/`).

1. **Senha da role** (uma vez). No SQL Editor do Supabase:

   ```sql
   ALTER ROLE cerebro_leitor WITH LOGIN PASSWORD '<senha>';
   ```

   Gere a senha fora do chat, sem caracteres que precisem de escape na URL:
   `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`.

2. **`cerebro/.env`** (fora do git). Copie `cerebro/.env.example` e preencha:
   - `CEREBRO_TOKENS=web:<64 hex>` (gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
   - `SUPABASE_DB_URL=postgresql://cerebro_leitor.<ref>:<senha>@<host do pooler>:5432/postgres`
     (Dashboard > Connect > Session pooler; troque o usuário `postgres.<ref>` por `cerebro_leitor.<ref>`).

3. **Build e subida**:

   ```bash
   docker compose -f cerebro/docker-compose.yml up -d --build
   curl http://127.0.0.1:8787/health          # {"ok":true}
   ```

4. **Login da assinatura** (uma vez; fica no volume `cerebro-claude-home`):

   ```bash
   docker compose -f cerebro/docker-compose.yml exec cerebro claude
   ```

   No Claude Code, rode `/login`, escolha a conta **Claude (assinatura)**, abra a
   URL no navegador, autorize e cole o código. Depois `/exit`. Confira:

   ```bash
   curl -H "Authorization: Bearer <token web>" http://127.0.0.1:8787/v1/health
   # "claudeLogado": true
   ```

5. **Site** (`.env.local`, só servidor):

   ```env
   CHAT_BACKEND=cerebro        # ou auto (cai nos providers se o cérebro falhar)
   CEREBRO_URL=http://127.0.0.1:8787
   CEREBRO_TOKEN=<o mesmo token web do passo 2>
   ```

   Reinicie o `npm run dev`. A aba **Chat IA** volta no menu.

Quando `/v1/health` mostrar `claudeLogado: false` ou o chat responder
`claude_nao_logado`, repita o passo 4.

## API

| Rota | Auth | Resposta |
|---|---|---|
| `GET /health` | não | `{ ok: true }` (Docker HEALTHCHECK) |
| `GET /v1/health` | Bearer | `{ ok, claudeLogado, versaoCli, versaoSdk, banco, cache, fila }` |
| `POST /v1/chat` | Bearer | SSE `meta` → `tool`/`delta`… → `done` \| `error`. Erro antes do stream: JSON `{ codigo, mensagem, retryAfter? }` |

Body do chat: `{ messages, periodo?, contexto?, canal?, modelo?: "rapido" | "avancado" }`.
`rapido` = `CEREBRO_MODELO_RAPIDO` (Haiku, padrão), `avancado` = `CEREBRO_MODELO_AVANCADO` (Sonnet).
O perfil (quais tools) vem do token, nunca do body. Limites: 2 execuções
simultâneas, fila de 4 (espera máx. 15 s, depois 429), 110 s por pergunta, corpo de 32 KB.

## Desenvolvimento

```bash
cd cerebro
npm ci
npm test          # node:test, sem banco e sem Claude (SDK mockado)
npm run typecheck
npm run build     # esbuild → dist/server.js
```

## Segurança (resumo)

- Container: usuário `cerebro` (uid 10001), rootfs read-only, `/tmp` em tmpfs,
  `cap_drop: ALL`, `no-new-privileges`, porta só em `127.0.0.1:8787`, nenhum bind mount.
- Agente: `tools: []` (nenhuma built-in), `disallowedTools` com todas as built-ins,
  `allowedTools` só `mcp__navesa__*`, `canUseTool` nega por padrão,
  `settingSources: []`, `strictMcpConfig`, `verbatimPrompts`, `persistSession: false`.
- O processo do CLI recebe um env mínimo: sem `SUPABASE_DB_URL`, sem `CEREBRO_TOKENS`,
  sem `ANTHROPIC_API_KEY`.
- O volume `cerebro-claude-home` guarda a credencial da assinatura: trate backup dele como segredo.
