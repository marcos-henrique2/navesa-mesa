"use client";

import { useEffect, useMemo, useState } from "react";
import { Diamond, Loader2, AlertCircle, RefreshCw, CheckCircle2, Sparkles } from "lucide-react";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { FipeMarca, FipeModelo, FipeAno, FipeValor, FipeMatch } from "@/lib/fipe/types";
import { getMarcas, getModelos, getAnos, getValor, parseFipeValor } from "@/lib/fipe/service";
import { findMarca, findModelos, findAno } from "@/lib/fipe/matcher";
import { resolveMatch, saveMatch, forgetMatch, forgetModelMatch, countSimilarVeiculos, type MatchOrigem } from "@/lib/store/fipeMatches";
import { useInventory } from "@/lib/store/inventory";
import { formatBRL, cn } from "@/lib/utils";

type Props = {
  veiculo: VeiculoParsed;
  onValorChange?: (valor: number | null) => void;
};

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "needs-choice"; marca: FipeMarca; modelos: FipeModelo[]; sugeridos: FipeModelo[]; ano: number | null }
  | { kind: "needs-marca-choice"; marcas: FipeMarca[] }
  | { kind: "needs-ano-choice"; marca: FipeMarca; modelo: FipeModelo; anos: FipeAno[] }
  | { kind: "ok"; match: FipeMatch; valor: FipeValor; origem: Exclude<MatchOrigem, null> }
  | { kind: "error"; message: string };

