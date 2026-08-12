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
import { formatarDataBR, hojeLocal } from "@/lib/utils/data-local";
import { STATUS_LABEL } from "@/lib/repasses/types";
import {
  CONFIANCA_LABEL,
  CONFIANCA_MOTIVO,
  MODO_LABEL,
  MODO_PADRAO,
  REGUA_PADRAO,
  sugerirPrecoRepasse,
  type EntradaSugestaoRepasse,
  type ModoPreco,
  type ResultadoSugestao,
  type SugestaoPrecoRepasse,
} from "@/lib/pricing/sugerir-preco-repasse";
import { montarSnapshotPrecificacao, type CarimboAplicado } from "@/lib/pricing/snapshot-precificacao";
import {
  classificarOrigemAbaixoDoCusto,
  type SnapshotRecente,
} from "@/lib/pricing/origem-abaixo-do-custo";
import {
  aplicarPrecoRepasse,
  buscarCarroPorPlaca,
  buscarUltimoSnapshotPrecificacao,
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

/**
 * C10 — quanto do custo NÃO volta neste mínimo. **Um só lugar, zero literais.**
 *
 * ⚠️ Nunca escrever este número à mão em lugar nenhum — código, comentário,
 * teste ou texto de UI. Ele mudou TRÊS vezes num único dia (R$ 6.850 → 1.090 →
 * 1.570 → 1.550) conforme a régua e a base mudavam. Um literal aqui estaria
 * errado hoje e ninguém perceberia (ADR-003 §12.8).
 */
function naoRecuperado(custoReal: number, minimo: number): number {
  return Math.max(0, Math.round((custoReal - minimo + Number.EPSILON) * 100) / 100);
}

/**
 * As três zonas do mínimo no modo girar (C10). É isto que resolve o "alerta que
 * toca sempre": só a zona C é vermelha.
 *
 * - **A** `mínimo ≥ custoReal` — recupera tudo mesmo girando;
 * - **B** `compra ≤ mínimo < custoReal` — **a descrição do modo**, nunca vermelho;
 * - **C** `mínimo < compra` — abaixo do que ele pagou; só por edição manual.
 *
 * A zona B nunca ultrapassa `gastosTotal` por construção
 * (`custoReal − 1,066×compra ≤ gastos`), então a frase "dos R$ X de gastos"
 * nunca fica incoerente.
 */
function zonaDoMinimo(custoReal: number, compra: number, minimo: number): "A" | "B" | "C" {
  if (minimo < compra) return "C";
  if (minimo < custoReal) return "B";
  return "A";
}

/** "recuperar tudo" / "girar rápido" — o rótulo dentro de uma frase corrida. */
function modoEmFrase(modo: ModoPreco): string {
  return MODO_LABEL[modo].toLocaleLowerCase("pt-BR");
}

/** Percentual da régua formatado — nunca literal (mesmo precedente do rodapé). */
function pctRegua(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

type CarimboPendente = { snapshotId: number; carimbo: CarimboAplicado };

/** Qual nota de "gasto lançado" mostrar sob as colunas (Edge case #5). */
type NotaGasto = "virou_dois_modos" | "ja_tinha_dois_modos";

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

  /**
   * C15 — modo selecionado. **Default `recuperar_tudo` em TODO carro**, e a
   * escolha NÃO é lembrada: nem por carro, nem por sessão, **nem na URL**.
   *
   * ⚠️ Nada de `localStorage`/`sessionStorage`/contexto, e nada de `&modo=` no
   * deep-link: lembrar por carro transformaria consulta em escrita (recusado na
   * ADR-003 §3.2), e lembrar por sessão abriria o próximo carro no modo
   * escolhido pra OUTRO carro — modo errado em silêncio, que é a falha que um
   * default explícito evita. A única persistência com consumidor é o snapshot
   * da decisão aplicada (C12).
   */
  const [modo, setModo] = useState<ModoPreco>(MODO_PADRAO);
  /** Modo que o Marcos pediu mas ainda NÃO foi aplicado — tira de confirmação. */
  const [trocaPendente, setTrocaPendente] = useState<ModoPreco | null>(null);
  const [notaGasto, setNotaGasto] = useState<NotaGasto | null>(null);

  const [aplicando, setAplicando] = useState(false);
  const [carimboPendente, setCarimboPendente] = useState<CarimboPendente | null>(null);

  const [gastoValor, setGastoValor] = useState("");
  const [gastoDescricao, setGastoDescricao] = useState("");
  const [lancandoGasto, setLancandoGasto] = useState(false);

  /**
   * C16 — o snapshot mais recente deste repasse, pra desambiguar o alerta de
   * "abaixo do custo". `snapshotFalhou` existe pra que uma falha de rede NÃO
   * vire a frase "não há registro de decisão de preço": isso seria afirmar algo
   * falso. Falhou ⇒ cai no vermelho ORIGINAL, que é o comportamento de hoje.
   */
  const [snapshotRecente, setSnapshotRecente] = useState<SnapshotRecente | null>(null);
  const [snapshotFalhou, setSnapshotFalhou] = useState(false);

  const carro = resultado?.encontrado ? resultado.carro : null;

  const buscar = useCallback(async (placa: string) => {
    const alvo = placa.trim();
    if (alvo === "") return;
    setBuscando(true);
    setErroBusca(null);
    setCarimboPendente(null);
    setMinimoInput(null);
    setComprePorInput(null);
    // C15 — carro novo, modo volta pro default. Isto cobre TAMBÉM o deep-link:
    // o efeito de `?placa=` chama esta mesma função, então não há um segundo
    // caminho de entrada que pudesse escapar do reset.
    setModo(MODO_PADRAO);
    setTrocaPendente(null);
    setNotaGasto(null);
    setSnapshotRecente(null);
    setSnapshotFalhou(false);
    try {
      const achado = await buscarCarroPorPlaca(alvo);
      setResultado(achado);
      // C16 — leitura pontual da 030. Fora do try do carro de propósito: uma
      // falha aqui NÃO pode derrubar a busca. Sem o registro, o alerta cai no
      // vermelho original — nunca numa frase que afirme ausência de decisão.
      if (achado.encontrado) {
        try {
          setSnapshotRecente(await buscarUltimoSnapshotPrecificacao(achado.carro.repasseId));
        } catch {
          setSnapshotFalhou(true);
        }
      }
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
  const entradaMotor: EntradaSugestaoRepasse | null = useMemo(() => {
    if (!carro) return null;
    return {
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
    };
  }, [carro]);

  const recuperarResultado: ResultadoSugestao | null = useMemo(
    () => (entradaMotor ? sugerirPrecoRepasse(entradaMotor, REGUA_PADRAO, "recuperar_tudo") : null),
    [entradaMotor],
  );

  /**
   * ⚠️ **`null`, não "calculado e escondido"** (C3 / §1 da spec de UX).
   *
   * Sem gasto lançado as duas bases coincidem e não há segunda conta a fazer —
   * a tela colapsa numa coluna. Como o girar nem chega a ser calculado, **não
   * existe estado de UI em que `modo = girar_rapido` num carro sem gasto**: a
   * C19 fica fechada também pelo lado da tela, não só pela assinatura de
   * `montarSnapshotPrecificacao`.
   *
   * `!ok` aqui é o caso da C6 (compra 0 com gasto lançado): o girar não sugere,
   * mas a coluna aparece desabilitada com o motivo do MOTOR — os dois ramos da
   * C6 visíveis na mesma tela.
   */
  const girarResultado: ResultadoSugestao | null = useMemo(() => {
    if (entradaMotor == null || recuperarResultado == null || !recuperarResultado.ok) return null;
    if (recuperarResultado.custo.gastosTotal <= 0) return null;
    return sugerirPrecoRepasse(entradaMotor, REGUA_PADRAO, "girar_rapido");
  }, [entradaMotor, recuperarResultado]);

  const recuperar: SugestaoPrecoRepasse | null =
    recuperarResultado != null && recuperarResultado.ok ? recuperarResultado : null;
  const girar: SugestaoPrecoRepasse | null =
    girarResultado != null && girarResultado.ok ? girarResultado : null;
  /** Motivo pt-BR do MOTOR quando o girar existe como opção mas não sugere (C6). */
  const girarIndisponivel =
    girarResultado != null && !girarResultado.ok ? girarResultado.motivo : null;
  /** Há gasto lançado ⇒ há escolha a fazer ⇒ duas colunas (mesmo que uma esteja off). */
  const doisModos = girarResultado != null;

  /**
   * A sugestão que governa prefill, justificativa, alertas e o snapshot.
   *
   * ⚠️ O fallback pra `recuperar` quando o girar está indisponível é silencioso
   * de propósito — mas ele NÃO pode vazar pra tela como divergência: tudo o que
   * o Marcos vê (rádio marcado, chip do `BlocoAplicar`, textos) deriva de
   * `sugestao.modo`, nunca deste `modo` de estado. Se derivasse do estado, o
   * rádio poderia dizer "Girar rápido" enquanto o chip diz "Recuperar tudo" — o
   * "estado visual mente" que a C19 e a tira de confirmação existem pra impedir.
   */
  const sugestao: SugestaoPrecoRepasse | null =
    modo === "girar_rapido" && girar != null ? girar : recuperar;

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

  /**
   * C15 — trocar de modo NÃO grava nada (C13) e NÃO chama a rede. Se o Marcos
   * já digitou algum valor, o rádio **não flipa ainda**: abre a tira de
   * confirmação e só troca no "Trocar e substituir". Estado visual nunca mente.
   */
  function pedirTrocaModo(novo: ModoPreco) {
    if (novo === modo) return;
    if (minimoInput === null && comprePorInput === null) {
      setModo(novo);
      setTrocaPendente(null);
      return;
    }
    setTrocaPendente(novo);
  }

  function confirmarTrocaModo() {
    if (trocaPendente == null) return;
    setModo(trocaPendente);
    setMinimoInput(null);
    setComprePorInput(null);
    setTrocaPendente(null);
  }

  async function onLancarGasto() {
    if (!carro) return;
    const valor = parseValorBR(gastoValor);
    if (valor == null || valor <= 0) {
      showErrorToast("Informe um valor de gasto maior que zero.");
      return;
    }
    // Edge case #5 — lido ANTES da escrita: o gasto pode transformar um carro
    // colapsado num carro de dois modos, e as duas situações pedem notas
    // diferentes. Depois do `setResultado` esta informação já se perdeu.
    const tinhaDoisModos = doisModos;
    setLancandoGasto(true);
    try {
      const novo = await criarGastoRepasse(carro.repasseId, valor, gastoDescricao);
      setResultado({ encontrado: true, carro: { ...carro, gastos: [...carro.gastos, novo] } });
      setGastoValor("");
      setGastoDescricao("");
      setNotaGasto(tinhaDoisModos ? "ja_tinha_dois_modos" : "virou_dois_modos");
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
      // C16 — a decisão que acabou de ser gravada É o snapshot mais recente
      // agora. Atualizar em memória (em vez de refetch) mantém o alerta coerente
      // sem uma ida ao banco: os quatro campos são exatamente o que foi escrito.
      setSnapshotRecente({
        modo: sugestao.modo,
        minimoAplicado: minimoAplicar,
        custoReal: sugestao.custo.custoReal,
        aplicadoEmData: hojeLocal(),
      });
      setSnapshotFalhou(false);
      // Centavos na confirmação: a mensagem que confirma a ESCRITA é o pior
      // lugar pra arredondar num projeto que trata R$ 0,01 como bug crítico.
      //
      // O MODO entra no toast (§4.2): custa nada e torna a decisão auditável no
      // instante. Sai de `sugestao.modo` — o objeto que produziu os números —,
      // nunca do estado do seletor (C19).
      const rotuloModo = modoEmFrase(sugestao.modo);
      showSuccessToast(
        r.updatePulado
          ? `Decisão registrada (${rotuloModo}). Os preços já eram esses (mínimo ${formatBRLCents(minimoAplicar)} · compre por ${formatBRLCents(comprePorAplicar)}) — nada mudou no repasse.`
          : `Preço aplicado (${rotuloModo}): mínimo ${formatBRLCents(minimoAplicar)} · compre por ${formatBRLCents(comprePorAplicar)}.`,
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
      // C16 — o carimbo é o que torna a linha uma DECISÃO APLICADA. Sem espelhar
      // isto, num carro girado o alerta seguiria vermelho dizendo "não há
      // registro de decisão de preço para este valor" logo depois de o registro
      // ter sido completado — exatamente a frase falsa que o `snapshotFalhou`
      // existe pra evitar.
      if (sugestao != null) {
        setSnapshotRecente({
          modo: sugestao.modo,
          minimoAplicado: carimboPendente.carimbo.minimo_aplicado,
          custoReal: sugestao.custo.custoReal,
          aplicadoEmData: hojeLocal(new Date(carimboPendente.carimbo.aplicado_em)),
        });
        setSnapshotFalhou(false);
      }
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

          {/* Risco #8 — gasto lançado depois de aplicar pode virar prejuízo.
              C16 — o MESMO predicado atende três situações que pedem reações
              opostas; sem separá-las, este vermelho acenderia toda vez que o
              Marcos reabrisse um carro girado, PARA SEMPRE. */}
          {custoReal != null && carro.valorMinimo != null && carro.valorMinimo < custoReal && (
            <AlertaAbaixoDoCusto
              valorMinimo={carro.valorMinimo}
              custoReal={custoReal}
              snapshot={snapshotRecente}
              snapshotIndisponivel={snapshotFalhou}
            />
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
          {recuperarResultado && !recuperarResultado.ok && (
            <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-muted)] p-5">
              <p className="text-sm font-semibold text-[var(--text-strong)]">
                ⚪ Dados incompletos — sem sugestão
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{recuperarResultado.motivo}</p>
            </div>
          )}

          {recuperar && sugestao && (
            <>
              <BlocoSugestao
                recuperar={recuperar}
                girar={girar}
                girarIndisponivel={girarIndisponivel}
                doisModos={doisModos}
                selecionada={sugestao}
                notaGasto={notaGasto}
                trocaPendente={trocaPendente}
                minimoDigitado={minimoAplicar}
                comprePorDigitado={comprePorAplicar}
                onPedirModo={pedirTrocaModo}
                onConfirmarTroca={confirmarTrocaModo}
                onCancelarTroca={() => setTrocaPendente(null)}
              />

              <BlocoAplicar
                carro={carro}
                sugestao={sugestao}
                minimoTexto={minimoTexto}
                comprePorTexto={comprePorTexto}
                minimoAplicar={minimoAplicar}
                comprePorAplicar={comprePorAplicar}
                minimoEditado={minimoInput !== null}
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
  tom: "erro" | "atencao" | "info" | "neutro";
  children: React.ReactNode;
}) {
  // ⚠️ NO TOM `neutro`, `role="alert"` NÃO É APLICADO — e isto não é detalhe.
  // A nota da C10 descreve o que o modo girar FAZ; um leitor de tela anunciando
  // "alerta" nessa frase recria em áudio exatamente o problema que a fatia
  // existe pra consertar (tratar decisão consciente como falha). `note` é papel
  // de estrutura de documento, não de live region: não interrompe.
  const neutro = tom === "neutro";
  return (
    <div
      role={neutro ? "note" : "alert"}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
        tom === "erro" &&
          "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
        tom === "atencao" &&
          "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
        tom === "info" &&
          "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200",
        // Cinza dos tokens do projeto. `--text-body`, não `--text-subtle`: a
        // nota carrega dinheiro e precisa de contraste AA.
        neutro && "border-[var(--border-base)] bg-[var(--bg-muted)] text-[var(--text-body)]",
      )}
    >
      {tom === "info" || neutro ? (
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

/**
 * C16 — o mesmo predicado (`valor_minimo < custo_real`), três reações.
 *
 * ⚠️ **O vermelho fica reservado pro que o Marcos NÃO escolheu.** Girar sobre a
 * compra é decisão dele: pintar isso de vermelho para sempre descreveria uma
 * escolha consciente como falha, e um alerta que toca sempre deixa de ser lido
 * (ADR-003 §12.8). O texto vermelho ORIGINAL fica intacto nas outras duas
 * origens — inclusive a deriva, que é o caso que o Risk #8 da 3.1 mirava.
 */
function AlertaAbaixoDoCusto({
  valorMinimo,
  custoReal,
  snapshot,
  snapshotIndisponivel,
}: {
  valorMinimo: number;
  custoReal: number;
  snapshot: SnapshotRecente | null;
  /** A leitura da 030 falhou — cai no vermelho original, sem afirmar nada falso. */
  snapshotIndisponivel: boolean;
}) {
  const origem = snapshotIndisponivel
    ? "deriva"
    : classificarOrigemAbaixoDoCusto(snapshot, valorMinimo, custoReal);

  if (origem === "decisao" && snapshot != null) {
    return (
      <Aviso tom="neutro">
        Este carro foi girado sobre a compra em {formatarDataBR(snapshot.aplicadoEmData)}:{" "}
        {formatBRLCents(naoRecuperado(custoReal, valorMinimo))} de gastos não são recuperados no
        mínimo anunciado. Foi uma decisão, não um erro.
      </Aviso>
    );
  }

  return (
    <Aviso tom="erro">
      O mínimo já gravado ({formatBRLCents(valorMinimo)}) está ABAIXO do custo real de hoje (
      {formatBRLCents(custoReal)}). Vender no mínimo anunciado hoje dá prejuízo.
      {origem === "fora_do_sistema" && " Não há registro de decisão de preço para este valor."}
    </Aviso>
  );
}

/** Rótulo da BASE de cada modo no cabeçalho da coluna (§5 da spec de UX). */
const BASE_DA_COLUNA: Record<ModoPreco, string> = {
  recuperar_tudo: "sobre o custo real",
  girar_rapido: "sobre a compra",
};

/** A declaração de amostra vai ONDE O NÚMERO ESTÁ, não só no rodapé (C17). */
const AMOSTRA_DA_COLUNA: Record<ModoPreco, string> = {
  recuperar_tudo: "régua de 16 vendas",
  girar_rapido: "dessas 16, só 4 tinham gasto — é a base mais fraca",
};

function BlocoSugestao({
  recuperar,
  girar,
  girarIndisponivel,
  doisModos,
  selecionada,
  notaGasto,
  trocaPendente,
  minimoDigitado,
  comprePorDigitado,
  onPedirModo,
  onConfirmarTroca,
  onCancelarTroca,
}: {
  recuperar: SugestaoPrecoRepasse;
  girar: SugestaoPrecoRepasse | null;
  girarIndisponivel: string | null;
  doisModos: boolean;
  /**
   * A sugestão do modo ATIVO — governa justificativa, alertas, confiança **e
   * qual rádio aparece marcado**. Não existe prop `modo` aqui de propósito: o
   * modo exibido tem que sair do objeto que produziu os números, senão o rádio
   * e o chip do `BlocoAplicar` podem divergir.
   */
  selecionada: SugestaoPrecoRepasse;
  notaGasto: NotaGasto | null;
  trocaPendente: ModoPreco | null;
  minimoDigitado: number | null;
  comprePorDigitado: number | null;
  onPedirModo: (m: ModoPreco) => void;
  onConfirmarTroca: () => void;
  onCancelarTroca: () => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-strong)]">Sugestão pro anúncio</h3>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
            selecionada.confianca === "alta" &&
              "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
            selecionada.confianca === "baixa" &&
              "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
            selecionada.confianca === "muito_baixa" &&
              "bg-[var(--bg-muted)] text-[var(--text-muted)]",
          )}
        >
          {CONFIANCA_LABEL[selecionada.confianca]}
        </span>
      </div>

      {/* O motivo é TEXTO VISÍVEL, não tooltip. Um badge verde "Confiança alta"
          ao lado de um número que sai de n=16 é o Risk #1 da story — a sugestão
          parecer mais científica do que é. E o badge mede só "existe referência
          pra conferir", não "o preço está certo". Tooltip não aparece em toque
          nem em leitor de tela: quem mais precisa da ressalva não a receberia.

          A confiança NÃO é rebaixada no girar (C9): ela mede qualidade da
          referência de mercado, e a calibração mais fraca do modo é propriedade
          do MODO — declarada pela coluna `modo` e pelos rótulos de amostra. */}
      <p className="mt-1 text-[11px] text-[var(--text-muted)]">
        {CONFIANCA_MOTIVO[selecionada.confianca]} Mede se há referência de mercado pra conferir —
        não se o preço está certo.
      </p>

      {doisModos ? (
        <>
          <p id="rotulo-modo-preco" className="mt-4 text-xs font-medium text-[var(--text-body)]">
            Como precificar este carro:
          </p>
          <div
            role="radiogroup"
            aria-labelledby="rotulo-modo-preco"
            className="mt-2 grid gap-4 sm:grid-cols-2"
          >
            <ColunaModo
              modo="recuperar_tudo"
              base={recuperar.custo.custoReal}
              selecionado={selecionada.modo === "recuperar_tudo"}
              onSelecionar={onPedirModo}
            >
              <ParDePrecos sugestao={recuperar} rotularModo />
              <BandaMinimo sugestao={recuperar} />
            </ColunaModo>

            <ColunaModo
              modo="girar_rapido"
              base={recuperar.custo.valorCompraRepasse}
              selecionado={selecionada.modo === "girar_rapido"}
              indisponivel={girarIndisponivel}
              onSelecionar={onPedirModo}
            >
              {girar != null && (
                <>
                  <ParDePrecos sugestao={girar} rotularModo />
                  <NotaGiro sugestao={girar} />
                </>
              )}
              {/* C7 — a coluna girar NÃO reserva altura onde a banda estaria.
                  Altura desigual entre colunas é CORRETO: significa "aqui tem
                  menos evidência", que é verdade. */}
            </ColunaModo>
          </div>

          {trocaPendente != null && (
            <ConfirmarTrocaModo
              alvo={trocaPendente}
              minimoDigitado={minimoDigitado}
              comprePorDigitado={comprePorDigitado}
              onConfirmar={onConfirmarTroca}
              onCancelar={onCancelarTroca}
            />
          )}
        </>
      ) : (
        <>
          {/* C3 — COLAPSADO. Sem seletor, sem coluna fantasma, sem rádio
              desabilitado: um controle que não faz nada em 12 de 16 carros
              ensina a ignorá-lo, e aí ele não é usado nos 4 em que importa. */}
          <div className="mt-4">
            <Aviso tom="neutro">
              {recuperar.custo.gastosQtde === 0
                ? `Este carro não tem gasto lançado, então os dois modos dão exatamente o mesmo preço — ${pctRegua(REGUA_PADRAO.REGUA_MINIMO_PCT)} sobre a compra é ${pctRegua(REGUA_PADRAO.REGUA_MINIMO_PCT)} sobre o custo. Não há segunda conta a fazer neste carro.`
                : `Os gastos lançados neste carro somam ${formatBRLCents(recuperar.custo.gastosTotal)}, então os dois modos dão exatamente o mesmo preço — ${pctRegua(REGUA_PADRAO.REGUA_MINIMO_PCT)} sobre a compra é ${pctRegua(REGUA_PADRAO.REGUA_MINIMO_PCT)} sobre o custo. Não há segunda conta a fazer neste carro.`}
            </Aviso>
          </div>

          <div className="mt-4">
            <ParDePrecos sugestao={recuperar} />
          </div>
          <BandaMinimo sugestao={recuperar} />
        </>
      )}

      {notaGasto != null && (
        <div className="mt-4">
          <Aviso tom="neutro">
            {notaGasto === "virou_dois_modos" ? (
              <>
                Gasto lançado: este carro passou a ter dois preços. O <strong>girar rápido</strong> é
                o mesmo número de antes — a base dele é a compra, e ela não mudou.
              </>
            ) : (
              <>
                Gasto lançado: o <strong>recuperar tudo</strong> subiu, porque o custo subiu. O{" "}
                <strong>girar rápido</strong> não se moveu — a base dele é a compra.
              </>
            )}
          </Aviso>
        </div>
      )}

      <p className="mt-3 rounded-md bg-[var(--bg-muted)] px-3 py-2 text-xs leading-relaxed text-[var(--text-body)]">
        {selecionada.justificativa}
      </p>

      {selecionada.alertas.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {selecionada.alertas.map((a) => (
            <li key={a}>
              <Aviso tom="atencao">{a}</Aviso>
            </li>
          ))}
        </ul>
      )}

      {/* C17 — a evidência declarada. Duas versões: no colapsado o texto da
          3.1a fica SEM UMA PALAVRA A MAIS (não há segunda base a explicar). */}
      {doisModos ? (
        <p className="mt-3 text-[10px] leading-relaxed text-[var(--text-subtle)]">
          Régua calibrada em 16 vendas reais (jun–ago/2026) — amostra pequena, número editável. É a{" "}
          <strong>mesma</strong> régua nos dois modos (mínimo ={" "}
          {pctRegua(REGUA_PADRAO.REGUA_MINIMO_PCT)} da base; compre por derivado da razão
          mínimo÷compre-por de {pctRegua(REGUA_PADRAO.RAZAO_MINIMO_SOBRE_COMPRE_POR)}): o que muda é
          a base, não a constante. A base do &quot;girar rápido&quot; é a mais fraca das duas —
          dessas 16 vendas, só <strong>4</strong> tinham gasto, e esses 4 venderam a 105,6% da compra
          contra os {pctRegua(REGUA_PADRAO.REGUA_MINIMO_PCT)} que a régua pede. Nenhum dos dois é
          número fechado.
        </p>
      ) : (
        <p className="mt-3 text-[10px] leading-relaxed text-[var(--text-subtle)]">
          Régua calibrada em 16 vendas reais (jun–ago/2026) — amostra pequena, número editável.
          Mínimo = {pctRegua(REGUA_PADRAO.REGUA_MINIMO_PCT)} do custo; compre por derivado da razão
          mínimo÷compre-por de {pctRegua(REGUA_PADRAO.RAZAO_MINIMO_SOBRE_COMPRE_POR)}.
        </p>
      )}
    </div>
  );
}

/** Os dois `PrecoCard` de um modo. No colapsado, lado a lado; na coluna, empilhados. */
function ParDePrecos({
  sugestao,
  rotularModo,
}: {
  sugestao: SugestaoPrecoRepasse;
  /** Acrescenta o modo ao rótulo acessível — sem isso o leitor de tela lê
   *  quatro preços sem saber de qual coluna são. */
  rotularModo?: boolean;
}) {
  const rotulo = rotularModo === true ? MODO_LABEL[sugestao.modo] : undefined;
  return (
    <div className={cn("grid gap-4", rotularModo === true ? "grid-cols-1" : "sm:grid-cols-2")}>
      <PrecoCard
        titulo="Mínimo"
        descricao="Piso do leilão de 24h"
        arredondado={sugestao.minimoArredondado}
        exato={sugestao.minimoSugerido}
        razao={sugestao.minimoRazaoEfetiva}
        rotuloModo={rotulo}
      />
      <PrecoCard
        titulo="Compre por"
        descricao="Compra direta — encerra o anúncio na hora"
        arredondado={sugestao.comprePorArredondado}
        exato={sugestao.comprePorSugerido}
        razao={sugestao.comprePorRazaoEfetiva}
        rotuloModo={rotulo}
      />
    </div>
  );
}

/**
 * AC11 / C7 — a banda é DO MÍNIMO entre carros, não a faixa mín↔compre-por.
 *
 * `bandaMinimo` vem `null` no modo girar e a supressão é do MOTOR: a banda é
 * dispersão do mínimo SOBRE O CUSTO entre 16 carros, e reaplicá-la sobre a
 * compra seria o erro de eixo da ADR-003 §4 repetido. Aqui só não há o que
 * mostrar.
 */
function BandaMinimo({ sugestao }: { sugestao: SugestaoPrecoRepasse }) {
  if (sugestao.bandaMinimo == null) return null;
  return (
    <p className="mt-4 text-[11px] text-[var(--text-muted)]">
      Banda do mínimo entre os carros que venderam (p25–p75, n=16):{" "}
      <strong className="tabular-nums">{formatBRL(sugestao.bandaMinimo.p25)}</strong> –{" "}
      <strong className="tabular-nums">{formatBRL(sugestao.bandaMinimo.p75)}</strong>. Não é a faixa
      entre o mínimo e o compre por.
    </p>
  );
}

/**
 * C10, instância 1 — na coluna girar, calculada sobre o par que a coluna EXIBE.
 *
 * O slot nunca fica vazio: zona A tem texto próprio. E nunca é vermelho — sob o
 * modo girar, "abaixo do custo" não é alerta, é a descrição do modo (§12.8).
 */
function NotaGiro({ sugestao }: { sugestao: SugestaoPrecoRepasse }) {
  const { custoReal, valorCompraRepasse, gastosTotal } = sugestao.custo;
  // Zona C é INALCANÇÁVEL aqui: I1 garante `minimo ≥ base = compra`, e o
  // arredondamento respeita o piso. Ela só existe no bloco Aplicar, por edição
  // manual — e é lá que mora o único vermelho.
  const zona = zonaDoMinimo(custoReal, valorCompraRepasse, sugestao.minimoArredondado);
  return (
    <div className="mt-4">
      <Aviso tom="neutro">
        {zona === "A" ? (
          <>
            Mesmo girando, o mínimo ainda cobre os {formatBRLCents(gastosTotal)} de gastos. Entre os
            dois modos aqui a diferença é só de margem.
          </>
        ) : (
          <>
            <strong>
              Neste preço você abre mão de{" "}
              {formatBRLCents(naoRecuperado(custoReal, sugestao.minimoArredondado))} dos{" "}
              {formatBRLCents(gastosTotal)} de gastos.
            </strong>{" "}
            Não é erro: é o que este modo faz — ele recupera o que você pagou no carro, não o que
            gastou nele.
          </>
        )}
      </Aviso>
    </div>
  );
}

/**
 * C15 — uma coluna do radiogroup. Rádio NATIVO dentro de `<label>`: as setas
 * navegam de graça e o estado não depende só de cor (rádio + palavra
 * "Selecionado" + borda).
 */
function ColunaModo({
  modo,
  base,
  selecionado,
  indisponivel,
  onSelecionar,
  children,
}: {
  modo: ModoPreco;
  base: number;
  selecionado: boolean;
  /** Motivo pt-BR do MOTOR quando este modo não pode sugerir (C6). */
  indisponivel?: string | null;
  onSelecionar: (m: ModoPreco) => void;
  children: React.ReactNode;
}) {
  const off = indisponivel != null;
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        // A não-selecionada NÃO é esmaecida: ele precisa comparar os números, e
        // opacidade em número de dinheiro é hostil.
        selecionado
          ? "border-[var(--brand-600)] ring-1 ring-[var(--brand-600)]"
          : "border-[var(--border-soft)]",
        off && "bg-[var(--bg-muted)]",
      )}
    >
      <label
        className={cn(
          "flex min-h-[44px] items-start gap-2",
          off ? "cursor-not-allowed" : "cursor-pointer",
        )}
        title={indisponivel ?? undefined}
      >
        <input
          type="radio"
          name="modo-preco"
          value={modo}
          checked={selecionado}
          disabled={off}
          aria-disabled={off || undefined}
          onChange={() => onSelecionar(modo)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand-700)]"
        />
        <span className="flex-1">
          <span className="block text-sm font-semibold text-[var(--text-strong)]">
            {MODO_LABEL[modo]}
            {off && " — indisponível neste carro"}
          </span>
          {selecionado && (
            <span className="block text-[10px] font-medium uppercase tracking-wide text-[var(--brand-700)]">
              Selecionado
            </span>
          )}
          {/* Cabeçalho repete a BASE em dinheiro: no empilhado (mobile) nenhum
              número fica órfão ao rolar, e a assimetria de evidência fica onde o
              número está — não só no rodapé (C17). */}
          <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
            {BASE_DA_COLUNA[modo]} ·{" "}
            <strong className="tabular-nums">{formatBRLCents(base)}</strong>
          </span>
          <span className="block text-[11px] text-[var(--text-subtle)]">
            {AMOSTRA_DA_COLUNA[modo]}
          </span>
        </span>
      </label>

      {off ? (
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-muted)]">{indisponivel}</p>
      ) : (
        <div className="mt-3 space-y-3">{children}</div>
      )}
    </div>
  );
}

