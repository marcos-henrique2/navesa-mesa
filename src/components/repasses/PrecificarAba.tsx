"use client";
/* eslint-disable react-hooks/set-state-in-effect --
 * O deep-link `?placa=` (AC30) é estado EXTERNO (a URL) do qual esta tela se
 * sincroniza: ler a query e disparar a busca é exatamente "subscrever a um
 * sistema externo". A regra é conservadora demais aqui — mesmo precedente do
 * AppShell, do PrecificacaoBlock e do FlagsVeiculo.
 */

/**
 * Aba `/precificar` — Story 3.1a.
 *
 * Fluxo: placa → dados do carro → sugestão dos DOIS preços do anúncio →
 * editar → aplicar (snapshot + UPDATE + carimbo).
 *
 * A metade "avaliar oferta recebida" é a 3.1b e NÃO entra aqui.
 *
 * ⚠️ A tela não pode apresentar o número como verdade fechada: a régua é de
 * n=16, em 3 meses. Por isso a `justificativa` fica visível (é o que faz a aba
 * ser usada — sem o porquê, o Marcos volta a precificar no olho) e os dois
 * campos são editáveis.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
  Loader2,
  Plus,
  RotateCcw,
  Search,
} from "lucide-react";
import { cn, formatBRL, formatBRLCents, formatInt } from "@/lib/utils";
import { parseValorBR } from "@/lib/utils/parse-br";
import { formatarDataBR } from "@/lib/utils/data-local";
import { STATUS_LABEL } from "@/lib/repasses/types";
import {
  CONFIANCA_LABEL,
  CONFIANCA_MOTIVO,
  REGUA_PADRAO,
  sugerirPrecoRepasse,
  type ResultadoSugestao,
  type SugestaoPrecoRepasse,
} from "@/lib/pricing/sugerir-preco-repasse";
import { montarSnapshotPrecificacao, type CarimboAplicado } from "@/lib/pricing/snapshot-precificacao";
import {
  aplicarPrecoRepasse,
  buscarCarroPorPlaca,
  carimbarSnapshotAplicado,
  criarGastoRepasse,
  type CarroPrecificar,
  type ResultadoBuscaPlaca,
} from "@/lib/repasses/precificar-queries";
import { showErrorToast, showSuccessToast } from "@/components/ui/Toast";

// ─── Helpers de formulário ───────────────────────────────────────────────────

/** number → texto do input, no formato que o Marcos digita ("106600,00"). */
function paraInput(v: number): string {
  return v.toFixed(2).replace(".", ",");
}

type CarimboPendente = { snapshotId: number; carimbo: CarimboAplicado };

// ═════════════════════════════════════════════════════════════════════════════