export function FipeBox({ veiculo, onValorChange }: Props) {
  const { veiculos } = useInventory();
  const similares = useMemo(() => countSimilarVeiculos(veiculo, veiculos), [veiculo, veiculos]);
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    void start(true);
  }, [veiculo.chassi]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start(useCachedMatch: boolean) {
    setState({ kind: "loading" });

    if (useCachedMatch) {
      const resolved = resolveMatch(veiculo);
      if (resolved) {
        try {
          const valor = await getValor(resolved.match.marcaCod, resolved.match.modeloCod, resolved.match.anoCod);
          setState({ kind: "ok", match: resolved.match, valor, origem: resolved.origem });
          onValorChange?.(parseFipeValor(valor.Valor));
          return;
        } catch (err) {
          console.warn("Match salvo falhou, refazendo:", err);
        }
      }
    }

    try {
      const marcas = await getMarcas();
      const marca = veiculo.marca ? findMarca(veiculo.marca, marcas) : null;

      if (!marca) {
        setState({ kind: "needs-marca-choice", marcas });
        return;
      }

      await chooseMarca(marca);
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Erro desconhecido" });
    }
  }

  async function chooseMarca(marca: FipeMarca) {
    setState({ kind: "loading" });
    try {
      const modelos = await getModelos(marca.codigo);
      const sugeridos = findModelos(veiculo.modelo, modelos).map((m) => m.modelo);

      if (sugeridos.length === 0) {
        setState({ kind: "needs-choice", marca, modelos, sugeridos: [], ano: veiculo.ano_modelo });
        return;
      }

      if (sugeridos.length === 1) {
        await chooseModelo(marca, sugeridos[0]);
        return;
      }

      setState({ kind: "needs-choice", marca, modelos, sugeridos, ano: veiculo.ano_modelo });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Erro desconhecido" });
    }
  }

  async function chooseModelo(marca: FipeMarca, modelo: FipeModelo) {
    setState({ kind: "loading" });
    try {
      const anos = await getAnos(marca.codigo, modelo.codigo);
      const matched = findAno(veiculo.ano_modelo, veiculo.combustivel, anos);
      if (matched) {
        await chooseAno(marca, modelo, matched);
      } else {
        setState({ kind: "needs-ano-choice", marca, modelo, anos });
      }
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Erro desconhecido" });
    }
  }

  async function chooseAno(marca: FipeMarca, modelo: FipeModelo, ano: FipeAno) {
    setState({ kind: "loading" });
    try {
      const valor = await getValor(marca.codigo, modelo.codigo, ano.codigo);
      const match: FipeMatch = {
        marcaCod: marca.codigo,
        marcaNome: marca.nome,
        modeloCod: modelo.codigo,
        modeloNome: modelo.nome,
        anoCod: ano.codigo,
        anoNome: ano.nome,
      };
      saveMatch(veiculo, match);
      setState({ kind: "ok", match, valor, origem: "manual-chassi" });
      onValorChange?.(parseFipeValor(valor.Valor));
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Erro desconhecido" });
    }
  }

  function refazer(mode: "este" | "todos-similares") {
    if (mode === "todos-similares") forgetModelMatch(veiculo);
    forgetMatch(veiculo);
    start(false);
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold">
          <Diamond className="h-4 w-4 text-blue-600" />
          FIPE em tempo real
        </h3>
        {state.kind === "ok" && (
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => refazer("este")}
              className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-900"
              title="Refazer match só deste carro"
            >
              <RefreshCw className="h-3 w-3" /> Refazer
            </button>
            {state.origem === "aprendido-modelo" && similares > 0 && (
              <button
                onClick={() => refazer("todos-similares")}
                className="inline-flex items-center gap-1 text-amber-600 hover:text-amber-800"
                title={`Esquece a escolha de modelo e refaz para ${similares + 1} carros`}
              >
                Refazer p/ todos ({similares + 1})
              </button>
            )}
          </div>
        )}
      </div>

      {state.kind === "loading" && (
        <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Consultando FIPE…
        </p>
      )}

      {state.kind === "error" && (
        <div className="mt-4 flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <div>
            <p>{state.message}</p>
            <button onClick={() => start(false)} className="mt-1 underline">Tentar novamente</button>
          </div>
        </div>
      )}

      {state.kind === "needs-marca-choice" && (
        <ChoiceList
          title={`Não consegui mapear a marca "${veiculo.marca}" automaticamente. Escolha:`}
          items={state.marcas.map((m) => ({ label: m.nome, onClick: () => chooseMarca(m) }))}
        />
      )}

      {state.kind === "needs-choice" && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-zinc-500">
            Modelo NBS: <span className="font-mono">{veiculo.modelo}</span>
            {state.sugeridos.length === 0 && <span className="ml-2 text-amber-600">— sem sugestão automática, escolha abaixo:</span>}
          </p>
          {state.sugeridos.length > 0 && (
            <ChoiceList
              title="Sugestões mais prováveis:"
              items={state.sugeridos.map((m) => ({ label: m.nome, onClick: () => chooseModelo(state.marca, m), highlight: true }))}
            />
          )}
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
              {state.sugeridos.length > 0 ? "Nenhuma serve? Ver todos os " : "Ver os "}
              {state.modelos.length} modelos da marca {state.marca.nome}
            </summary>
            <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
              {state.modelos.map((m) => (
                <button
                  key={m.codigo}
                  onClick={() => chooseModelo(state.marca, m)}
                  className="block w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {m.nome}
                </button>
              ))}
            </div>
          </details>
        </div>
      )}

      {state.kind === "needs-ano-choice" && (
        <ChoiceList
          title={`Modelo "${state.modelo.nome}" — escolha o ano/combustível:`}
          items={state.anos.map((a) => ({ label: a.nome, onClick: () => chooseAno(state.marca, state.modelo, a) }))}
        />
      )}

      {state.kind === "ok" && (
        <div className="mt-4 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-3xl font-bold tabular-nums text-slate-900">{state.valor.Valor.replace("R$", "R$ ")}</p>
            <p className="text-xs text-slate-500">Tabela: {state.valor.MesReferencia}</p>
          </div>
          <div className="rounded-md bg-slate-50 p-3 text-xs">
            <p className="flex items-center gap-1.5 font-medium text-slate-900"><CheckCircle2 className="h-3 w-3 text-emerald-600" /> {state.match.marcaNome} · {state.match.modeloNome}</p>
            <p className="mt-1 ml-5 text-slate-500">{state.match.anoNome} · FIPE {state.valor.CodigoFipe}</p>
            {state.origem === "aprendido-modelo" && (
              <p className="mt-2 ml-5 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                <Sparkles className="h-3 w-3" /> Match aprendido de outro carro deste modelo
                {similares > 0 && <span className="text-amber-700">· aplicado a {similares + 1} carros</span>}
              </p>
            )}
          </div>

          <ComparacaoPreco precoFipe={parseFipeValor(state.valor.Valor)} precoVenda={veiculo.preco_venda} />
        </div>
      )}
    </div>
  );
}

function ChoiceList({ title, items }: { title: string; items: { label: string; onClick: () => void; highlight?: boolean }[] }) {
  return (
    <div className="mt-3">
      <p className="text-xs text-zinc-600 dark:text-zinc-400">{title}</p>
      <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
        {items.map((item, i) => (
          <button
            key={i}
            onClick={item.onClick}
            className={cn(
              "block w-full rounded-md border px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800",
              item.highlight ? "border-blue-300 bg-blue-50/40 dark:border-blue-800 dark:bg-blue-950/20" : "border-zinc-200 dark:border-zinc-800",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ComparacaoPreco({ precoFipe, precoVenda }: { precoFipe: number; precoVenda: number | null }) {
  if (!precoVenda) return null;
  const diff = precoVenda - precoFipe;
  const pct = (diff / precoFipe) * 100;
  const isAbove = diff > 0;
  return (
    <div className={cn(
      "rounded-md p-3 text-xs",
      isAbove ? "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" : "bg-green-50 text-green-900 dark:bg-green-950/30 dark:text-green-200",
    )}>
      Seu preço {isAbove ? "está acima" : "está abaixo"} da FIPE: {formatBRL(Math.abs(diff))} ({pct >= 0 ? "+" : ""}{pct.toFixed(1)}%)
    </div>
  );
}
