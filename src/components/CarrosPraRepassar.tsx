"use client";

/**
 * Página completa "Carros pra repassar" com filtros e lista detalhada.
 *
 * Mostra os carros ranqueados pelo score de urgência. Cada linha tem:
 *   - Score visual (cor + número)
 *   - Marca/modelo/placa + identificação
 *   - Chips de motivos (parado, margem fraca, FIPE, cautelar)
 *   - Capital travado e preço atual
 *   - Sugestão de preço de repasse
 *   - Botão pra abrir o detalhe completo do veículo
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Clock,
  Calendar,
  Gauge,
  ChevronRight,
  Building2,
  Filter,
} from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import { useFipeBatch } from "@/lib/fipe/useFipeBatch";
import { useCautelares } from "@/lib/inventory/cautelar";
import {
  calcularCarrosPraRepassar,
  type CarroPraRepassar,
  type MotivoRepasse,
} from "@/lib/analytics/carros-pra-repassar";
import { cn, formatBRL, formatInt } from "@/lib/utils";

export function CarrosPraRepassar() {
  const { veiculos, lojas, isHydrated } = useInventory();
  const fipeBatch = useFipeBatch();
  const cautelares = useCautelares();
  const [filtroLoja, setFiltroLoja] = useState<string>("all");
  const [scoreMin, setScoreMin] = useState<number>(50);

  const carros = useMemo(() => {
    if (!isHydrated) return [];
    return calcularCarrosPraRepassar(veiculos, fipeBatch, cautelares);
  }, [veiculos, fipeBatch, cautelares, isHydrated]);

  const filtrados = useMemo(() => {
    return carros.filter((c) => {
      if (scoreMin > 0 && c.score < scoreMin) return false;
      if (filtroLoja !== "all" && String(c.loja) !== filtroLoja) return false;
      return true;
    });
  }, [carros, scoreMin, filtroLoja]);

  if (!isHydrated) {
    return <p className="text-sm text-[var(--text-muted)]">Carregando…</p>;
  }

  if (veiculos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] p-12 text-center">
        <p className="text-[var(--text-muted)]">Nenhum estoque carregado.</p>
        <Link href="/upload" className="mt-3 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          Subir relatório
        </Link>
      </div>
    );
  }

  if (carros.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-6 text-center dark:border-emerald-900/60 dark:bg-emerald-950/30">
        <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
          ✅ Nenhum carro precisa de repasse no momento.
        </p>
        <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
          Critérios: 10 anos ou mais de uso · 100.000 km ou mais · 50 dias parado ou mais.
        </p>
      </div>
    );
  }

  const lojasComCarros = [...new Set(carros.map((c) => c.loja))].sort((a, b) => a - b);
  const capitalTotal = filtrados.reduce((s, c) => s + c.capitalTravado, 0);

  return (
    <div className="space-y-5">
      {/* Resumo + Filtros */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
        <div className="inline-flex items-center gap-1.5 rounded-md bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800 dark:bg-red-950/40 dark:text-red-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          {filtrados.length} carro{filtrados.length === 1 ? "" : "s"} priorizado{filtrados.length === 1 ? "" : "s"}
        </div>
        <div className="text-xs text-[var(--text-muted)]">
          Capital travado: <span className="font-semibold text-[var(--text-strong)] tabular-nums">{formatBRL(capitalTotal)}</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-xs">
            <Filter className="h-3 w-3 text-[var(--text-subtle)]" />
            <span className="text-[var(--text-muted)]">Loja:</span>
            <select
              value={filtroLoja}
              onChange={(e) => setFiltroLoja(e.target.value)}
              className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--brand-600)]"
            >
              <option value="all">Todas</option>
              {lojasComCarros.map((l) => (
                <option key={l} value={String(l)}>
                  {lojas[l]?.nome?.trim() ?? `Loja ${l}`}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs">
            <span className="text-[var(--text-muted)]">Critérios:</span>
            <select
              value={String(scoreMin)}
              onChange={(e) => setScoreMin(Number(e.target.value))}
              className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--brand-600)]"
            >
              <option value="50">Bate ao menos 1</option>
              <option value="75">Bate 2 ou mais</option>
              <option value="100">Bate os 3 (crítico)</option>
            </select>
          </label>
        </div>
      </div>

      {/* Lista */}
      <div className="space-y-3">
        {filtrados.map((c) => (
          <CarroCard key={c.chassi} carro={c} nomeLoja={lojas[c.loja]?.nome?.trim() ?? `Loja ${c.loja}`} />
        ))}
      </div>

      {filtrados.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] p-8 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            Sem carros nesse score com esses filtros. Reduza o score mínimo ou troque a loja.
          </p>
        </div>
      )}
    </div>
  );
}

