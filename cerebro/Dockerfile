# syntax=docker/dockerfile:1
# Cérebro Navesa (doc docs/arquitetura/cerebro-claude.md §2.2, §4.2).
# Contexto de build = RAIZ do repo (o bundle embute os módulos puros de src/lib).
#   docker compose -f cerebro/docker-compose.yml build

# ───── build ─────
FROM node:22-bookworm-slim AS build
WORKDIR /app/cerebro
COPY cerebro/package.json cerebro/package-lock.json ./
RUN npm ci --no-audit --no-fund
WORKDIR /app
# Só o código puro compartilhado (o .dockerignore da raiz já corta o resto)
COPY src/lib ./src/lib
COPY cerebro/tsconfig.json cerebro/build.mjs ./cerebro/
COPY cerebro/src ./cerebro/src
WORKDIR /app/cerebro
RUN node build.mjs && npm prune --omit=dev --no-audit --no-fund

# ───── runtime ─────
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    HOME=/home/cerebro \
    CEREBRO_CWD=/srv/cerebro/empty     CEREBRO_HOST=0.0.0.0     SUPABASE_DB_CA_FILE=/srv/cerebro/certs/supabase-prod-ca-2021.crt \
    DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    DISABLE_TELEMETRY=1 \
    DISABLE_ERROR_REPORTING=1

# Usuário fixo não-root. /home/cerebro vira o volume nomeado do login do Claude
# (o CLI grava ~/.claude/ E ~/.claude.json, por isso o volume é o home inteiro).
RUN groupadd --gid 10001 cerebro \
 && useradd --uid 10001 --gid cerebro --home-dir /home/cerebro --create-home --shell /usr/sbin/nologin cerebro \
 && mkdir -p /home/cerebro/.claude /srv/cerebro/empty /srv/cerebro/certs \
 && chown -R cerebro:cerebro /home/cerebro \
 && chmod 0700 /home/cerebro /home/cerebro/.claude \
 && chmod 0555 /srv/cerebro/empty

WORKDIR /srv/cerebro/app
COPY --from=build /app/cerebro/node_modules ./node_modules
COPY --from=build /app/cerebro/dist ./dist
COPY cerebro/package.json ./package.json
# CA pública do Supabase (Supabase Root 2021 CA, vale até 2031-04-26): TLS do banco
# verificado por padrão. Desligar só com SUPABASE_DB_TLS_INSEGURO=1 (ver README).
# O diretório é criado no RUN acima (0755): COPY --chmod no arquivo não pode criar o pai.
COPY --chmod=0444 cerebro/certs/supabase-prod-ca-2021.crt /srv/cerebro/certs/supabase-prod-ca-2021.crt

# O Agent SDK traz o CLI nativo do Claude Code (pacote por plataforma, versão
# PINADA pelo package-lock: atualizar = rebuild consciente). Expõe como `claude`
# para o /login e o `claude --version` do /v1/health. Não há npm i -g separado.
RUN set -eu; \
    bin="$(ls -d /srv/cerebro/app/node_modules/@anthropic-ai/claude-agent-sdk-linux-*/claude | grep -v musl | head -n1)"; \
    test -x "$bin"; \
    ln -s "$bin" /usr/local/bin/claude; \
    chmod -R a-w /srv/cerebro/app

USER cerebro
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.js"]