export function PrecificarAba() {
  const router = useRouter();
  const searchParams = useSearchParams();
  /** Deep-link vindo do /repasses (AC30) — volta pra lista depois de aplicar. */
  const placaDaUrl = searchParams.get("placa") ?? "";
  const veioDeDeepLink = useRef(placaDaUrl !== "");

  const [termo, setTermo] = useState(placaDaUrl);
  const [buscando, setBuscando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoBuscaPlaca | null>(null);
  const [erroBusca, setErroBusca] = useState<string | null>(null);

  // `null` = ainda não editado ⇒ o campo segue a sugestão automaticamente.
  const [minimoInput, setMinimoInput] = useState<string | null>(null);
  const [comprePorInput, setComprePorInput] = useState<string | null>(null);

  const [aplicando, setAplicando] = useState(false);
  const [carimboPendente, setCarimboPendente] = useState<CarimboPendente | null>(null);

  const [gastoValor, setGastoValor] = useState("");
  const [gastoDescricao, setGastoDescricao] = useState("");
  const [lancandoGasto, setLancandoGasto] = useState(false);

  const carro = resultado?.encontrado ? resultado.carro : null;

  const buscar = useCallback(async (placa: string) => {
    const alvo = placa.trim();
    if (alvo === "") return;
    setBuscando(true);
    setErroBusca(null);
    setCarimboPendente(null);
    setMinimoInput(null);
    setComprePorInput(null);
    try {
      setResultado(await buscarCarroPorPlaca(alvo));
    } catch (e) {
      setResultado(null);
      setErroBusca(e instanceof Error ? e.message : "Não foi possível buscar a placa.");
    } finally {
      setBuscando(false);
    }
  }, []);

  // Deep-link: `?placa=XXX0000` já vem carregado (AC30). Roda quando a URL muda.
  useEffect(() => {
    if (placaDaUrl !== "") void buscar(placaDaUrl);
  }, [placaDaUrl, buscar]);

  // ── Sugestão (recalcula sozinha quando um gasto entra — AC9) ──────────────
  const sugestaoResultado: ResultadoSugestao | null = useMemo(() => {
    if (!carro) return null;
    return sugerirPrecoRepasse({
      valorCompraRepasse: carro.valorCompraRepasse,
      gastos: carro.gastos.map((g) => g.valor),
      valorAutoAvaliar: carro.valorAutoAvaliar,
      valorFipe: carro.valorFipe,
      km: carro.km,
      anoModelo: carro.anoModelo,
      anoReferencia: new Date().getFullYear(),
      diasNoRepasse: carro.diasNoRepasse,
      diasAproximados: carro.diasAproximados,
      qtdeAnuncios: carro.qtdeAnuncios,
    });
  }, [carro]);

  const sugestao: SugestaoPrecoRepasse | null =
    sugestaoResultado != null && sugestaoResultado.ok ? sugestaoResultado : null;

  // ── Valores a aplicar ────────────────────────────────────────────────────
  // Prefill com o par ARREDONDADO, não com o centavo exato (decisão do Marcos,
  // 2026-08-12): é o número que ele digita no portal, então é ele que tem que
  // virar `minimo_aplicado`. Gravar o exato registraria um preço que nunca foi
  // ao ar — ruído no rótulo de calibração, que é a razão da tabela 030 existir.
  const minimoTexto = minimoInput ?? (sugestao ? paraInput(sugestao.minimoArredondado) : "");
  const comprePorTexto =
    comprePorInput ?? (sugestao ? paraInput(sugestao.comprePorArredondado) : "");
  const minimoAplicar = parseValorBR(minimoTexto);
  const comprePorAplicar = parseValorBR(comprePorTexto);

  const custoReal = sugestao?.custo.custoReal ?? null;
  const podeAplicar =
    carro != null &&
    carro.editavel &&
    sugestao != null &&
    minimoAplicar != null &&
    comprePorAplicar != null &&
    !aplicando &&
    carimboPendente == null;

  // ── Ações ────────────────────────────────────────────────────────────────

  async function onLancarGasto() {
    if (!carro) return;
    const valor = parseValorBR(gastoValor);
    if (valor == null || valor <= 0) {
      showErrorToast("Informe um valor de gasto maior que zero.");
      return;
    }
    setLancandoGasto(true);
    try {
      const novo = await criarGastoRepasse(carro.repasseId, valor, gastoDescricao);
      setResultado({ encontrado: true, carro: { ...carro, gastos: [...carro.gastos, novo] } });
      setGastoValor("");
      setGastoDescricao("");
      showSuccessToast("Gasto lançado — a sugestão foi recalculada.");
    } catch (e) {
      showErrorToast(e instanceof Error ? e.message : "Falha ao lançar o gasto.");
    } finally {
      setLancandoGasto(false);
    }
  }

  async function onAplicar() {
    if (!carro || !sugestao || minimoAplicar == null || comprePorAplicar == null) return;
    setAplicando(true);
    try {
      const { insert, carimbo } = montarSnapshotPrecificacao({
        repasseId: carro.repasseId,
        sugestao,
        aplicado: { minimo: minimoAplicar, comprePor: comprePorAplicar },
      });

      const r = await aplicarPrecoRepasse({
        insert,
        carimbo,
        atuais: { minimo: carro.valorMinimo, comprePor: carro.valorComprePor },
      });

      if (r.etapa === "falha_snapshot") {
        // Nada foi gravado — nem snapshot, nem preços. Retry é grátis.
        showErrorToast(
          `Não foi possível registrar a decisão, então NADA foi gravado: ${r.mensagem} Tente de novo.`,
          { duracaoMs: 10_000 },
        );
        return;
      }

      if (r.etapa === "falha_update") {
        // Rollback do estado otimista: os preços do repasse seguem os antigos.
        showErrorToast(
          `A decisão ficou registrada, mas os preços NÃO foram gravados no repasse: ${r.mensagem} Os valores da lista continuam os anteriores.`,
          { duracaoMs: 10_000 },
        );
        return;
      }

      if (r.etapa === "falha_carimbo") {
        // Pior dos três: repasse aplicado, snapshot dizendo "não aplicou".
        setCarimboPendente({ snapshotId: r.snapshotId, carimbo: r.carimbo });
        setResultado({
          encontrado: true,
          carro: { ...carro, valorMinimo: minimoAplicar, valorComprePor: comprePorAplicar },
        });
        return;
      }

      setResultado({
        encontrado: true,
        carro: { ...carro, valorMinimo: minimoAplicar, valorComprePor: comprePorAplicar },
      });
      // Centavos na confirmação: a mensagem que confirma a ESCRITA é o pior
      // lugar pra arredondar num projeto que trata R$ 0,01 como bug crítico.
      showSuccessToast(
        r.updatePulado
          ? `Decisão registrada. Os preços já eram esses (mínimo ${formatBRLCents(minimoAplicar)} · compre por ${formatBRLCents(comprePorAplicar)}) — nada mudou no repasse.`
          : `Preço aplicado: mínimo ${formatBRLCents(minimoAplicar)} · compre por ${formatBRLCents(comprePorAplicar)}.`,
        { duracaoMs: 8_000 },
      );
      if (veioDeDeepLink.current) router.push("/repasses");
    } finally {
      setAplicando(false);
    }
  }

  async function onRetentarCarimbo() {
    if (!carimboPendente) return;
    setAplicando(true);
    try {
      await carimbarSnapshotAplicado(carimboPendente.snapshotId, carimboPendente.carimbo);
      setCarimboPendente(null);
      showSuccessToast("Registro da decisão completado.");
      if (veioDeDeepLink.current) router.push("/repasses");
    } catch (e) {
      // Não gerar linha nova: duplicaria a decisão. Avisa e para.
      setCarimboPendente(null);
      showErrorToast(
        `O registro continua incompleto: ${e instanceof Error ? e.message : "erro inesperado"} Os preços no repasse estão corretos; o histórico dessa decisão ficou sem o carimbo.`,
        { duracaoMs: 12_000 },
      );
    } finally {
      setAplicando(false);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      {/* ── Busca por placa ─────────────────────────────────────────────── */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void buscar(termo);
        }}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4"
      >
        <div className="min-w-[200px] flex-1">
          <label htmlFor="placa" className="block text-xs font-medium text-[var(--text-body)]">
            Placa
          </label>
          <input
            id="placa"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="ABC1D23 ou ABC-1234"
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-3 py-2 text-sm uppercase text-[var(--text-strong)] outline-none focus:border-[var(--brand-600)]"
          />
        </div>
        <button
          type="submit"
          disabled={buscando || termo.trim() === ""}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-800)] disabled:opacity-50"
        >
          {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Buscar
        </button>
      </form>

      {erroBusca && <Aviso tom="erro">{erroBusca}</Aviso>}

      {/* ── Estados vazios (AC2) ────────────────────────────────────────── */}
      {resultado && !resultado.encontrado && (
        <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-6 text-center">
          <p className="text-sm font-medium text-[var(--text-strong)]">{resultado.mensagem}</p>
          {resultado.motivo === "so_no_estoque" && resultado.veiculoEstoque && (
            <div className="mt-3 text-xs text-[var(--text-muted)]">
              <p>
                {resultado.veiculoEstoque.placa} · {resultado.veiculoEstoque.modelo}
              </p>
              <Link
                href="/repasses"
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 py-1.5 font-medium text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
              >
                Ir pra Repasses e marcar o carro <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          )}
        </div>
      )}

      {/* ── Carro carregado ─────────────────────────────────────────────── */}
      {carro && (
        <>
          <CabecalhoCarro carro={carro} />

          {carro.motivoBloqueio && <Aviso tom="atencao">{carro.motivoBloqueio}</Aviso>}

          {/* Risco #8 — gasto lançado depois de aplicar pode virar prejuízo. */}
          {custoReal != null && carro.valorMinimo != null && carro.valorMinimo < custoReal && (
            <Aviso tom="erro">
              O mínimo já gravado ({formatBRLCents(carro.valorMinimo)}) está ABAIXO do custo real de
              hoje ({formatBRLCents(custoReal)}). Vender no mínimo anunciado hoje dá prejuízo.
            </Aviso>
          )}

          <BlocoCusto
            carro={carro}
            sugestao={sugestao}
            gastoValor={gastoValor}
            gastoDescricao={gastoDescricao}
            lancando={lancandoGasto}
            onGastoValor={setGastoValor}
            onGastoDescricao={setGastoDescricao}
            onLancar={() => void onLancarGasto()}
          />

          {/* Sem sugestão: cor neutra, motivo explícito, nunca um número inventado. */}
          {sugestaoResultado && !sugestaoResultado.ok && (
            <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-muted)] p-5">
              <p className="text-sm font-semibold text-[var(--text-strong)]">
                ⚪ Dados incompletos — sem sugestão
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{sugestaoResultado.motivo}</p>
            </div>
          )}

          {sugestao && (
            <>
              <BlocoSugestao sugestao={sugestao} />

              <BlocoAplicar
                carro={carro}
                sugestao={sugestao}
                minimoTexto={minimoTexto}
                comprePorTexto={comprePorTexto}
                minimoAplicar={minimoAplicar}
                comprePorAplicar={comprePorAplicar}
                aplicando={aplicando}
                podeAplicar={podeAplicar}
                carimboPendente={carimboPendente != null}
                onMinimo={setMinimoInput}
                onComprePor={setComprePorInput}
                onResetar={() => {
                  setMinimoInput(null);
                  setComprePorInput(null);
                }}
                onAplicar={() => void onAplicar()}
                onRetentarCarimbo={() => void onRetentarCarimbo()}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// BLOCOS
// ═════════════════════════════════════════════════════════════════════════════

function Aviso({
  tom,
  children,
}: {
  tom: "erro" | "atencao" | "info";
  children: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
        tom === "erro" &&
          "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
        tom === "atencao" &&
          "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
        tom === "info" &&
          "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200",
      )}
    >
      {tom === "info" ? (
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      ) : (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      )}
      <span className="flex-1">{children}</span>
    </div>
  );
}

function Campo({ label, valor }: { label: string; valor: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-[var(--text-subtle)]">{label}</p>
      <p className="text-sm text-[var(--text-strong)]">{valor}</p>
    </div>
  );
}

function CabecalhoCarro({ carro }: { carro: CarroPrecificar }) {
  const anos =
    carro.anoFabricacao || carro.anoModelo
      ? `${carro.anoFabricacao ?? "—"}/${carro.anoModelo ?? "—"}`
      : "—";
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-[var(--text-strong)]">
          {carro.placa} · {carro.modelo}
        </h2>
        <span className="rounded-full bg-[var(--bg-muted)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-body)]">
          {STATUS_LABEL[carro.status]}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Campo label="Marca" valor={carro.marca ?? "—"} />
        <Campo label="Ano fab/mod" valor={anos} />
        <Campo label="KM" valor={carro.km != null ? `${formatInt(carro.km)} km` : "—"} />
        <Campo
          label="Dias em repasse"
          valor={carro.diasNoRepasse != null ? `${carro.diasNoRepasse} dias` : "—"}
        />
        <Campo label="Ref. Auto Avaliar" valor={formatBRL(carro.valorAutoAvaliar)} />
        <Campo label="FIPE" valor={formatBRL(carro.valorFipe)} />
        <Campo label="Maior oferta" valor={formatBRL(carro.valorMaiorOferta)} />
        <Campo
          label="Anúncios ativos"
          valor={carro.qtdeAnuncios != null ? formatInt(carro.qtdeAnuncios) : "—"}
        />
        <Campo label="Mínimo gravado" valor={formatBRL(carro.valorMinimo)} />
        <Campo label="Compre por gravado" valor={formatBRL(carro.valorComprePor)} />
      </div>

      {/* AC3 — a identidade do repasse é por CICLO, nunca por chassi.
          A data tem que sair do ciclo ESCOLHIDO: `ciclos` vem por id desc
          INCLUINDO cancelados, e o escolhido é o mais recente NÃO-cancelado —
          `ciclos[0]` mostraria a data do ciclo errado justamente no texto que
          existe pra desambiguar. */}
      {carro.ciclos.length > 1 && (
        <p className="mt-4 rounded-md bg-[var(--bg-muted)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
          Essa placa tem {carro.ciclos.length} ciclos de repasse. Precificando o ciclo{" "}
          <strong>#{carro.repasseId}</strong> (marcado em{" "}
          {formatarDataBR(carro.ciclos.find((c) => c.id === carro.repasseId)?.dataMarcado)}) — o mais
          recente que não está cancelado.
        </p>
      )}
    </div>
  );
}

