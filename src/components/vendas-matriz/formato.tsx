import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Delta } from "@/lib/export/vendas-matriz/resumir-painel";
import { KpiDelta } from "@/components/ui/KpiDelta";
import { Tooltip } from "@/components/ui/Tooltip";
import { formatBRL, formatInt } from "@/lib/utils";

// ─── Datas ───

function dataDoMes(mes: number, ano: number): Date {
  return new Date(ano, mes - 1, 1);
}

/** "outubro/2026" */
export function nomeMesAno(mes: number, ano: number): string {
  return format(dataDoMes(mes, ano), "MMMM/yyyy", { locale: ptBR });
}

/** "Outubro/2026" */
export function nomeMesAnoCapitalizado(mes: number, ano: number): string {
  const s = nomeMesAno(mes, ano);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "set/2026" */
export function mesAnoCurto(mes: number, ano: number): string {
  return format(dataDoMes(mes, ano), "MMM/yyyy", { locale: ptBR });
}

/** "set" */
export function mesCurto(mes: number, ano: number): string {
  return format(dataDoMes(mes, ano), "MMM", { locale: ptBR });
}

// ─── Números ───

const NF_1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 12.345 → "12,3%" (recebe já em pontos de %). */
export function fmtPct(v: number): string {
  return `${NF_1.format(v)}%`;
}

/** Fração (0,0523) → "5,2%"; `null` → "—". */
export function fmtMargemPct(frac: number | null): string {
  return frac == null ? "—" : fmtPct(frac * 100);
}

function arred(v: number, casas: number): number {
  const f = 10 ** casas;
  return Math.round(v * f) / f;
}

function comSinal(texto: string, v: number): string {
  return v > 0 ? `+${texto}` : texto;
}

/** "inclui 2 consignadas (fora da margem)" — `null` quando não há consignada. */
export function notaConsignadas(n: number): string | null {
  return n > 0 ? `inclui ${formatInt(n)} consignada${n === 1 ? "" : "s"} (fora da margem)` : null;
}

export type FormatoDelta = "int" | "money";

// ─── Contexto de comparação ───

export type ContextoComparacao = {
  /** "set/2026" (mês fechado) ou "1–30 set" (mês parcial). */
  rotuloBase: string;
  /** Mês anterior não teve nenhuma venda → todo delta vira "sem base". */
  semBaseMes: boolean;
  /** "setembro/2026" */
  nomeMesAnterior: string;
  /** Período efetivamente comparado: "setembro/2026" (mês fechado) ou "1–2 set" (mês parcial). */
  recorteAnterior: string;
};

/**
 * Linha de variação MoM. Regras: base ausente → "— sem base de comparação" (com tooltip);
 * base 0 → só o absoluto; margem % → p.p.; zero (no arredondamento exibido) → neutro.
 */
export function DeltaMoM({
  delta,
  formato = "int",
  motivoSemBase,
}: {
  delta: Delta | null;
  formato?: FormatoDelta;
  motivoSemBase: string;
}) {
  if (delta == null) return null;

  if (delta.tipo === "semBase") {
    return (
      <div className="mt-1 text-xs text-[var(--text-muted)]">
        <Tooltip content={motivoSemBase} ariaLabel={`Sem base de comparação. ${motivoSemBase}`}>
          <span>— sem base de comparação</span>
        </Tooltip>
      </div>
    );
  }

  const fmtAbs = (v: number): string => (formato === "money" ? formatBRL(v) : formatInt(v));

  if (delta.tipo === "pontos") {
    const pp = arred(delta.pp, 1);
    return (
      <KpiDelta delta={pp} className="tabular-nums">
        <span>{comSinal(`${NF_1.format(pp)} p.p.`, pp)}</span>
      </KpiDelta>
    );
  }

  const abs = arred(delta.abs, formato === "money" ? 0 : 2);
  if (delta.tipo === "absoluto") {
    return (
      <KpiDelta delta={abs} className="tabular-nums">
        <span>{comSinal(fmtAbs(abs), abs)}</span>
      </KpiDelta>
    );
  }

  const pct = arred(delta.pct, 1);
  return (
    <KpiDelta delta={abs === 0 ? 0 : pct === 0 ? abs : pct} className="flex-wrap tabular-nums">
      <span>{comSinal(fmtPct(pct), pct)}</span>
      <span className="font-normal opacity-80">({comSinal(fmtAbs(abs), abs)})</span>
    </KpiDelta>
  );
}
