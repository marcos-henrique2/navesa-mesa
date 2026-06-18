import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

/**
 * Diz se um veículo está RESERVADO — tem proposta/reserva ativa no NBS.
 *
 * Derivado do `cod_proposta` (Cód. Proposta Internet, col 310 do XLSX): o
 * NBS preenche essa coluna quando há proposta, sem mudar a "Descrição
 * Situação" (continua "DISPONIVEL"). Por isso esse é o único sinal de reserva.
 */
export function estaReservado(v: Pick<VeiculoParsed, "cod_proposta">): boolean {
  return v.cod_proposta != null;
}