function BlocoCusto({
  carro,
  sugestao,
  gastoValor,
  gastoDescricao,
  lancando,
  onGastoValor,
  onGastoDescricao,
  onLancar,
}: {
  carro: CarroPrecificar;
  sugestao: SugestaoPrecoRepasse | null;
  gastoValor: string;
  gastoDescricao: string;
  lancando: boolean;
  onGastoValor: (v: string) => void;
  onGastoDescricao: (v: string) => void;
  onLancar: () => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
      <h3 className="text-sm font-semibold text-[var(--text-strong)]">Custo real</h3>
      <p className="mt-0.5 text-[11px] text-[var(--text-subtle)]">
        R$ Compra do repasse + Σ gastos. Nunca o valor de aquisição — esse é custo de varejo.
      </p>

      {carro.valorCompraRepasse == null ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          Sem R$ Compra do Auto Avaliar — não há custo real e, portanto, não há sugestão.
        </p>
      ) : (
        <div className="mt-3 space-y-1.5 text-sm">
          <Linha rotulo="R$ Compra (repasse)" valor={formatBRLCents(carro.valorCompraRepasse)} />
          {carro.gastos.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              Sem gastos lançados — não é erro nem bloqueio.
            </p>
          ) : (
            <>
              {carro.gastos.map((g) => (
                <Linha
                  key={g.id}
                  rotulo={`+ ${g.descricao || g.tipo}`}
                  valor={formatBRLCents(g.valor)}
                  discreta
                />
              ))}
              <Linha
                rotulo={`Σ gastos (${carro.gastos.length})`}
                valor={formatBRLCents(sugestao?.custo.gastosTotal ?? null)}
              />
            </>
          )}
          <div className="border-t border-[var(--border-soft)] pt-1.5">
            <Linha
              rotulo="= Custo real"
              valor={formatBRLCents(sugestao?.custo.custoReal ?? null)}
              forte
            />
          </div>
        </div>
      )}

      {/* AC9 — lançar gasto aqui mesmo; a sugestão recalcula na hora. */}
      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-[var(--border-soft)] pt-4">
        <div className="w-32">
          <label htmlFor="gasto-valor" className="block text-[10px] uppercase tracking-wide text-[var(--text-subtle)]">
            Novo gasto (R$)
          </label>
          <input
            id="gasto-valor"
            value={gastoValor}
            onChange={(e) => onGastoValor(e.target.value)}
            placeholder="1.500,00"
            inputMode="decimal"
            className="mt-1 w-full rounded-md border border-[var(--border-soft)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-strong)] outline-none focus:border-[var(--brand-600)]"
          />
        </div>
        <div className="min-w-[160px] flex-1">
          <label htmlFor="gasto-desc" className="block text-[10px] uppercase tracking-wide text-[var(--text-subtle)]">
            Descrição (opcional)
          </label>
          <input
            id="gasto-desc"
            value={gastoDescricao}
            onChange={(e) => onGastoDescricao(e.target.value)}
            placeholder="Ex.: pintura do para-choque"
            className="mt-1 w-full rounded-md border border-[var(--border-soft)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-strong)] outline-none focus:border-[var(--brand-600)]"
          />
        </div>
        <button
          type="button"
          onClick={onLancar}
          disabled={lancando || gastoValor.trim() === ""}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-body)] hover:bg-[var(--bg-muted)] disabled:opacity-50"
        >
          {lancando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Lançar gasto
        </button>
      </div>
    </div>
  );
}

