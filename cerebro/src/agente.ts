/**
 * Agente Claude (fatia 1c): `query()` do Claude Agent SDK com o login da
 * ASSINATURA (sem API key) e SÓ as tools mcp__navesa__*.
 *
 * Opções confirmadas em @anthropic-ai/claude-agent-sdk 0.3.319 (sdk.d.ts):
 *   tools: []                 → nenhuma built-in registrada (doc do campo: "[] disable all built-in tools")
 *   disallowedTools           → defesa em profundidade, caso `tools` mude de semântica
 *   allowedTools              → lista explícita mcp__navesa__<nome> do perfil
 *   canUseTool                → deny-by-default; só tools do perfil vindas do servidor in-process (source "sdk")
 *   permissionMode "default"  → nunca bypassPermissions/acceptEdits/auto
 *   settingSources []         → não lê ~/.claude/settings.json, .claude/, CLAUDE.md
 *   strictMcpConfig true      → ignora .mcp.json, MCP de usuário/plugin
 *   skills [] / plugins []    → nenhuma skill/plugin
 *   verbatimPrompts true      → sem expansão de @arquivo nem slash command no texto do usuário
 *   persistSession false      → nada gravado em ~/.claude/projects
 *   env                       → env MÍNIMO para o CLI: sem SUPABASE_DB_URL, CEREBRO_TOKENS
 *                               nem ANTHROPIC_API_KEY (o CLI usa o login OAuth do volume)
 */
import type { Options, Query, SDKMessage, CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type { Config } from "@cerebro/config";
import type { EstadoCache } from "@cerebro/data/cache";
import type { EventoAgente, ExecutorChat, PedidoChat } from "@cerebro/contrato";
import { ErroCerebro } from "@cerebro/erros";
import { criarServidorMcp } from "@cerebro/mcp/sdk-server";
import { PERFIS, SERVIDOR_MCP, nomeMcp, type Perfil } from "@cerebro/perfis";
import { SYSTEM_PROMPT, montarPrompt } from "@cerebro/prompt";
import { isoDia } from "@cerebro/tools/comum";
import { resumoErro, type Log } from "@cerebro/log";

export type FuncaoQuery = (params: { prompt: string; options?: Options }) => Query | AsyncIterable<SDKMessage>;

/** Built-ins negadas explicitamente (lista da 0.3.319 + nomes legados). */
export const BUILTINS_NEGADAS = [
  "Bash", "BashOutput", "KillShell", "KillBash", "Monitor",
  "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "NotebookRead", "Glob", "Grep", "LS",
  "WebFetch", "WebSearch",
  "Task", "Agent", "TaskCreate", "TaskGet", "TaskUpdate", "TaskList", "TaskStop", "TodoWrite",
  "ExitPlanMode", "EnterPlanMode", "AskUserQuestion", "Skill", "SlashCommand", "ProposeSkills", "ProposeGoal",
  "ListMcpResourcesTool", "ReadMcpResourceTool", "ReadMcpResourceDir", "RefreshMcpTools",
  "Workflow", "CronCreate", "CronDelete", "CronList", "ScheduleWakeup", "RemoteTrigger",
  "EnterWorktree", "ExitWorktree", "Artifact", "PushNotification", "ReadNotifications", "SendFeedback",
  "ClaudeDesign", "Projects", "ReportFindings", "OfferChromeSetup", "ShowOnboardingRolePicker", "ToolSearch",
] as const;

/** Variáveis repassadas ao CLI. Qualquer outra (inclusive segredos do cérebro) fica de fora. */
const ENV_REPASSADAS = [
  "PATH", "HOME", "TZ", "LANG", "LC_ALL", "TMPDIR",
  "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN",
  "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy",
] as const;

export function envDoCli(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ENV_REPASSADAS) {
    const v = env[k];
    if (v) out[k] = v;
  }
  return {
    ...out,
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    CLAUDE_AGENT_SDK_CLIENT_APP: "navesa-cerebro/0.1.0",
  };
}

export function criarCanUseTool(perfil: Perfil): CanUseTool {
  const permitidas = new Set(PERFIS[perfil].tools.map(nomeMcp));
  return async (toolName, _input, opts) => {
    const doServidorInterno = !opts.mcpServer || (opts.mcpServer.source === "sdk" && opts.mcpServer.name === SERVIDOR_MCP);
    if (permitidas.has(toolName) && doServidorInterno) return { behavior: "allow" };
    return { behavior: "deny", message: "Ferramenta não permitida neste assistente." };
  };
}

