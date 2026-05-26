"use client";

import type { FipeMatch } from "@/lib/fipe/types";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

const KEY_CHASSI = "navesa-mesa:fipe-matches-v1";
const KEY_MODELO = "navesa-mesa:fipe-matches-model-v1";

export type MatchOrigem = "manual-chassi" | "aprendido-modelo" | null;

export type MatchResolved = {
  match: FipeMatch;
  origem: Exclude<MatchOrigem, null>;
  appliedTo?: number; // se aprendido pelo modelo, quantos chassis usaram a mesma escolha
};

/** Chave composta para reutilizar match entre carros similares. */
export function modelKey(v: { marca: string | null; modelo: string; ano_modelo: number | null; combustivel: string | null }): string {
  const marca = (v.marca ?? "").trim().toUpperCase();
  const modelo = (v.modelo ?? "").trim().toUpperCase();
  const ano = v.ano_modelo ?? 0;
  const comb = (v.combustivel ?? "").trim().toUpperCase();
  return `${marca}|${modelo}|${ano}|${comb}`;
}

function readMap<T>(key: string): Record<string, T> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, T>;
  } catch {
    return {};
  }
}

function writeMap<T>(key: string, data: Record<string, T>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.warn("Falha ao salvar map FIPE:", err);
  }
}

/** Tenta achar match — primeiro por chassi (exato), depois por modelo+ano+comb (aprendido). */
export function resolveMatch(veiculo: VeiculoParsed): MatchResolved | null {
  const byChassi = readMap<FipeMatch>(KEY_CHASSI);
  const direto = byChassi[veiculo.chassi];
  if (direto) return { match: direto, origem: "manual-chassi" };

  const byModelo = readMap<FipeMatch>(KEY_MODELO);
  const k = modelKey(veiculo);
  const aprendido = byModelo[k];
  if (aprendido) {
    // Contar quantos chassis no localStorage usam o mesmo modelKey (estimativa de uso)
    return { match: aprendido, origem: "aprendido-modelo" };
  }
  return null;
}

/** Salva match nas duas chaves (chassi + modelo composto). */
export function saveMatch(veiculo: VeiculoParsed, match: FipeMatch): void {
  const byChassi = readMap<FipeMatch>(KEY_CHASSI);
  byChassi[veiculo.chassi] = match;
  writeMap(KEY_CHASSI, byChassi);

  const byModelo = readMap<FipeMatch>(KEY_MODELO);
  byModelo[modelKey(veiculo)] = match;
  writeMap(KEY_MODELO, byModelo);
}

/** Remove match do chassi (para refazer). NÃO apaga a chave do modelo. */
export function forgetMatch(veiculo: VeiculoParsed): void {
  const byChassi = readMap<FipeMatch>(KEY_CHASSI);
  delete byChassi[veiculo.chassi];
  writeMap(KEY_CHASSI, byChassi);
}

/** Remove match do modelo composto (faz todos os carros similares re-perguntarem). */
export function forgetModelMatch(veiculo: VeiculoParsed): void {
  const byModelo = readMap<FipeMatch>(KEY_MODELO);
  delete byModelo[modelKey(veiculo)];
  writeMap(KEY_MODELO, byModelo);
}

/** Conta quantos carros do estoque usariam um match aprendido pra esse modelKey. */
export function countSimilarVeiculos(target: VeiculoParsed, allVeiculos: VeiculoParsed[]): number {
  const k = modelKey(target);
  return allVeiculos.filter((v) => modelKey(v) === k && v.chassi !== target.chassi).length;
}
