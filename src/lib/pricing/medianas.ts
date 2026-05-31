/**
 * MEDIANAS DE KM POR MODELO/ANO — Fase A
 *
 * Calcula mediana de quilometragem combinando:
 *   - Estoque atual (carros que entraram com km registrado)
 *   - Vendas dos últimos 24 meses
 *
 * Por que client-side? Volume baixo (~1k veículos + ~5k vendas no horizonte do MVP),
 * dados já em memória nas telas que precisam, evita matview + refresh assíncrono.
 *
 * Fallback hierárquico no lookup:
 *   1. (marca, modelo, ano)              — match exato
 *   2. (marca, modelo, ano ± 1)          — ano adjacente
 *   3. (marca, modelo, qualquer ano)     — qualquer ano do modelo
 *   4. heurística por idade              — 15k/18k/20k km/ano (último recurso)
 *
 * Mínimo de amostras: 3. Abaixo disso, ignora (cai pro próximo fallback).
 */

import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";

export type ChaveModelo = string; // `${marca}|${modelo}|${ano_modelo}` normalizado

const MIN_AMOSTRAS = 3;
const JANELA_VENDAS_MESES = 24;

// ═══════════════════════════════════════════════════════════════════════════
// CONSTRUÇÃO DO MAPA
// ═══════════════════════════════════════════════════════════════════════════

export function calcularMedianasKm(
  veiculos: VeiculoParsed[],
  vendas: VendaParsed[],
): Map<ChaveModelo, number> {
  // Agrupa km por chave (marca, modelo, ano)
  const buckets = new Map<ChaveModelo, number[]>();

  for (const v of veiculos) {
    if (v.km == null || v.km <= 0) continue;
    const chave = chaveDe(v.marca, v.modelo, v.ano_modelo ?? v.ano_fabricacao);
    if (!chave) continue;
    pushBucket(buckets, chave, v.km);
  }

  // Janela: últimos 24 meses a partir da data de venda mais recente.
  const corte = calcularCorteVendas(vendas);

  for (const venda of vendas) {
    if (venda.km == null || venda.km <= 0) continue;
    if (corte && venda.data_venda && venda.data_venda < corte) continue;
    const chave = chaveDe(venda.marca, venda.modelo, venda.ano_modelo ?? venda.ano_fabricacao);
    if (!chave) continue;
    pushBucket(buckets, chave, venda.km);
  }

  // Calcula mediana onde temos ≥ MIN_AMOSTRAS
  const out = new Map<ChaveModelo, number>();
  for (const [chave, kms] of buckets) {
    if (kms.length < MIN_AMOSTRAS) continue;
    out.set(chave, mediana(kms));
  }
  return out;
}

function pushBucket(buckets: Map<ChaveModelo, number[]>, chave: ChaveModelo, km: number): void {
  const arr = buckets.get(chave);
  if (arr) arr.push(km);
  else buckets.set(chave, [km]);
}

function calcularCorteVendas(vendas: VendaParsed[]): Date | null {
  let maxData: Date | null = null;
  for (const v of vendas) {
    if (v.data_venda && (maxData == null || v.data_venda > maxData)) maxData = v.data_venda;
  }
  if (!maxData) return null;
  const corte = new Date(maxData);
  corte.setMonth(corte.getMonth() - JANELA_VENDAS_MESES);
  return corte;
}

// ═══════════════════════════════════════════════════════════════════════════
// LOOKUP COM FALLBACK
// ═══════════════════════════════════════════════════════════════════════════

export function buscarMedianaKm(
  medianas: Map<ChaveModelo, number>,
  veiculo: VeiculoParsed,
): { mediana: number | null; heuristica: boolean } {
  const marca = normalizar(veiculo.marca);
  const modelo = normalizar(veiculo.modelo);
  const ano = veiculo.ano_modelo ?? veiculo.ano_fabricacao;

  if (!modelo) return aplicarHeuristica(veiculo);

  // 1. Match exato
  if (ano != null) {
    const exato = medianas.get(`${marca}|${modelo}|${ano}`);
    if (exato != null) return { mediana: exato, heuristica: false };

    // 2. Ano ± 1
    for (const delta of [-1, 1]) {
      const v = medianas.get(`${marca}|${modelo}|${ano + delta}`);
      if (v != null) return { mediana: v, heuristica: false };
    }
  }

  // 3. Qualquer ano do mesmo (marca, modelo)
  const prefix = `${marca}|${modelo}|`;
  const candidatos: number[] = [];
  for (const [chave, val] of medianas) {
    if (chave.startsWith(prefix)) candidatos.push(val);
  }
  if (candidatos.length > 0) {
    return { mediana: mediana(candidatos), heuristica: false };
  }

  // 4. Heurística por idade
  return aplicarHeuristica(veiculo);
}

function aplicarHeuristica(veiculo: VeiculoParsed): { mediana: number | null; heuristica: boolean } {
  const ano = veiculo.ano_modelo ?? veiculo.ano_fabricacao;
  if (ano == null) return { mediana: null, heuristica: true };
  const anoAtual = new Date().getFullYear();
  const idade = Math.max(0, anoAtual - ano);
  let kmAno: number;
  if (idade <= 2) kmAno = 15000;
  else if (idade <= 5) kmAno = 18000;
  else kmAno = 20000;
  const estimativa = Math.max(idade, 0.5) * kmAno;
  return { mediana: Math.round(estimativa), heuristica: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function chaveDe(marca: string | null, modelo: string, ano: number | null): ChaveModelo | null {
  if (!modelo || ano == null) return null;
  return `${normalizar(marca)}|${normalizar(modelo)}|${ano}`;
}

function normalizar(s: string | null | undefined): string {
  return (s ?? "").trim().toUpperCase();
}

function mediana(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const meio = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[meio - 1] + sorted[meio]) / 2);
  }
  return sorted[meio];
}
