"use client";

import { useCallback, useState } from "react";
import { RefreshCw, CheckCircle2, AlertCircle, Loader2, X } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import {
  runFipeBatch,
  batchIdadeHoras,
  clearBatch,
  contarFipeConfirmada,
  type BatchProgress,
} from "@/lib/fipe/batch";
import { clearFipeLocalCache } from "@/lib/fipe/service";
import { useFipeBatch } from "@/lib/fipe/useFipeBatch";
import { formatInt, cn } from "@/lib/utils";

/**
 * Banner pra disparar o batch FIPE e ver o status.
 * Mostra: data do último batch, # de carros com match, ação pra atualizar.
 */
export function FipeBatchRunner() {
  const { veiculos, isHydrated } = useInventory();
  const batch = useFipeBatch();
  const [rodando, setRodando] = useState(false);
  const [progresso, setProgresso] = useState<BatchProgress | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  /**
   * Roda o batch. `forcarRebusca` descarta o cache local de chamadas da API antes.
   *
   * O caminho normal NÃO limpa mais o cache. Ele limpava porque o esquema antigo
   * tinha TTL de 30 dias e chave SEM referência: reprocessar devolvia as mesmas
   * listas e os mesmos matches errados. Com as chaves por referência o valor de
   * um mês fechado é imutável — re-buscar devolve número idêntico, e limpar só
   * custaria milhares de requisições contra uma API gratuita (com risco de 429
   * no meio da rodada, que vira `erro-api` em dezenas de chassis). Na virada de
   * mês as chaves novas dão miss sozinhas.
   */
  const rodar = useCallback(async (forcarRebusca = false) => {
    setRodando(true);
    setErro(null);
    setProgresso(null);
    try {
      if (forcarRebusca) clearFipeLocalCache();
      const r = await runFipeBatch(veiculos, (p) => setProgresso(p));
      // Persistência falhou em silêncio até aqui: a UI dizia "Pronto" com zero
      // linha gravada. Agora vira erro visível.
      if (r.persistenciaErro) setErro(r.persistenciaErro);
      // batch atualiza automaticamente via useFipeBatch hook
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setRodando(false);
    }
  }, [veiculos]);

  /**
   * Escape hatch explícito: descarta o cache local de chamadas da API e re-busca tudo.
   *
   * Precisa existir como ação própria porque o cache por referência não expira:
   * uma resposta corrompida da API gravada sob uma chave de mês fechado ficaria
   * cacheada até a virada do mês. Antes essa saída existia por acidente, embutida
   * no "Atualizar" — o que fazia TODA rodada pagar o custo de uma re-busca total.
   */
  const forcarRebusca = useCallback(() => {
    if (
      !confirm(
        "Descartar o cache local da FIPE e buscar tudo de novo?\n\n" +
          "Use só se desconfiar que algum preço veio corrompido da API. " +
          "A busca refaz marcas, modelos, anos e valores do zero e leva alguns minutos.",
      )
    )
      return;
    void rodar(true);
  }, [rodar]);

  const limpar = useCallback(() => {
    // `clearBatch` limpa a tabela `fipe_batch` e o cache em memória — NÃO o
    // cache de chamadas da API no localStorage. Desde que as chaves passaram a
    // incluir a referência FIPE, o valor de um mês fechado é imutável: re-buscar
    // devolveria exatamente o mesmo número, ao custo de milhares de requisições.
    if (!confirm("Limpar os preços FIPE salvos? Você vai precisar rodar de novo.")) return;
    clearBatch();
    setProgresso(null);
  }, []);

  if (!isHydrated || veiculos.length === 0) return null;

  const idadeHoras = batchIdadeHoras();
  const idadeLabel =
    idadeHoras == null
      ? null
      : idadeHoras < 1
        ? "agora há pouco"
        : idadeHoras < 24
          ? `há ${Math.floor(idadeHoras)}h`
          : `há ${Math.floor(idadeHoras / 24)}d`;

  // Cobertura conta só match CONFIRMADO. Contar `Object.keys(batch.items)` fazia
  // o painel exibir 100% mesmo quando metade das linhas era match não confiável.
  const totalComFipe = contarFipeConfirmada(batch);
  const totalNaoConfirmados = batch ? Object.keys(batch.items).length - totalComFipe : 0;

  // Banner inicial (sem batch ou batch antigo)
  if (!batch && !rodando) {
    return (
      <div className="rounded-xl border-2 border-dashed border-[var(--brand-300)] bg-[var(--brand-50)] p-4 shadow-[var(--shadow-sm)] dark:bg-[var(--brand-950)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[var(--text-strong)]">
              💰 Buscar preços FIPE do estoque
            </h3>
            <p className="mt-0.5 text-xs text-[var(--text-body)]">
              Vamos comparar cada um dos {formatInt(veiculos.length)} carros com a FIPE atual — leva ~2 minutos.
            </p>
          </div>
          <button
            onClick={() => rodar()}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[var(--brand-800)]"
          >
            <RefreshCw className="h-4 w-4" /> Buscar FIPE
          </button>
        </div>
      </div>
    );
  }

  // Em execução
  if (rodando && progresso) {
    const pct = progresso.total > 0 ? (progresso.atual / progresso.total) * 100 : 0;
    return (
      <div className="rounded-xl border border-[var(--brand-300)] bg-[var(--brand-50)] p-4 dark:bg-[var(--brand-950)]">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--brand-700)] dark:text-[var(--brand-300)]" />
          Buscando FIPE...
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--bg-muted)]">
          <div className="h-full bg-[var(--brand-700)] transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-body)]">
          <span>{progresso.mensagem}</span>
          <span className="tabular-nums">
            {progresso.atual}/{progresso.total} grupos · {progresso.matchesAteAgora} matches
            {progresso.errosAteAgora > 0 && ` · ${progresso.errosAteAgora} sem FIPE`}
          </span>
        </div>
      </div>
    );
  }

  // Erro ANTES do histórico: quando a persistência falha o cache em memória
  // fica populado, então o bloco `if (batch)` capturava o render e o erro
  // nunca aparecia.
  if (erro) {
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
        <div className="flex items-center gap-2 text-sm font-semibold text-red-900 dark:text-red-200">
          <AlertCircle className="h-4 w-4" /> Erro na busca FIPE
        </div>
        <p className="mt-1 text-xs text-red-700 dark:text-red-300">{erro}</p>
        <button
          onClick={() => rodar()}
          className={cn(
            "mt-2 inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700",
          )}
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  // Concluído ou histórico
  if (batch) {
    // Após reload, `loadBatchFromSupabase` gera um erro por item não confirmado,
    // então somar os dois contadores exibia o dobro do problema real. Os erros
    // que interessam aqui são os que NÃO produziram linha nenhuma (marca/modelo/
    // ano não encontrados, falha de API, preço implausível rejeitado); os itens
    // gravados porém não confiáveis já são contados por `totalNaoConfirmados`.
    const erros = batch.erros.filter((e) => !batch.items[e.chassi]).length;
    // Conjunto pequeno e acionável: FIPE muito acima do custo pode ser compra
    // bem-feita ou match errado, e nenhum sinal automático decide. Vale destaque
    // próprio porque um clique no drawer resolve cada um.
    const emRevisao = batch.erros.filter((e) => e.motivo === "revisao-recomendada").length;
    const cobertura = batch.totalVeiculos > 0 ? (totalComFipe / batch.totalVeiculos) * 100 : 0;
    return (
      <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-sm)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-strong)]">
                FIPE buscada · {formatInt(totalComFipe)} de {formatInt(batch.totalVeiculos)} carros ({cobertura.toFixed(0)}%)
              </h3>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Última busca: {idadeLabel} · {formatInt(batch.totalGrupos)} grupos consultados
                {erros > 0 && <span className="text-amber-700"> · {erros} sem match</span>}
                {totalNaoConfirmados > 0 && (
                  <span className="text-amber-700">
                    {" "}
                    · {formatInt(totalNaoConfirmados)} não confirmada{totalNaoConfirmados === 1 ? "" : "s"}
                  </span>
                )}
                {emRevisao > 0 && (
                  <span className="text-amber-700">
                    {" "}
                    · {formatInt(emRevisao)} aguardando conferência (FIPE bem acima do custo)
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => rodar()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-body)] transition hover:bg-[var(--bg-muted)]"
            >
              <RefreshCw className="h-3 w-3" /> Atualizar
            </button>
            <button
              onClick={forcarRebusca}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-[var(--text-subtle)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--text-body)]"
              title="Descarta o cache local da FIPE e busca tudo de novo (leva alguns minutos)"
            >
              Forçar re-busca
            </button>
            <button
              onClick={limpar}
              className="inline-flex items-center gap-1 rounded-lg p-1.5 text-xs text-[var(--text-subtle)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--text-body)]"
              title="Limpar cache"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
