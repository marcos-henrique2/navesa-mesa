"use client";

/**
 * Tela de conferência do sync por ARQUIVO do Auto Avaliar (Story 2.2 / Fatia 3a).
 *
 * ┌─ POR QUE ISTO EXISTE ──────────────────────────────────────────────────────┐
 * │ Os quatro uploads do NBS processam local e terminam num store do navegador. │
 * │ ESTE grava em PRODUÇÃO. Por isso existe um passo de confirmação que os      │
 * │ outros não têm: arrasta → parseia → preview (RPC read-only) → o Marcos      │
 * │ confere → clica → aplica. NADA é gravado sem clique explícito.              │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * A tela RENDERIZA o contrato do §5 (`campos[]` com `antes`/`depois`/`acao`).
 * Não reagrupa balde, não recalcula diff, não infere ação, não lê `patch`
 * (que nem existe nos tipos). Toda a classificação é da RPC.
 *
 * A única liberdade de apresentação é a separação de leitura dentro de
 * "Vão mudar": carros que TROCAM um valor existente na frente, carros que só
 * PREENCHEM campo vazio depois e colapsados. Essa distinção vem do `acao` que a
 * própria RPC manda — e é o que impede a primeira importação (em que quase tudo
 * é buraco sendo preenchido) de parecer que algo deu errado.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  MapPin,
  PencilLine,
  PlusCircle,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import type {
  LinhaOutraLoja,
  OfertasMeta,
  PayloadSyncArquivo,
} from "@/lib/parsers/auto-avaliar-ofertas-xls";
import {
  baldesFecham,
  contarAcoes,
  formatarValorCampo,
  ordenarPorAtencao,
  pareceSessaoExpirada,
  rotuloCampo,
  rotuloMotivoIgnorada,
  rotuloMotivoNaoEncontrada,
  temValorTrocado,
  type DiffCampo,
  type ItemComAlteracao,
  type RelatorioSync,
} from "@/lib/repasses/sync-arquivo-auto-avaliar";
import { aplicarSyncArquivo } from "@/lib/repasses/sync-arquivo-auto-avaliar-queries";
import { SumidosDoArquivoPainel } from "./SumidosDoArquivoPainel";
import { cn, formatInt } from "@/lib/utils";

export type SyncOfertasConferenciaProps = {
  arquivoNome: string;
  meta: OfertasMeta;
  /** Linhas retidas no CLIENTE por serem de outra loja — nunca chegaram à RPC (AC5). */
  outraLoja: ReadonlyArray<LinhaOutraLoja>;
  /**
   * Universo de placas do arquivo — TODAS as lojas, não só a Matriz. Alimenta o
   * balde "saíram do Auto Avaliar", que é um diff de conjunto feito no cliente
   * (a RPC só enxerga o payload da loja alvo, e por isso não pode calculá-lo).
   */
  placasNoArquivo: ReadonlySet<string>;
  /** O mesmo payload bruto do preview: a RPC de aplicar recalcula o diff do zero. */
  payload: PayloadSyncArquivo;
  preview: RelatorioSync;
  onFechar: () => void;
  /** Chamado depois da gravação, com o relatório em modo "aplicado". */
  onAplicado: (relatorio: RelatorioSync) => void;
};

