"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, Lightbulb } from "lucide-react";
import { useInventory, nomeOuCodigo } from "@/lib/store/inventory";
import { classificarPatio, STATUS_LABEL } from "@/lib/inventory/status";
import { FipeBox } from "./FipeBox";
import { sugerirPreco } from "@/lib/pricing/suggest";
import {
  classificarVeiculo,
  contarPorModelo,
  CLASSE_LABEL,
  CLASSE_DESC,
  CLASSE_COR,
  CANAL_LABEL,
} from "@/lib/pricing/classificacao";
import {
  setCautelar,
  useCautelares,
  CAUTELAR_LABEL,
  CAUTELAR_ICONE,
  CAUTELAR_COR,
  type StatusCautelar,
} from "@/lib/inventory/cautelar";
import { formatBRL, formatInt, cn } from "@/lib/utils";

export function VeiculoDetalhe({ chassi }: { chassi: string }) {
  const { veiculos, vendas, custosPorPlaca, lojas, isHydrated } = useInventory();
  const [precoFipe, setPrecoFipe] = useState<number | null>(null);

  const veiculo = useMemo(() => veiculos.find((v) => v.chassi === chassi), [veiculos, chassi]);

  const sugestao = useMemo(
    () => (veiculo ? sugerirPreco(veiculo, vendas, custosPorPlaca, precoFipe) : null),
    [veiculo, vendas, custosPorPlaca, precoFipe],
  );

  const cautelares = useCautelares();
  const cautelarAtual = veiculo ? cautelares[veiculo.chassi] ?? null : null;

  const classificacao = useMemo(() => {
    if (!veiculo) return null;
    return classificarVeiculo(veiculo, {
      contagemPorModelo: contarPorModelo(veiculos),
      cautelar: cautelarAtual,
    });
  }, [veiculo, veiculos, cautelarAtual]);

  if (!isHydrated) return <p className="text-sm text-zinc-500">Carregando…</p>;

  if (!veiculo || !sugestao) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-12 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-zinc-500">Veículo com chassi <span className="font-mono">{chassi}</span> não encontrado nessa sessão.</p>
        <Link href="/veiculos" className="mt-3 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Ver estoque</Link>
      </div>
    );
  }

  const status = classificarPatio(veiculo.patio);
  const ehPrep = status === "preparacao";
  const statusLabel = STATUS_LABEL[status];
  const margemAtual = veiculo.preco_venda && veiculo.custo_total && veiculo.custo_total > 0
    ? ((veiculo.preco_venda - veiculo.custo_total) / veiculo.custo_total) * 100
    : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/veiculos" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          <ArrowLeft className="h-3 w-3" /> voltar ao estoque
        </Link>
        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-bold">{veiculo.marca} {veiculo.modelo}</h1>
          <span className="font-mono text-sm text-zinc-500">{veiculo.placa}</span>
          {status !== "disponivel" && (
            <span className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
              status === "preparacao" && "bg-amber-100 text-amber-800",
              status === "bloqueado" && "bg-red-100 text-red-800",
              status === "transito" && "bg-slate-100 text-slate-700",
              status === "oficina" && "bg-orange-100 text-orange-800",
              status === "documentacao" && "bg-yellow-100 text-yellow-800",
              status === "outro" && "bg-slate-100 text-slate-600",
            )}>
              {(ehPrep || status === "bloqueado") && <AlertTriangle className="h-3 w-3" />} {statusLabel}
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
          <Row label="Quilometragem" value={veiculo.km !== null ? `${formatInt(veiculo.km)} km` : "—"} bold tone={kmTone(veiculo.km)} />
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
          <Row label="Data entrada" value={veiculo.data_entrada ? new Date(veiculo.data_entrada).toLocaleDateString("pt-BR") : "—"} />
        </Card>
      </div>

      {classificacao && (
        <ClassificacaoBox
          classif={classificacao}
          cautelar={cautelarAtual}
          onCautelarChange={(s) => setCautelar(veiculo.chassi, s)}
        />
      )}

      <FipeBox veiculo={veiculo} onValorChange={setPrecoFipe} />

      <SugestaoBox sugestao={sugestao} precoAtual={veiculo.preco_venda} />
    </div>
  );
}

