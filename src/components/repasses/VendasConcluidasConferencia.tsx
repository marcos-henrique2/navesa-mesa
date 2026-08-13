"use client";

/**
 * Tela de conferência da importação de VENDAS do Auto Avaliar (migration 036).
 *
 * ┌─ POR QUE ISTO EXISTE ──────────────────────────────────────────────────────┐
 * │ Esta importação grava em PRODUÇÃO e, diferente das outras duas, ela CRIA    │
 * │ carro. Por isso o passo de confirmação: arrasta → parseia → preview (RPC    │
 * │ read-only) → o Marcos confere → clica → aplica. NADA é gravado sem clique.  │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * A tela RENDERIZA o contrato da RPC (`campos[]` com `antes`/`depois`/`acao`).
 * Não reagrupa balde, não recalcula diff, não infere ação, não lê `patch` (que
 * nem existe nos tipos). Toda a classificação é da RPC.
 *
 * O grupo "vão ser criados" tem destaque próprio e vem ANTES dos demais: criar
 * carro é a diferença desta fonte para as outras duas, e é o que o usuário
 * precisa enxergar antes de confirmar.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Coins,
  Loader2,
  MapPin,
  PencilLine,
  PlusCircle,
  ShieldAlert,
  X,
} from "lucide-react";
import type {
  LinhaVendaOutraLoja,
  PayloadVendas,
  VendasMeta,
} from "@/lib/parsers/auto-avaliar-vendas-xlsx";
import {
  baldesFechamVenda,
  contarAcoesVenda,
  formatarValorVenda,
  nadaPraGravarVenda,
  ordenarPorAtencaoVenda,
  pareceSessaoExpiradaVenda,
  rotuloCampoVenda,
  rotuloMotivoIgnoradaVenda,
  temValorTrocadoVenda,
  type DiffCampoVenda,
  type ItemVendaAtualiza,
  type RelatorioVendas,
} from "@/lib/repasses/vendas-concluidas";
import { aplicarVendasConcluidas } from "@/lib/repasses/vendas-concluidas-queries";
import { formatarDataBR } from "@/lib/utils/data-local";
import { cn, formatBRLCents, formatInt } from "@/lib/utils";

export type VendasConcluidasConferenciaProps = {
  arquivoNome: string;
  meta: VendasMeta;
  /** Linhas retidas no CLIENTE por serem de outra loja — nunca chegaram à RPC. */
  outraLoja: ReadonlyArray<LinhaVendaOutraLoja>;
  /** O mesmo payload bruto do preview: a RPC de aplicar recalcula o diff do zero. */
  payload: PayloadVendas;
  preview: RelatorioVendas;
  onFechar: () => void;
  /** Chamado depois da gravação, com o relatório em modo "aplicado". */
  onAplicado: (relatorio: RelatorioVendas) => void;
};