export function SyncOfertasConferencia({
  arquivoNome,
  meta,
  outraLoja,
  placasNoArquivo,
  payload,
  preview,
  onFechar,
  onAplicado,
}: SyncOfertasConferenciaProps) {
  const [aplicando, setAplicando] = useState(false);
  const [aplicado, setAplicado] = useState<RelatorioSync | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /**
   * Gravações feitas pelo painel de "saíram do Auto Avaliar", que acontecem FORA
   * do ciclo do Aplicar. Sem esse contador o rodapé continuaria dizendo "nada é
   * gravado até você clicar" enquanto o Marcos já apagou repasse — e o
   * "Descartar" leria como desfazer, que ele não é.
   */
  const [gravadoNoPainel, setGravadoNoPainel] = useState(0);

  // Depois de gravar, a tela passa a mostrar o que FOI gravado — mesmo contrato,
  // modo "aplicado". O preview fica guardado só pra detectar deriva (§5.1).
  const rel = aplicado ?? preview;
  const acoes = useMemo(() => contarAcoes(rel), [rel]);
  const ordenados = useMemo(() => ordenarPorAtencao(rel.com_alteracao), [rel]);
  const comTroca = useMemo(() => ordenados.filter(temValorTrocado), [ordenados]);
  const soPreenche = useMemo(() => ordenados.filter((i) => !temValorTrocado(i)), [ordenados]);

  // Deriva entre a conferência e o OK: alguém editou o carro no meio do caminho.
  const deriva =
    aplicado != null && aplicado.resumo.com_alteracao !== preview.resumo.com_alteracao;

  const filtroLojaZerou = meta.total_loja_alvo === 0 && meta.total_outra_loja > 0;
  const nadaPraGravar = rel.resumo.com_alteracao === 0;
  // Contagem que não fecha significa que alguma linha sumiu entre os grupos. O
  // aviso não pode depender de o usuário obedecer um texto: trava o botão.
  const contagemQuebrada = !baldesFecham(rel);

  async function aplicar() {
    if (aplicando || aplicado != null) return;
    setAplicando(true);
    setErro(null);
    try {
      const resultado = await aplicarSyncArquivo(payload);
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
      aria-label="Conferência do sync do arquivo Veículos em Oferta"
    >
      <div className="my-8 w-full max-w-5xl rounded-xl border border-[var(--border-soft)] bg-[var(--bg-app)] shadow-xl">
        {/* ─── Cabeçalho ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[var(--text-strong)]">
              {aplicado ? "Sincronização aplicada" : "Conferir antes de gravar"}
            </h2>
            <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
              {arquivoNome} · {formatInt(meta.total_linhas)} linhas no arquivo ·{" "}
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
          {/* ─── Avisos que mudam a leitura de tudo abaixo ────────────────── */}
          {pareceSessaoExpirada(rel) && (
            <Aviso tom="rose" icone={<ShieldAlert className="h-4 w-4" />} titulo="Nenhum carro do arquivo casou com o sistema">
              Todas as {formatInt(rel.resumo.linhas_no_arquivo)} linhas caíram em &quot;não
              encontradas&quot;. Isso costuma ser <strong>sessão expirada</strong>, não estoque
              perdido: recarregue a página, entre de novo e suba o arquivo outra vez antes de
              concluir qualquer coisa.
            </Aviso>
          )}

          {filtroLojaZerou && (
            <Aviso tom="amber" icone={<AlertTriangle className="h-4 w-4" />} titulo="Nenhuma linha da Matriz neste arquivo">
              O sync só sincroniza <strong>NAVESA - GO/MATRIZ</strong>, e nenhuma linha bateu com
              esse nome. Lojas encontradas no arquivo: {meta.lojas_encontradas.join(" · ") || "—"}.
              Se o Auto Avaliar renomeou a loja, o import viraria um no-op silencioso — por isso
              este aviso.
            </Aviso>
          )}

          {contagemQuebrada && (
            <Aviso tom="amber" icone={<AlertTriangle className="h-4 w-4" />} titulo="Contagem inconsistente">
              A soma dos grupos não fecha com o total de linhas enviadas. Não confirme: reporte
              isso antes de gravar.
            </Aviso>
          )}

          {rel.truncado && (
            <Aviso tom="amber" icone={<AlertTriangle className="h-4 w-4" />} titulo="Listas truncadas na exibição">
              O arquivo é grande, então as listas abaixo mostram só parte dos itens. As contagens do
              resumo continuam exatas, e o grupo &quot;vão mudar&quot; nunca é cortado.
            </Aviso>
          )}

          {deriva && (
            <Aviso tom="amber" icone={<AlertTriangle className="h-4 w-4" />} titulo="Mudou entre a conferência e o OK">
              A conferência mostrava {formatInt(preview.resumo.com_alteracao)} carros e a gravação
              aplicou {formatInt(aplicado!.resumo.com_alteracao)}. Alguém editou carro no meio do
              caminho — o que está abaixo é o que <strong>foi gravado</strong>.
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
              {aplicado.resumo.linhas_gravadas === 1 ? "carro atualizado" : "carros atualizados"} no
              sistema. Nenhum carro foi criado, nenhum gasto foi tocado e nenhum valor existente foi
              apagado.
            </Aviso>
          )}

          {/* ─── Resumo ───────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Tile rotulo="Vão mudar" valor={rel.resumo.com_alteracao} tom="sky" />
            <Tile rotulo="Sem alteração" valor={rel.resumo.sem_alteracao} tom="neutro" />
            <Tile rotulo="Não encontradas" valor={rel.resumo.nao_encontradas} tom="neutro" />
            <Tile rotulo="Ignoradas" valor={rel.resumo.ignoradas} tom="neutro" />
            <Tile rotulo="Outra loja" valor={outraLoja.length} tom="neutro" />
          </div>

          <p className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-4 py-3 text-xs text-[var(--text-body)]">
            <strong>{formatInt(rel.resumo.campos_a_alterar)} campos</strong> no total:{" "}
            <strong className="text-[var(--text-strong)]">{formatInt(acoes.preenche)}</strong>{" "}
            preenchendo campo que estava vazio ·{" "}
            <strong className="text-amber-700 dark:text-amber-400">
              {formatInt(acoes.altera)}
            </strong>{" "}
            trocando valor que já existia.{" "}
            {acoes.altera === 0
              ? "Nenhum número gravado é sobrescrito."
              : "Só a segunda categoria muda um número que já estava no sistema."}
          </p>

          {/* ─── Grupo: vão mudar ─────────────────────────────────────────── */}
          <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
            <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)]">
              <PencilLine className="h-4 w-4 text-sky-600" />
              {aplicado ? "Foram alterados" : "Vão mudar"} ({formatInt(rel.resumo.com_alteracao)})
            </h3>

            {rel.resumo.com_alteracao === 0 ? (
              <p className="mt-3 text-xs text-[var(--text-muted)]">
                Nada muda. O arquivo confirma o que já está no sistema — nenhuma linha será gravada.
              </p>
            ) : (
              <div className="mt-4 space-y-5">
                {comTroca.length > 0 && (
                  <div>
                    <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Trocam valor que já existia ({formatInt(comTroca.length)})
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                      O arquivo está discordando do sistema. Confira o sentido de cada seta: se um
                      valor está <em>regredindo</em>, o download pode estar desatualizado.
                    </p>
                    <ul className="mt-2 space-y-2">
                      {comTroca.map((item) => (
                        <CarroDiff key={`${item.linha}-${item.repasse_id}`} item={item} destaque />
                      ))}
                    </ul>
                  </div>
                )}

                {soPreenche.length > 0 && (
                  <Colapsavel
                    titulo={`Só preenchem campo vazio (${formatInt(soPreenche.length)})`}
                    icone={<PlusCircle className="h-3.5 w-3.5 text-emerald-600" />}
                    abertoInicial={comTroca.length === 0}
                    nota="Campo que estava em branco ganhando valor pela primeira vez. Nenhum número existente é sobrescrito aqui. Na primeira importação este grupo é grande de propósito: as colunas Maior oferta e Qtde de anúncios ainda estavam vazias em todo mundo."
                  >
                    <ul className="mt-2 space-y-2">
                      {soPreenche.map((item) => (
                        <CarroDiff key={`${item.linha}-${item.repasse_id}`} item={item} />
                      ))}
                    </ul>
                  </Colapsavel>
                )}
              </div>
            )}
          </section>

          {/* ─── Grupo: saíram do arquivo (diff de conjunto, no cliente) ──── */}
          <SumidosDoArquivoPainel
            placasNoArquivo={placasNoArquivo}
            onGravou={(n) => setGravadoNoPainel((v) => v + n)}
          />

          {/* ─── Grupo: sem alteração ─────────────────────────────────────── */}
          <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
            <Colapsavel
              titulo={`Sem alteração (${formatInt(rel.resumo.sem_alteracao)})`}
              icone={<CheckCircle2 className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
              abertoInicial={false}
              nota={
                rel.resumo.sem_alteracao === 0
                  ? "Nenhum carro ficou igual — o normal na PRIMEIRA sincronização, porque as duas colunas novas estavam vazias em todo mundo. Da segunda importação em diante o esperado é o inverso: quase tudo aqui."
                  : "O arquivo conferiu estes carros contra o banco e achou os mesmos valores. Nenhuma linha é gravada, nem a data de atualização muda."
              }
            >
              {rel.sem_alteracao.length > 0 && (
                <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                  {rel.sem_alteracao.map((s) => (
                    <li key={`${s.linha}-${s.repasse_id}`} className="flex items-baseline gap-2 truncate">
                      <Placa valor={s.placa_norm} />
                      <span className="truncate text-[var(--text-muted)]">{s.modelo ?? "—"}</span>
                      <span className="shrink-0 text-[10px] text-[var(--text-subtle)]">
                        {formatInt(s.campos_observados)} campos conferidos
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Colapsavel>
          </section>

          {/* ─── Grupo: não encontradas ───────────────────────────────────── */}
          <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
            <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)]">
              <Ban className="h-4 w-4 text-[var(--text-muted)]" />
              Não encontradas ({formatInt(rel.resumo.nao_encontradas)})
            </h3>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Placas do arquivo sem repasse ativo correspondente. O arquivo{" "}
              <strong>nunca cria carro</strong>.
            </p>
            {rel.nao_encontradas.length === 0 ? (
              <p className="mt-3 text-xs text-[var(--text-muted)]">Todas as placas casaram.</p>
            ) : (
              <ul className="mt-3 space-y-1.5 text-xs">
                {rel.nao_encontradas.map((n) => (
                  <li key={`${n.linha}-${n.placa_norm}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <Placa valor={n.placa_norm} />
                    <span className="text-[var(--text-muted)]">
                      linha {formatInt(n.linha)} — {rotuloMotivoNaoEncontrada(n.motivo)}
                      {n.status_atual ? ` (status atual: ${n.status_atual})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ─── Grupo: ignoradas ─────────────────────────────────────────── */}
          <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
            <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)]">
              <Ban className="h-4 w-4 text-[var(--text-muted)]" />
              Ignoradas ({formatInt(rel.resumo.ignoradas)})
            </h3>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Linhas descartadas antes do casamento com o banco, cada uma com o motivo.
            </p>
            {rel.ignoradas.length === 0 ? (
              <p className="mt-3 text-xs text-[var(--text-muted)]">Nenhuma linha descartada.</p>
            ) : (
              <ul className="mt-3 space-y-1.5 text-xs">
                {rel.ignoradas.map((g) => (
                  <li key={`${g.linha}-${g.placa_norm}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <Placa valor={g.placa_norm} />
                    <span className="text-[var(--text-muted)]">
                      linha {formatInt(g.linha)} — {rotuloMotivoIgnorada(g.motivo)}
                      {g.repasse_ids ? ` (repasses ${g.repasse_ids.join(", ")})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ─── Grupo: outra loja (filtrado no cliente, nunca foi à RPC) ─── */}
          <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
            <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)]">
              <MapPin className="h-4 w-4 text-[var(--text-muted)]" />
              De outra loja ({formatInt(outraLoja.length)})
            </h3>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Deixadas de fora de propósito: o sync só sincroniza a Matriz. Estas linhas nem foram
              enviadas ao sistema.
            </p>
            {outraLoja.length === 0 ? (
              <p className="mt-3 text-xs text-[var(--text-muted)]">
                Todas as linhas do arquivo são da Matriz.
              </p>
            ) : (
              <ul className="mt-3 space-y-1.5 text-xs">
                {outraLoja.map((o) => (
                  <li key={`${o.linha}-${o.placa_norm}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <Placa valor={o.placa_norm} />
                    <span className="truncate text-[var(--text-muted)]">{o.modelo ?? "—"}</span>
                    <span className="rounded bg-[var(--bg-muted)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                      {o.loja}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ─── Barra de ação ───────────────────────────────────────────────── */}
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
          <span className="min-w-0 flex-1 text-xs text-[var(--text-muted)]">
            {aplicado
              ? `${formatInt(aplicado.resumo.linhas_gravadas)} gravados · ${formatInt(rel.resumo.sem_alteracao)} sem alteração · ${formatInt(rel.resumo.nao_encontradas)} não encontradas · ${formatInt(rel.resumo.ignoradas)} ignoradas`
              : "A SINCRONIZAÇÃO não grava nada até você clicar. O sistema recalcula tudo de novo no clique — nunca grava o que está na tela."}
            {gravadoNoPainel > 0 && (
              <span className="mt-1 flex items-start gap-1.5 font-medium text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {formatInt(gravadoNoPainel)}{" "}
                  {gravadoNoPainel === 1 ? "alteração já gravada" : "alterações já gravadas"} no
                  painel &quot;saíram do Auto Avaliar&quot; (venda registrada ou repasse removido).{" "}
                  <strong>Descartar não desfaz isso.</strong>
                </span>
              </span>
            )}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onFechar}
              disabled={aplicando}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border-base)] px-4 py-2 text-sm font-medium text-[var(--text-body)] hover:bg-[var(--bg-muted)] disabled:opacity-50"
            >
              {aplicado ? <CheckCircle2 className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
              {/* "Descartar A IMPORTAÇÃO": o escopo tem que estar no rótulo. O botão
                  joga fora o arquivo conferido, não as gravações do painel abaixo. */}
              {aplicado ? "Fechar" : "Descartar a importação"}
            </button>
            {!aplicado && (
              <button
                type="button"
                onClick={() => void aplicar()}
                disabled={aplicando || nadaPraGravar || contagemQuebrada}
                title={
                  contagemQuebrada
                    ? "A soma dos grupos não fecha com o total de linhas — gravação bloqueada."
                    : nadaPraGravar
                      ? "Nada mudou — não há o que gravar."
                      : undefined
                }
                className="inline-flex items-center gap-2 rounded-md bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-800)] disabled:opacity-50"
              >
                {aplicando ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {aplicando
                  ? "Gravando…"
                  : `Confirmar e gravar (${formatInt(rel.resumo.com_alteracao)})`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Peças ───────────────────────────────────────────────────────────────────

/** Um carro do grupo "vão mudar", com o diff campo a campo. */
function CarroDiff({ item, destaque = false }: { item: ItemComAlteracao; destaque?: boolean }) {
  return (
    <li
      className={cn(
        "rounded-lg border p-3",
        destaque
          ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
          : "border-[var(--border-soft)] bg-[var(--bg-muted)]",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Placa valor={item.placa_norm} />
        <span className="truncate text-xs text-[var(--text-body)]">{item.modelo ?? "—"}</span>
        {item.status && (
          <span className="rounded bg-[var(--bg-surface)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
            {item.status}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-[var(--text-subtle)]">
          linha {formatInt(item.linha)}
        </span>
      </div>

      <ul className="mt-2 space-y-1">
        {item.campos.map((c) => (
          <LinhaDiff key={c.campo} diff={c} />
        ))}
      </ul>

      {item.campos_observados_sem_mudanca.length > 0 && (
        <p className="mt-2 text-[10px] text-[var(--text-subtle)]">
          O arquivo confirmou, iguais ao sistema:{" "}
          {item.campos_observados_sem_mudanca.map(rotuloCampo).join(" · ")}
        </p>
      )}
    </li>
  );
}

/** `campo · antes → depois`, com o tom vindo da `acao` que a RPC decidiu. */
function LinhaDiff({ diff }: { diff: DiffCampo }) {
  const troca = diff.acao === "altera";
  return (
    <li className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
      <span className="font-medium text-[var(--text-body)]">{rotuloCampo(diff.campo)}</span>
      <span className="text-[var(--text-subtle)]">·</span>
      <span
        className={cn(
          "tabular-nums",
          troca ? "text-[var(--text-muted)] line-through" : "italic text-[var(--text-subtle)]",
        )}
      >
        {formatarValorCampo(diff.campo, diff.antes)}
      </span>
      <ArrowRight className="h-3 w-3 shrink-0 text-[var(--text-subtle)]" />
      <span
        className={cn(
          "font-semibold tabular-nums",
          troca
            ? "text-amber-800 dark:text-amber-300"
            : "text-emerald-700 dark:text-emerald-400",
        )}
      >
        {formatarValorCampo(diff.campo, diff.depois)}
      </span>
      <span
        className={cn(
          "rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
          troca
            ? "bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200"
            : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
        )}
      >
        {troca ? "troca" : "preenche"}
      </span>
    </li>
  );
}

function Placa({ valor }: { valor: string | null }) {
  return (
    <span className="shrink-0 font-mono text-xs font-semibold text-[var(--text-strong)]">
      {valor ?? "sem placa"}
    </span>
  );
}

function Tile({
  rotulo,
  valor,
  tom,
}: {
  rotulo: string;
  valor: number;
  tom: "sky" | "neutro";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        tom === "sky"
          ? "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30"
          : "border-[var(--border-soft)] bg-[var(--bg-surface)]",
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {rotulo}
      </p>
      <p
        className={cn(
          "mt-0.5 text-xl font-bold tabular-nums",
          tom === "sky" ? "text-sky-800 dark:text-sky-300" : "text-[var(--text-strong)]",
        )}
      >
        {formatInt(valor)}
      </p>
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
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-body)] hover:text-[var(--text-strong)]"
      >
        {aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {icone}
        {titulo}
      </button>
      <p className="mt-1 text-[11px] text-[var(--text-muted)]">{nota}</p>
      {aberto && children}
    </div>
  );
}

/** `2026-08-11T17:48:53-03:00` → `11/08/2026 17:48`. Só recorta a string, não converte fuso. */
function formatarInstante(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : iso;
}
