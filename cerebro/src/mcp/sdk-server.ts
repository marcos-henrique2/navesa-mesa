/**
 * Adaptador fino: registra as tools puras no MCP in-process do Agent SDK
 * (`createSdkMcpServer` + `tool`). Nenhuma lógica de negócio aqui: na fatia 2d
 * um stdio-server reusa os mesmos `TOOLS`.
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { ZodError } from "zod";
import { PERFIS, SERVIDOR_MCP, type NomeTool, type Perfil } from "@cerebro/perfis";
import { TOOLS } from "@cerebro/tools";
import type { ContextoTool } from "@cerebro/tools/comum";
import { resumoErro, type Log } from "@cerebro/log";

export type ResultadoTool = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Executa uma tool e devolve o resultado no formato MCP (sem lançar). */
export async function executarToolMcp(
  nome: NomeTool,
  args: unknown,
  obterContexto: () => Promise<ContextoTool>,
  log: Log,
): Promise<ResultadoTool> {
  try {
    const ctx = await obterContexto();
    const saida = TOOLS[nome].executar(args, ctx);
    return { content: [{ type: "text", text: JSON.stringify(saida) }] };
  } catch (err) {
    const erro = err instanceof ZodError
      ? { erro: "entrada_invalida", detalhes: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 5) }
      : { erro: "falha_ferramenta", mensagem: "Não foi possível consultar os dados agora." };
    if (!(err instanceof ZodError)) log.erro("tool falhou", { tool: nome, erro: resumoErro(err) });
    return { content: [{ type: "text", text: JSON.stringify(erro) }], isError: true };
  }
}

export type OpcoesMcp = {
  perfil: Perfil;
  obterContexto: () => Promise<ContextoTool>;
  aoUsarTool: (nome: NomeTool, fase: "inicio" | "fim", ms?: number) => void;
  log: Log;
};

/** Definições `tool()` do perfil (exportado para teste: o handler é chamável direto). */
export function definicoesTools(opts: OpcoesMcp) {
  return PERFIS[opts.perfil].tools.map((nome) => {
    const t = TOOLS[nome];
    return tool(nome, t.descricao, t.entrada, async (args) => {
      const t0 = Date.now();
      opts.aoUsarTool(nome, "inicio");
      try {
        return await executarToolMcp(nome, args, opts.obterContexto, opts.log);
      } finally {
        opts.aoUsarTool(nome, "fim", Date.now() - t0);
      }
    }, { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } });
  });
}

export function criarServidorMcp(opts: OpcoesMcp) {
  return createSdkMcpServer({ name: SERVIDOR_MCP, version: "1.0.0", tools: definicoesTools(opts) });
}