export function VendasConcluidasConferencia({
  arquivoNome,
  meta,
  outraLoja,
  payload,
  preview,
  onFechar,
  onAplicado,
}: VendasConcluidasConferenciaProps) {
  const [aplicando, setAplicando] = useState(false);
  const [aplicado, setAplicado] = useState<RelatorioVendas | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Depois de gravar, a tela passa a mostrar o que FOI gravado — mesmo contrato,
  // modo "aplicado". O preview fica guardado só pra detectar deriva.
  const rel = aplicado ?? preview;
  const acoes = useMemo(() => contarAcoesVenda(rel), [rel]);
  const ordenados = useMemo(() => ordenarPorAtencaoVenda(rel.com_alteracao), [rel]);
  const comTroca = useMemo(() => ordenados.filter(temValorTrocadoVenda), [ordenados]);
  const soPreenche = useMemo(
    () => ordenados.filter((i) => !temValorTrocadoVenda(i)),
    [ordenados],
  );

  // Deriva entre a conferência e o OK: alguém mexeu no carro no meio do caminho.
  const deriva =
    aplicado != null &&
    (aplicado.resumo.com_alteracao !== preview.resumo.com_alteracao ||
      aplicado.resumo.a_criar !== preview.resumo.a_criar);

  const filtroLojaZerou = meta.total_loja_alvo === 0 && meta.total_outra_loja > 0;
  const nadaPraGravar = nadaPraGravarVenda(rel);
  // Contagem que não fecha significa que alguma linha sumiu entre os grupos. O aviso
  // não pode depender de o usuário obedecer um texto: trava o botão.
  const contagemQuebrada = !baldesFechamVenda(rel);

  async function aplicar() {
    if (aplicando || aplicado != null) return;
    setAplicando(true);
    setErro(null);
    try {
      const resultado = await aplicarVendasConcluidas(payload);
      setAplicado(resultado);
      onAplicado(resultado);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro desconhecido ao gravar.");
    } finally {
      setAplicando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Conferência das vendas concluídas do Auto Avaliar"
    >
      <div className="my-8 w-full max-w-5xl rounded-xl border border-[var(--border-soft)] bg-[var(--bg-app)] shadow-xl">
        {/* ─── Cabeçalho ───────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[var(--text-strong)]">
              {aplicado ? "Vendas registradas" : "Conferir antes de gravar"}
            </h2>
            <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
              {arquivoNome} · {formatInt(meta.total_linhas)}{" "}
              {meta.total_linhas === 1 ? "venda no arquivo" : "vendas no arquivo"} ·{" "}
              {formatInt(meta.total_loja_alvo)} da Matriz
              {rel.gerado_em ? ` · conferido em ${formatarInstante(rel.gerado_em)}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            className="shrink-0 rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-muted)]"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {/* ─── Avisos que mudam a leitura de tudo abaixo ──────────────────── */}
          {pareceSessaoExpiradaVenda(rel) && (
            <Aviso
              tom="rose"
              icone={<ShieldAlert className="h-4 w-4" />}
              titulo="Nenhum carro do arquivo foi encontrado no sistema"
            >
              Todas as {formatInt(rel.resumo.linhas_no_arquivo)} linhas caíram em &quot;vão ser
              criados&quot;. Isso costuma ser <strong>sessão expirada</strong>, não estoque
              perdido — e confirmar assim criaria {formatInt(rel.resumo.a_criar)} duplicatas do
              seu próprio estoque. Recarregue a página, entre de novo e suba o arquivo outra vez.
            </Aviso>
          )}

          {filtroLojaZerou && (
            <Aviso
              tom="amber"
              icone={<AlertTriangle className="h-4 w-4" />}
              titulo="Nenhuma linha da Matriz neste arquivo"
            >
              A importação só registra <strong>NAVESA - GO/MATRIZ</strong>, e nenhuma linha bateu
              com esse nome. Lojas encontradas: {meta.lojas_encontradas.join(" · ") || "—"}. Se o
              Auto Avaliar renomeou a loja, o import viraria um no-op silencioso — por isso este
              aviso.
            </Aviso>
          )}

          {contagemQuebrada && (
            <Aviso
              tom="amber"
              icone={<AlertTriangle className="h-4 w-4" />}
              titulo="Contagem inconsistente"
            >
              A soma dos grupos não fecha com o total de linhas enviadas. Não confirme: reporte
              isso antes de gravar.
            </Aviso>
          )}

          {rel.truncado && (
            <Aviso
              tom="amber"
              icone={<AlertTriangle className="h-4 w-4" />}
              titulo="Listas truncadas na exibição"
            >
              O arquivo é grande, então as listas abaixo mostram só parte dos itens. As contagens
              do resumo continuam exatas, e os grupos &quot;vão mudar&quot; e &quot;vão ser
              criados&quot; nunca são cortados.
            </Aviso>
          )}

          {deriva && (
            <Aviso
              tom="amber"
              icone={<AlertTriangle className="h-4 w-4" />}
              titulo="Mudou entre a conferência e o OK"
            >
              A conferência mostrava {formatInt(preview.resumo.com_alteracao)} a atualizar e{" "}
              {formatInt(preview.resumo.a_criar)} a criar; a gravação aplicou{" "}
              {formatInt(aplicado!.resumo.com_alteracao)} e {formatInt(aplicado!.resumo.a_criar)}.
              O que está abaixo é o que <strong>foi gravado</strong>.
            </Aviso>
          )}

          {erro && (
            <Aviso tom="rose" icone={<ShieldAlert className="h-4 w-4" />} titulo="Falha ao gravar">
              {erro} Nada foi gravado pela metade: a RPC roda em uma transação só.
            </Aviso>
          )}

          {aplicado && !erro && (
            <Aviso tom="emerald" icone={<CheckCircle2 className="h-4 w-4" />} titulo="Gravado">
              {formatInt(aplicado.resumo.linhas_gravadas)}{" "}
              {aplicado.resumo.linhas_gravadas === 1 ? "carro atualizado" : "carros atualizados"} ·{" "}
              {formatInt(aplicado.resumo.repasses_criados)}{" "}
              {aplicado.resumo.repasses_criados === 1 ? "carro criado" : "carros criados"} ·{" "}
              {formatInt(aplicado.resumo.gastos_lancados)}{" "}
              {aplicado.resumo.gastos_lancados === 1 ? "gasto lançado" : "gastos lançados"}. Nenhum
              valor de compra existente foi sobrescrito e nenhum gasto foi apagado.
            </Aviso>
          )}

          {/* ─── Resumo ─────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Tile rotulo="Vão ser criados" valor={rel.resumo.a_criar} tom="emerald" />
            <Tile rotulo="Vão mudar" valor={rel.resumo.com_alteracao} tom="sky" />
            <Tile rotulo="Sem alteração" valor={rel.resumo.sem_alteracao} tom="neutro" />
            <Tile rotulo="Ignoradas" valor={rel.resumo.ignoradas} tom="neutro" />
            <Tile rotulo="Outra loja" valor={outraLoja.length} tom="neutro" />
          </div>

          <p className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-4 py-3 text-xs text-[var(--text-body)]">
            <strong>{formatInt(rel.resumo.campos_a_alterar)} campos</strong> nos carros que já
            existem: <strong className="text-[var(--text-strong)]">{formatInt(acoes.preenche)}</strong>{" "}
            preenchendo campo que estava vazio ·{" "}
            <strong className="text-amber-700 dark:text-amber-400">{formatInt(acoes.altera)}</strong>{" "}
            trocando valor que já existia. {formatInt(rel.resumo.gastos_a_lancar)}{" "}
            {rel.resumo.gastos_a_lancar === 1 ? "gasto será lançado" : "gastos serão lançados"} como{" "}
            <strong>Gastos Auto Avaliar</strong>.
          </p>

          {/* ─── TAC: exibido, NUNCA gravado ────────────────────────────────── */}
          {meta.linhas_com_tac > 0 && (
            <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-muted)] p-4">
              <h3 className="inline-flex items-center gap-2 text-sm font-bold text-[var(--text-strong)]">
                <Coins className="h-4 w-4" /> TAC destas vendas:{" "}
                {formatBRLCents(meta.total_tac)}
              </h3>
              <p className="mt-1 text-xs text-[var(--text-body)]">
                Taxa cobrada pelo Auto Avaliar em {formatInt(meta.linhas_com_tac)}{" "}
                {meta.linhas_com_tac === 1 ? "venda" : "vendas"} —{" "}
                <strong>não lançado como custo do carro</strong> e não gravado em lugar nenhum.
                Está aqui só pra você ver o tamanho: hoje esse dinheiro não aparece no sistema.
              </p>
            </div>
          )}

          {meta.total_sem_identificacao > 0 && (
            <p className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-4 py-2 text-[11px] text-[var(--text-muted)]">
              {formatInt(meta.total_sem_identificacao)}{" "}
              {meta.total_sem_identificacao === 1 ? "linha veio" : "linhas vieram"} sem placa e sem
              chassi e {meta.total_sem_identificacao === 1 ? "foi descartada" : "foram descartadas"}{" "}
              antes da conferência — é o rodapé de totais do relatório, não um carro.
            </p>
          )}

          {/* ─── Grupo: VÃO SER CRIADOS ─────────────────────────────────────── */}
          {rel.a_criar.length > 0 && (
            <Colapsavel
              titulo={`Vão ser CRIADOS — ${formatInt(rel.resumo.a_criar)}`}
              icone={<PlusCircle className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />}
              nota="Carros vendidos no Auto Avaliar que nunca passaram pelo sistema. Entram já como vendidos."
              abertoInicial
            >
              <div className="space-y-2">
                {rel.a_criar.map((c) => (
                  <div
                    key={`cri-${c.linha}`}
                    className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-mono text-sm font-bold text-[var(--text-strong)]">
                        {c.placa_norm ?? "—"}
                      </span>
                      <span className="truncate text-xs text-[var(--text-body)]">
                        {c.modelo ?? "—"}
                      </span>
                      <span className="ml-auto text-[10px] text-[var(--text-muted)]">
                        linha {c.linha}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">
                      {c.chassi ?? "sem chassi"}
                    </p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                      <Dado rotulo="Subiu em" valor={formatarDataBR(c.data_subiu)} />
                      <Dado rotulo="Vendido em" valor={formatarDataBR(c.data_vendido)} />
                      <Dado rotulo="Compra" valor={dinheiroOuTraco(c.valor_compra_repasse)} />
                      <Dado rotulo="Vendido por" valor={dinheiroOuTraco(c.valor_vendido)} />
                    </dl>
                    {c.gastos != null && (
                      <p className="mt-1 text-[11px] text-[var(--text-body)]">
                        + {formatBRLCents(c.gastos)} de gastos Auto Avaliar
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Colapsavel>
          )}

          {/* ─── Grupo: TROCAM valor existente ──────────────────────────────── */}
          {comTroca.length > 0 && (
            <Colapsavel
              titulo={`Trocam algo que já estava gravado — ${formatInt(comTroca.length)}`}
              icone={<PencilLine className="h-4 w-4 text-amber-700 dark:text-amber-400" />}
              nota="É aqui que mora o risco. Confira antes de confirmar."
              abertoInicial
            >
              <ListaAlteracoes itens={comTroca} />
            </Colapsavel>
          )}

          {/* ─── Grupo: só PREENCHEM ────────────────────────────────────────── */}
          {soPreenche.length > 0 && (
            <Colapsavel
              titulo={`Só preenchem campo vazio — ${formatInt(soPreenche.length)}`}
              icone={<ArrowRight className="h-4 w-4 text-sky-700 dark:text-sky-400" />}
              nota="Nada é sobrescrito: esses campos estavam em branco no sistema."
              abertoInicial={false}
            >
              <ListaAlteracoes itens={soPreenche} />
            </Colapsavel>
          )}

          {/* ─── Grupo: sem alteração ───────────────────────────────────────── */}
          {rel.sem_alteracao.length > 0 && (
            <Colapsavel
              titulo={`Já estavam assim — ${formatInt(rel.resumo.sem_alteracao)}`}
              icone={<CheckCircle2 className="h-4 w-4 text-[var(--text-muted)]" />}
              nota="Venda já registrada com os mesmos números. Reimportar o mesmo arquivo cai todo aqui."
              abertoInicial={false}
            >
              <ul className="space-y-1">
                {rel.sem_alteracao.map((s) => (
                  <li
                    key={`sem-${s.linha}`}
                    className="flex flex-wrap items-baseline gap-x-2 rounded-md border border-[var(--border-soft)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs"
                  >
                    <span className="font-mono font-semibold text-[var(--text-strong)]">
                      {s.placa_norm ?? "—"}
                    </span>
                    <span className="truncate text-[var(--text-body)]">{s.modelo ?? "—"}</span>
                    <span className="ml-auto text-[10px] text-[var(--text-muted)]">
                      linha {s.linha}
                    </span>
                  </li>
                ))}
              </ul>
            </Colapsavel>
          )}

          {/* ─── Grupo: ignoradas ───────────────────────────────────────────── */}
          {rel.ignoradas.length > 0 && (
            <Colapsavel
              titulo={`Ignoradas — ${formatInt(rel.resumo.ignoradas)}`}
              icone={<Ban className="h-4 w-4 text-[var(--text-muted)]" />}
              nota="Linhas descartadas antes de qualquer escrita, com o motivo."
              abertoInicial={rel.ignoradas.length <= 5}
            >
              <ul className="space-y-1">
                {rel.ignoradas.map((g) => (
                  <li
                    key={`ign-${g.linha}-${g.motivo}`}
                    className="rounded-md border border-[var(--border-soft)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono font-semibold text-[var(--text-strong)]">
                        {g.placa_norm ?? g.chassi ?? "—"}
                      </span>
                      <span className="ml-auto text-[10px] text-[var(--text-muted)]">
                        linha {g.linha}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[var(--text-body)]">
                      {rotuloMotivoIgnoradaVenda(g.motivo)}
                      {g.repasse_ids && g.repasse_ids.length > 0
                        ? ` (repasses ${g.repasse_ids.join(", ")})`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </Colapsavel>
          )}

          {/* ─── Outra loja: retido no cliente ──────────────────────────────── */}
          {outraLoja.length > 0 && (
            <Colapsavel
              titulo={`De outra loja — ${formatInt(outraLoja.length)}`}
              icone={<MapPin className="h-4 w-4 text-[var(--text-muted)]" />}
              nota="Nem chegaram ao banco: foram retidas aqui no navegador pelo filtro da Matriz."
              abertoInicial={false}
            >
              <ul className="space-y-1">
                {outraLoja.map((o) => (
                  <li
                    key={`out-${o.linha}`}
                    className="flex flex-wrap items-baseline gap-x-2 rounded-md border border-[var(--border-soft)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs"
                  >
                    <span className="font-mono font-semibold text-[var(--text-strong)]">
                      {o.placa_norm || "—"}
                    </span>
                    <span className="truncate text-[var(--text-body)]">{o.modelo ?? "—"}</span>
                    <span className="text-[10px] text-[var(--text-muted)]">{o.loja}</span>
                    <span className="ml-auto text-[10px] text-[var(--text-muted)]">
                      linha {o.linha}
                    </span>
                  </li>
                ))}
              </ul>
            </Colapsavel>
          )}
        </div>

        {/* ─── Rodapé ──────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
          <p className="text-xs text-[var(--text-muted)]">
            {aplicado
              ? "Gravado. Feche pra voltar."
              : "Nada é gravado até você clicar em confirmar."}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onFechar}
              className="rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
            >
              {aplicado ? "Fechar" : "Descartar"}
            </button>
            {!aplicado && (
              <button
                type="button"
                onClick={aplicar}
                disabled={aplicando || nadaPraGravar || contagemQuebrada}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-700)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {aplicando && <Loader2 className="h-4 w-4 animate-spin" />}
                {nadaPraGravar
                  ? "Nada pra gravar"
                  : `Registrar ${formatInt(
                      rel.resumo.com_alteracao + rel.resumo.a_criar,
                    )} ${rel.resumo.com_alteracao + rel.resumo.a_criar === 1 ? "venda" : "vendas"}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Peças de tela ───────────────────────────────────────────────────────────

function ListaAlteracoes({ itens }: { itens: ReadonlyArray<ItemVendaAtualiza> }) {
  return (
    <div className="space-y-2">
      {itens.map((item) => (
        <div
          key={`alt-${item.linha}-${item.repasse_id ?? "x"}`}
          className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-3"
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-mono text-sm font-bold text-[var(--text-strong)]">
              {item.placa_norm ?? "—"}
            </span>
            <span className="truncate text-xs text-[var(--text-body)]">{item.modelo ?? "—"}</span>
            {item.casou_por === "chassi" && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                casou pelo chassi
              </span>
            )}
            <span className="ml-auto text-[10px] text-[var(--text-muted)]">
              linha {item.linha}
            </span>
          </div>
          <ul className="mt-2 space-y-1">
            {item.campos.map((c) => (
              <LinhaDiff key={`${item.linha}-${c.campo}`} diff={c} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function LinhaDiff({ diff }: { diff: DiffCampoVenda }) {
  const trocando = diff.acao !== "preenche";
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-xs">
      <span className="min-w-[8rem] text-[var(--text-muted)]">{rotuloCampoVenda(diff.campo)}</span>
      <span
        className={cn(
          "tabular-nums",
          trocando ? "text-[var(--text-body)] line-through" : "text-[var(--text-muted)]",
        )}
      >
        {formatarValorVenda(diff.campo, diff.antes)}
      </span>
      <ArrowRight className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
      <span
        className={cn(
          "font-semibold tabular-nums",
          trocando
            ? "text-amber-700 dark:text-amber-400"
            : "text-[var(--text-strong)]",
        )}
      >
        {formatarValorVenda(diff.campo, diff.depois)}
      </span>
    </li>
  );
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{rotulo}</dt>
      <dd className="font-semibold tabular-nums text-[var(--text-strong)]">{valor}</dd>
    </div>
  );
}

function Tile({
  rotulo,
  valor,
  tom,
}: {
  rotulo: string;
  valor: number;
  tom: "sky" | "emerald" | "neutro";
}) {
  const cores = {
    sky: "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30",
    emerald: "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30",
    neutro: "border-[var(--border-soft)] bg-[var(--bg-surface)]",
  } as const;
  const texto = {
    sky: "text-sky-800 dark:text-sky-300",
    emerald: "text-emerald-800 dark:text-emerald-300",
    neutro: "text-[var(--text-strong)]",
  } as const;
  return (
    <div className={cn("rounded-lg border px-3 py-2", cores[tom])}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {rotulo}
      </p>
      <p className={cn("mt-0.5 text-xl font-bold tabular-nums", texto[tom])}>{formatInt(valor)}</p>
    </div>
  );
}

function Aviso({
  tom,
  icone,
  titulo,
  children,
}: {
  tom: "rose" | "amber" | "emerald";
  icone: React.ReactNode;
  titulo: string;
  children: React.ReactNode;
}) {
  const cores = {
    rose: "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200",
    amber:
      "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
    emerald:
      "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  } as const;
  return (
    <div className={cn("rounded-xl border p-4", cores[tom])}>
      <h3 className="inline-flex items-center gap-2 text-sm font-bold">
        {icone} {titulo}
      </h3>
      <p className="mt-1 text-xs">{children}</p>
    </div>
  );
}

function Colapsavel({
  titulo,
  icone,
  nota,
  abertoInicial,
  children,
}: {
  titulo: string;
  icone: React.ReactNode;
  nota: string;
  abertoInicial: boolean;
  children?: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(abertoInicial);
  return (
    <div>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-3 py-2 text-left hover:bg-[var(--bg-muted)]"
      >
        {aberto ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
        )}
        {icone}
        <span className="text-sm font-semibold text-[var(--text-strong)]">{titulo}</span>
        <span className="ml-auto hidden text-[11px] text-[var(--text-muted)] sm:block">{nota}</span>
      </button>
      {aberto && <div className="mt-2">{children}</div>}
    </div>
  );
}

// ─── Formatação local ────────────────────────────────────────────────────────

function dinheiroOuTraco(v: number | null): string {
  return v == null ? "—" : formatBRLCents(v);
}

/** `2026-08-13T14:05:22-03:00` → `13/08/2026 14:05`. */
function formatarInstante(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : iso;
}
