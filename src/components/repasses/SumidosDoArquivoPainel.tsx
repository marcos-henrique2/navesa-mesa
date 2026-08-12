"use client";
/* eslint-disable react-hooks/set-state-in-effect --
 * Carga inicial async via Supabase. Mesmo padrão do RepassesLista/AppShell: o
 * effect dispara o fetch e o estado é setado quando a Promise resolve.
 * A regra é conservadora demais pra esse uso.
 */

/**
 * Painel "saíram do Auto Avaliar" da tela de conferência do sync por arquivo
 * (Story 2.2 / Fatia 3b).
 *
 * ┌─ O PROBLEMA ───────────────────────────────────────────────────────────────┐
 * │ O relatório é uma foto do momento. O sync da Fatia 3a só afirma sobre as    │
 * │ linhas que o arquivo TEM; quem sumiu era informação disponível indo pro     │
 * │ lixo, e o Marcos tinha que caçar carro por carro na lista de repasses.      │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ ORDEM DAS AÇÕES É REGRA DE NEGÓCIO, não estética. "Marcar como vendido" vem
 * PRIMEIRO e é a ação primária porque `custo_real = valor_compra_repasse +
 * Σ repasse_gastos`, e o KPI "Margem real" do /repasses hoje é parcial por falta
 * exatamente desses dados. Remover um carro que VENDEU joga fora o dado que
 * fecharia a métrica. Remover é a saída pra carro que saiu de anúncio SEM ter
 * vendido.
 *
 * ⚠️ Este painel NÃO conclui nada. Sumir do relatório costuma significar venda,
 * mas também acontece com anúncio pausado, transferência de loja e download
 * incompleto. A classificação (`presenca-arquivo-auto-avaliar.ts`) é de
 * PRESENÇA; o desfecho é decisão do Marcos.
 *
 * A regra do universo de placas — comparar contra TODAS as linhas do arquivo, de
 * qualquer loja — mora no módulo puro e é o que impede acusar de "saiu do
 * anúncio" um carro que só mudou de loja. Aqui só se renderiza o resultado.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  PackageX,
  RotateCcw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  diffPresencaNoArquivo,
  LIMITE_SUSPEITA_ARQUIVO_PARCIAL,
  pareceArquivoParcial,
  type RepasseRefPresenca,
} from "@/lib/repasses/presenca-arquivo-auto-avaliar";
import {
  deleteRepasses,
  listGastosPorRepasse,
  listRepassesParaPresencaArquivo,
  marcarComoVendido,
  type MarcarVendidoInput,
} from "@/lib/repasses/queries";
import { calcularCustoReal } from "@/lib/repasses/margem-repasse";
import { useChassisEmRepasse } from "@/lib/repasses/useChassisEmRepasse";
import { STATUS_LABEL } from "@/lib/repasses/types";
import { MarcarVendidoModal } from "./MarcarVendidoModal";
import { showErrorToast, showInfoToast, showSuccessToast } from "@/components/ui/Toast";
import { cn, formatBRL, formatInt } from "@/lib/utils";

/**
 * `STATUS_LABEL` alargado pra `string`: o status vem de um select estreito e não
 * é estreitado pra `RepasseStatus`. Widening por atribuição, sem `as`.
 */
const ROTULO_STATUS: Record<string, string> = STATUS_LABEL;

