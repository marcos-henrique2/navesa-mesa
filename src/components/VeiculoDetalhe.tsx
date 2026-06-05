"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { useInventory, nomeOuCodigo } from "@/lib/store/inventory";
import { normalizarPlaca } from "@/lib/utils/placa";
import { classificarPatio, STATUS_LABEL } from "@/lib/inventory/status";
import { PrecificacaoBlock } from "./veiculos/PrecificacaoBlock";
import { SimuladorPreco } from "./veiculos/SimuladorPreco";
import { DemonstrativoLucro } from "./veiculos/DemonstrativoLucro";
import { EstatisticasModelo } from "./veiculos/EstatisticasModelo";
import { FlagsVeiculo } from "./veiculos/FlagsVeiculo";
import { ComposicaoCustos } from "./ComposicaoCustos";
import { ComposicaoCustosEstoque } from "./ComposicaoCustosEstoque";
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
  const { veiculos, lojas, vendas, custosPorPlaca, custosEstoquePorPlaca, isHydrated } = useInventory();

  const veiculo = useMemo(() => veiculos.find((v) => v.chassi === chassi), [veiculos, chassi]);

  const custoDetalhado = veiculo?.placa ? custosPorPlaca[veiculo.placa] ?? null : null;
  const custoEstoque = veiculo?.placa && !custoDetalhado
    ? custosEstoquePorPlaca[normalizarPlaca(veiculo.placa)] ?? null
    : null;

  const vendasDaPlaca = useMemo(() => {
    if (!veiculo?.placa || !custoDetalhado) return [];
    return vendas.filter((v) => v.placa === veiculo.placa);
  }, [vendas, veiculo, custoDetalhado]);

  const cautelares = useCautelares();
  const cautelarAtual = veiculo ? cautelares[veiculo.chassi] ?? null : null;

  const classificacao = useMemo(() => {
    if (!veiculo) return null;
    return classificarVeiculo(veiculo, {
      contagemPorModelo: contarPorModelo(veiculos),
      cautelar: cautelarAtual,
    });
  }, [veiculo, veiculos, cautelarAtual]);

  if (!isHydrated) return <p className="text-sm text-[var(--text-muted)]">Carregando…</p>;

  if (!veiculo) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] p-12 text-center">
        <p className="text-[var(--text-muted)]">Veículo com chassi <span className="font-mono">{chassi}</span> não encontrado nessa sessão.</p>
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

  const gastoPosEntrada =
    veiculo.custo_total !== null && veiculo.valor_aquisicao !== null
      ? veiculo.custo_total - veiculo.valor_aquisicao
      : null;

  const custoPorDia =
    gastoPosEntrada !== null && gastoPosEntrada > 0 && veiculo.dias_patio !== null && veiculo.dias_patio > 0
      ? gastoPosEntrada / veiculo.dias_patio
      : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/veiculos" className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-strong)]">
          <ArrowLeft className="h-3 w-3" /> voltar ao estoque
        </Link>
        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-bold">{veiculo.marca} {veiculo.modelo}</h1>
          <span className="font-mono text-sm text-[var(--text-muted)]">{veiculo.placa}</span>
          {status !== "disponivel" && (
            <span className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
              status === "preparacao" && "bg-amber-100 text-amber-800",
              status === "bloqueado" && "bg-red-100 text-red-800",
              status === "transito" && "bg-[var(--bg-muted)] text-[var(--text-body)]",
              status === "oficina" && "bg-orange-100 text-orange-800",
              status === "documentacao" && "bg-yellow-100 text-yellow-800",
              status === "outro" && "bg-[var(--bg-muted)] text-[var(--text-body)]",
            )}>
              {(ehPrep || status === "bloqueado") && <AlertTriangle className="h-3 w-3" />} {statusLabel}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">Chassi <span className="font-mono">{veiculo.chassi}</span></p>
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
          <Row
            label="Gasto pós-entrada"
            value={gastoPosEntrada === null || gastoPosEntrada === 0 ? "—" : formatBRL(gastoPosEntrada)}
            muted
            tone={gastoPosEntrada !== null && gastoPosEntrada < 0 ? "bad" : undefined}
          />
          <Row label="Custo total" value={formatBRL(veiculo.custo_total)} muted />
          <Row
            label="Custo/dia"
            value={custoPorDia === null ? "—" : formatBRL(custoPorDia)}
            muted
          />
          <Row label="Margem bruta" value={margemAtual === null ? "—" : `${margemAtual.toFixed(1)}%`} bold tone={margemAtual !== null ? (margemAtual >= 7 ? "good" : margemAtual >= 3 ? "warn" : "bad") : undefined} />
          <Row label="Dias de pátio" value={formatInt(veiculo.dias_patio)} />
          <Row label="Data entrada" value={veiculo.data_entrada ? new Date(veiculo.data_entrada).toLocaleDateString("pt-BR") : "—"} />
          {!custoDetalhado && !custoEstoque && (
            <p className="mt-3 text-xs italic text-[var(--text-muted)]">
              ℹ️ Detalhe completo por categoria aparece quando o relatório &quot;Custos de Veículos em Estoque&quot; do NBS for importado pra essa loja.
            </p>
          )}
        </Card>
      </div>

      {custoDetalhado && vendasDaPlaca.length > 0 && (
        <ComposicaoCustos vendas={vendasDaPlaca} />
      )}

      {!custoDetalhado && custoEstoque && (
        <ComposicaoCustosEstoque custo={custoEstoque} />
      )}

      {classificacao && (
        <ClassificacaoBox
          classif={classificacao}
          cautelar={cautelarAtual}
          onCautelarChange={(s) => setCautelar(veiculo.chassi, s)}
        />
      )}

      <PrecificacaoBlock veiculo={veiculo} />

      <SimuladorPreco veiculo={veiculo} />

      <DemonstrativoLucro veiculo={veiculo} precoSim={veiculo.preco_venda} />

      <EstatisticasModelo veiculo={veiculo} />

      <FlagsVeiculo chassi={veiculo.chassi} />
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
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
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
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className={cn("text-right tabular-nums", bold && "font-semibold", muted && "text-[var(--text-body)]", toneClass)}>{value}</span>
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
    <div className={cn("rounded-xl border-2 p-5 shadow-[var(--shadow-sm)]", cor.border, cor.bgSoft)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={cn("flex h-12 w-12 items-center justify-center rounded-xl text-xl font-black", cor.bg, cor.text)}>
            {classif.classe}
          </div>
          <div>
            <h3 className="text-base font-semibold text-[var(--text-strong)]">
              Classe {CLASSE_LABEL[classif.classe]}
            </h3>
            <p className="text-xs text-[var(--text-body)]">{CLASSE_DESC[classif.classe]}</p>
          </div>
        </div>
        <span className={cn(
          "rounded-full px-3 py-1 text-xs font-semibold",
          classif.canal === "showroom"
            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
            : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
        )}>
          → {CANAL_LABEL[classif.canal]}
          {classif.rebaixadoPorEstoque && " (rebaixado)"}
        </span>
      </div>

      {/* Seletor de Cautelar */}
      <div className="mt-4 rounded-lg bg-[var(--bg-surface)]/70 dark:bg-[var(--bg-surface)]/40 p-3">
        <p className="mb-2 text-xs font-semibold text-[var(--text-body)]">Laudo cautelar</p>
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
                    : "border-[var(--border-soft)] bg-[var(--bg-surface)] text-[var(--text-body)] hover:border-[var(--border-base)] hover:bg-[var(--bg-muted)]",
                )}
              >
                <span>{CAUTELAR_ICONE[s]}</span> {CAUTELAR_LABEL[s]}
              </button>
            );
          })}
          {cautelar && (
            <button
              onClick={() => onCautelarChange(null)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-body)]"
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
        <div className="rounded-lg bg-[var(--bg-surface)]/70 dark:bg-[var(--bg-surface)]/40 p-2">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Idade</p>
          <p className="font-semibold tabular-nums text-[var(--text-strong)]">
            {classif.metricas.idade != null ? `${classif.metricas.idade} ${classif.metricas.idade === 1 ? "ano" : "anos"}` : "—"}
          </p>
        </div>
        <div className="rounded-lg bg-[var(--bg-surface)]/70 dark:bg-[var(--bg-surface)]/40 p-2">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">KM/ano</p>
          <p className="font-semibold tabular-nums text-[var(--text-strong)]">
            {classif.metricas.kmPorAno != null ? formatInt(classif.metricas.kmPorAno) : "—"}
          </p>
        </div>
        <div className="rounded-lg bg-[var(--bg-surface)]/70 dark:bg-[var(--bg-surface)]/40 p-2">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Iguais no estoque</p>
          <p className="font-semibold tabular-nums text-[var(--text-strong)]">{classif.metricas.qtMesmoModelo}</p>
        </div>
      </div>

      {/* Motivos */}
      {classif.motivos.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-[var(--text-body)]">
          {classif.motivos.map((m, i) => (
            <li key={i}>✓ {m}</li>
          ))}
        </ul>
      )}

      {/* Alertas manuais */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-[var(--text-body)] hover:text-[var(--text-strong)]">
          ⚠️ {classif.alertasManuais.length} aspectos pra validar manualmente
        </summary>
        <ul className="mt-2 space-y-1 text-xs text-[var(--text-body)]">
          {classif.alertasManuais.map((a, i) => (
            <li key={i}>• {a}</li>
          ))}
        </ul>
      </details>

      <p className="mt-3 text-[10px] text-[var(--text-muted)]">
        Classificação automática pela política Auto Avaliar. KM, idade e dias de pátio vêm do NBS; avarias e documentação ficam pro avaliador validar.
      </p>
    </div>
  );
}

