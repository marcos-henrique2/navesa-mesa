/**
 * STATUS DE PÁTIO — classifica cada veículo em uma categoria operacional.
 *
 * Critério alinhado com o NBS:
 *   "Em preparação" no NBS = apenas patio = "PREPARAÇÃO" (validado: 373 carros).
 *   BLOQUEADO é separado (o NBS conta noutra tela).
 */

export type StatusVeiculo =
  | "disponivel"   // pronto pra venda em pátio comercial
  | "transito"     // em trânsito (TRANSITO-local)
  | "preparacao"   // em preparação (= "preparação" do NBS, exato)
  | "bloqueado"    // bloqueado (jurídico/financeiro/etc.) — separado no NBS
  | "oficina"      // em oficina externa (terceirizada)
  | "documentacao" // pendência de documentação
  | "outro";

const PATIO_PREPARACAO = "PREPARAÇÃO";
const PATIO_BLOQUEADO = "BLOQUEADO";
const PATIOS_TRANSITO = new Set(["TRANSITO-LOCAL"]);
const PATIOS_DOCUMENTACAO = new Set(["PENENCIA DOCUMENTACAO", "AEROPORTO/ACESSORIO"]);

/** Substrings que indicam oficina externa. */
function ehOficina(p: string): boolean {
  const up = p.toUpperCase();
  if (up.startsWith("OFICINA")) return true;
  if (up.startsWith("FUNILARIA")) return true;
  // Parceiros terceiros conhecidos
  return ["TONICAR", "AUTO HALL", "PATIO VALCIMAR"].includes(up);
}

export function classificarPatio(patio: string | null | undefined): StatusVeiculo {
  const p = (patio ?? "").trim();
  if (!p) return "outro";
  const up = p.toUpperCase();
  if (up === PATIO_PREPARACAO) return "preparacao";
  if (up === PATIO_BLOQUEADO) return "bloqueado";
  if (PATIOS_TRANSITO.has(up)) return "transito";
  if (PATIOS_DOCUMENTACAO.has(up)) return "documentacao";
  if (ehOficina(p)) return "oficina";
  return "disponivel";
}

export const STATUS_LABEL: Record<StatusVeiculo, string> = {
  disponivel: "Disponível",
  transito: "Em trânsito",
  preparacao: "Em preparação",
  bloqueado: "Bloqueado",
  oficina: "Em oficina externa",
  documentacao: "Pendência de documentação",
  outro: "Outro",
};
