"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronUp, ChevronsUpDown, Landmark, Repeat } from "lucide-react";
import {
  chaveVendedor,
  derivadosVenda,
  rotuloVendedor,
  ROTULO_CUSTO,
  type ChaveOrdenacao,
  type DerivadosVenda,
  type Ordenacao,
  type TotaisFiltro,
} from "@/lib/export/vendas-matriz/filtrar-vendas";
import { classificarComprador, type CompradorChave } from "@/lib/export/vendas-matriz/resumir-painel";
import { classificarOrigem, type LinhaVendaMatriz, type OrigemChave } from "@/lib/export/vendas-matriz/tipos";
import { hojeLocal } from "@/lib/utils/data-local";
import { cn, formatBRL, formatBRLCents, formatInt } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";
import { PontoOrigem } from "./Barras";
import { CLASSE_NEGATIVO, fmtFrac } from "./comum";

export type PresetColunas = "resumo" | "custos" | "completo";

// ═══════════════════════════════════════════════════════════════════════════
// Formatação da linha
// ═══════════════════════════════════════════════════════════════════════════

/** "14/10" no calendário de Brasília. */
export function dataCurta(d: Date | null): string {
  if (!d) return "—";
  const iso = hojeLocal(d);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function dataLonga(d: Date | null): string {
  if (!d) return "—";
  const iso = hojeLocal(d);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** "João da Silva Souza" → "João Souza". */
export function nomeCurto(nome: string): string {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  if (p.length <= 2) return p.join(" ");
  return `${p[0]} ${p[p.length - 1]}`;
}

function capitalizar(s: string): string {
  return s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/** "NAVESA GWM GOIANIA" → "Gwm Goiania". */
function lojaCurta(nome: string): string {
  return capitalizar(nome.replace(/^NAVESA\s+/i, ""));
}

export function rotuloOrigemLinha(l: LinhaVendaMatriz, codEmpresa: number): { origem: OrigemChave; texto: string } {
  const origem = classificarOrigem(l, codEmpresa);
  return { origem, texto: origem === "proprio" ? "Próprio" : origem === "outras" ? lojaCurta(l.lojaOrigemNome) : "Não ident." };
}

const BADGE_COMPRADOR: Record<CompradorChave, { texto: string; classe: string; titulo: string }> = {
  pf: { texto: "PF", classe: "border-blue-500/40 text-blue-700 dark:text-blue-300", titulo: "Pessoa física" },
  pj: { texto: "PJ", classe: "border-purple-500/40 text-purple-700 dark:text-purple-300", titulo: "Pessoa jurídica" },
  autoAvaliar: { texto: "Leilão", classe: "border-slate-400 text-[var(--text-muted)]", titulo: "Auto Avaliar (leilão)" },
  naoInformado: { texto: "—", classe: "border-slate-300 text-[var(--text-subtle)] dark:border-slate-600", titulo: "Tipo de cliente não informado" },
};

export function BadgeComprador({ l }: { l: LinhaVendaMatriz }) {
  const b = BADGE_COMPRADOR[classificarComprador(l)];
  return (
    <span title={b.titulo} className={cn("inline-flex shrink-0 rounded border px-1 text-[10px] font-semibold leading-4", b.classe)}>
      <span aria-hidden="true">{b.texto}</span>
      <span className="sr-only">{b.titulo}</span>
    </span>
  );
}

function Margem({ l, d, centavos = false }: { l: LinhaVendaMatriz; d: DerivadosVenda; centavos?: boolean }) {
  const fmt = centavos ? formatBRLCents : formatBRL;
  if (l.consignado) {
    return (
      <Tooltip content="Consignada: fora das margens do painel" focavel={false}>
        <span className="italic text-[var(--text-subtle)]">
          {fmt(d.margemLiquida)}
          <span className="sr-only"> (consignada: fora das margens do painel)</span>
        </span>
      </Tooltip>
    );
  }
  return <span className={cn((d.margemLiquida ?? 0) < 0 && CLASSE_NEGATIVO)}>{fmt(d.margemLiquida)}</span>;
}

function PctFipe({ d }: { d: DerivadosVenda }) {
  if (d.pctFipe == null) {
    return (
      <Tooltip content="FIPE não confirmada para este carro" focavel={false}>
        <span className="text-[var(--text-subtle)]">
          —<span className="sr-only"> FIPE não confirmada para este carro</span>
        </span>
      </Tooltip>
    );
  }
  return <>{fmtFrac(d.pctFipe)}</>;
}

/** Ícones de observação (sempre com texto acessível, nunca só cor/ícone). */
export function Observacoes({ l, d }: { l: LinhaVendaMatriz; d: DerivadosVenda }) {
  const faltando = l.consignado ? 0 : d.custosNaoLancados.length;
  return (
    <span className="inline-flex items-center justify-center gap-1.5">
      {l.consignado && (
        <span className="rounded bg-[var(--bg-muted)] px-1 text-[10px] font-semibold leading-4 text-[var(--text-body)]">Consig.</span>
      )}
      {l.usadoNaTroca && (
        <span title="Usado na troca">
          <Repeat className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
          <span className="sr-only">Usado na troca</span>
        </span>
      )}
      {l.financiou === true && (
        <span title="Financiou">
          <Landmark className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
          <span className="sr-only">Financiou</span>
        </span>
      )}
      {faltando > 0 && (
        <span title={`${faltando} custo${faltando === 1 ? "" : "s"} não lançado${faltando === 1 ? "" : "s"}`}>
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <span className="sr-only">Custos incompletos</span>
        </span>
      )}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Colunas
// ═══════════════════════════════════════════════════════════════════════════

type Ctx = { codEmpresa: number };

type Coluna = {
  id: string;
  header: string;
  /** Rótulo acessível quando `header` é abreviado. */
  headerLongo?: string;
  alinhar?: "dir" | "centro";
  ordenar?: ChaveOrdenacao;
  /** Visível no tablet (768–1023). */
  tablet?: boolean;
  /** Fixa à esquerda no preset "Completo". */
  sticky?: "data" | "veiculo";
  largura?: string;
  celula: (l: LinhaVendaMatriz, d: DerivadosVenda, ctx: Ctx) => ReactNode;
  rodape?: (t: TotaisFiltro) => ReactNode;
};

const brl = (v: number | null) => formatBRL(v);
const brlC = (v: number | null) => formatBRLCents(v);
const naoLancado = (v: number | null, fmt: (x: number | null) => string = brl): ReactNode =>
  v == null ? <span className="italic text-[var(--text-subtle)]">não lançado</span> : fmt(v);
const pctVenda = (v: number | null, venda: number | null): string => (v == null || venda == null || venda <= 0 ? "" : fmtFrac(v / venda));

const COL_DATA: Coluna = {
  id: "data",
  header: "Data",
  ordenar: "data",
  tablet: true,
  sticky: "data",
  largura: "w-14",
  celula: (l) => <span className="tabular-nums">{dataCurta(l.dataVenda)}</span>,
  rodape: (t) => (
    <span className="font-semibold">
      {formatInt(t.qtdSemConsig)}
      <span className="sr-only"> vendas sem consignadas</span>
    </span>
  ),
};

const COL_VEICULO: Coluna = {
  id: "veiculo",
  header: "Veículo",
  tablet: true,
  sticky: "veiculo",
  celula: (l) => (
    <div className="min-w-0 max-w-[16rem]">
      <p className="truncate font-medium text-[var(--text-strong)]" title={l.descricaoVeiculo}>
        {l.descricaoVeiculo}
      </p>
      <p className="truncate text-[11px] tabular-nums text-[var(--text-muted)]">
        {[l.placa, l.anoModelo, l.km != null ? `${formatInt(l.km)} km` : null].filter(Boolean).join(" · ")}
      </p>
    </div>
  ),
  rodape: () => <span className="text-[11px] text-[var(--text-muted)]">Totais do filtro (sem consignadas)</span>,
};

const COL_ORIGEM: Coluna = {
  id: "origem",
  header: "Origem",
  ordenar: "origem",
  tablet: true,
  celula: (l, _d, ctx) => {
    const o = rotuloOrigemLinha(l, ctx.codEmpresa);
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={l.lojaOrigemNome}>
        <PontoOrigem origem={o.origem} />
        {o.texto}
      </span>
    );
  },
};

const COL_CLIENTE: Coluna = {
  id: "cliente",
  header: "Cliente",
  ordenar: "cliente",
  celula: (l) => (
    <span className="flex min-w-0 max-w-[12rem] items-center gap-1.5">
      <span className="truncate" title={l.clienteNome}>
        {l.clienteNome || "—"}
      </span>
      <BadgeComprador l={l} />
    </span>
  ),
};

const COL_VENDEDOR: Coluna = {
  id: "vendedor",
  header: "Vendedor",
  ordenar: "vendedor",
  celula: (l) => <span className="whitespace-nowrap">{nomeCurto(rotuloVendedor(chaveVendedor(l)))}</span>,
};

const COL_VENDA: Coluna = {
  id: "venda",
  header: "Venda",
  alinhar: "dir",
  ordenar: "venda",
  tablet: true,
  celula: (l) => brl(l.valorVenda),
  rodape: (t) => <span className="font-semibold">{brl(t.venda)}</span>,
};

const COL_PCT_FIPE: Coluna = {
  id: "pctFipe",
  header: "%FIPE",
  alinhar: "dir",
  ordenar: "pctFipe",
  celula: (_l, d) => <PctFipe d={d} />,
  rodape: (t) => fmtFrac(t.pctFipe),
};

const COL_MARGEM: Coluna = {
  id: "margem",
  header: "Margem",
  alinhar: "dir",
  ordenar: "margem",
  tablet: true,
  celula: (l, d) => <Margem l={l} d={d} />,
  rodape: (t) => <span className={cn("font-semibold", (t.margem ?? 0) < 0 && CLASSE_NEGATIVO)}>{brl(t.margem)}</span>,
};

const COL_PCT_MARGEM: Coluna = {
  id: "pctMargem",
  header: "% margem",
  alinhar: "dir",
  ordenar: "pctMargem",
  tablet: true,
  celula: (l, d) => (l.consignado ? <span className="text-[var(--text-subtle)]">—</span> : <span className={cn((d.pctMargem ?? 0) < 0 && CLASSE_NEGATIVO)}>{fmtFrac(d.pctMargem)}</span>),
  rodape: (t) => <span className={cn((t.pctMargem ?? 0) < 0 && CLASSE_NEGATIVO)}>{fmtFrac(t.pctMargem)}</span>,
};

const COL_DIAS: Coluna = {
  id: "dias",
  header: "Dias",
  headerLongo: "Dias de estoque",
  alinhar: "dir",
  ordenar: "dias",
  celula: (l) => formatInt(l.diasEstoque),
  rodape: (t) => (t.diasMedio == null ? "—" : `${formatInt(Math.round(t.diasMedio))} méd.`),
};

const COL_OBS: Coluna = {
  id: "obs",
  header: "Obs.",
  headerLongo: "Observações",
  alinhar: "centro",
  tablet: true,
  celula: (l, d) => <Observacoes l={l} d={d} />,
  rodape: (t) => (t.kmMedio == null ? "" : <span className="whitespace-nowrap text-[11px] text-[var(--text-muted)]">{formatInt(Math.round(t.kmMedio))} km méd.</span>),
};

const custo = (id: string, header: string, campo: "despesaGeral" | "forplan" | "impostos" | "comissao" | "adm"): Coluna => ({
  id,
  header,
  alinhar: "dir",
  celula: (l) => naoLancado(l[campo]),
});

const COLUNAS_RESUMO: Coluna[] = [COL_DATA, COL_VEICULO, COL_ORIGEM, COL_CLIENTE, COL_VENDEDOR, COL_VENDA, COL_PCT_FIPE, COL_MARGEM, COL_PCT_MARGEM, COL_DIAS, COL_OBS];

const COLUNAS_CUSTOS: Coluna[] = [
  COL_DATA,
  COL_VEICULO,
  COL_ORIGEM,
  COL_VENDA,
  COL_PCT_FIPE,
  { id: "custoReal", header: "Custo real", alinhar: "dir", celula: (_l, d) => brl(d.custoReal) },
  { id: "lucroBruto", header: "Lucro bruto", alinhar: "dir", celula: (_l, d) => <span className={cn((d.lucroBruto ?? 0) < 0 && CLASSE_NEGATIVO)}>{brl(d.lucroBruto)}</span> },
  custo("despesa", "Despesa", "despesaGeral"),
  custo("fplan", "F Plan", "forplan"),
  custo("impostos", "Impostos", "impostos"),
  custo("comissao", "Comissão", "comissao"),
  custo("adm", "ADM", "adm"),
  COL_MARGEM,
  COL_PCT_MARGEM,
  COL_DIAS,
  COL_OBS,
];

const simNao = (v: boolean | null): string => (v == null ? "" : v ? "Sim" : "Não");

/** As colunas B..AJ das abas 1/2, na ordem e com os valores (centavos) do Excel, mais "Data". */
const COLUNAS_COMPLETO: Coluna[] = [
  COL_DATA,
  { ...COL_VEICULO, id: "descricao", header: "Descrição do veículo", celula: (l) => <span className="block max-w-[16rem] truncate" title={l.descricaoVeiculo}>{l.descricaoVeiculo}</span>, rodape: COL_VEICULO.rodape },
  { id: "loja", header: "Loja de origem", celula: (l) => <span className="whitespace-nowrap">{l.lojaOrigemNome}</span> },
  { id: "cor", header: "Cor", celula: (l) => l.cor ?? "" },
  { id: "marca", header: "Marca", celula: (l) => l.marca ?? "" },
  { id: "placa", header: "Placa", celula: (l) => <span className="whitespace-nowrap">{l.placa}</span> },
  { id: "anoModelo", header: "Ano/modelo", celula: (l) => l.anoModelo },
  { id: "km", header: "KM", alinhar: "dir", celula: (l) => formatInt(l.km), rodape: (t) => (t.kmMedio == null ? "—" : formatInt(Math.round(t.kmMedio))) },
  { ...COL_DIAS, header: "Dias" },
  { id: "nf", header: "NF entrada", alinhar: "dir", celula: (l) => brlC(l.nfEntrada) },
  { id: "valoriza", header: "Valoriza", alinhar: "dir", celula: (l) => brlC(l.valoriza) },
  { id: "custoReal", header: "Custo real", alinhar: "dir", celula: (_l, d) => brlC(d.custoReal) },
  { id: "fipe", header: "Valor FIPE", alinhar: "dir", celula: (l) => (l.valorFipe == null ? "" : brlC(l.valorFipe)) },
  { ...COL_VENDA, header: "Valor da venda", celula: (l) => brlC(l.valorVenda), rodape: (t) => <span className="font-semibold">{brlC(t.venda)}</span> },
  COL_PCT_FIPE,
  { id: "lucroBruto", header: "Lucro bruto", alinhar: "dir", celula: (_l, d) => <span className={cn((d.lucroBruto ?? 0) < 0 && CLASSE_NEGATIVO)}>{brlC(d.lucroBruto)}</span> },
  { id: "pctLb", header: "%", headerLongo: "% lucro bruto", alinhar: "dir", celula: (_l, d) => fmtFrac(d.pctLucroBruto) },
  { id: "despesa", header: "Despesa geral", alinhar: "dir", celula: (l) => brlC(l.despesaGeral) },
  { id: "pctDesp", header: "%", headerLongo: "% despesa geral", alinhar: "dir", celula: (l) => pctVenda(l.despesaGeral, l.valorVenda) },
  { id: "fplan", header: "F Plan", alinhar: "dir", celula: (l) => brlC(l.forplan) },
  { id: "pctFplan", header: "%", headerLongo: "% F Plan", alinhar: "dir", celula: (l) => pctVenda(l.forplan, l.valorVenda) },
  { id: "impostos", header: "Impostos", alinhar: "dir", celula: (l) => brlC(l.impostos) },
  { id: "pctImp", header: "%", headerLongo: "% impostos", alinhar: "dir", celula: (l) => pctVenda(l.impostos, l.valorVenda) },
  { id: "comissao", header: "Comissão", alinhar: "dir", celula: (l) => brlC(l.comissao) },
  { id: "pctCom", header: "%", headerLongo: "% comissão", alinhar: "dir", celula: (l) => pctVenda(l.comissao, l.valorVenda) },
  { ...COL_MARGEM, header: "Margem líquida", celula: (l, d) => <Margem l={l} d={d} centavos /> },
  { ...COL_PCT_MARGEM, header: "%Margem" },
  { id: "troca", header: "Usado na troca", celula: (l) => simNao(l.usadoNaTroca) },
  { id: "financiou", header: "Financiou", celula: (l) => simNao(l.financiou) },
  { id: "clienteNome", header: "Cliente", ordenar: "cliente", celula: (l) => <span className="whitespace-nowrap">{l.clienteNome}</span> },
  { id: "lojista", header: "Lojista", celula: (l) => simNao(l.lojista) },
  { ...COL_VENDEDOR, celula: (l) => <span className="whitespace-nowrap">{l.vendedorNome ?? ""}</span> },
  { id: "consignado", header: "Consignado", celula: (l) => simNao(l.consignado) },
  { id: "adm", header: "ADM", alinhar: "dir", celula: (l) => brlC(l.adm) },
  { id: "pctAdm", header: "%", headerLongo: "% ADM", alinhar: "dir", celula: (l) => pctVenda(l.adm, l.valorVenda) },
];

export const COLUNAS_POR_PRESET: Record<PresetColunas, Coluna[]> = {
  resumo: COLUNAS_RESUMO,
  custos: COLUNAS_CUSTOS,
  completo: COLUNAS_COMPLETO,
};

// ═══════════════════════════════════════════════════════════════════════════
// Linha expandida — "o resto do Excel"
// ═══════════════════════════════════════════════════════════════════════════

function LinhaConta({ rotulo, valor, pct, forte, negativo }: { rotulo: string; valor: ReactNode; pct?: string; forte?: boolean; negativo?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", forte && "font-semibold text-[var(--text-strong)]")}>
      <dt>{rotulo}</dt>
      <dd className={cn("tabular-nums", negativo && CLASSE_NEGATIVO)}>
        {valor}
        {pct ? <span className="ml-1.5 text-[11px] font-normal text-[var(--text-muted)]">{pct}</span> : null}
      </dd>
    </div>
  );
}

export function LinhaVendaExpandida({ l, codEmpresa }: { l: LinhaVendaMatriz; codEmpresa: number }) {
  const d = derivadosVenda(l);
  const venda = l.valorVenda;
  const pct = (v: number | null): string | undefined => (v == null || venda == null || venda <= 0 ? undefined : fmtFrac(v / venda));
  const origem = rotuloOrigemLinha(l, codEmpresa);
  const comprador = BADGE_COMPRADOR[classificarComprador(l)].titulo;
  const faltando = d.custosNaoLancados.length;
  const custoLinha = (campo: "despesaGeral" | "forplan" | "impostos" | "comissao" | "adm") => (
    <LinhaConta key={campo} rotulo={`(−) ${ROTULO_CUSTO[campo]}`} valor={naoLancado(l[campo])} pct={pct(l[campo])} />
  );
  return (
    <div className="grid gap-5 text-xs text-[var(--text-body)] md:grid-cols-3">
      <div className="space-y-1">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Veículo</h4>
        <p className="font-medium text-[var(--text-strong)]">{l.descricaoVeiculo}</p>
        <p>{[l.marca, l.cor, l.anoModelo].filter(Boolean).join(" · ")}</p>
        <p className="tabular-nums">
          {l.km != null ? `${formatInt(l.km)} km` : "km —"} · {l.diasEstoque != null ? `${formatInt(l.diasEstoque)} dias` : "dias —"}
        </p>
        <p>Placa {l.placa}</p>
        <p className="break-all">Chassi {l.chassi}</p>
        <p className="inline-flex items-center gap-1.5">
          <PontoOrigem origem={origem.origem} /> Origem: {l.lojaOrigemNome}
        </p>
      </div>
      <div>
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Conta do carro</h4>
        <dl className="mt-1 space-y-0.5">
          <LinhaConta rotulo="NF entrada" valor={formatBRLCents(l.nfEntrada)} />
          <LinhaConta rotulo="(−) Valoriza" valor={formatBRLCents(l.valoriza)} />
          <LinhaConta rotulo="= Custo real" valor={formatBRLCents(d.custoReal)} forte />
          <LinhaConta rotulo="FIPE" valor={l.valorFipe == null ? "não confirmada" : formatBRLCents(l.valorFipe)} />
          <LinhaConta rotulo="Venda" valor={formatBRLCents(venda)} pct={d.pctFipe != null ? `${fmtFrac(d.pctFipe)} FIPE` : undefined} />
          <LinhaConta rotulo="= Lucro bruto" valor={formatBRLCents(d.lucroBruto)} pct={pct(d.lucroBruto)} forte negativo={(d.lucroBruto ?? 0) < 0} />
          {(["despesaGeral", "forplan", "impostos", "comissao", "adm"] as const).map(custoLinha)}
          <LinhaConta rotulo="= Margem líquida" valor={formatBRLCents(d.margemLiquida)} pct={pct(d.margemLiquida)} forte negativo={(d.margemLiquida ?? 0) < 0} />
        </dl>
        {faltando > 0 && (
          <p className="mt-2 flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            {faltando} custo{faltando === 1 ? "" : "s"} não lançado{faltando === 1 ? "" : "s"} conta{faltando === 1 ? "" : "m"} como zero na margem, como no Excel.
          </p>
        )}
        {d.custoReal == null && <p className="mt-1 text-[11px] text-[var(--text-muted)]">Sem NF de entrada: sem custo real, a margem não é calculada.</p>}
        {l.consignado && <p className="mt-1 text-[11px] text-[var(--text-muted)]">Consignada: fora das margens do painel.</p>}
      </div>
      <div className="space-y-1">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Negócio</h4>
        <p>
          Cliente <span className="font-medium text-[var(--text-strong)]">{l.clienteNome || "—"}</span> ({comprador})
        </p>
        <p>Comprador recorrente (regra Excel): {l.lojista == null ? "sem CPF/CNPJ" : l.lojista ? "Sim" : "Não"}</p>
        <p>Vendedor {rotuloVendedor(chaveVendedor(l))}</p>
        <p>
          Financiou {l.financiou == null ? "—" : l.financiou ? "Sim" : "Não"} · Troca {l.usadoNaTroca ? "Sim" : "Não"}
        </p>
        <p>Consignado {l.consignado ? "Sim" : "Não"}</p>
        <p>Venda em {dataLonga(l.dataVenda)}</p>
        <p className="pt-1">
          <Link
            href={`/vendas/${encodeURIComponent(l.chassi)}`}
            className="font-medium text-[var(--brand-700)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)] dark:text-[var(--brand-300)]"
          >
            Abrir ficha da venda →
          </Link>
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tabela (≥ md) e cards (< md)
// ═══════════════════════════════════════════════════════════════════════════

const LIMITE_SEM_PAGINAR = 200;
const PASSO = 100;

/** Estável entre ordenações (a expansão acompanha o carro, não a posição). */
function idLinha(l: LinhaVendaMatriz, i: number): string {
  return l.chassi || l.placa ? `${l.chassi}|${l.placa}|${l.dataVenda?.getTime() ?? ""}` : `linha-${i}`;
}

export function TabelaVendasMatriz({
  linhas,
  totais,
  preset,
  ordenacao,
  onOrdenar,
  codEmpresa,
  caption,
  tooltipRodape,
}: {
  linhas: LinhaVendaMatriz[];
  totais: TotaisFiltro;
  preset: PresetColunas;
  ordenacao: Ordenacao;
  onOrdenar: (chave: ChaveOrdenacao) => void;
  codEmpresa: number;
  caption: string;
  tooltipRodape: string;
}) {
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [limite, setLimite] = useState(PASSO);
  const colunas = COLUNAS_POR_PRESET[preset];
  const completo = preset === "completo";
  const visiveis = linhas.length > LIMITE_SEM_PAGINAR ? linhas.slice(0, limite) : linhas;
  const ctx: Ctx = { codEmpresa };

  const alternar = (id: string) =>
    setAbertas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const classeTablet = (c: Coluna) => (!completo && preset === "resumo" && !c.tablet ? "hidden lg:table-cell" : "");
  const classeSticky = (c: Coluna) =>
    completo && c.sticky ? cn("sticky z-10 bg-inherit", c.sticky === "data" ? "left-0" : "left-14 shadow-[2px_0_0_var(--border-soft)]") : "";
  const alinhamento = (c: Coluna) => (c.alinhar === "dir" ? "text-right" : c.alinhar === "centro" ? "text-center" : "text-left");

  return (
    <>
      {/* ≥ md: tabela */}
      <div className="hidden overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums">
            <caption className="sr-only">{caption}</caption>
            <thead className="border-b border-[var(--border-soft)] bg-[var(--bg-muted)]">
              <tr>
                {colunas.map((c) => {
                  const ativo = c.ordenar != null && ordenacao.chave === c.ordenar;
                  const ariaSort = c.ordenar == null ? undefined : ativo ? (ordenacao.dir === "asc" ? "ascending" : "descending") : "none";
                  const Icone = !ativo ? ChevronsUpDown : ordenacao.dir === "asc" ? ChevronUp : ChevronDown;
                  return (
                    <th
                      key={c.id}
                      scope="col"
                      aria-sort={ariaSort}
                      className={cn(
                        "whitespace-nowrap bg-[var(--bg-muted)] px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-body)]",
                        alinhamento(c),
                        classeTablet(c),
                        classeSticky(c),
                      )}
                    >
                      {c.ordenar ? (
                        <button
                          type="button"
                          onClick={() => onOrdenar(c.ordenar as ChaveOrdenacao)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded uppercase hover:text-[var(--text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)]",
                            c.alinhar === "dir" && "flex-row-reverse",
                          )}
                        >
                          {c.header}
                          {c.headerLongo && <span className="sr-only"> ({c.headerLongo})</span>}
                          <Icone className={cn("h-3 w-3", !ativo && "opacity-40")} aria-hidden="true" />
                        </button>
                      ) : (
                        <>
                          <span aria-hidden={c.headerLongo ? true : undefined}>{c.header}</span>
                          {c.headerLongo && <span className="sr-only">{c.headerLongo}</span>}
                        </>
                      )}
                    </th>
                  );
                })}
                <th scope="col" className="w-8 bg-[var(--bg-muted)] px-1">
                  <span className="sr-only">Detalhes</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l, i) => {
                const id = idLinha(l, i);
                const aberta = abertas.has(id);
                const d = derivadosVenda(l);
                const idDetalhe = `detalhe-venda-${i}`;
                return (
                  <Fragment key={id}>
                    <tr className={cn("border-b border-[var(--border-soft)] bg-[var(--bg-surface)] hover:bg-[var(--bg-muted)]", aberta && "bg-[var(--bg-muted)]")}>
                      {colunas.map((c) => (
                        <td key={c.id} className={cn("px-2 py-1.5 align-middle", alinhamento(c), classeTablet(c), classeSticky(c))}>
                          {c.celula(l, d, ctx)}
                        </td>
                      ))}
                      <td className="px-1 text-center">
                        <button
                          type="button"
                          onClick={() => alternar(id)}
                          aria-expanded={aberta}
                          aria-controls={aberta ? idDetalhe : undefined}
                          aria-label={`${aberta ? "Ocultar" : "Ver"} detalhes da ${l.descricaoVeiculo.split(" ")[0] ?? "venda"} ${l.placa}`}
                          className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)]"
                        >
                          <ChevronDown className={cn("h-4 w-4 transition", aberta && "rotate-180")} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                    {aberta && (
                      <tr id={idDetalhe} className="border-b border-[var(--border-soft)] bg-[var(--bg-muted)]">
                        <td colSpan={colunas.length + 1} className="px-4 py-4">
                          <div className={cn(completo && "sticky left-4 max-w-5xl")}>
                            <LinhaVendaExpandida l={l} codEmpresa={codEmpresa} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-[var(--border-base)] bg-[var(--bg-muted)] text-[var(--text-strong)]">
              <tr>
                {colunas.map((c, i) => (
                  <td key={c.id} className={cn("px-2 py-2", alinhamento(c), classeTablet(c), classeSticky(c), "bg-[var(--bg-muted)]")}>
                    {i === 1 ? (
                      <Tooltip content={tooltipRodape} focavel={false}>
                        <span className="cursor-help">
                          {c.rodape?.(totais)}
                          <span className="sr-only"> {tooltipRodape}</span>
                        </span>
                      </Tooltip>
                    ) : (
                      c.rodape?.(totais)
                    )}
                  </td>
                ))}
                <td className="bg-[var(--bg-muted)]" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* < md: cards */}
      <ul className="space-y-2 md:hidden" aria-label={caption}>
        {visiveis.map((l, i) => (
          <li key={idLinha(l, i)}>
            <CardVendaMobile l={l} codEmpresa={codEmpresa} indice={i} />
          </li>
        ))}
        <li className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-muted)] p-3 text-xs tabular-nums text-[var(--text-body)]">
          <p className="font-semibold text-[var(--text-strong)]">Totais do filtro (sem consignadas)</p>
          <p className="mt-1">
            {formatInt(totais.qtdSemConsig)} vendas · Venda {formatBRL(totais.venda)} · Margem{" "}
            <span className={cn((totais.margem ?? 0) < 0 && CLASSE_NEGATIVO)}>{formatBRL(totais.margem)}</span> ({fmtFrac(totais.pctMargem)})
          </p>
          <p className="mt-1 text-[var(--text-muted)]">{tooltipRodape}</p>
        </li>
      </ul>

      {linhas.length > LIMITE_SEM_PAGINAR && limite < linhas.length && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setLimite((n) => n + PASSO)}
            className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-body)] hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)]"
          >
            Mostrar mais {formatInt(Math.min(PASSO, linhas.length - limite))}
          </button>
        </div>
      )}
    </>
  );
}