function Linha({
  rotulo,
  valor,
  forte,
  discreta,
}: {
  rotulo: string;
  valor: string;
  forte?: boolean;
  discreta?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span
        className={cn(
          "text-xs",
          discreta ? "text-[var(--text-subtle)]" : "text-[var(--text-muted)]",
          forte && "text-sm font-semibold text-[var(--text-strong)]",
        )}
      >
        {rotulo}
      </span>
      <span
        className={cn(
          "tabular-nums text-sm text-[var(--text-body)]",
          forte && "text-base font-bold text-[var(--text-strong)]",
        )}
      >
        {valor}
      </span>
    </div>
  );
}

function BlocoSugestao({ sugestao }: { sugestao: SugestaoPrecoRepasse }) {
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-strong)]">Sugestão pro anúncio</h3>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
            sugestao.confianca === "alta" &&
              "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
            sugestao.confianca === "baixa" &&
              "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
            sugestao.confianca === "muito_baixa" &&
              "bg-[var(--bg-muted)] text-[var(--text-muted)]",
          )}
        >
          {CONFIANCA_LABEL[sugestao.confianca]}
        </span>
      </div>

      {/* O motivo é TEXTO VISÍVEL, não tooltip. Um badge verde "Confiança alta"
          ao lado de um número que sai de n=16 é o Risk #1 da story — a sugestão
          parecer mais científica do que é. E o badge mede só "existe referência
          pra conferir", não "o preço está certo". Tooltip não aparece em toque
          nem em leitor de tela: quem mais precisa da ressalva não a receberia. */}
      <p className="mt-1 text-[11px] text-[var(--text-muted)]">
        {CONFIANCA_MOTIVO[sugestao.confianca]} Mede se há referência de mercado pra conferir — não
        se o preço está certo.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <PrecoCard
          titulo="Mínimo"
          descricao="Piso do leilão de 24h"
          arredondado={sugestao.minimoArredondado}
          exato={sugestao.minimoSugerido}
          razao={sugestao.minimoRazaoEfetiva}
        />
        <PrecoCard
          titulo="Compre por"
          descricao="Compra direta — encerra o anúncio na hora"
          arredondado={sugestao.comprePorArredondado}
          exato={sugestao.comprePorSugerido}
          razao={sugestao.comprePorRazaoEfetiva}
        />
      </div>

      {/* AC11 — a banda é DO MÍNIMO entre carros, não a faixa mín↔compre-por. */}
      <p className="mt-4 text-[11px] text-[var(--text-muted)]">
        Banda do mínimo entre os carros que venderam (p25–p75, n=16):{" "}
        <strong className="tabular-nums">{formatBRL(sugestao.bandaMinimo.p25)}</strong> –{" "}
        <strong className="tabular-nums">{formatBRL(sugestao.bandaMinimo.p75)}</strong>. Não é a
        faixa entre o mínimo e o compre por.
      </p>

      <p className="mt-3 rounded-md bg-[var(--bg-muted)] px-3 py-2 text-xs leading-relaxed text-[var(--text-body)]">
        {sugestao.justificativa}
      </p>

      {sugestao.alertas.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {sugestao.alertas.map((a) => (
            <li key={a}>
              <Aviso tom="atencao">{a}</Aviso>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-[var(--text-subtle)]">
        Régua calibrada em 16 vendas reais (jun–ago/2026) — amostra pequena, número editável.
        Mínimo = {(REGUA_PADRAO.REGUA_MINIMO_PCT * 100).toFixed(1)}% do custo; compre por derivado da
        razão mínimo÷compre-por de {(REGUA_PADRAO.RAZAO_MINIMO_SOBRE_COMPRE_POR * 100).toFixed(1)}%.
      </p>
    </div>
  );
}

function PrecoCard({
  titulo,
  descricao,
  arredondado,
  exato,
  razao,
}: {
  titulo: string;
  descricao: string;
  arredondado: number;
  exato: number;
  razao: number;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-muted)] p-4">
      <p className="text-[10px] uppercase tracking-wide text-[var(--text-subtle)]">{titulo}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--text-strong)]">
        {formatBRL(arredondado)}
      </p>
      <p className="mt-1 text-[11px] text-[var(--text-muted)]">
        {descricao} · {(razao * 100).toFixed(1)}% do custo
      </p>
      {arredondado !== exato && (
        <p className="mt-0.5 text-[10px] text-[var(--text-subtle)]">
          Régua crua: {formatBRLCents(exato)}
        </p>
      )}
    </div>
  );
}

