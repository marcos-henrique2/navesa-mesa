/**
 * CLASSIFICAÇÃO DE VEÍCULOS — Política Auto Avaliar
 *
 * Define classes A–E e canal (Show Room × Repasse) com base em critérios objetivos do NBS.
 *
 * O que classifica automaticamente:
 *   - Idade (ano_modelo / ano_fabricacao)
 *   - KM por ano (km / idade)
 *   - Dias de pátio
 *   - Repetição no estoque (mesmo modelo)
 *
 * O que NÃO classifica (vira flag manual):
 *   - Avarias / estado lataria / interior
 *   - Modificação documental (GNV, rebaixado)
 *   - Sinistro / motor danificado / cautelar
 *   - Histórico táxi
 *
 * Regras especiais:
 *   - >40k km/ano  → automaticamente classe D
 *   - >30 dias pátio → força repasse (mesmo se classe A/B)
 *   - ≥5 do mesmo modelo no estoque → força repasse
 */

import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { StatusCautelar } from "@/lib/inventory/cautelar";

export type Classe = "A" | "B" | "C" | "D" | "E";
export type Canal = "showroom" | "repasse";

export type ClassificacaoVeiculo = {
  classe: Classe;
  canal: Canal;
  /** Razões objetivas que justificam essa classe (km/ano, idade, etc.). */
  motivos: string[];
  /** Aspectos que o avaliador precisa conferir manualmente. */
  alertasManuais: string[];
  /** Indica que a classe foi rebaixada por dias de pátio ou repetição (era A/B mas virou repasse). */
  rebaixadoPorEstoque: boolean;
  /** Cálculo intermediário usado, exposto pra UI explicar pro avaliador. */
  metricas: {
    idade: number | null;          // anos
    kmPorAno: number | null;       // estimativa
    diasPatio: number | null;
    qtMesmoModelo: number;
  };
};

// ─── PARÂMETROS ─────────────────────────────────────────────────────────────
const KM_A_ANO = 15000;
const KM_B_ANO = 25000;
const KM_C_ANO = 40000;
const IDADE_A_MAX = 2;
const DIAS_PATIO_REPASSE = 30;
const QT_REPETICAO_REPASSE = 5;

export type ClassificacaoOpts = {
  anoReferencia?: number;
  /** Modelo do veículo → quantos iguais existem no estoque (passar pre-computado por performance). */
  contagemPorModelo?: Map<string, number>;
  /** Status do laudo cautelar (preenchido manualmente). Sobrepõe a classe automática. */
  cautelar?: StatusCautelar | null;
};

