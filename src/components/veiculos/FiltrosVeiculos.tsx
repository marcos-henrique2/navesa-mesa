"use client";

import { SlidersHorizontal, Search, FilterX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Classe } from "@/lib/pricing/classificacao";
import type { StatusCautelar } from "@/lib/inventory/cautelar";
import type { LojaInfo } from "@/lib/store/inventory";

type FiltroClasseValor = "all" | Classe | "showroom" | "repasse";
type FiltroFipeValor = "all" | "acima" | "abaixo" | "sem";
type FiltroCautelarValor = "all" | StatusCautelar | "sem";
type FiltroFlagValor = "all" | "promocao" | "brinde" | "qualquer";
type FiltroRepasseValor = "all" | "sim" | "nao";

type SelectOption = [string, string];

type FiltrosVeiculosProps = {
  filtroLoja: string;
  setFiltroLoja: (v: string) => void;
  lojasCods: number[];
  lojas: Record<number, LojaInfo>;
  
  filtroMarca: string;
  setFiltroMarca: (v: string) => void;
  marcas: string[];
  
  filtroSituacao: string;
  setFiltroSituacao: (v: string) => void;
  situacoes: string[];

  avancadoOpen: boolean;
  setAvancadoOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  filtrosAvancadosAtivos: number;

  search: string;
  setSearch: (v: string) => void;

  filtroCor: string;
  setFiltroCor: (v: string) => void;
  cores: string[];

  filtroComb: string;
  setFiltroComb: (v: string) => void;
  combs: string[];

  filtroPatio: string;
  setFiltroPatio: (v: string) => void;
  patios: string[];

  filtroClasse: "all" | Classe | "showroom" | "repasse";
  setFiltroClasse: (v: "all" | Classe | "showroom" | "repasse") => void;

  filtroFipe: "all" | "acima" | "abaixo" | "sem";
  setFiltroFipe: (v: "all" | "acima" | "abaixo" | "sem") => void;

  filtroCautelar: "all" | StatusCautelar | "sem";
  setFiltroCautelar: (v: "all" | StatusCautelar | "sem") => void;

  filtroFlag: FiltroFlagValor;
  setFiltroFlag: (v: FiltroFlagValor) => void;

  filtroRepasse: FiltroRepasseValor;
  setFiltroRepasse: (v: FiltroRepasseValor) => void;

  idadeMin: string;
  setIdadeMin: (v: string) => void;
  idadeMax: string;
  setIdadeMax: (v: string) => void;

  margemMin: string;
  setMargemMin: (v: string) => void;
  margemMax: string;
  setMargemMax: (v: string) => void;

  anoMin: string;
  setAnoMin: (v: string) => void;
  anoMax: string;
  setAnoMax: (v: string) => void;

  kmMin: string;
  setKmMin: (v: string) => void;
  kmMax: string;
  setKmMax: (v: string) => void;

  precoMin: string;
  setPrecoMin: (v: string) => void;
  precoMax: string;
  setPrecoMax: (v: string) => void;

  diasMin: string;
  setDiasMin: (v: string) => void;
  diasMax: string;
  setDiasMax: (v: string) => void;

  filtrosAtivos: number;
  onLimparFiltros: () => void;
};

