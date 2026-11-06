import { z } from "zod";
import type { NomeTool } from "@cerebro/perfis";
import { arredondar, type ContextoTool } from "@cerebro/tools/comum";

/** Tool pronta para o registro: shape Zod (para o MCP) + execução validada. */
export type ToolNavesa = {
  nome: NomeTool;
  descricao: string;
  entrada: z.ZodRawShape;
  /** Valida `input` com Zod, executa e arredonda a saída. Lança ZodError em entrada inválida. */
  executar: (input: unknown, ctx: ContextoTool) => unknown;
};

export function definirTool<S extends z.ZodRawShape>(def: {
  nome: NomeTool;
  descricao: string;
  entrada: S;
  executar: (args: z.output<z.ZodObject<S>>, ctx: ContextoTool) => unknown;
}): ToolNavesa {
  const schema = z.object(def.entrada).strict();
  return {
    nome: def.nome,
    descricao: def.descricao,
    entrada: def.entrada,
    executar: (input, ctx) => arredondar(def.executar(schema.parse(input ?? {}), ctx)),
  };
}
