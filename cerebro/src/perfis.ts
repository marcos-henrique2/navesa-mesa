/**
 * Perfis de acesso (doc §3.5). O perfil vem SEMPRE do token Bearer, nunca do body.
 * Cada perfil define quais tools o modelo pode usar.
 */
export type Perfil = "web" | "whatsapp";

/** Nomes curtos das tools (sem o prefixo MCP). */
export const TOOLS_FATIA_1 = [
  "resumo_estoque",
  "carros_parados",
  "buscar_veiculo",
  "vendas_periodo",
  "comparar_fipe",
  "resumo_executivo",
  "listar_lojas",
] as const;

export type NomeTool = (typeof TOOLS_FATIA_1)[number];

export const SERVIDOR_MCP = "navesa";
export const PREFIXO_MCP = `mcp__${SERVIDOR_MCP}__`;

export function nomeMcp(nome: NomeTool): string {
  return `${PREFIXO_MCP}${nome}`;
}

export type ConfigPerfil = {
  tools: readonly NomeTool[];
  /** Perfil habilitado para conversar com o LLM nesta fatia. */
  chatHabilitado: boolean;
};

export const PERFIS: Record<Perfil, ConfigPerfil> = {
  web: { tools: TOOLS_FATIA_1, chatHabilitado: true },
  // Fatia 2b: busca/disponibilidade/preço de venda, sem custo/margem/vendedor/FIPE.
  // Até lá o perfil existe (token pode ser emitido) mas não conversa.
  whatsapp: { tools: [], chatHabilitado: false },
};