export function classificarVeiculo(
  veiculo: VeiculoParsed,
  opts: ClassificacaoOpts = {},
): ClassificacaoVeiculo {
  const anoRef = opts.anoReferencia ?? new Date().getFullYear();
  const motivos: string[] = [];
  const alertasManuais: string[] = [];

  // ── MÉTRICAS BÁSICAS ──
  const ano = veiculo.ano_modelo ?? veiculo.ano_fabricacao;
  const idade = ano != null ? Math.max(0, anoRef - ano) : null;
  const km = veiculo.km;
  // Carro do ano → divide por 0,5 ano pra evitar km/ano = ∞
  const idadeEfetiva = idade != null ? Math.max(idade, 0.5) : null;
  const kmPorAno = km != null && idadeEfetiva != null ? km / idadeEfetiva : null;
  const diasPatio = veiculo.dias_patio ?? null;

  // ── CONTAGEM DO MESMO MODELO NO ESTOQUE ──
  const modeloKey = (veiculo.modelo ?? "").trim().toUpperCase();
  const qtMesmoModelo = opts.contagemPorModelo?.get(modeloKey) ?? 0;

  // ── CLASSIFICAÇÃO BASE PELA REGRA AUTO AVALIAR ──
  let classe: Classe;

  if (kmPorAno != null && kmPorAno > KM_C_ANO) {
    // > 40k km/ano → D direto (regra explícita do PDF)
    classe = "D";
    motivos.push(`${formatInt(kmPorAno)} km/ano (>40.000 = classe D obrigatória)`);
  } else if (idade != null && idade <= IDADE_A_MAX && kmPorAno != null && kmPorAno <= KM_A_ANO) {
    classe = "A";
    motivos.push(`${idade} ${idade === 1 ? "ano" : "anos"} de uso · ${formatInt(kmPorAno)} km/ano`);
  } else if (kmPorAno != null && kmPorAno <= KM_B_ANO) {
    classe = "B";
    motivos.push(`${formatInt(kmPorAno)} km/ano (≤25.000)`);
    if (idade != null) motivos.push(`${idade} ${idade === 1 ? "ano" : "anos"} de uso`);
  } else if (kmPorAno != null && kmPorAno <= KM_C_ANO) {
    classe = "C";
    motivos.push(`${formatInt(kmPorAno)} km/ano (≤40.000)`);
  } else if (kmPorAno != null) {
    classe = "D";
    motivos.push(`${formatInt(kmPorAno)} km/ano (>40.000)`);
  } else {
    // Sem dados suficientes → conservador, marca como C
    classe = "C";
    motivos.push("KM ou ano ausentes — classe sugerida conservadora");
  }

  // ── REGRA 0: cautelar reprovado → Classe E direto / com restrição → desce 1 ──
  if (opts.cautelar === "reprovado") {
    classe = "E";
    motivos.unshift("Laudo cautelar REPROVADO → classe E (regra Auto Avaliar)");
  } else if (opts.cautelar === "com_restricao") {
    const ordem: Classe[] = ["A", "B", "C", "D", "E"];
    const idx = ordem.indexOf(classe);
    const novaIdx = Math.min(idx + 1, ordem.length - 1);
    if (novaIdx !== idx) {
      const antiga = classe;
      classe = ordem[novaIdx];
      motivos.unshift(`Cautelar COM RESTRIÇÃO → desceu de ${antiga} para ${classe}`);
    } else {
      motivos.unshift("Cautelar com restrição (já está na classe mais baixa)");
    }
  }
  // (cautelar = "aprovado" não muda a classe — segue a regra automática)

  // ── CANAL: começa pelo padrão da classe ──
  let canal: Canal = classe === "A" || classe === "B" ? "showroom" : "repasse";
  let rebaixadoPorEstoque = false;

  // ── REGRA 1: >30 dias de pátio força repasse ──
  if (diasPatio != null && diasPatio > DIAS_PATIO_REPASSE) {
    if (canal === "showroom") {
      canal = "repasse";
      rebaixadoPorEstoque = true;
      motivos.push(`Parado há ${diasPatio} dias (>30) → forçado para repasse`);
    }
  }

  // ── REGRA 2: ≥5 do mesmo modelo no estoque força repasse ──
  if (qtMesmoModelo >= QT_REPETICAO_REPASSE) {
    if (canal === "showroom") {
      canal = "repasse";
      rebaixadoPorEstoque = true;
      motivos.push(`${qtMesmoModelo} carros iguais no estoque (≥${QT_REPETICAO_REPASSE}) → forçado para repasse`);
    }
  }

  // ── ALERTAS MANUAIS — o avaliador precisa validar ──
  if (classe === "A" || classe === "B") {
    alertasManuais.push("Confirme: sem detalhes de lataria/pintura (A) ou ≤2 avarias (B)");
    alertasManuais.push("Confirme: interior sem detalhes");
  }
  if (classe === "A") {
    alertasManuais.push("Garantia de fábrica vigente?");
  }
  alertasManuais.push("Sem modificação documental (GNV, rebaixado)?");
  alertasManuais.push("Carro foi táxi? (se sim, desce 1 classe)");
  if (!opts.cautelar) {
    alertasManuais.push("⚠️ Laudo cautelar NÃO informado — preencha pra classificação ficar correta");
  }

  return {
    classe,
    canal,
    motivos,
    alertasManuais,
    rebaixadoPorEstoque,
    metricas: {
      idade,
      kmPorAno: kmPorAno != null ? Math.round(kmPorAno) : null,
      diasPatio,
      qtMesmoModelo,
    },
  };
}

/**
 * Pre-computa o mapa modelo → quantidade no estoque, pra usar em loop com várias classificações.
 * Performance: O(N) uma vez, em vez de O(N²).
 */
export function contarPorModelo(veiculos: VeiculoParsed[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of veiculos) {
    const k = (v.modelo ?? "").trim().toUpperCase();
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

// ─── LABELS PRA UI ──────────────────────────────────────────────────────────

export const CLASSE_LABEL: Record<Classe, string> = {
  A: "A · Show Room",
  B: "B · Show Room",
  C: "C · Repasse",
  D: "D · Repasse",
  E: "E · Repasse",
};

export const CLASSE_DESC: Record<Classe, string> = {
  A: "Premium — similar a OKM",
  B: "Bom — leve reparo",
  C: "Repasse padrão",
  D: "Repasse com restrição",
  E: "Repasse / sinistro",
};

export const CLASSE_COR: Record<Classe, { bg: string; bgSoft: string; text: string; border: string }> = {
  A: {
    bg: "bg-emerald-100 dark:bg-emerald-900/40",
    bgSoft: "bg-emerald-50 dark:bg-emerald-950/30",
    text: "text-emerald-800 dark:text-emerald-300",
    border: "border-emerald-300 dark:border-emerald-800",
  },
  B: {
    bg: "bg-blue-100 dark:bg-blue-900/40",
    bgSoft: "bg-blue-50 dark:bg-blue-950/30",
    text: "text-blue-800 dark:text-blue-300",
    border: "border-blue-300 dark:border-blue-800",
  },
  C: {
    bg: "bg-amber-100 dark:bg-amber-900/40",
    bgSoft: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-800 dark:text-amber-300",
    border: "border-amber-300 dark:border-amber-800",
  },
  D: {
    bg: "bg-orange-100 dark:bg-orange-900/40",
    bgSoft: "bg-orange-50 dark:bg-orange-950/30",
    text: "text-orange-800 dark:text-orange-300",
    border: "border-orange-300 dark:border-orange-800",
  },
  E: {
    bg: "bg-red-100 dark:bg-red-900/40",
    bgSoft: "bg-red-50 dark:bg-red-950/30",
    text: "text-red-800 dark:text-red-300",
    border: "border-red-300 dark:border-red-800",
  },
};

export const CANAL_LABEL: Record<Canal, string> = {
  showroom: "Show Room",
  repasse: "Repasse",
};

function formatInt(n: number): string {
  return Math.round(n).toLocaleString("pt-BR");
}