export function FiltrosVeiculos(props: FiltrosVeiculosProps) {
  const {
    filtroLoja, setFiltroLoja, lojasCods, lojas,
    filtroMarca, setFiltroMarca, marcas,
    filtroSituacao, setFiltroSituacao, situacoes,
    avancadoOpen, setAvancadoOpen, filtrosAvancadosAtivos,
    search, setSearch,
    filtroCor, setFiltroCor, cores,
    filtroComb, setFiltroComb, combs,
    filtroPatio, setFiltroPatio, patios,
    filtroClasse, setFiltroClasse,
    filtroFipe, setFiltroFipe,
    filtroCautelar, setFiltroCautelar,
    filtroFlag, setFiltroFlag,
    filtroRepasse, setFiltroRepasse,
    idadeMin, setIdadeMin, idadeMax, setIdadeMax,
    margemMin, setMargemMin, margemMax, setMargemMax,
    anoMin, setAnoMin, anoMax, setAnoMax,
    kmMin, setKmMin, kmMax, setKmMax,
    precoMin, setPrecoMin, precoMax, setPrecoMax,
    diasMin, setDiasMin, diasMax, setDiasMax,
    filtrosAtivos, onLimparFiltros,
  } = props;
  const temFiltro = filtrosAtivos > 0;

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
      {/* Essenciais: sempre visíveis */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          label="Loja"
          value={filtroLoja}
          onChange={setFiltroLoja}
          options={[
            ["all", "Todas"],
            ...lojasCods.map((l) => [String(l), lojas[l]?.nome?.trim() || `Loja ${l}`] as SelectOption)
          ]}
        />
        <Select
          label="Marca"
          value={filtroMarca}
          onChange={setFiltroMarca}
          options={[
            ["all", "Todas"],
            ...marcas.map((m) => [m, m] as SelectOption)
          ]}
        />
        <Select
          label="Situação"
          value={filtroSituacao}
          onChange={setFiltroSituacao}
          options={[
            ["all", "Todas"],
            ...situacoes.map((s) => [s, s] as SelectOption)
          ]}
        />

        <button
          type="button"
          onClick={() => setAvancadoOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition",
            filtrosAvancadosAtivos > 0
              ? "border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"
              : "border-[var(--border-base)] bg-[var(--bg-surface)] text-[var(--text-body)] hover:bg-[var(--bg-muted)]",
          )}
          aria-expanded={avancadoOpen}
          aria-controls="filtros-avancados-veiculos"
        >
          <SlidersHorizontal className="h-3 w-3" />
          {avancadoOpen ? "▴ Ocultar" : "▾ Mais"} filtros
          {filtrosAvancadosAtivos > 0 && (
            <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
              +{filtrosAvancadosAtivos}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onLimparFiltros}
          disabled={!temFiltro}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition",
            temFiltro
              ? "border-red-300 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
              : "cursor-not-allowed border-[var(--border-soft)] bg-[var(--bg-surface)] text-[var(--text-subtle)] opacity-60",
          )}
          title={temFiltro ? `Limpar ${filtrosAtivos} filtro${filtrosAtivos === 1 ? "" : "s"} ativo${filtrosAtivos === 1 ? "" : "s"}` : "Nenhum filtro ativo"}
          aria-label="Limpar todos os filtros"
        >
          <FilterX className="h-3 w-3" />
          Limpar filtros
          {temFiltro && (
            <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {filtrosAtivos}
            </span>
          )}
        </button>

        <div className="relative ml-auto">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-[var(--text-subtle)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Placa, chassi, modelo, marca…"
            className="w-64 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] pl-8 pr-3 py-1.5 text-sm"
          />
        </div>
      </div>

      {/* Dica de bulk: sempre visível pra Marcos descobrir o checkbox */}
      <p className="text-[11px] text-[var(--text-muted)]">
        💡 Marque a caixa de seleção na 1ª coluna pra escolher vários carros e subir tudo de uma vez pra repasse.
      </p>

      {/* Avançados: colapsáveis */}
      <div
        id="filtros-avancados-veiculos"
        inert={!avancadoOpen ? true : undefined}
        aria-hidden={!avancadoOpen}
        className={cn(
          "grid overflow-hidden transition-all duration-200 ease-out",
          avancadoOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0">
          <div className="space-y-4 rounded-md bg-[var(--bg-muted)] p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Select
                label="Cor"
                value={filtroCor}
                onChange={setFiltroCor}
                options={[
                  ["all", "Todas"],
                  ...cores.map((c) => [c, c] as SelectOption)
                ]}
              />
              <Select
                label="Comb"
                value={filtroComb}
                onChange={setFiltroComb}
                options={[
                  ["all", "Todos"],
                  ...combs.map((c) => [c, c] as SelectOption)
                ]}
              />
              <Select
                label="Pátio"
                value={filtroPatio}
                onChange={setFiltroPatio}
                options={[
                  ["all", "Todos"],
                  ...patios.map((p) => [p, p] as SelectOption)
                ]}
              />
              <Select
                label="Classe/Canal"
                value={filtroClasse}
                onChange={(v) => setFiltroClasse(v as FiltroClasseValor)}
                options={[
                  ["all", "Todas"],
                  ["A", "Classe A"],
                  ["B", "Classe B"],
                  ["C", "Classe C"],
                  ["D", "Classe D"],
                  ["showroom", "Show Room"],
                  ["repasse", "Repasse"],
                ]}
              />
              <Select
                label="vs FIPE"
                value={filtroFipe}
                onChange={(v) => setFiltroFipe(v as FiltroFipeValor)}
                options={[
                  ["all", "Todos"],
                  ["acima", "Acima da FIPE"],
                  ["abaixo", "Abaixo da FIPE"],
                  ["sem", "Sem match FIPE"],
                ]}
              />
              <Select
                label="Cautelar"
                value={filtroCautelar}
                onChange={(v) => setFiltroCautelar(v as FiltroCautelarValor)}
                options={[
                  ["all", "Todos"],
                  ["aprovado", "Aprovada"],
                  ["restricao", "Com restrição"],
                  ["reprovado", "Reprovada"],
                  ["sem", "Sem cautelar"],
                ]}
              />
              <Select
                label="Marcação"
                value={filtroFlag}
                onChange={(v) => setFiltroFlag(v as FiltroFlagValor)}
                options={[
                  ["all", "Todas"],
                  ["promocao", "Em promoção"],
                  ["brinde", "Com brinde"],
                  ["qualquer", "Qualquer marcação"],
                ]}
              />
              <Select
                label="Pra repasse"
                value={filtroRepasse}
                onChange={(v) => setFiltroRepasse(v as FiltroRepasseValor)}
                options={[
                  ["all", "Todos"],
                  ["sim", "Sim — bate critérios"],
                  ["nao", "Não — fora dos critérios"],
                ]}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              <InputRange label="Ano modelo" valMin={anoMin} setMin={setAnoMin} valMax={anoMax} setMax={setAnoMax} placeholder="Ex: 2020" />
              <InputRange label="Idade (anos)" valMin={idadeMin} setMin={setIdadeMin} valMax={idadeMax} setMax={setIdadeMax} placeholder="Ex: 5" />
              <InputRange label="KM" valMin={kmMin} setMin={setKmMin} valMax={kmMax} setMax={setKmMax} placeholder="Ex: 50000" />
              <InputRange label="Preço venda (R$)" valMin={precoMin} setMin={setPrecoMin} valMax={precoMax} setMax={setPrecoMax} placeholder="Ex: 85000" />
              <InputRange label="Margem teórica (%)" valMin={margemMin} setMin={setMargemMin} valMax={margemMax} setMax={setMargemMax} placeholder="Ex: 5" />
              <InputRange label="Dias pátio" valMin={diasMin} setMin={setDiasMin} valMax={diasMax} setMax={setDiasMax} placeholder="Ex: 30" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: SelectOption[] }) {
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="text-[var(--text-muted)]">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-56 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--brand-600)]"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}

function InputRange({
  label,
  valMin,
  setMin,
  valMax,
  setMax,
  placeholder,
}: {
  label: string;
  valMin: string;
  setMin: (v: string) => void;
  valMax: string;
  setMax: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-[var(--text-body)]">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={valMin}
          onChange={(e) => setMin(e.target.value)}
          placeholder={placeholder ? `Min ${placeholder}` : "Mín"}
          className="w-full rounded border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-[var(--brand-600)]"
        />
        <span className="text-[var(--text-muted)] text-xs">a</span>
        <input
          type="text"
          value={valMax}
          onChange={(e) => setMax(e.target.value)}
          placeholder={placeholder ? `Max ${placeholder}` : "Máx"}
          className="w-full rounded border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-[var(--brand-600)]"
        />
      </div>
    </div>
  );
}