export function CardVendaMobile({ l, codEmpresa, indice }: { l: LinhaVendaMatriz; codEmpresa: number; indice: number }) {
  const [aberto, setAberto] = useState(false);
  const d = derivadosVenda(l);
  const o = rotuloOrigemLinha(l, codEmpresa);
  const idDetalhe = `card-venda-${indice}`;
  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] text-xs text-[var(--text-body)] shadow-[var(--shadow-sm)]">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-controls={aberto ? idDetalhe : undefined}
        className="w-full space-y-1 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-700)]"
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate font-medium text-[var(--text-strong)]">
            <span className="tabular-nums">{dataCurta(l.dataVenda)}</span> · {l.descricaoVeiculo}
          </span>
          <span className="shrink-0 tabular-nums text-[var(--text-muted)]">{l.anoModelo}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-[var(--text-muted)]">
          {l.placa} · <PontoOrigem origem={o.origem} /> {o.texto} · <BadgeComprador l={l} /> · {nomeCurto(rotuloVendedor(chaveVendedor(l)))}
        </span>
        <span className="flex justify-between gap-2 tabular-nums">
          <span>Venda {formatBRL(l.valorVenda)}</span>
          <span>
            Margem <Margem l={l} d={d} />
          </span>
        </span>
        <span className="flex justify-between gap-2 tabular-nums text-[var(--text-muted)]">
          <span>
            {d.pctFipe != null ? `${fmtFrac(d.pctFipe)} FIPE` : "FIPE —"} · {l.diasEstoque != null ? `${formatInt(l.diasEstoque)} dias` : "dias —"}
          </span>
          <span>{l.consignado ? "—" : fmtFrac(d.pctMargem)}</span>
        </span>
        <span className="flex items-center justify-between">
          <Observacoes l={l} d={d} />
          <ChevronDown className={cn("h-4 w-4 text-[var(--text-muted)] transition", aberto && "rotate-180")} aria-hidden="true" />
          <span className="sr-only">{aberto ? "Ocultar" : "Ver"} detalhes</span>
        </span>
      </button>
      {aberto && (
        <div id={idDetalhe} className="border-t border-[var(--border-soft)] p-3">
          <LinhaVendaExpandida l={l} codEmpresa={codEmpresa} />
        </div>
      )}
    </div>
  );
}