export function opcoesAgente(args: {
  config: Pick<Config, "CEREBRO_MAX_TURNS" | "CEREBRO_CWD">;
  perfil: Perfil;
  modelo: string;
  abortController: AbortController;
  mcpServer: ReturnType<typeof criarServidorMcp>;
  env?: NodeJS.ProcessEnv;
  stderr?: (s: string) => void;
}): Options {
  return {
    model: args.modelo,
    systemPrompt: SYSTEM_PROMPT,
    tools: [],
    mcpServers: { [SERVIDOR_MCP]: args.mcpServer },
    strictMcpConfig: true,
    allowedTools: PERFIS[args.perfil].tools.map(nomeMcp),
    disallowedTools: [...BUILTINS_NEGADAS],
    canUseTool: criarCanUseTool(args.perfil),
    permissionMode: "default",
    settingSources: [],
    skills: [],
    plugins: [],
    verbatimPrompts: true,
    persistSession: false,
    includePartialMessages: true,
    maxTurns: args.config.CEREBRO_MAX_TURNS,
    cwd: args.config.CEREBRO_CWD,
    abortController: args.abortController,
    env: envDoCli(args.env),
    stderr: args.stderr,
  };
}

// ───── Tradução de mensagens do SDK → eventos ─────

const ERROS_LOGIN = new Set(["authentication_failed", "oauth_org_not_allowed", "account_on_hold", "verification_required"]);

function horaBrasilia(epochSeg: number): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })
    .format(new Date(epochSeg * 1000));
}

export function erroDeLimite(resetsAt?: number, agoraMs: number = Date.now()): ErroCerebro {
  if (resetsAt) {
    const seg = Math.max(1, Math.ceil(resetsAt - agoraMs / 1000));
    return new ErroCerebro("limite_assinatura", `Cota do Claude esgotada até ${horaBrasilia(resetsAt)}.`, seg);
  }
  return new ErroCerebro("limite_assinatura", "Cota do Claude esgotada no momento.");
}

/** Classifica um texto de erro do CLI (result.is_error / errors[]). */
export function classificarTextoErro(texto: string): ErroCerebro {
  const t = texto.toLowerCase();
  if (/(not logged in|\/login|please run|invalid api key|oauth|authenticat|credential|token (has )?expired)/.test(t)) {
    return new ErroCerebro("claude_nao_logado", "Claude sem login válido no cérebro. Refaça o /login no container.");
  }
  if (/(usage limit|rate limit|limit reached|quota|5-hour|weekly limit)/.test(t)) return erroDeLimite();
  return new ErroCerebro("erro_interno", "O Claude terminou com erro.");
}

/**
 * Tradutor com estado: texto de stream parcial (preferido) ou, sem parciais,
 * blocos de texto da mensagem completa. Mensagens de subagente são ignoradas.
 */
export class TradutorSdk {
  private viuParcial = false;
  private emitiuTexto = false;
  private novaMensagem = false;

  traduzir(msg: SDKMessage): EventoAgente[] {
    switch (msg.type) {
      case "stream_event": {
        if (msg.parent_tool_use_id) return [];
        const ev = msg.event;
        if (ev.type === "message_start") this.novaMensagem = true;
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta" && ev.delta.text) {
          this.viuParcial = true;
          return this.texto(ev.delta.text);
        }
        return [];
      }
      case "assistant": {
        if (msg.parent_tool_use_id) return [];
        if (msg.error) {
          if (ERROS_LOGIN.has(msg.error)) throw classificarTextoErro("not logged in");
          if (msg.error === "rate_limit" || msg.error === "billing_error") throw erroDeLimite();
          throw new ErroCerebro("erro_interno", "O Claude retornou erro.");
        }
        if (this.viuParcial) return [];
        this.novaMensagem = true;
        const out: EventoAgente[] = [];
        for (const b of msg.message.content) if (b.type === "text" && b.text) out.push(...this.texto(b.text));
        return out;
      }
      case "rate_limit_event":
        if (msg.rate_limit_info.status === "rejected") throw erroDeLimite(msg.rate_limit_info.resetsAt);
        return [];
      case "auth_status":
        if (msg.error) throw classificarTextoErro("not logged in");
        return [];
      case "result": {
        if (msg.subtype === "success" && !msg.is_error) {
          return [{
            tipo: "done",
            turns: msg.num_turns,
            duracaoMs: msg.duration_ms,
            usage: { entrada: msg.usage.input_tokens ?? 0, saida: msg.usage.output_tokens ?? 0 },
          }];
        }
        if (msg.subtype === "error_max_turns") {
          throw new ErroCerebro("erro_interno", "A pergunta exigiu etapas demais; tente algo mais específico.");
        }
        const texto = msg.subtype === "success" ? msg.result : msg.errors.join(" ");
        throw classificarTextoErro(texto);
      }
      default:
        return [];
    }
  }

  private texto(t: string): EventoAgente[] {
    const out: EventoAgente[] = [];
    if (this.novaMensagem && this.emitiuTexto) out.push({ tipo: "delta", texto: "\n\n" });
    this.novaMensagem = false;
    this.emitiuTexto = true;
    out.push({ tipo: "delta", texto: t });
    return out;
  }
}