function CarroCard({ carro, nomeLoja }: { carro: CarroPraRepassar; nomeLoja: string }) {
  const router = useRouter();
  const corScore = scoreToColor(carro.score);

  return (
    <button
      type="button"
      onClick={() => router.push(`/veiculos/${carro.chassi}`)}
      className="group block w-full rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4 text-left shadow-[var(--shadow-sm)] transition hover:shadow-[var(--shadow-md)] hover:-translate-y-px"
    >
      <div className="flex items-start gap-4">
        {/* Score grande */}
        <div className={cn("flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-lg font-bold", corScore.bg, corScore.text)}>
          <span className="text-2xl tabular-nums leading-none">{carro.score}</span>
          <span className="text-[9px] uppercase tracking-wider opacity-80">score</span>
        </div>

        {/* Conteúdo */}
        <div className="min-w-0 flex-1">
          {/* Linha 1: marca/modelo/placa */}
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-semibold text-[var(--text-strong)]">
              {carro.marca && <span className="text-[var(--text-muted)]">{carro.marca}</span>}{" "}
              {carro.modelo}
            </h3>
            <span className="font-mono text-xs text-[var(--text-body)]">{carro.placa}</span>
          </div>

          {/* Linha 2: specs + loja */}
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            {carro.anoModelo ?? "—"}
            {carro.km != null && ` · ${formatInt(carro.km)} km`}
            {carro.cor && ` · ${carro.cor}`}
            {" · "}
            <span className="inline-flex items-center gap-0.5">
              <Building2 className="h-3 w-3" />
              {nomeLoja}
            </span>
          </p>

          {/* Linha 3: chips de motivos */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {carro.motivos.map((m, i) => (
              <ChipMotivo key={i} motivo={m} />
            ))}
          </div>

          {/* Linha 4: financeiro */}
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--border-soft)] pt-3 sm:grid-cols-4">
            <Mini label="Capital travado" valor={formatBRL(carro.capitalTravado)} tom="warn" />
            <Mini
              label="Preço atual"
              valor={carro.precoVenda != null ? formatBRL(carro.precoVenda) : "—"}
            />
            <Mini
              label="Margem teórica"
              valor={carro.margemTeoricaPct != null ? `${carro.margemTeoricaPct.toFixed(1)}%` : "—"}
              tom={
                carro.margemTeoricaPct == null
                  ? "neutro"
                  : carro.margemTeoricaPct < 0
                    ? "bad"
                    : carro.margemTeoricaPct < 5
                      ? "warn"
                      : "good"
              }
            />
            <Mini
              label="Repasse sugerido"
              valor={carro.precoSugerido ? `${formatBRL(carro.precoSugerido.piso)} – ${formatBRL(carro.precoSugerido.teto)}` : "—"}
              tom="info"
            />
          </div>
        </div>

        <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-[var(--text-subtle)] transition group-hover:translate-x-0.5 group-hover:text-[var(--brand-700)]" />
      </div>
    </button>
  );
}

function scoreToColor(score: number): { bg: string; text: string } {
  if (score >= 85)
    return {
      bg: "bg-red-200 dark:bg-red-950/60",
      text: "text-red-900 dark:text-red-200",
    };
  if (score >= 75)
    return {
      bg: "bg-red-100 dark:bg-red-950/40",
      text: "text-red-800 dark:text-red-300",
    };
  if (score >= 60)
    return {
      bg: "bg-amber-100 dark:bg-amber-950/40",
      text: "text-amber-800 dark:text-amber-300",
    };
  return {
    bg: "bg-[var(--bg-muted)]",
    text: "text-[var(--text-body)]",
  };
}

function ChipMotivo({ motivo }: { motivo: MotivoRepasse }) {
  let icon: React.ReactNode = null;
  let texto = "";
  // Cores fixas por tipo de critério — todos têm peso igual no novo modelo
  let tom = "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300";

  switch (motivo.tipo) {
    case "idade":
      icon = <Calendar className="h-3 w-3" />;
      texto = `${motivo.anos} anos de uso`;
      tom = "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300";
      break;
    case "km":
      icon = <Gauge className="h-3 w-3" />;
      texto = `${motivo.km.toLocaleString("pt-BR")} km`;
      tom = "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300";
      break;
    case "parado":
      icon = <Clock className="h-3 w-3" />;
      texto = `${motivo.dias} dias parado`;
      tom = motivo.dias >= 180
        ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
        : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
      break;
  }

  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", tom)}>
      {icon} {texto}
    </span>
  );
}

function Mini({
  label,
  valor,
  tom = "neutro",
}: {
  label: string;
  valor: string;
  tom?: "neutro" | "good" | "warn" | "bad" | "info";
}) {
  const toneClass =
    tom === "good"
      ? "text-emerald-700 dark:text-emerald-400"
      : tom === "warn"
        ? "text-amber-700 dark:text-amber-400"
        : tom === "bad"
          ? "text-red-700 dark:text-red-400"
          : tom === "info"
            ? "text-blue-700 dark:text-blue-400"
            : "text-[var(--text-body)]";
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className={cn("mt-0.5 text-xs font-semibold tabular-nums", toneClass)}>{valor}</p>
    </div>
  );
}
