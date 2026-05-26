"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, Lightbulb } from "lucide-react";
import { useInventory, nomeOuCodigo } from "@/lib/store/inventory";
import { FipeBox } from "./FipeBox";
import { sugerirPreco } from "@/lib/pricing/suggest";
import { formatBRL, formatInt, cn } from "@/lib/utils";

export function VeiculoDetalhe({ chassi }: { chassi: string }) {
  const { veiculos, lojas, isHydrated } = useInventory();
  const [precoFipe, setPrecoFipe] = useState<number | null>(null);

  const veiculo = useMemo(() => veiculos.find((v) => v.chassi === chassi), [veiculos, chassi]);

  if (!isHydrated) return <p className="text-sm text-zinc-500">Carregando…</p>;

  if (!veiculo) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-12 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-zinc-500">Veículo com chassi <span className="font-mono">{chassi}</span> não encontrado nessa sessão.</p>
        <Link href="/veiculos" className="mt-3 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Ver estoque</Link>
      </div>
    );
  }

  const ehPrep = veiculo.patio.trim().toUpperCase() === "PREPARAÇÃO";
  const margemAtual = veiculo.preco_venda && veiculo.custo_total && veiculo.custo_total > 0
    ? ((veiculo.preco_venda - veiculo.custo_total) / veiculo.custo_total) * 100
    : null;
  const sugestao = sugerirPreco(veiculo, precoFipe);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/veiculos" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          <ArrowLeft className="h-3 w-3" /> voltar ao estoque
        </Link>
        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-bold">{veiculo.marca} {veiculo.modelo}</h1>
          <span className="font-mono text-sm text-zinc-500">{veiculo.placa}</span>
          {ehPrep && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
              <AlertTriangle className="h-3 w-3" /> Em PREPARAÇÃO
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-zinc-500">Chassi <span className="font-mono">{veiculo.chassi}</span></p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="🚗 Identidade">
          <Row label="Marca" value={veiculo.marca ?? "—"} />
          <Row label="Modelo" value={veiculo.modelo} />
          <Row label="Ano fab./mod." value={`${veiculo.ano_fabricacao ?? "—"} / ${veiculo.ano_modelo ?? "—"}`} />
          <Row label="Cor" value={veiculo.cor_externa ?? "—"} />
          <Row label="Combustível" value={veiculo.combustivel ?? "—"} />
          <Row label="Pátio" value={veiculo.patio.trim()} />
          <Row label="Situação" value={veiculo.descricao_situacao ?? "—"} />
          <Row label="Loja" value={nomeOuCodigo(lojas, veiculo.cod_empresa)} />
        </Card>

        <Card title="📊 Financeiro atual">
          <Row label="Preço de venda" value={formatBRL(veiculo.preco_venda)} bold />
          <Row label="Aquisição" value={formatBRL(veiculo.valor_aquisicao)} muted />
          <Row label="Custo total" value={formatBRL(veiculo.custo_total)} muted />
          <Row label="Margem bruta" value={margemAtual === null ? "—" : `${margemAtual.toFixed(1)}%`} bold tone={margemAtual !== null ? (margemAtual >= 7 ? "good" : margemAtual >= 3 ? "warn" : "bad") : undefined} />
          <Row label="Dias de pátio" value={formatInt(veiculo.dias_patio)} />
          <Row label="Vendedor" value={veiculo.vendedor_recebeu ?? "—"} />
          <Row label="Data entrada" value={veiculo.data_entrada ? new Date(veiculo.data_entrada).toLocaleDateString("pt-BR") : "—"} />
        </Card>
      </div>

      <FipeBox veiculo={veiculo} onValorChange={setPrecoFipe} />

      <SugestaoBox sugestao={sugestao} precoAtual={veiculo.preco_venda} />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-3 font-semibold">{title}</h3>
      <div className="space-y-1.5 text-sm">{children}</div>
    </div>
  );
}

function Row({ label, value, bold, muted, tone }: { label: string; value: string; bold?: boolean; muted?: boolean; tone?: "good" | "warn" | "bad" }) {
  const toneClass = tone === "good" ? "text-green-700 dark:text-green-400"
    : tone === "warn" ? "text-amber-700 dark:text-amber-400"
    : tone === "bad" ? "text-red-700 dark:text-red-400"
    : "";
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <span className={cn("text-right tabular-nums", bold && "font-semibold", muted && "text-zinc-600 dark:text-zinc-400", toneClass)}>{value}</span>
    </div>
  );
}

function SugestaoBox({ sugestao, precoAtual }: { sugestao: ReturnType<typeof sugerirPreco>; precoAtual: number | null }) {
  const diff = precoAtual ? sugestao.precoSugerido - precoAtual : 0;
  const diffPct = precoAtual && precoAtual > 0 ? (diff / precoAtual) * 100 : 0;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-5 dark:border-blue-900 dark:bg-blue-950/20">
      <h3 className="flex items-center gap-2 font-semibold">
        <Lightbulb className="h-4 w-4 text-blue-600" />
        Sugestão de preço (regra simples)
      </h3>

      <div className="mt-4 flex items-baseline gap-3">
        <p className="text-3xl font-bold tabular-nums">{formatBRL(sugestao.precoSugerido)}</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          margem {(sugestao.margemPct * 100).toFixed(1)}%
        </p>
      </div>

      {precoAtual && (
        <p className="mt-1 text-sm">
          <span className="text-zinc-500">vs preço atual: </span>
          <span className={cn("font-medium", diff > 0 ? "text-green-700 dark:text-green-400" : diff < 0 ? "text-amber-700 dark:text-amber-400" : "text-zinc-500")}>
            {diff > 0 ? "+" : ""}{formatBRL(diff)} ({diffPct >= 0 ? "+" : ""}{diffPct.toFixed(1)}%)
          </span>
        </p>
      )}

      <p className="mt-3 rounded-md bg-white/60 p-3 text-xs text-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300">
        💡 {sugestao.justificativaBreve}
      </p>

      <p className="mt-2 text-xs text-zinc-500">
        Regra atual: <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">max(FIPE × 1.02, custo × 1.07)</code> — pode ser refinada depois.
      </p>
    </div>
  );
}
