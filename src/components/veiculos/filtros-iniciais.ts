/**
 * Setters do estado de filtros do estoque. Tipados como discriminated union
 * pelo nome do filtro pra ficar testável sem React.
 *
 * `aplicarLimparFiltros` zera TODOS os filtros — usado pelo botão "Limpar
 * filtros" da UI + por `useVeiculosTable.limparFiltros`.
 */

import type { Classe } from "@/lib/pricing/classificacao";
import type { StatusCautelar } from "@/lib/inventory/cautelar";

export type StatusFiltro = "all" | "real" | "prep";
export type FiltroClasse = "all" | Classe | "showroom" | "repasse";
export type FiltroFipe = "all" | "acima" | "abaixo" | "sem";
export type FiltroCautelar = "all" | StatusCautelar | "sem";
export type FiltroFlag = "all" | "promocao" | "brinde" | "qualquer";
export type FiltroRepasse = "all" | "sim" | "nao";
export type FiltroReservado = "all" | "sim" | "nao";

export type SettersFiltrosVeiculos = {
  setStatusFiltro: (v: StatusFiltro) => void;
  setSearch: (v: string) => void;
  setFiltroLoja: (v: string) => void;
  setFiltroMarca: (v: string) => void;
  setFiltroCor: (v: string) => void;
  setFiltroComb: (v: string) => void;
  setFiltroSituacao: (v: string) => void;
  setFiltroPatio: (v: string) => void;
  setFiltroClasse: (v: FiltroClasse) => void;
  setFiltroFipe: (v: FiltroFipe) => void;
  setFiltroCautelar: (v: FiltroCautelar) => void;
  setFiltroFlag: (v: FiltroFlag) => void;
  setFiltroRepasse: (v: FiltroRepasse) => void;
  setFiltroReservado: (v: FiltroReservado) => void;
  setAnoMin: (v: string) => void;
  setAnoMax: (v: string) => void;
  setKmMin: (v: string) => void;
  setKmMax: (v: string) => void;
  setPrecoMin: (v: string) => void;
  setPrecoMax: (v: string) => void;
  setDiasMin: (v: string) => void;
  setDiasMax: (v: string) => void;
  setIdadeMin: (v: string) => void;
  setIdadeMax: (v: string) => void;
  setMargemMin: (v: string) => void;
  setMargemMax: (v: string) => void;
  fecharModoPrioridade: () => void;
};

/**
 * Aplica o estado inicial em todos os setters. Pura — não toca React diretamente.
 * Retorna a lista de chaves zeradas (ordem estável, pra teste).
 */
export function aplicarLimparFiltros(s: SettersFiltrosVeiculos): readonly string[] {
  s.setStatusFiltro("all");
  s.setSearch("");
  s.setFiltroLoja("all");
  s.setFiltroMarca("all");
  s.setFiltroCor("all");
  s.setFiltroComb("all");
  s.setFiltroSituacao("all");
  s.setFiltroPatio("all");
  s.setFiltroClasse("all");
  s.setFiltroFipe("all");
  s.setFiltroCautelar("all");
  s.setFiltroFlag("all");
  s.setFiltroRepasse("all");
  s.setFiltroReservado("all");
  s.setAnoMin("");
  s.setAnoMax("");
  s.setKmMin("");
  s.setKmMax("");
  s.setPrecoMin("");
  s.setPrecoMax("");
  s.setDiasMin("");
  s.setDiasMax("");
  s.setIdadeMin("");
  s.setIdadeMax("");
  s.setMargemMin("");
  s.setMargemMax("");
  s.fecharModoPrioridade();
  return CHAVES_FILTROS_ZERADAS;
}

/**
 * Ordem canônica das chaves zeradas por `aplicarLimparFiltros`. Usado pra teste
 * garantir cobertura completa (qualquer adição de filtro novo no hook precisa
 * refletir aqui — ou o teste vai pegar).
 */
export const CHAVES_FILTROS_ZERADAS = [
  "statusFiltro",
  "search",
  "filtroLoja",
  "filtroMarca",
  "filtroCor",
  "filtroComb",
  "filtroSituacao",
  "filtroPatio",
  "filtroClasse",
  "filtroFipe",
  "filtroCautelar",
  "filtroFlag",
  "filtroRepasse",
  "filtroReservado",
  "anoMin",
  "anoMax",
  "kmMin",
  "kmMax",
  "precoMin",
  "precoMax",
  "diasMin",
  "diasMax",
  "idadeMin",
  "idadeMax",
  "margemMin",
  "margemMax",
  "modoPrioridade",
] as const;
