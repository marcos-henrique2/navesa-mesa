import type { NomeTool } from "@cerebro/perfis";
import type { ToolNavesa } from "@cerebro/tools/definicao";
import { buscarVeiculo, carrosParados, resumoEstoque } from "@cerebro/tools/estoque";
import { vendasPeriodo } from "@cerebro/tools/vendas";
import { compararFipe } from "@cerebro/tools/fipe";
import { listarLojas, resumoExecutivo } from "@cerebro/tools/diagnostico";

export const TOOLS: Record<NomeTool, ToolNavesa> = {
  resumo_estoque: resumoEstoque,
  carros_parados: carrosParados,
  buscar_veiculo: buscarVeiculo,
  vendas_periodo: vendasPeriodo,
  comparar_fipe: compararFipe,
  resumo_executivo: resumoExecutivo,
  listar_lojas: listarLojas,
};

export type { ToolNavesa };
