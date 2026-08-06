"use client";
/* eslint-disable react-hooks/set-state-in-effect --
 * Carga inicial async via Supabase. Mesmo padrão do RepassesLista/VeiculoDetalhe:
 * o effect dispara fetch e o estado é setado quando a Promise resolve.
 */

/**
 * Mini-CRM de Interessados por carro — quem visualizou o anúncio no Auto Avaliar.
 *
 * Fonte de dados: `lead_interesses` (filtrado pelo repasse), com join no lead
 * pra trazer nome/whatsapp/email/cidade. Cada linha tem link "Ver lead" pro CRM
 * central de leads.
 *
 * Padrão de inline edit + patch otimista replicado do RepassesLista (status e
 * observação editáveis na linha; salva em background; rollback se o banco recusa).
 *
 * O WhatsApp abre via link wa.me em nova aba — NÃO dispara nada automático.
 * O `window.open` acontece SÍNCRONO, antes de qualquer await: se vier depois de
 * um await o navegador trata como popup não solicitado e bloqueia. O registro do
 * contato (RPC `marcar_lead_contatado`, via `registrarContatoLead`) vai em
 * background — não pode depender de o usuário voltar da aba do WhatsApp.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  MessageCircle,
  Eye,
  Flame,
  Trash2,
  Users,
  UserPlus,
  ExternalLink,
} from "lucide-react";
import { getRepasse } from "@/lib/repasses/queries";
import type { Repasse } from "@/lib/repasses/types";
import {
  deleteInteresse,
  importarInteressesDeRepasse,
  listInteressesPorRepasse,
  listOutrosInteressesDeLeads,
  updateInteresse,
  STATUS_FOLLOWUP_LABEL,
  STATUS_FOLLOWUP_VALUES,
  type LeadInteresseComLead,
  type LeadInteressePatch,
  type OutroInteresseRepasse,
  type StatusFollowup,
} from "@/lib/leads/interesses";
import {
  aplicarContatoOtimista,
  desfazerContatoLead,
  mensagemEscopoInesperado,
  registrarContatoLead,
  reverterContatoOtimista,
  type ContatoAnterior,
} from "@/lib/leads/contato";
import { contarComStatusRelacionamento } from "@/lib/leads/leads";
import {
  ehAltaIntencao,
  filtrarFilaInteressados,
  LIMIAR_ALTA_INTENCAO,
  ordenarFilaInteressados,
} from "@/lib/leads/fila-interessados";
import {
  getDadosMargemRepasse,
  type DadosMargemRepasse,
} from "@/lib/repasses/anuncio-queries";
import {
  gerarMensagemNegociacao,
  repasseParaCarro,
} from "@/lib/repasses/gerar-mensagem-lead";
import {
  classificarBadge,
  simularLance,
  COR_MARGEM_EMOJI,
  COR_MARGEM_LABEL,
  type CorMargem,
} from "@/lib/repasses/margem-repasse";
import { cn, formatBRLCents, formatInt } from "@/lib/utils";
import { formatarDataBR, hojeLocal } from "@/lib/utils/data-local";
import { parseValorBR } from "@/lib/utils/parse-br";
import { showErrorToast, showInfoToast, showSuccessToast } from "@/components/ui/Toast";
import { ImportarInteressadosModal } from "./ImportarInteressadosModal";
import { MensagemLeadModal } from "./MensagemLeadModal";

export function InteressadosCRM({ repasseId }: { repasseId: number }) {
  const [repasse, setRepasse] = useState<Repasse | null>(null);
  const [interesses, setInteresses] = useState<LeadInteresseComLead[]>([]);
  const [margem, setMargem] = useState<DadosMargemRepasse | null>(null);
  const [crossSell, setCrossSell] = useState<Map<number, OutroInteresseRepasse[]>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Filtros rápidos da fila (client-only, sobre dados já carregados).
  const [filtroAltaIntencao, setFiltroAltaIntencao] = useState(false);
  const [filtroSemContato, setFiltroSemContato] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importando, setImportando] = useState(false);
  const [verMensagem, setVerMensagem] = useState<LeadInteresseComLead | null>(null);

  // Carga inicial: carro + lista de interesses (com lead embutido) + margem +
  // cross-sell (outros carros que cada lead também quer).
  useEffect(() => {
    if (!Number.isFinite(repasseId)) {
      setErro("Repasse inválido.");
      setCarregando(false);
      return;
    }
    let vivo = true;
    (async () => {
      try {
        const [r, lista, dadosMargem] = await Promise.all([
          getRepasse(repasseId),
          listInteressesPorRepasse(repasseId),
          getDadosMargemRepasse(repasseId),
        ]);
        if (!vivo) return;
        setRepasse(r);
        setInteresses(lista);
        setMargem(dadosMargem);

        // Cross-sell é best-effort: se falhar, só o badge "+N carros" some.
        // Nunca derruba a tela — não seta `erro` da página.
        try {
          const cross = await listOutrosInteressesDeLeads(
            lista.map((i) => i.lead_id),
            repasseId,
          );
          if (!vivo) return;
          setCrossSell(cross);
        } catch {
          if (!vivo) return;
          setCrossSell(new Map());
        }
      } catch (e) {
        if (!vivo) return;
        setErro(e instanceof Error ? e.message : String(e));
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [repasseId]);

  // ─── KPIs do funil (sempre sobre a lista completa, não a filtrada) ──────────
  const kpis = useMemo(
    () =>
      contarComStatusRelacionamento(
        interesses.map((i) => ({ status_relacionamento: i.status_followup })),
      ),
    [interesses],
  );

  // ─── Fila de prioridade: filtra pelos chips e ordena (lead quente no topo) ──
  const listaFila = useMemo(
    () =>
      ordenarFilaInteressados(
        filtrarFilaInteressados(interesses, {
          altaIntencao: filtroAltaIntencao,
          semContato: filtroSemContato,
        }),
      ),
    [interesses, filtroAltaIntencao, filtroSemContato],
  );

  // ─── Importar (RPC dedup server-side) ────────────────────────────────────────
  const handleImportar = useCallback(
    async (textoColado: string) => {
      setImportando(true);
      try {
        const res = await importarInteressesDeRepasse(repasseId, textoColado);
        // Recarrega a lista (o RPC criou/atualizou no servidor).
        const lista = await listInteressesPorRepasse(repasseId);
        setInteresses(lista);
        setImportOpen(false);
        showSuccessToast(
          `${res.leads_novos} lead(s) novo(s) · ${res.leads_existentes} já existia(m) · ` +
            `${res.interesses_novos} interesse(s) novo(s)` +
            (res.interesses_ignorados > 0
              ? ` · ${res.interesses_ignorados} ignorado(s)`
              : ""),
        );
      } catch (e) {
        showErrorToast(`Erro ao importar: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setImportando(false);
      }
    },
    [repasseId],
  );

  // ─── Patch otimista (status / observação / data_contato) ─────────────────────
  const handlePatch = useCallback(
    async (id: number, patch: LeadInteressePatch) => {
      const anterior = interesses.find((i) => i.id === id);
      if (!anterior) return;

      setInteresses((prev) =>
        prev.map((i) =>
          i.id === id
            ? {
                ...i,
                ...("status_followup" in patch && patch.status_followup
                  ? { status_followup: patch.status_followup }
                  : {}),
                ...("observacao" in patch ? { observacao: patch.observacao ?? null } : {}),
                ...("data_contato" in patch ? { data_contato: patch.data_contato ?? null } : {}),
              }
            : i,
        ),
      );

      try {
        const atualizado = await updateInteresse(id, patch);
        // Mantém os campos do lead embutido (o update não os retorna).
        setInteresses((prev) =>
          prev.map((i) => (i.id === id ? { ...i, ...atualizado } : i)),
        );
      } catch (e) {
        setInteresses((prev) => prev.map((i) => (i.id === id ? anterior : i)));
        showErrorToast(`Erro ao salvar: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [interesses],
  );

  // Mensagem de negociação (base 'visualizou' + compre-por + gancho FIPE quando
  // houver). Degrada sem "undefined" se o carro estiver sem dados de margem.
  const montarMensagem = useCallback(
    (nome: string): string | null => {
      if (!repasse) return null;
      return gerarMensagemNegociacao(
        repasseParaCarro(repasse),
        { nome },
        { comprePor: margem?.comprePor ?? null, fipe: margem?.fipe ?? null },
      );
    },
    [repasse, margem],
  );

  // ─── Registro de contato ─────────────────────────────────────────────────────
  // Chamado DEPOIS que a aba do WhatsApp já abriu. Nunca dá await no caller:
  // o registro roda em background e se resolve sozinho (toast de sucesso com
  // "Desfazer", ou rollback + toast de erro com "Tentar de novo").
  const registrarContato = useCallback((interesse: LeadInteresseComLead) => {
    const anterior: ContatoAnterior = {
      status_followup: interesse.status_followup,
      data_contato: interesse.data_contato,
    };
    const hoje = hojeLocal();

    // Nomeada pra que o "Tentar de novo" reexecute o fluxo inteiro (otimismo +
    // RPC) sem o callback precisar depender de si mesmo.
    function disparar() {
      // Patch otimista escopado no id — os outros carros do mesmo lojista
      // voltam por referência, intocados.
      setInteresses((prev) => aplicarContatoOtimista(prev, interesse.id, hoje));

      void (async () => {
        try {
          // registrarContatoLead já embute 1 retry automático.
          const resultado = await registrarContatoLead({
            leadId: interesse.lead_id,
            interesseId: interesse.id,
            repasseId: interesse.repasse_id,
            statusAtual: anterior.status_followup,
          });

          // Escopo inesperado: a RPC caiu no fallback e marcou 0 ou N interesses em
          // vez do carro pedido. O "Desfazer" é escopado num interesse só — ofertá-lo
          // reverteria 1 de N e deixaria o resto marcado silenciosamente.
          if (resultado.escopoInesperado) {
            showErrorToast(mensagemEscopoInesperado(resultado.interessesMarcados), {
              duracaoMs: 12000,
            });
            return;
          }

          // Já havia contato antes? Avisa com a data pra Marcos não repetir
          // abordagem sem saber (mesmo carro ofertado de novo ao mesmo lojista).
          const base = `Contato com ${interesse.lead_nome} registrado hoje.`;
          const msg =
            anterior.data_contato != null
              ? `${base} Já havia contato em ${formatarDataBR(anterior.data_contato)}.`
              : base;

          showSuccessToast(msg, {
            duracaoMs: 8000,
            acao: {
              label: "Desfazer",
              onClick: () => {
                setInteresses((prev) =>
                  reverterContatoOtimista(prev, interesse.id, anterior),
                );
                // `statusPromovido` leva o desfazer até `leads.status_relacionamento`:
                // sem ele o lead ficava 'contatado' sem contato registrado. Essa tela
                // não exibe o status do lead, então aqui só o banco precisa voltar.
                void desfazerContatoLead({
                  leadId: interesse.lead_id,
                  interesseId: interesse.id,
                  anterior,
                  statusPromovido: resultado.statusPromovido,
                  dataContato: resultado.dataContato,
                }).catch((e: unknown) => {
                  // Falhou o desfazer: a UI volta pro estado contatado (que é o
                  // que o banco tem) pra não mentir pro usuário.
                  setInteresses((prev) => aplicarContatoOtimista(prev, interesse.id, hoje));
                  showErrorToast(
                    `Não consegui desfazer: ${e instanceof Error ? e.message : String(e)}`,
                  );
                });
              },
            },
          });
        } catch (e) {
          // Rollback visual: a linha volta exatamente como estava. A aba do
          // WhatsApp já aberta NÃO é revertida — o contato aconteceu de fato.
          setInteresses((prev) => reverterContatoOtimista(prev, interesse.id, anterior));
          showErrorToast(
            `Não consegui registrar o contato: ${e instanceof Error ? e.message : String(e)}`,
            { duracaoMs: 8000, acao: { label: "Tentar de novo", onClick: disparar } },
          );
        }
      })();
    }

    disparar();
  }, []);

  // ─── WhatsApp ────────────────────────────────────────────────────────────────
  const handleWhatsapp = useCallback(
    (interesse: LeadInteresseComLead) => {
      if (!repasse) return;
      // Sem celular: botão já vem desabilitado; aqui é defesa em profundidade.
      // Nada é gravado.
      if (!interesse.lead_telefone_whatsapp) {
        showInfoToast("Esse lead não tem celular pra WhatsApp.");
        return;
      }
      const msg = montarMensagem(interesse.lead_nome);
      if (msg == null) return;

      // 1º e SÍNCRONO — depois de um await o navegador bloqueia o popup.
      const url = `https://wa.me/${interesse.lead_telefone_whatsapp}?text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank", "noopener");

      // 2º, sem await: não depende de o usuário voltar da aba do WhatsApp.
      registrarContato(interesse);
    },
    [repasse, montarMensagem, registrarContato],
  );

  // ─── Remover ─────────────────────────────────────────────────────────────────
  const handleRemover = useCallback(
    async (id: number) => {
      const anterior = interesses;
      setInteresses((prev) => prev.filter((i) => i.id !== id));
      try {
        await deleteInteresse(id);
      } catch (e) {
        setInteresses(anterior);
        showErrorToast(`Erro ao remover: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [interesses],
  );

  if (carregando) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando interessados…
      </div>
    );
  }

  if (erro) {
    return <p className="text-sm text-red-700 dark:text-red-400">Erro: {erro}</p>;
  }

  const ano = repasse?.ano_modelo ?? repasse?.ano_fabricacao ?? null;

  return (
    <div className="space-y-6">
      {/* Cabeçalho: voltar + dados do carro */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/repasses"
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Repasses
          </Link>
          {repasse && (
            <div>
              <h2 className="text-base font-bold text-[var(--text-strong)]">
                {repasse.modelo}
                {ano != null ? ` ${ano}` : ""}
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                <span className="font-mono">{repasse.placa}</span>
                {repasse.km != null ? ` · ${formatInt(repasse.km)} km` : ""}
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--brand-700)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--brand-800)]"
        >
          <UserPlus className="h-4 w-4" /> Importar do Auto Avaliar
        </button>
      </div>

      {/* Painel de negociação: custo/mínimo/compre-por + semáforo + simulador */}
      {margem && <PainelNegociacao margem={margem} />}

      {/* KPIs do funil */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiFunil label="Novos" value={kpis.novo} tone="info" />
        <KpiFunil label="Contatados" value={kpis.contatado} tone="neutro" />
        <KpiFunil label="Responderam" value={kpis.respondeu} tone="info" />
        <KpiFunil label="Negociando" value={kpis.negociando} tone="warn" />
        <KpiFunil label="Fecharam" value={kpis.fechou} tone="good" />
        <KpiFunil label="Perdidos" value={kpis.perdido} tone="bad" />
      </div>

      {/* Chips de filtro rápido (fila) */}
      {interesses.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Filtrar:
          </span>
          <ChipFiltro
            ativo={filtroAltaIntencao}
            onClick={() => setFiltroAltaIntencao((v) => !v)}
          >
            <Flame className="h-3 w-3" /> Alta intenção
          </ChipFiltro>
          <ChipFiltro
            ativo={filtroSemContato}
            onClick={() => setFiltroSemContato((v) => !v)}
          >
            Sem contato
          </ChipFiltro>
          <span className="text-[11px] text-[var(--text-muted)]">
            {listaFila.length} de {interesses.length}
          </span>
        </div>
      )}

      {/* Tabela */}
      {interesses.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-base)] p-10 text-center">
          <Users className="mx-auto h-8 w-8 text-[var(--text-subtle)]" />
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Nenhum interessado ainda. Clique em “Importar do Auto Avaliar” pra colar a lista de
            quem visualizou o anúncio.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border-soft)]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border-soft)] bg-[var(--bg-muted)] text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              <tr>
                <Th>Nome</Th>
                <Th>Cidade/UF</Th>
                <Th>WhatsApp</Th>
                <Th>E-mail</Th>
                <Th className="text-right">Views</Th>
                <Th>Status</Th>
                <Th>Observação</Th>
                <Th className="text-right">Ações</Th>
              </tr>
            </thead>
            <tbody>
              {listaFila.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">
                    Nenhum interessado no filtro atual.
                  </td>
                </tr>
              ) : (
                listaFila.map((i) => (
                <tr
                  key={i.id}
                  className="border-b border-[var(--border-soft)] last:border-0 hover:bg-[var(--bg-muted)]"
                >
                  <Td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        href={`/leads/${i.lead_id}`}
                        className="inline-flex items-center gap-1 font-medium text-[var(--text-strong)] hover:text-[var(--brand-700)] hover:underline"
                        title="Ver lead"
                      >
                        {i.lead_nome}
                      </Link>
                      {ehAltaIntencao(i.qtd_visualizacoes) && <BadgeAltaIntencao />}
                      <BadgeCrossSell outros={crossSell.get(i.lead_id)} />
                    </div>
                  </Td>
                  <Td className="text-xs text-[var(--text-muted)]">{i.lead_cidade_uf ?? "—"}</Td>
                  <Td className="font-mono text-xs">
                    {i.lead_telefone_whatsapp ?? (
                      <span className="text-amber-700 dark:text-amber-400">—</span>
                    )}
                  </Td>
                  <Td className="text-xs text-[var(--text-muted)]">{i.lead_email ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{i.qtd_visualizacoes}</Td>
                  <Td>
                    <StatusSelect
                      value={i.status_followup}
                      onChange={(v) => void handlePatch(i.id, { status_followup: v })}
                      nome={i.lead_nome}
                    />
                  </Td>
                  <Td>
                    <ObservacaoInput
                      value={i.observacao}
                      onCommit={(v) => void handlePatch(i.id, { observacao: v })}
                      nome={i.lead_nome}
                    />
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleWhatsapp(i)}
                        disabled={!i.lead_telefone_whatsapp}
                        title={
                          i.lead_telefone_whatsapp
                            ? "Abrir WhatsApp com mensagem pronta"
                            : "Sem celular pra WhatsApp"
                        }
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <MessageCircle className="h-3 w-3" /> WhatsApp
                      </button>
                      <button
                        type="button"
                        onClick={() => setVerMensagem(i)}
                        title="Ver/copiar a mensagem"
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
                      >
                        <Eye className="h-3 w-3" /> Mensagem
                      </button>
                      <Link
                        href={`/leads/${i.lead_id}`}
                        title="Ver lead completo"
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
                      >
                        <ExternalLink className="h-3 w-3" /> Ver lead
                      </Link>
                      <button
                        type="button"
                        onClick={() => void handleRemover(i.id)}
                        title="Remover interesse"
                        aria-label={`Remover interesse de ${i.lead_nome}`}
                        className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-800 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </Td>
                </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <ImportarInteressadosModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onConfirmar={handleImportar}
        importando={importando}
      />

      {verMensagem && repasse && (
        <MensagemLeadModal
          key={verMensagem.id}
          carro={repasseParaCarro(repasse)}
          nome={verMensagem.lead_nome}
          telefoneWhatsapp={verMensagem.lead_telefone_whatsapp}
          contexto="visualizou"
          mensagemInicial={montarMensagem(verMensagem.lead_nome) ?? undefined}
          aoAbrirWhatsapp={() => registrarContato(verMensagem)}
          open={true}
          onClose={() => setVerMensagem(null)}
        />
      )}
    </div>
  );
}

// ─── Subcomponentes ───────────────────────────────────────────────────────────

// ─── Painel de negociação (margem + semáforo + simulador) ────────────────────

function PainelNegociacao({ margem }: { margem: DadosMargemRepasse }) {
  const { custoReal, minimo, comprePor, fipe } = margem;
  const incompleto = custoReal == null || minimo == null || comprePor == null;
  const cor: CorMargem = incompleto
    ? "neutro"
    : classificarBadge(custoReal, minimo, comprePor).cor;

  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SemaforoBadge cor={cor} />
          <span className="text-sm font-semibold text-[var(--text-strong)]">
            Negociação
          </span>
          {incompleto && (
            <span className="text-xs italic text-[var(--text-subtle)]">
              sem dados de margem
            </span>
          )}
        </div>
        <SimuladorLance
          custoReal={custoReal}
          minimo={minimo}
          comprePor={comprePor}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ValorMargem label="Custo real" valor={custoReal} />
        <ValorMargem label="Mínimo" valor={minimo} />
        <ValorMargem label="Compre por" valor={comprePor} destaque />
        <ValorMargem label="FIPE" valor={fipe} />
      </div>
    </div>
  );
}