export type SumidosDoArquivoPainelProps = {
  /**
   * Universo de comparação: TODAS as placas normalizadas do arquivo, de QUALQUER
   * loja. Vem de `placasVistasNoArquivo(parse.linhas, parse.outra_loja)`.
   * Passar só as placas da loja alvo acusa de "saiu do anúncio" carro que apenas
   * mudou de loja — é o bug que este fluxo inteiro existe pra não cometer.
   */
  placasNoArquivo: ReadonlySet<string>;
  /**
   * Avisa o pai que ESTE painel já gravou no banco (venda registrada ou repasse
   * removido). Existe porque o rodapé da conferência promete "nada é gravado até
   * você clicar" e oferece "Descartar": sem esse sinal, o Marcos remove 6 carros,
   * se arrepende, clica Descartar e acredita ter desfeito — mas o DELETE já
   * levou junto `repasse_gastos` e `repasse_interessados` por CASCADE.
   *
   * `lead_interesses` é a exceção: FK ON DELETE SET NULL. Os interesses NÃO são
   * apagados — viram órfãos (`repasse_id NULL`) e continuam visíveis em
   * /leads/[id] pelo `modelo_snapshot`. Ver migration 033.
   */
  onGravou: (quantidade: number) => void;
};

export function SumidosDoArquivoPainel({
  placasNoArquivo,
  onGravou,
}: SumidosDoArquivoPainelProps) {
  const { removerLocalmente: removerChassiEmRepasse } = useChassisEmRepasse();

  const [repasses, setRepasses] = useState<RepasseRefPresenca[] | null>(null);
  const [gastos, setGastos] = useState<Map<number, number[]> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false);
  const [removendo, setRemovendo] = useState(false);
  // Fila do "marcar como vendido": um MarcarVendidoModal por carro, em sequência.
  const [fila, setFila] = useState<RepasseRefPresenca[] | null>(null);
  const [posFila, setPosFila] = useState(0);
  const [registradas, setRegistradas] = useState(0);

  /** Busca os repasses comparáveis e os gastos. Também é o botão "tentar de novo". */
  async function carregar() {
    setErro(null);
    try {
      const lista = await listRepassesParaPresencaArquivo();
      setRepasses(lista);
      try {
        setGastos(await listGastosPorRepasse(lista.map((r) => r.id)));
      } catch {
        // `null` ≠ "sem gasto": sem o Σ gastos o custo sai MENOR do que é. O
        // painel mostra traço em vez de número otimista. Não derruba a lista.
        setGastos(null);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro desconhecido ao ler os repasses.");
      setRepasses(null);
    }
  }

  // Só na montagem: o fetch não depende de `placasNoArquivo` (a comparação é o
  // `useMemo` abaixo), e o painel remonta a cada upload novo.
  useEffect(() => {
    void carregar();
  }, []);

  const diff = useMemo(
    () => diffPresencaNoArquivo(repasses ?? [], placasNoArquivo),
    [repasses, placasNoArquivo],
  );

  const sumiram = diff.sumiram;
  /** Fatia grande demais do estoque sumiu de uma vez — cheiro de download pela metade. */
  const arquivoParcial = pareceArquivoParcial(diff);
  const selecionadosArr = useMemo(
    () => sumiram.filter((r) => selecionados.has(r.id)),
    [sumiram, selecionados],
  );

  const custoDe = useCallback(
    (r: RepasseRefPresenca) =>
      gastos == null ? null : calcularCustoReal(r.valor_compra_repasse, gastos.get(r.id) ?? []),
    [gastos],
  );

  function toggleUm(id: number) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTodos() {
    // Trava, não aviso: mesma régua do `contagemQuebrada` desta tela. Só o atalho
    // de massa cai — desmarcar tudo e marcar item a item seguem livres.
    if (arquivoParcial && selecionados.size !== sumiram.length) return;
    setSelecionados((prev) =>
      prev.size === sumiram.length ? new Set() : new Set(sumiram.map((r) => r.id)),
    );
  }

  /** Tira os ids processados da lista e da seleção — sem refetch. */
  function descartar(ids: ReadonlyArray<number>) {
    const fora = new Set(ids);
    setRepasses((prev) => (prev == null ? prev : prev.filter((r) => !fora.has(r.id))));
    setSelecionados((prev) => new Set([...prev].filter((id) => !fora.has(id))));
  }

  // ─── Fila de venda ─────────────────────────────────────────────────────────

  const atual = fila?.[posFila] ?? null;

  function iniciarFila() {
    if (selecionadosArr.length === 0) return;
    setFila(selecionadosArr);
    setPosFila(0);
    setRegistradas(0);
  }

  function encerrarFila(total: number, feitas: number) {
    setFila(null);
    setPosFila(0);
    setRegistradas(0);
    const pulados = total - feitas;
    if (feitas === 0) {
      showInfoToast("Nenhuma venda registrada.");
    } else if (pulados === 0) {
      showSuccessToast(`${feitas} venda${feitas === 1 ? "" : "s"} registrada${feitas === 1 ? "" : "s"}.`);
    } else {
      showInfoToast(
        `${feitas} venda${feitas === 1 ? "" : "s"} registrada${feitas === 1 ? "" : "s"}, ${pulados} pulado${pulados === 1 ? "" : "s"}.`,
      );
    }
  }

  function avancar(feitasAgora: number) {
    const total = fila?.length ?? 0;
    if (posFila + 1 >= total) encerrarFila(total, feitasAgora);
    else setPosFila((p) => p + 1);
  }

  async function confirmarVenda(repasse: RepasseRefPresenca, input: MarcarVendidoInput) {
    try {
      await marcarComoVendido(repasse.id, input);
      onGravou(1);
      descartar([repasse.id]);
      const feitas = registradas + 1;
      setRegistradas(feitas);
      avancar(feitas);
    } catch (e) {
      // Falha NÃO avança a fila: o carro continua na tela pra tentar de novo.
      showErrorToast(e instanceof Error ? e.message : "Falha ao registrar a venda.");
    }
  }

  // ─── Remoção em lote ───────────────────────────────────────────────────────

  async function removerSelecionados() {
    if (removendo || selecionadosArr.length === 0) return;
    setRemovendo(true);
    const alvos = selecionadosArr;
    try {
      const n = await deleteRepasses(alvos.map((r) => r.id));
      onGravou(n);
      for (const r of alvos) if (r.chassi !== "") removerChassiEmRepasse(r.chassi);
      descartar(alvos.map((r) => r.id));
      setConfirmandoRemocao(false);
      showSuccessToast(`${n} carro${n === 1 ? "" : "s"} removido${n === 1 ? "" : "s"} da lista de repasses.`);
    } catch (e) {
      showErrorToast(e instanceof Error ? e.message : "Falha ao remover.");
    } finally {
      setRemovendo(false);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const carregando = repasses == null && erro == null;

  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
      <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)]">
        <PackageX className="h-4 w-4 text-orange-600" />
        Saíram do Auto Avaliar ({carregando ? "…" : formatInt(sumiram.length)})
      </h3>
      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
        Carros que estão ativos no sistema e cuja placa <strong>não aparece em nenhuma linha</strong>{" "}
        deste arquivo — nem na Matriz, nem nas outras lojas. Sair do anúncio{" "}
        <strong>normalmente significa venda</strong>, mas também é o que acontece com anúncio
        pausado, carro transferido ou download incompleto.{" "}
        <strong className="text-[var(--text-strong)]">Quem decide é você</strong> — nada aqui é
        automático.
      </p>
      {/* O resto da tela só grava no "Confirmar e gravar". Este painel não —
          e a promessa do rodapé ("nada é gravado até você clicar") mentiria
          por omissão se isso não estivesse escrito ANTES dos botões. */}
      <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertTriangle className="mr-1 inline h-3 w-3" />
        Diferente do resto desta tela, as ações deste painel{" "}
        <strong>gravam na hora, cada uma por si</strong> — não entram no
        &quot;Confirmar e gravar&quot; nem são desfeitas pelo &quot;Descartar&quot;.
      </p>

      {erro && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">
            Não consegui ler a lista de repasses pra comparar: {erro} O resto da conferência acima
            continua válido.
          </span>
          <button
            type="button"
            onClick={() => void carregar()}
            className="inline-flex items-center gap-1 rounded-md border border-rose-400 px-2 py-1 font-medium hover:bg-rose-100 dark:hover:bg-rose-900/40"
          >
            <RotateCcw className="h-3 w-3" /> Tentar de novo
          </button>
        </div>
      )}

      {carregando && (
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Comparando o arquivo com os repasses do
          sistema…
        </p>
      )}

      {repasses != null && sumiram.length === 0 && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          Todo carro ativo no sistema continua no arquivo. Nenhum sumiu do anúncio.
        </p>
      )}

      {arquivoParcial && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>
              {formatInt(sumiram.length)} de {formatInt(diff.total_ativos_comparaveis)} carros
              ativos sumiram deste arquivo
            </strong>{" "}
            — mais de {Math.round(LIMITE_SUSPEITA_ARQUIVO_PARCIAL * 100)}% do estoque em repasse.
            Isso é bem mais parecido com <strong>download incompleto</strong> do que com venda em
            massa. Baixe o relatório de novo antes de dar baixa em qualquer coisa. O{" "}
            <strong>&quot;selecionar todos&quot; está desabilitado</strong>; se você conferiu e é
            real mesmo, marque os carros um a um.
          </span>
        </div>
      )}

      {sumiram.length > 0 && (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-soft)] text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="w-8 py-1.5">
                    <input
                      type="checkbox"
                      checked={selecionados.size === sumiram.length && sumiram.length > 0}
                      onChange={toggleTodos}
                      disabled={arquivoParcial && selecionados.size !== sumiram.length}
                      aria-label="Selecionar todos os carros que saíram do anúncio"
                      title={
                        arquivoParcial
                          ? "Desabilitado: sumiu gente demais de uma vez. Confira o arquivo e marque um a um."
                          : undefined
                      }
                      className="h-3.5 w-3.5 accent-[var(--brand-700)] disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </th>
                  <th className="py-1.5 pr-2 font-semibold">Placa</th>
                  <th className="py-1.5 pr-2 font-semibold">Modelo</th>
                  <th className="py-1.5 pr-2 font-semibold">Status</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Custo real</th>
                </tr>
              </thead>
              <tbody>
                {sumiram.map((r) => {
                  const custo = custoDe(r);
                  return (
                    <tr
                      key={r.id}
                      className={cn(
                        "border-b border-[var(--border-soft)] last:border-0",
                        selecionados.has(r.id) && "bg-[var(--bg-muted)]",
                      )}
                    >
                      <td className="py-1.5">
                        <input
                          type="checkbox"
                          checked={selecionados.has(r.id)}
                          onChange={() => toggleUm(r.id)}
                          aria-label={`Selecionar ${r.placa}`}
                          className="h-3.5 w-3.5 accent-[var(--brand-700)]"
                        />
                      </td>
                      <td className="py-1.5 pr-2 font-mono font-semibold text-[var(--text-strong)]">
                        {r.placa}
                      </td>
                      <td className="max-w-[18rem] truncate py-1.5 pr-2 text-[var(--text-body)]">
                        {r.modelo || "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-[var(--text-muted)]">
                        {ROTULO_STATUS[r.status] ?? r.status}
                      </td>
                      <td
                        className="py-1.5 pr-2 text-right tabular-nums text-[var(--text-body)]"
                        title={
                          custo == null
                            ? "Sem valor de compra do repasse (ou falha ao carregar os gastos)"
                            : "Valor de compra + gastos do repasse"
                        }
                      >
                        {custo == null ? "—" : formatBRL(custo)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Barra de ações. Vendido PRIMEIRO e primário — ver cabeçalho. */}
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-muted)] px-3 py-2">
            <span className="text-xs font-semibold text-[var(--text-body)]">
              {formatInt(selecionadosArr.length)} selecionado
              {selecionadosArr.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={iniciarFila}
              disabled={selecionadosArr.length === 0 || removendo}
              title="Registra valor e data de venda de cada um, um por vez."
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3 w-3" /> Marcar como vendido (
              {formatInt(selecionadosArr.length)})
            </button>
            <button
              type="button"
              onClick={() => setConfirmandoRemocao(true)}
              disabled={selecionadosArr.length === 0 || removendo}
              title="Só pra carro que saiu do anúncio SEM ter vendido. Apaga o repasse."
              className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            >
              <Trash2 className="h-3 w-3" /> Remover ({formatInt(selecionadosArr.length)})
            </button>
            {selecionados.size > 0 && (
              <button
                type="button"
                onClick={() => setSelecionados(new Set())}
                className="ml-auto text-xs text-[var(--text-muted)] hover:text-[var(--text-strong)]"
              >
                Limpar seleção
              </button>
            )}
          </div>

          <p className="mt-2 text-[11px] text-[var(--text-muted)]">
            Prefira <strong>marcar como vendido</strong> quando o carro saiu porque vendeu: é o que
            fecha a margem real (custo de compra + gastos do repasse contra o valor de venda).{" "}
            <strong>Remover apaga o repasse</strong> e joga esse dado fora — use só pra carro que
            saiu do anúncio sem ter vendido.
          </p>
        </>
      )}

      {diff.sem_placa_comparavel.length > 0 && (
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
          {formatInt(diff.sem_placa_comparavel.length)} repasse
          {diff.sem_placa_comparavel.length === 1 ? "" : "s"} ativo
          {diff.sem_placa_comparavel.length === 1 ? "" : "s"} sem placa legível no sistema —
          ficaram de fora da comparação porque não dá pra afirmar nada sobre eles.
        </p>
      )}

      {diff.reapareceram.length > 0 && (
        <Reapareceram itens={diff.reapareceram} />
      )}

      {atual && fila && (
        <MarcarVendidoModal
          key={`sumido-vendido-${atual.id}`}
          repasse={atual}
          gastos={gastos == null ? null : (gastos.get(atual.id) ?? [])}
          open={true}
          contexto={`Carro ${formatInt(posFila + 1)} de ${formatInt(fila.length)} que saíram do anúncio`}
          rotuloCancelar={posFila + 1 >= fila.length ? "Pular e fechar" : "Pular este"}
          onClose={() => avancar(registradas)}
          onConfirm={(input) => confirmarVenda(atual, input)}
        />
      )}

      {confirmandoRemocao && (
        <ConfirmarRemocaoModal
          itens={selecionadosArr}
          custoDe={custoDe}
          removendo={removendo}
          onCancelar={() => setConfirmandoRemocao(false)}
          onConfirmar={() => void removerSelecionados()}
        />
      )}
    </section>
  );
}

