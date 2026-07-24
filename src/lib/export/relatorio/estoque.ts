/**
 * LIGAÇÃO DA FONTE ESTOQUE AO MOTOR GENÉRICO (Fatia A)
 *
 * Reproduz o "Relatório de Estoque Customizado" atual através do novo motor
 * config-driven: constrói um `RelatorioDef` de fonte estoque a partir da seleção
 * do modal, monta via `montarRelatorio` (catálogo do estoque) e renderiza o XLSX.
 * O resultado é equivalente ao export de hoje + as novas linhas TOTAIS/MÉDIA.
 */

import {
  CATALOGO_ESTOQUE,
  COLUNAS_ESTOQUE,
  type ColunaKey,
  type VeiculoExportavel,
} from "@/lib/export/colunas-estoque";
import { montarRelatorio } from "@/lib/export/relatorio/motor";
import { renderRelatorioXLSX, type RenderMetaXLSX } from "@/lib/export/relatorio/renderer-xlsx";
import { validarFonteImplementada } from "@/lib/export/relatorio/registry";
import {
  RELATORIO_DEF_VERSION,
  type ColunaSaida,
  type RelatorioDef,
} from "@/lib/export/relatorio/tipos";

const BRANCO_BG = "FFFFFBEB";

export type ConstruirDefEstoqueOpcoes = {
  /** Keys escolhidas (qualquer ordem; reordenadas pra ordem canônica do catálogo). */
  colunas: ColunaKey[];
  incluirObservacoes: boolean;
  incluirAnotacoes?: boolean;
  filtroLoja?: string;
  /** Default true — linhas de agregação no rodapé. */
  incluirTotais?: boolean;
  incluirMedia?: boolean;
};

/**
 * Constrói o `RelatorioDef` serializável de estoque a partir da seleção do modal.
 *
 * Decisão consciente: as colunas do catálogo saem na ORDEM CANÔNICA do catálogo
 * (não na ordem de clique) pra preservar exatamente o layout que o Marcos já
 * conhece. O motor RESPEITA a ordem do `def.colunas` — quem impõe a ordem
 * canônica aqui é este builder, não o motor (a Fatia B/F2 vai expor reordenação).
 */
export function construirDefEstoque(opcoes: ConstruirDefEstoqueOpcoes): RelatorioDef {
  const escolhidas = new Set(opcoes.colunas);
  const colunasCatalogo: ColunaSaida[] = COLUNAS_ESTOQUE.filter((c) => escolhidas.has(c.key)).map(
    (c) => ({ tipo: "catalogo", key: c.key }),
  );

  const brancas: ColunaSaida[] = [];
  if (opcoes.incluirObservacoes) brancas.push({ tipo: "branco", label: "Observações", corFundo: BRANCO_BG });
  if (opcoes.incluirAnotacoes) brancas.push({ tipo: "branco", label: "Anotações", corFundo: BRANCO_BG });

  return {
    schemaVersion: RELATORIO_DEF_VERSION,
    id: "estoque-customizado",
    nome: "NAVESA — RELATÓRIO DE ESTOQUE CUSTOMIZADO",
    fonte: "estoque",
    filtros: { loja: opcoes.filtroLoja ?? null },
    colunas: [...colunasCatalogo, ...brancas],
    totais: {
      incluirTotais: opcoes.incluirTotais ?? true,
      incluirMedia: opcoes.incluirMedia ?? true,
    },
    saida: "xlsx",
  };
}

function fmtDataBR(): string {
  return new Date().toLocaleDateString("pt-BR");
}

function montarMeta(def: RelatorioDef, total: number): RenderMetaXLSX {
  const loja = def.filtros.loja?.trim() || "TODAS";
  return {
    sheetName: "Estoque",
    titulo: def.nome,
    linhaMeta: `Data: ${fmtDataBR()}   |   Loja: ${loja}   |   Total de veículos: ${total}`,
  };
}

/** Gera o XLSX do relatório de estoque a partir de um `RelatorioDef`. */
export async function gerarRelatorioEstoque(
  def: RelatorioDef,
  veiculos: VeiculoExportavel[],
): Promise<Blob> {
  validarFonteImplementada(def.fonte);
  const montado = montarRelatorio<VeiculoExportavel>(def, veiculos, CATALOGO_ESTOQUE);
  return renderRelatorioXLSX(montado, montarMeta(def, veiculos.length));
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Gera e baixa (browser) o XLSX do relatório de estoque. */
export async function baixarRelatorioEstoque(
  def: RelatorioDef,
  veiculos: VeiculoExportavel[],
): Promise<void> {
  const blob = await gerarRelatorioEstoque(def, veiculos);
  const url = URL.createObjectURL(blob);
  const fileName = `relatorio-estoque-customizado-${todayISO()}.xlsx`;
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