/**
 * §4.1 — tira de confirmação INLINE, não `window.confirm` nem modal: em tablet
 * o modal cobre justamente os números que ele precisa ver pra decidir.
 *
 * O rádio só flipa no "Trocar e substituir" — estado visual nunca mente.
 */
function ConfirmarTrocaModo({
  alvo,
  minimoDigitado,
  comprePorDigitado,
  onConfirmar,
  onCancelar,
}: {
  alvo: ModoPreco;
  minimoDigitado: number | null;
  comprePorDigitado: number | null;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const primario = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primario.current?.focus();
  }, []);

  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-label={`Trocar para ${MODO_LABEL[alvo]}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancelar();
      }}
      className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <p>
        Trocar pra &quot;{MODO_LABEL[alvo]}&quot; vai substituir os valores que você digitou (mínimo{" "}
        <span className="tabular-nums">
          {minimoDigitado != null ? formatBRLCents(minimoDigitado) : "—"}
        </span>{" "}
        · compre por{" "}
        <span className="tabular-nums">
          {comprePorDigitado != null ? formatBRLCents(comprePorDigitado) : "—"}
        </span>
        ).
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          ref={primario}
          type="button"
          onClick={onConfirmar}
          className="inline-flex min-h-[44px] items-center rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
        >
          Trocar e substituir
        </button>
        <button
          type="button"
          onClick={onCancelar}
          className="inline-flex min-h-[44px] items-center rounded-md border border-amber-400 bg-transparent px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function PrecoCard({
  titulo,
  descricao,
  arredondado,
  exato,
  razao,
  rotuloModo,
}: {
  titulo: string;
  descricao: string;
  arredondado: number;
  exato: number;
  razao: number;
  /**
   * Nome do modo, quando há duas colunas. Vira o rótulo acessível do card —
   * sem ele o leitor de tela lê QUATRO preços seguidos sem saber de qual coluna
   * cada um é. Opcional: as chamadas do estado colapsado seguem inalteradas.
   */
  rotuloModo?: string;
}) {
  return (
    <div
      className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-muted)] p-4"
      aria-label={
        rotuloModo != null
          ? `${rotuloModo} — ${titulo.toLocaleLowerCase("pt-BR")} ${formatBRL(arredondado)}`
          : undefined
      }
      role={rotuloModo != null ? "group" : undefined}
    >
      <p className="text-[10px] uppercase tracking-wide text-[var(--text-subtle)]">{titulo}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--text-strong)]">
        {formatBRL(arredondado)}
      </p>
      {/* `text-xs` (12px), não 11px: quatro números de razão num tablet em pé de
          pátio é pouco. A razão é sempre SOBRE O CUSTO REAL nos dois modos
          (ADR-003 §12.5) — por isso o texto continua dizendo "do custo". */}
      <p className="mt-1 text-xs text-[var(--text-muted)]">
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
  minimoEditado,
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
  /** O Marcos digitou no campo do mínimo? Só muda o RÓTULO da nota da C10. */
  minimoEditado: boolean;
  aplicando: boolean;
  podeAplicar: boolean;
  carimboPendente: boolean;
  onMinimo: (v: string) => void;
  onComprePor: (v: string) => void;
  onResetar: () => void;
  onAplicar: () => void;
  onRetentarCarimbo: () => void;
}) {
  // ⚠️ O modo sai de `sugestao.modo` — do objeto que PRODUZIU estes números —,
  // nunca de um prop de estado de UI lido em separado. Mesma disciplina da C19:
  // "girar com rótulo de recuperar" não deve ser representável nem na tela.
  const modo = sugestao.modo;
  const custo = sugestao.custo.custoReal;
  const compra = sugestao.custo.valorCompraRepasse;

  // §3.4 — O LIMIAR DO VERMELHO É POR MODO.
  //
  // ⚠️ Devolver `custo_real` aqui no modo girar reintroduz o alerta que toca
  // SEMPRE: acima de 6,6% de gastos todo carro girado acenderia vermelho, e
  // alerta que toca sempre deixa de ser lido (a mesma razão que matou o alerta
  // de piso na ADR-003 §5). Pior: apaga a diferença entre escolha e erro.
  // No modo recuperar o limiar e o texto são os de hoje, palavra por palavra.
  const limiarVermelho = modo === "girar_rapido" ? compra : custo;
  const minimoAbaixo = minimoAplicar != null && minimoAplicar < limiarVermelho;
  const comprePorAbaixo = comprePorAplicar != null && comprePorAplicar < limiarVermelho;
  const invertido =
    minimoAplicar != null && comprePorAplicar != null && comprePorAplicar < minimoAplicar;

  // C10, instância 2 — sobre o valor que está NO CAMPO. Enquanto ele não editar
  // é o mesmo número da coluna, então não há duplicidade percebida.
  const zonaAplicar =
    modo === "girar_rapido" && minimoAplicar != null
      ? zonaDoMinimo(custo, compra, minimoAplicar)
      : null;

  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-strong)]">Aplicar no repasse</h3>
        {/* É o último ponto antes de uma escrita irreversível: o modo tem que
            estar visível aqui. Mitigação viva do Risk #2 (girar aplicado por
            engano num carro de showroom). */}
        <span className="rounded-full bg-[var(--bg-muted)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-body)]">
          {MODO_LABEL[modo]}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-[var(--text-subtle)]">
        Os dois campos vêm preenchidos com o par de &quot;{modoEmFrase(modo)}&quot; e são editáveis.
        Sua correção é gravada junto com a sugestão — é ela que ensina onde a régua erra.
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

      {/* AC19 — editar abaixo do piso É permitido, com aviso em vermelho.
          MODO RECUPERAR: idêntico à 3.1a, palavra por palavra. */}
      {modo === "recuperar_tudo" && (minimoAbaixo || comprePorAbaixo) && (
        <div className="mt-3">
          <Aviso tom="erro">
            Valor abaixo do custo real ({formatBRLCents(custo)}) — vender assim dá prejuízo. Dá pra
            aplicar assim mesmo: o piso de 0% é regra do motor de sugestão, não do que você pode
            decidir.
          </Aviso>
        </div>
      )}

      {/* MODO GIRAR — o vermelho fica reservado pro que ele NÃO escolheu:
          abaixo da COMPRA (zona C). Abrir mão dos gastos foi decisão dele. */}
      {modo === "girar_rapido" && minimoAbaixo && (
        <div className="mt-3">
          <Aviso tom="erro">
            <strong>
              O mínimo ficou abaixo do que você pagou no carro ({formatBRLCents(compra)}).
            </strong>{" "}
            Girar rápido abre mão dos gastos, não da compra — isso aqui é prejuízo sobre a compra. Dá
            pra aplicar assim mesmo, mas confira.
          </Aviso>
        </div>
      )}
      {modo === "girar_rapido" && comprePorAbaixo && (
        <div className="mt-3">
          <Aviso tom="erro">
            <strong>
              O compre por ficou abaixo do que você pagou no carro ({formatBRLCents(compra)}).
            </strong>{" "}
            Girar rápido abre mão dos gastos, não da compra — isso aqui é prejuízo sobre a compra. Dá
            pra aplicar assim mesmo, mas confira.
          </Aviso>
        </div>
      )}

      {/* C10, instância 2 — contexto de DECISÃO. Cinza, nunca vermelho: zona B
          é a descrição do modo. Sem zona A aqui: não há nada de que abrir mão. */}
      {zonaAplicar === "B" && minimoAplicar != null && (
        <div className="mt-3">
          <Aviso tom="neutro">
            {minimoEditado ? (
              <>
                <strong>Com o valor que você digitou</strong>,{" "}
                {formatBRLCents(naoRecuperado(custo, minimoAplicar))} dos{" "}
                {formatBRLCents(sugestao.custo.gastosTotal)} de gastos não voltam.
              </>
            ) : (
              <>
                Com esse mínimo, {formatBRLCents(naoRecuperado(custo, minimoAplicar))} dos{" "}
                {formatBRLCents(sugestao.custo.gastosTotal)} de gastos não voltam.
              </>
            )}
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