// ───── Fila assíncrona (junta mensagens do SDK e eventos das tools) ─────

class FilaEventos<T> {
  private itens: T[] = [];
  private esperando: ((v: IteratorResult<T>) => void) | null = null;
  private falhou: ((e: unknown) => void) | null = null;
  private erro: unknown = null;
  private fechada = false;

  push(v: T): void {
    if (this.fechada) return;
    if (this.esperando) {
      const r = this.esperando;
      this.esperando = this.falhou = null;
      r({ value: v, done: false });
    } else this.itens.push(v);
  }

  fechar(erro?: unknown): void {
    if (this.fechada) return;
    this.fechada = true;
    this.erro = erro ?? null;
    if (this.esperando) {
      const r = this.esperando, f = this.falhou;
      this.esperando = this.falhou = null;
      if (erro) f?.(erro);
      else r({ value: undefined as never, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      if (this.itens.length > 0) {
        yield this.itens.shift() as T;
        continue;
      }
      if (this.fechada) {
        if (this.erro) throw this.erro;
        return;
      }
      const r = await new Promise<IteratorResult<T>>((res, rej) => {
        this.esperando = res;
        this.falhou = rej;
      });
      if (r.done) return;
      yield r.value;
    }
  }
}

export type DepsAgente = {
  query: FuncaoQuery;
  obterCache: () => Promise<EstadoCache>;
  config: Pick<Config, "CEREBRO_MAX_TURNS" | "CEREBRO_CWD" | "CEREBRO_MODELO_RAPIDO" | "CEREBRO_MODELO_AVANCADO">;
  log: Log;
  env?: NodeJS.ProcessEnv;
  /** Injetável nos testes; padrão = servidor MCP in-process real. */
  criarMcp?: typeof criarServidorMcp;
};

export function modeloDoPedido(pedido: PedidoChat, config: DepsAgente["config"]): string {
  return pedido.modelo === "avancado" ? config.CEREBRO_MODELO_AVANCADO : config.CEREBRO_MODELO_RAPIDO;
}

export function criarExecutorAgente(deps: DepsAgente): ExecutorChat {
  return ({ pedido, perfil, requestId, signal }) => {
    const modelo = modeloDoPedido(pedido, deps.config);

    async function* gerar(): AsyncGenerator<EventoAgente> {
      // Carrega os dados ANTES de gastar cota: banco fora → 503 JSON e o /api/chat cai no fallback.
      try {
        await deps.obterCache();
      } catch (err) {
        deps.log.erro("cache indisponível", { requestId, erro: resumoErro(err) });
        throw new ErroCerebro("dados_indisponiveis", "Não foi possível ler os dados da Navesa agora.");
      }

      const fila = new FilaEventos<EventoAgente>();
      const abortController = new AbortController();
      const onAbort = () => abortController.abort();
      if (signal.aborted) abortController.abort();
      else signal.addEventListener("abort", onAbort, { once: true });

      const mcpServer = (deps.criarMcp ?? criarServidorMcp)({
        perfil,
        log: deps.log,
        obterContexto: async () => {
          const e = await deps.obterCache();
          return { snapshot: e.snapshot, cacheDesatualizado: e.desatualizado, agora: new Date() };
        },
        aoUsarTool: (nome, fase, ms) => {
          deps.log.info("tool", { requestId, tool: nome, fase, ms });
          fila.push(ms == null ? { tipo: "tool", nome, fase } : { tipo: "tool", nome, fase, ms });
        },
      });

      const q = deps.query({
        prompt: montarPrompt(pedido, isoDia(new Date()) ?? ""),
        options: opcoesAgente({
          config: deps.config,
          perfil,
          modelo,
          abortController,
          mcpServer,
          env: deps.env,
          stderr: (s) => deps.log.erro("cli stderr", { requestId, linha: s.slice(0, 300) }),
        }),
      });

      const tradutor = new TradutorSdk();
      const bomba = (async () => {
        let terminou = false;
        for await (const msg of q) {
          for (const ev of tradutor.traduzir(msg)) {
            fila.push(ev);
            if (ev.tipo === "done") terminou = true;
          }
          if (terminou) break;
        }
        if (!terminou) throw new ErroCerebro("erro_interno", "O Claude encerrou sem resposta.");
      })();
      bomba.then(() => fila.fechar(), (e) => fila.fechar(e));

      try {
        yield* fila;
      } finally {
        signal.removeEventListener("abort", onAbort);
        abortController.abort();
        await bomba.catch(() => {});
      }
    }

    return { modelo, eventos: gerar() };
  };
}
