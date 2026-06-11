/**
 * Helpers do fluxo de bulk-marcar-pra-subir no /estoque.
 *
 * Funções puras (sem React/Supabase) pra ficarem testáveis no Node.
 */

import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

export type BulkParticionado<T> = {
  /** Carros elegíveis pra marcar (não têm repasse ativo) */
  elegiveis: T[];
  /** Carros que já têm repasse ativo (pulados silenciosamente) */
  jaEmRepasse: T[];
};

/**
 * Separa os selecionados em (elegíveis) vs (já em repasse).
 *
 * Usada pelo BulkMarcarRepasseModal: só os elegíveis entram no batch;
 * os "ja em repasse" são reportados em toast informativo.
 */
export function particionarParaBulkSubir<T extends { chassi: string }>(
  selecionados: ReadonlyArray<T>,
  chassisEmRepasse: ReadonlyMap<string, number>,
): BulkParticionado<T> {
  const elegiveis: T[] = [];
  const jaEmRepasse: T[] = [];
  for (const v of selecionados) {
    if (chassisEmRepasse.has(v.chassi)) {
      jaEmRepasse.push(v);
    } else {
      elegiveis.push(v);
    }
  }
  return { elegiveis, jaEmRepasse };
}

/**
 * Tipo mínimo do veículo que o bulk precisa — usado tanto pelo modal
 * quanto pelos testes (assim os testes não precisam montar VeiculoParsed inteiro).
 */
export type VeiculoBulkRef = Pick<VeiculoParsed, "chassi" | "placa" | "modelo">;