function BlocoAplicar({
  carro,
  sugestao,
  minimoTexto,
  comprePorTexto,
  minimoAplicar,
  comprePorAplicar,
  aplicando,
  podeAplicar,
  carimboPendente,
  onMinimo,
  onComprePor,
  onResetar,
  onAplicar,
  onRetentarCarimbo,
}: {
  carro: CarroPrecificar;
  sugestao: SugestaoPrecoRepasse;
  minimoTexto: string;
  comprePorTexto: string;
  minimoAplicar: number | null;
  comprePorAplicar: number | null;
  aplicando: boolean;
  podeAplicar: boolean;
  carimboPendente: boolean;
  onMinimo: (v: string) => void;
  onComprePor: (v: string) => void;
  onResetar: () => void;
  onAplicar: () => void;
  onRetentarCarimbo: () => void;
}) {
  const custo = sugestao.custo.custoReal;
  const abaixoDoCusto =
    (minimoAplicar != null && minimoAplicar < custo) ||
    (comprePorAplicar != null && comprePorAplicar < custo);
  const invertido =
    minimoAplicar != null && comprePorAplicar != null && comprePorAplicar < minimoAplicar;

  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
      <h3 className="text-sm font-semibold text-[var(--text-strong)]">Aplicar no repasse</h3>
      <p className="mt-0.5 text-[11px] text-[var(--text-subtle)]">
        Os dois campos vêm preenchidos com o sugerido e são editáveis. Sua correção é gravada junto
        com a sugestão — é ela que ensina onde a régua erra.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {/* A referência da diferença é o par ARREDONDADO — é ele que preenche o
            campo, então "sem edição" tem que mostrar diferença zero. */}
        <CampoPreco
          id="aplicar-minimo"
          label="Mínimo"
          valor={minimoTexto}
          numero={minimoAplicar}
          sugerido={sugestao.minimoArredondado}
          desabilitado={!carro.editavel || aplicando}
          onChange={onMinimo}
        />
        <CampoPreco
          id="aplicar-compre-por"
          label="Compre por"
          valor={comprePorTexto}
          numero={comprePorAplicar}
          sugerido={sugestao.comprePorArredondado}
          desabilitado={!carro.editavel || aplicando}
          onChange={onComprePor}
        />
      </div>

      {/* AC19 — editar abaixo do custo É permitido, com aviso em vermelho. */}
      {abaixoDoCusto && (
        <div className="mt-3">
          <Aviso tom="erro">
            Valor abaixo do custo real ({formatBRLCents(custo)}) — vender assim dá prejuízo. Dá pra
            aplicar assim mesmo: o piso de 0% é regra do motor de sugestão, não do que você pode
            decidir.
          </Aviso>
        </div>
      )}
      {invertido && (
        <div className="mt-3">
          <Aviso tom="erro">
            O compre por ficou ABAIXO do mínimo. Confira — é possível aplicar, mas normalmente é
            engano de digitação.
          </Aviso>
        </div>
      )}

      {/* AC23 — o valor gravado é intenção e vai convergir pro real. */}
      <div className="mt-3">
        <Aviso tom="info">
          Esse valor é a sua intenção; quando o carro subir e o relatório do Auto Avaliar for
          importado, ele passa a refletir o que está no ar. O registro dessa decisão não se perde no
          import.
        </Aviso>
      </div>

      {carimboPendente ? (
        <div className="mt-4 space-y-2">
          <Aviso tom="atencao">
            Os preços foram gravados no repasse, mas o registro da decisão ficou sem o carimbo de
            &quot;aplicado&quot; — do jeito que está, ele diz que você sugeriu e não aplicou. Dá pra
            completar agora.
          </Aviso>
          <button
            type="button"
            onClick={onRetentarCarimbo}
            disabled={aplicando}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          >
            {aplicando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Completar o registro
          </button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onAplicar}
            disabled={!podeAplicar}
            title={carro.motivoBloqueio ?? undefined}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-800)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {aplicando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Aplicar no repasse
          </button>
          <button
            type="button"
            onClick={onResetar}
            disabled={aplicando}
            className="text-xs text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text-strong)] disabled:opacity-50"
          >
            Voltar pro sugerido
          </button>
          {(minimoAplicar == null || comprePorAplicar == null) && (
            <span className="text-xs text-red-700 dark:text-red-400">
              Preencha os dois valores em reais (ex.: 106.600,00).
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function CampoPreco({
  id,
  label,
  valor,
  numero,
  sugerido,
  desabilitado,
  onChange,
}: {
  id: string;
  label: string;
  valor: string;
  numero: number | null;
  sugerido: number;
  desabilitado: boolean;
  onChange: (v: string) => void;
}) {
  const diff = numero != null ? Math.round((numero - sugerido + Number.EPSILON) * 100) / 100 : null;
  return (
    <div>
      <label htmlFor={id} className="block text-[10px] uppercase tracking-wide text-[var(--text-subtle)]">
        {label}
      </label>
      <input
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        disabled={desabilitado}
        inputMode="decimal"
        className="mt-1 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-3 py-2 text-sm tabular-nums text-[var(--text-strong)] outline-none focus:border-[var(--brand-600)] disabled:bg-[var(--bg-muted)]"
      />
      <p className="mt-1 text-[11px] text-[var(--text-muted)]">
        Sugerido: <span className="tabular-nums">{formatBRLCents(sugerido)}</span>
        {diff != null && diff !== 0 && (
          <span
            className={cn(
              "ml-1.5 font-medium tabular-nums",
              diff > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400",
            )}
          >
            ({diff > 0 ? "+" : "−"}
            {formatBRLCents(Math.abs(diff))})
          </span>
        )}
      </p>
    </div>
  );
}