function kmTone(km: number | null): "good" | "warn" | "bad" | undefined {
  if (km === null) return undefined;
  if (km < 30000) return "good";
  if (km < 80000) return undefined;
  if (km < 150000) return "warn";
  return "bad";
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

function ClassificacaoBox({
  classif,
  cautelar,
  onCautelarChange,
}: {
  classif: ReturnType<typeof classificarVeiculo>;
  cautelar: StatusCautelar | null;
  onCautelarChange: (s: StatusCautelar | null) => void;
}) {
  const cor = CLASSE_COR[classif.classe];
  return (
    <div className={cn("rounded-xl border-2 p-5 shadow-[var(--shadow-sm)]", cor.border, cor.bg.replace("bg-", "bg-").replace("100", "50"))}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={cn("flex h-12 w-12 items-center justify-center rounded-xl text-xl font-black", cor.bg, cor.text)}>
            {classif.classe}
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Classe {CLASSE_LABEL[classif.classe]}
            </h3>
            <p className="text-xs text-slate-600">{CLASSE_DESC[classif.classe]}</p>
          </div>
        </div>
        <span className={cn(
          "rounded-full px-3 py-1 text-xs font-semibold",
          classif.canal === "showroom" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800",
        )}>
          → {CANAL_LABEL[classif.canal]}
          {classif.rebaixadoPorEstoque && " (rebaixado)"}
        </span>
      </div>

      {/* Seletor de Cautelar */}
      <div className="mt-4 rounded-lg bg-white/70 p-3">
        <p className="mb-2 text-xs font-semibold text-slate-700">Laudo cautelar</p>
        <div className="flex flex-wrap gap-2">
          {(["aprovado", "com_restricao", "reprovado"] as StatusCautelar[]).map((s) => {
            const ativo = cautelar === s;
            const ccor = CAUTELAR_COR[s];
            return (
              <button
                key={s}
                onClick={() => onCautelarChange(ativo ? null : s)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border-2 px-3 py-1.5 text-xs font-medium transition",
                  ativo
                    ? `${ccor.bg} ${ccor.text} ${ccor.border}`
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
                )}
              >
                <span>{CAUTELAR_ICONE[s]}</span> {CAUTELAR_LABEL[s]}
              </button>
            );
          })}
          {cautelar && (
            <button
              onClick={() => onCautelarChange(null)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              title="Limpar cautelar"
            >
              ✕ limpar
            </button>
          )}
        </div>
        {!cautelar && (
          <p className="mt-2 text-[11px] text-amber-700">
            ⚠️ Sem cautelar informada — preencha pra classificação ficar correta (reprovado força Classe E, restrição desce 1 classe).
          </p>
        )}
      </div>

      {/* Métricas */}
      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-white/70 p-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Idade</p>
          <p className="font-semibold tabular-nums text-slate-900">
            {classif.metricas.idade != null ? `${classif.metricas.idade} ${classif.metricas.idade === 1 ? "ano" : "anos"}` : "—"}
          </p>
        </div>
        <div className="rounded-lg bg-white/70 p-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">KM/ano</p>
          <p className="font-semibold tabular-nums text-slate-900">
            {classif.metricas.kmPorAno != null ? formatInt(classif.metricas.kmPorAno) : "—"}
          </p>
        </div>
        <div className="rounded-lg bg-white/70 p-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Iguais no estoque</p>
          <p className="font-semibold tabular-nums text-slate-900">{classif.metricas.qtMesmoModelo}</p>
        </div>
      </div>

      {/* Motivos */}
      {classif.motivos.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-slate-700">
          {classif.motivos.map((m, i) => (
            <li key={i}>✓ {m}</li>
          ))}
        </ul>
      )}

      {/* Alertas manuais */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-700 hover:text-slate-900">
          ⚠️ {classif.alertasManuais.length} aspectos pra validar manualmente
        </summary>
        <ul className="mt-2 space-y-1 text-xs text-slate-600">
          {classif.alertasManuais.map((a, i) => (
            <li key={i}>• {a}</li>
          ))}
        </ul>
      </details>

      <p className="mt-3 text-[10px] text-slate-500">
        Classificação automática pela política Auto Avaliar. KM, idade e dias de pátio vêm do NBS; avarias e documentação ficam pro avaliador validar.
      </p>
    </div>
  );
}

function SugestaoBox({ sugestao, precoAtual }: { sugestao: ReturnType<typeof sugerirPreco>; precoAtual: number | null }) {
  const fonteLabel: Record<typeof sugestao.baseUsada, string> = {
    historico: "📊 Histórico de vendas",
    fipe: "📋 Tabela FIPE",
    custo: "💰 Custo + margem mínima",
  };

  return (
    <div className="rounded-xl border border-[var(--brand-200)] bg-gradient-to-br from-[var(--brand-50)] to-white p-5 shadow-[var(--shadow-sm)]">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Lightbulb className="h-4 w-4 text-[var(--brand-700)]" />
          Sugestão de preço
        </h3>
        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[var(--brand-700)] shadow-[var(--shadow-sm)]">
          {fonteLabel[sugestao.baseUsada]}
        </span>
      </div>

      {/* 3 BANDAS */}
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <BandaCard
          titulo="🎯 Target"
          subtitulo="margem & giro equilibrados"
          banda={sugestao.target}
          precoAtual={precoAtual}
          destaque
        />
        <BandaCard
          titulo="⚡ Giro rápido"
          subtitulo="venda em ≤30 dias"
          banda={sugestao.giroRapido}
          precoAtual={precoAtual}
          tone="amber"
        />
        <BandaCard
          titulo="🚨 Mínimo"
          subtitulo="piso sem prejuízo"
          banda={sugestao.minimo}
          precoAtual={precoAtual}
          tone="red"
        />
      </div>

      {/* JUSTIFICATIVA */}
      <p className="mt-3 rounded-lg bg-white/80 px-3 py-2 text-xs text-slate-700">
        💡 {sugestao.justificativa}
      </p>

      {/* ALERTAS */}
      {sugestao.alertas.length > 0 && (
        <ul className="mt-2 space-y-1">
          {sugestao.alertas.map((a, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{a}</span>
            </li>
          ))}
        </ul>
      )}

      {/* COMPARÁVEIS */}
      {sugestao.comparaveis.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-[var(--brand-700)] hover:text-[var(--brand-900)]">
            Ver {sugestao.comparaveis.length} comparável{sugestao.comparaveis.length === 1 ? "" : "is"} do histórico
          </summary>
          <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--border-soft)] bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2">Placa</th>
                  <th className="px-3 py-2 text-right">Vendido por</th>
                  <th className="px-3 py-2 text-right">KM</th>
                  <th className="px-3 py-2 text-right">Margem</th>
                  <th className="px-3 py-2 text-right">Dias até venda</th>
                  <th className="px-3 py-2 text-right">Data</th>
                </tr>
              </thead>
              <tbody>
                {sugestao.comparaveis.slice(0, 10).map((c) => (
                  <tr key={c.placa} className="border-t border-[var(--border-soft)]">
                    <td className="px-3 py-1.5 font-mono">{c.placa}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatBRL(c.precoVenda)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                      {c.km != null ? formatInt(c.km) : "—"}
                    </td>
                    <td className={cn(
                      "px-3 py-1.5 text-right tabular-nums",
                      c.margemReal >= 0 ? "text-emerald-700" : "text-red-700"
                    )}>
                      {formatBRL(c.margemReal)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                      {c.diasAteVenda != null ? `${c.diasAteVenda}d` : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right text-slate-500">
                      {c.dataVenda ? new Date(c.dataVenda).toLocaleDateString("pt-BR") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function BandaCard({
  titulo,
  subtitulo,
  banda,
  precoAtual,
  destaque,
  tone,
}: {
  titulo: string;
  subtitulo: string;
  banda: { preco: number; margemSobreFaturamento: number };
  precoAtual: number | null;
  destaque?: boolean;
  tone?: "amber" | "red";
}) {
  const diff = precoAtual ? banda.preco - precoAtual : 0;
  const diffPct = precoAtual && precoAtual > 0 ? (diff / precoAtual) * 100 : 0;
  const margemNeg = banda.margemSobreFaturamento < 0;

  return (
    <div
      className={cn(
        "rounded-lg border bg-white p-3",
        destaque ? "border-[var(--brand-400)] shadow-[var(--shadow-md)]" : "border-[var(--border-soft)] shadow-[var(--shadow-sm)]",
        tone === "amber" && "border-amber-200",
        tone === "red" && "border-red-200",
      )}
    >
      <p className="text-xs font-semibold text-slate-700">{titulo}</p>
      <p className="text-[10px] text-slate-500">{subtitulo}</p>
      <p className={cn(
        "mt-2 text-2xl font-bold tabular-nums",
        destaque ? "text-[var(--brand-900)]" : tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-700" : "text-slate-900",
      )}>
        {formatBRL(banda.preco)}
      </p>
      <p className={cn(
        "text-[11px] tabular-nums",
        margemNeg ? "text-red-600" : "text-slate-500",
      )}>
        margem {banda.margemSobreFaturamento.toFixed(1)}%
      </p>
      {precoAtual != null && precoAtual > 0 && (
        <p className={cn(
          "mt-1 text-[10px] tabular-nums",
          diff > 0 ? "text-emerald-700" : diff < 0 ? "text-amber-700" : "text-slate-500",
        )}>
          {diff === 0 ? "= preço atual" : `${diff > 0 ? "+" : ""}${formatBRL(diff)} (${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(1)}%)`}
        </p>
      )}
    </div>
  );
}