// ─── Peças ───────────────────────────────────────────────────────────────────

/**
 * O inverso do balde principal: estava `vendido` no sistema e a placa voltou a
 * aparecer no relatório. Sinal de venda que não se confirmou.
 *
 * Read-only de propósito: reabrir um repasse já fechado é decisão de outra tela
 * (o "Reabrir" do /repasses), e este painel não é lugar de desfazer venda.
 */
function Reapareceram({ itens }: { itens: ReadonlyArray<RepasseRefPresenca> }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200"
      >
        {aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Undo2 className="h-3.5 w-3.5" />
        Estavam vendidos e voltaram a aparecer ({formatInt(itens.length)})
      </button>
      <p className="mt-1 text-[11px] text-amber-900 dark:text-amber-200">
        Marcados como <strong>vendidos</strong> no sistema, mas a placa está anunciada neste
        arquivo. Costuma ser venda que não se confirmou. Pra reabrir, use o botão{" "}
        <strong>Reabrir</strong> na linha do carro em /repasses — este painel não desfaz venda.
      </p>
      {aberto && (
        <ul className="mt-2 space-y-1 text-xs">
          {itens.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono font-semibold text-amber-950 dark:text-amber-100">
                {r.placa}
              </span>
              <span className="truncate text-amber-900 dark:text-amber-200">{r.modelo || "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Confirmação da remoção em lote. Irreversível: o repasse é APAGADO, junto com o
 * `valor_compra_repasse` que alimenta a margem real.
 *
 * Por isso não é um `confirm()` genérico — o modal LISTA placa e modelo de cada
 * carro e exige um aceite marcado à mão. A afirmação do aceite é a que importa
 * ("nenhum destes vendeu"), não a contagem.
 */
function ConfirmarRemocaoModal({
  itens,
  custoDe,
  removendo,
  onCancelar,
  onConfirmar,
}: {
  itens: ReadonlyArray<RepasseRefPresenca>;
  custoDe: (r: RepasseRefPresenca) => number | null;
  removendo: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const [aceito, setAceito] = useState(false);
  const total = itens.length;

  // O R$ que vai ser jogado fora é o argumento mais forte contra o clique errado.
  // `parcial` quando algum carro não tem custo: soma incompleta não pode se
  // apresentar como total — subestimar o estrago é o erro perigoso aqui.
  const custos = itens.map(custoDe);
  const custoTotal = custos.reduce<number>((s, c) => s + (c ?? 0), 0);
  const semCusto = custos.filter((c) => c == null).length;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar remoção dos carros que saíram do anúncio"
    >
      <div className="w-full max-w-md rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-6 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--text-strong)]">
            Remover {formatInt(total)} carro{total === 1 ? "" : "s"} da lista de repasses?
          </h2>
          {!removendo && (
            <button
              type="button"
              onClick={onCancelar}
              className="shrink-0 rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-muted)]"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Isso <strong>apaga o repasse</strong> e não tem desfazer. Se algum destes carros
            vendeu, o valor de compra e os gastos vão junto — e a margem real deixa de fechar. Nesse
            caso, feche aqui e use <strong>Marcar como vendido</strong>.
          </span>
        </div>

        <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto rounded-md border border-[var(--border-soft)] bg-[var(--bg-muted)] p-2 text-xs">
          {itens.map((r) => {
            const custo = custoDe(r);
            return (
              <li key={r.id} className="flex items-baseline gap-x-2">
                <span className="shrink-0 font-mono font-semibold text-[var(--text-strong)]">
                  {r.placa}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--text-muted)]">
                  {r.modelo || "—"}
                </span>
                <span className="shrink-0 tabular-nums text-[var(--text-body)]">
                  {custo == null ? "—" : formatBRL(custo)}
                </span>
              </li>
            );
          })}
        </ul>

        <p className="mt-2 rounded-md border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          Vai embora com {total === 1 ? "ele" : "eles"}:{" "}
          <strong className="tabular-nums">{formatBRL(custoTotal)}</strong> de custo real
          registrado (compra + gastos)
          {semCusto > 0 && (
            <>
              {" "}
              — e {formatInt(semCusto)} {semCusto === 1 ? "carro" : "carros"} sem custo conhecido,
              então o total real é <strong>maior</strong> que isso
            </>
          )}
          .
        </p>

        <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-[var(--text-body)]">
          <input
            type="checkbox"
            checked={aceito}
            onChange={(e) => setAceito(e.target.checked)}
            disabled={removendo}
            className="mt-0.5 h-3.5 w-3.5 accent-red-600"
          />
          <span>
            Confirmo que {total === 1 ? "este carro saiu" : `estes ${formatInt(total)} carros saíram`}{" "}
            do anúncio <strong>sem ter vendido</strong>.
          </span>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            disabled={removendo}
            className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-4 py-2 text-sm text-[var(--text-body)] hover:bg-[var(--bg-muted)] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={!aceito || removendo}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {removendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {removendo ? "Removendo…" : `Remover ${formatInt(total)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