function ValorMargem({
  label,
  valor,
  destaque = false,
}: {
  label: string;
  valor: number | null;
  destaque?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-sm tabular-nums",
          destaque ? "font-bold text-[var(--text-strong)]" : "font-medium text-[var(--text-body)]",
        )}
      >
        {formatBRLCents(valor)}
      </p>
    </div>
  );
}

/** Simulador de lance inline — mesma lógica canônica do relatório de anúncio. */
function SimuladorLance({
  custoReal,
  minimo,
  comprePor,
}: {
  custoReal: number | null;
  minimo: number | null;
  comprePor: number | null;
}) {
  const [raw, setRaw] = useState("");

  const sim = useMemo(() => {
    if (raw.trim() === "") return null;
    return simularLance(parseValorBR(raw), { custoReal, minimo, comprePor });
  }, [raw, custoReal, minimo, comprePor]);

  return (
    <div className="flex items-center gap-2">
      <label className="text-[11px] font-medium text-[var(--text-muted)]">
        Oferta do lojista
      </label>
      <input
        type="text"
        inputMode="decimal"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="R$"
        aria-label="Oferta do lojista"
        className="w-28 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-right text-xs tabular-nums text-[var(--text-body)] focus:border-[var(--brand-500)] focus:outline-none"
      />
      {sim && (
        <div className="min-w-[150px] text-xs leading-tight">
          {!sim.completo ? (
            <span className="italic text-[var(--text-subtle)]">{sim.motivo}</span>
          ) : (
            <div className="flex items-center gap-1.5">
              <SemaforoBadge cor={sim.cor} compact />
              <div>
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    sim.abaixoDoCusto ? "text-red-600 dark:text-red-400" : "text-[var(--text-strong)]",
                  )}
                >
                  {formatBRLCents(sim.margemValor)}
                </span>
                <span className="ml-1 text-[10px] text-[var(--text-muted)]">
                  {sim.margemPct == null ? "" : `(${sim.margemPct.toFixed(1)}%)`}
                </span>
                <div className="flex gap-1">
                  {sim.abaixoDoCusto && (
                    <span className="rounded bg-red-600 px-1 text-[9px] font-bold text-white">
                      PREJUÍZO
                    </span>
                  )}
                  {sim.abaixoDoMinimo && !sim.abaixoDoCusto && (
                    <span className="rounded bg-orange-500 px-1 text-[9px] font-bold text-white">
                      abaixo do mínimo
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Semáforo badge (mesmas cores do relatório de anúncio) ───────────────────

const COR_CLASSES: Record<CorMargem, string> = {
  verde: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  amarelo: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  laranja: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  vermelho: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  neutro: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};

function SemaforoBadge({ cor, compact = false }: { cor: CorMargem; compact?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium",
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
        COR_CLASSES[cor],
      )}
      title={COR_MARGEM_LABEL[cor]}
    >
      <span aria-hidden>{COR_MARGEM_EMOJI[cor]}</span>
      <span className="sr-only">{COR_MARGEM_LABEL[cor]}</span>
    </span>
  );
}

// ─── Chip de filtro rápido ───────────────────────────────────────────────────

function ChipFiltro({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        ativo
          ? "border-[var(--brand-600)] bg-[var(--brand-600)] text-white"
          : "border-[var(--border-base)] bg-[var(--bg-surface)] text-[var(--text-body)] hover:bg-[var(--bg-muted)]",
      )}
    >
      {children}
    </button>
  );
}

// ─── Marcadores da linha (alta intenção / cross-sell) ────────────────────────

function BadgeAltaIntencao() {
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange-700 dark:bg-orange-950 dark:text-orange-300"
      title={`Visualizou ${LIMIAR_ALTA_INTENCAO}+ vezes — lead quente`}
    >
      <Flame className="h-2.5 w-2.5" /> alta intenção
    </span>
  );
}

function BadgeCrossSell({ outros }: { outros: OutroInteresseRepasse[] | undefined }) {
  if (!outros || outros.length === 0) return null;
  const modelos = outros.map((o) => o.modelo).join(", ");
  return (
    <span
      className="inline-flex items-center rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300"
      title={`Também quer: ${modelos}`}
    >
      também quer +{outros.length} carro{outros.length > 1 ? "s" : ""}
    </span>
  );
}

function KpiFunil({
  label,
  value,
  tone = "neutro",
}: {
  label: string;
  value: number;
  tone?: "neutro" | "good" | "warn" | "bad" | "info";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-700 dark:text-amber-400"
        : tone === "bad"
          ? "text-red-700 dark:text-red-400"
          : tone === "info"
            ? "text-blue-700 dark:text-blue-400"
            : "text-[var(--text-body)]";
  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </p>
      <p className={cn("mt-1 text-xl font-bold tabular-nums", toneClass)}>{value}</p>
    </div>
  );
}

const SELECT_BASE =
  "w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[11px] text-[var(--text-body)] focus:border-[var(--brand-500)] focus:outline-none";

function corStatus(s: StatusFollowup): string {
  switch (s) {
    case "novo":
      return "bg-blue-50 dark:bg-blue-950/30";
    case "contatado":
      return "bg-[var(--bg-muted)]";
    case "respondeu":
      return "bg-blue-50 dark:bg-blue-950/30";
    case "negociando":
      return "bg-amber-50 dark:bg-amber-950/30";
    case "fechou":
      return "bg-emerald-50 dark:bg-emerald-950/30";
    case "perdido":
      return "bg-red-50 dark:bg-red-950/30";
  }
}

function StatusSelect({
  value,
  onChange,
  nome,
}: {
  value: StatusFollowup;
  onChange: (v: StatusFollowup) => void;
  nome: string;
}) {
  return (
    <select
      aria-label={`Status de ${nome}`}
      className={cn(SELECT_BASE, "min-w-[120px]", corStatus(value))}
      value={value}
      onChange={(e) => onChange(e.target.value as StatusFollowup)}
    >
      {STATUS_FOLLOWUP_VALUES.map((v) => (
        <option key={v} value={v}>
          {STATUS_FOLLOWUP_LABEL[v]}
        </option>
      ))}
    </select>
  );
}

/** Observação inline — commit no blur/Enter, Escape reverte. */
function ObservacaoInput({
  value,
  onCommit,
  nome,
}: {
  value: string | null;
  onCommit: (v: string | null) => void;
  nome: string;
}) {
  const [draft, setDraft] = useState<string>(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  function commit() {
    const novo = draft.trim() === "" ? null : draft;
    if (novo === (value ?? null)) return;
    onCommit(novo);
  }

  return (
    <input
      type="text"
      aria-label={`Observação de ${nome}`}
      placeholder="—"
      className="w-full min-w-[200px] truncate rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[11px] text-[var(--text-body)] focus:border-[var(--brand-500)] focus:outline-none"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(value ?? "");
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2 text-left", className)}>{children}</th>;
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2", className)}>{children}</td>;
}
