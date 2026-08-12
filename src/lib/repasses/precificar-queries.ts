"use client";

/**
 * Queries da aba `/precificar` — Story 3.1a.
 *
 * Molde: `getDadosMargemRepasse` (`@/lib/repasses/anuncio-queries.ts`). Tudo
 * client-side via `getSupabase()`; erros viram `Error` em pt-BR e a UI mostra.
 *
 * ┌─ ORDEM DE ESCRITA DO "APLICAR" (ADR-003 §3 / AC20) ─────────────────────────┐
 * │ 1. snapshot (linha nova, sem carimbo)                                       │
 * │ 2. UPDATE de `valor_minimo` / `valor_compre_por` em `repasses`              │
 * │ 3. carimbo do aplicado NA MESMA linha do snapshot                           │
 * │                                                                             │
 * │ Falha em 1 ⇒ aborta tudo, NADA é gravado (consistência > disponibilidade    │
 * │              neste volume: um usuário, um clique, retry grátis).            │
 * │ Falha em 2 ⇒ sobra linha "sugeriu e não aplicou". É SINAL, não lixo — não   │
 * │              limpar.                                                        │
 * │ Falha em 3 ⇒ pior dos três: `repasses` aplicado e o snapshot MENTINDO. A UI │
 * │              oferece retry do carimbo; `trg_rep_prec_append_only` permite a │
 * │              transição NULL → valor UMA vez.                                │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */

import { getSupabase } from "@/lib/data/supabase";
import { calcularDiasNoRepasse } from "@/lib/repasses/margem-repasse";
import { hojeLocal } from "@/lib/utils/data-local";
import { normalizarPlaca, placaCasa } from "@/lib/utils/placa";
import type {
  CarimboAplicado,
  SnapshotPrecificacaoInsert,
} from "@/lib/pricing/snapshot-precificacao";
import type { RepasseStatus } from "./types";

// ═════════════════════════════════════════════════════════════════════════════
// TIPOS DE DOMÍNIO DA ABA
// ═════════════════════════════════════════════════════════════════════════════

export type GastoRepasseItem = {
  id: number;
  tipo: string;
  descricao: string;
  valor: number;
  data: string | null;
};

/** Um ciclo de repasse da mesma placa (AC3 — identidade é por CICLO, não chassi). */
export type CicloRepasse = {
  id: number;
  status: RepasseStatus;
  dataMarcado: string | null;
  dataSubido: string | null;
};

export type CarroPrecificar = {
  repasseId: number;
  placa: string;
  chassi: string;
  modelo: string;
  marca: string | null;
  anoFabricacao: number | null;
  anoModelo: number | null;
  km: number | null;
  status: RepasseStatus;
  diasNoRepasse: number | null;
  /**
   * true = `data_subido` foi INFERIDA no backfill da 027. Marca a incerteza no
   * ajuste de dias parados, que é o único ajuste que mexe em dinheiro.
   */
  diasAproximados: boolean;
  valorCompraRepasse: number | null;
  gastos: GastoRepasseItem[];
  valorAutoAvaliar: number | null;
  valorFipe: number | null;
  valorMaiorOferta: number | null;
  qtdeAnuncios: number | null;
  /** Valores operacionais já gravados no repasse (governados pelo portal). */
  valorMinimo: number | null;
  valorComprePor: number | null;
  /** Todos os ciclos da mesma placa, mais recente primeiro (AC3). */
  ciclos: CicloRepasse[];
  /** AC4 — `vendido`/`cancelado` abrem em modo consulta. */
  editavel: boolean;
  motivoBloqueio: string | null;
};

export type FalhaBuscaPlaca =
  | "sem_placa"
  | "ambiguo"
  | "so_no_estoque"
  | "nao_encontrado";

export type ResultadoBuscaPlaca =
  | { encontrado: true; carro: CarroPrecificar }
  | {
      encontrado: false;
      motivo: FalhaBuscaPlaca;
      mensagem: string;
      /** Preenchido em `so_no_estoque` — o carro existe, só não está em repasse. */
      veiculoEstoque?: { placa: string; modelo: string; chassi: string };
    };

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/** NUMERIC do Supabase (pode vir string) → number finito | null. */
function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** Contagem inteira. Preserva o 0 (medição real) e recusa negativo. */
function inteiro(v: number | string | null | undefined): number | null {
  const n = num(v);
  if (n == null || n < 0) return null;
  return Math.trunc(n);
}

const STATUS_VALIDOS: ReadonlyArray<RepasseStatus> = [
  "marcado",
  "subido",
  "vendido",
  "nao_vendido",
  "cancelado",
];

function isRepasseStatus(v: unknown): v is RepasseStatus {
  return typeof v === "string" && (STATUS_VALIDOS as ReadonlyArray<string>).includes(v);
}

/** Colunas que a aba precisa. `valor_aquisicao` NÃO entra — é custo de varejo. */
const COLUNAS_PRECIFICAR =
  "id, chassi, placa, modelo, marca, ano_fabricacao, ano_modelo, km, status, " +
  "data_subiu, data_subido, data_subido_aproximada, data_vendido, valor_compra_repasse, valor_minimo, " +
  "valor_compre_por, valor_auto_avaliar, valor_fipe, valor_maior_oferta, qtde_anuncios";

type RepassePrecificarRow = {
  id: number;
  chassi: string;
  placa: string;
  modelo: string;
  marca: string | null;
  ano_fabricacao: number | null;
  ano_modelo: number | null;
  km: number | null;
  status: string;
  data_subiu: string | null;
  data_subido: string | null;
  /** Coluna da migration 027 — pode vir ausente até a migration ser aplicada. */
  data_subido_aproximada?: boolean | null;
  data_vendido: string | null;
  valor_compra_repasse: number | string | null;
  valor_minimo: number | string | null;
  valor_compre_por: number | string | null;
  valor_auto_avaliar: number | string | null;
  valor_fipe: number | string | null;
  valor_maior_oferta?: number | string | null;
  qtde_anuncios?: number | string | null;
};

/** Motivo pt-BR do modo consulta (AC4). `null` = editável. */
function motivoBloqueio(status: RepasseStatus): string | null {
  if (status === "vendido") {
    return "Carro já vendido — modo consulta. Reabra o repasse pra alterar o preço.";
  }
  if (status === "cancelado") {
    return "Repasse cancelado — modo consulta. Não dá pra aplicar preço num ciclo cancelado.";
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// LEITURA
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Gastos de um repasse COM detalhe (AC8 — o custo tem que aparecer decomposto,
 * pro caso Frontier PRD1J39 não poder mais ser lido como "0,00%").
 *
 * `listGastosPorRepasse` (queries.ts) devolve só os valores; aqui a UI precisa
 * listar descrição e tipo. Mesma normalização: valor não-numérico é ignorado.
 */
export async function listGastosDetalhados(repasseId: number): Promise<GastoRepasseItem[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("repasse_gastos")
    .select("id, tipo, descricao, valor, data")
    .eq("repasse_id", repasseId)
    .order("id", { ascending: true });
  if (error) throw new Error(`Falha ao carregar gastos do repasse: ${error.message}`);

  const rows = (data ?? []) as Array<{
    id: number;
    tipo: string | null;
    descricao: string | null;
    valor: number | string | null;
    data: string | null;
  }>;

  const out: GastoRepasseItem[] = [];
  for (const r of rows) {
    const valor = num(r.valor);
    if (valor == null) continue;
    out.push({
      id: r.id,
      tipo: r.tipo ?? "outro",
      descricao: r.descricao ?? "",
      valor,
      data: r.data,
    });
  }
  return out;
}

/**
 * Resolve a placa e carrega tudo que a aba precisa (AC1–AC4).
 *
 * A resolução é client-side com `placaCasa` porque a placa é gravada ora com
 * hífen ora sem, e o `ilike` do Postgres não normaliza. São ~dezenas de linhas
 * de `repasses` — o custo de trazer a lista é irrelevante e evita depender de
 * uma coluna normalizada que não existe.
 */
export async function buscarCarroPorPlaca(termo: string): Promise<ResultadoBuscaPlaca> {
  const alvo = normalizarPlaca(termo);
  if (alvo === "") {
    return { encontrado: false, motivo: "sem_placa", mensagem: "Digite uma placa pra começar." };
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from("repasses")
    .select(COLUNAS_PRECIFICAR)
    .order("id", { ascending: false });
  if (error) throw new Error(`Falha ao buscar a placa nos repasses: ${error.message}`);

  const todos = (data ?? []) as unknown as RepassePrecificarRow[];
  const casam = todos.filter((r) => placaCasa(r.placa, alvo));

  if (casam.length === 0) {
    return await buscarNoEstoque(alvo);
  }

  // Termo parcial pode casar com carros diferentes — pedir a placa completa é
  // melhor do que escolher um por conta própria.
  const placasDistintas = new Set(casam.map((r) => normalizarPlaca(r.placa)));
  if (placasDistintas.size > 1) {
    return {
      encontrado: false,
      motivo: "ambiguo",
      mensagem: `"${termo.trim()}" casa com ${placasDistintas.size} carros diferentes. Digite a placa completa.`,
    };
  }

  // AC3 — o ciclo é o mais recente com status ≠ cancelado. `id` desc já veio do
  // banco. Se TODOS estiverem cancelados, abre o mais recente em modo consulta.
  const ativos = casam.filter((r) => r.status !== "cancelado");
  const escolhido = ativos[0] ?? casam[0];

  const gastos = await listGastosDetalhados(escolhido.id);

  const status: RepasseStatus = isRepasseStatus(escolhido.status) ? escolhido.status : "marcado";
  const bloqueio = motivoBloqueio(status);

  const carro: CarroPrecificar = {
    repasseId: escolhido.id,
    placa: escolhido.placa,
    chassi: escolhido.chassi,
    modelo: escolhido.modelo,
    marca: escolhido.marca,
    anoFabricacao: escolhido.ano_fabricacao,
    anoModelo: escolhido.ano_modelo,
    km: escolhido.km,
    status,
    // Mesma origem do relatório de anúncio: `data_subido` (carro NO AR), com
    // fallback pra `data_subiu` (marcação) nos registros legados.
    diasNoRepasse: calcularDiasNoRepasse(
      escolhido.data_subido ?? escolhido.data_subiu,
      escolhido.data_vendido,
      hojeLocal(),
    ),
    // `=== true` porque a coluna só existe a partir da 027: antes disso vem
    // undefined, e undefined não pode virar "data aproximada".
    diasAproximados: escolhido.data_subido_aproximada === true,
    valorCompraRepasse: num(escolhido.valor_compra_repasse),
    gastos,
    valorAutoAvaliar: num(escolhido.valor_auto_avaliar),
    valorFipe: num(escolhido.valor_fipe),
    valorMaiorOferta: num(escolhido.valor_maior_oferta ?? null),
    qtdeAnuncios: inteiro(escolhido.qtde_anuncios ?? null),
    valorMinimo: num(escolhido.valor_minimo),
    valorComprePor: num(escolhido.valor_compre_por),
    ciclos: casam.map((r) => ({
      id: r.id,
      status: isRepasseStatus(r.status) ? r.status : "marcado",
      dataMarcado: r.data_subiu,
      dataSubido: r.data_subido,
    })),
    editavel: bloqueio == null,
    motivoBloqueio: bloqueio,
  };

  return { encontrado: true, carro };
}

/**
 * AC2 — a placa não está em `repasses`. Se ela existe no estoque, a mensagem
 * diz isso e oferece o caminho (marcar o carro pra repasse).
 */
async function buscarNoEstoque(alvo: string): Promise<ResultadoBuscaPlaca> {
  const sb = getSupabase();
  const { data, error } = await sb.from("veiculos_atual").select("placa, modelo, chassi");
  if (error) {
    // O estoque é só o refinamento da mensagem — se ele falhar, a resposta útil
    // continua sendo "não está nos repasses".
    return {
      encontrado: false,
      motivo: "nao_encontrado",
      mensagem: "Placa não encontrada nos repasses.",
    };
  }

  const veiculos = (data ?? []) as Array<{ placa: string; modelo: string; chassi: string }>;
  const achado = veiculos.find((v) => placaCasa(v.placa, alvo));
  if (achado) {
    return {
      encontrado: false,
      motivo: "so_no_estoque",
      mensagem:
        "Esse carro está no estoque, mas ainda não foi marcado pra repasse. Marque ele em Repasses pra poder precificar.",
      veiculoEstoque: achado,
    };
  }

  return {
    encontrado: false,
    motivo: "nao_encontrado",
    mensagem: "Placa não encontrada nos repasses.",
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// ESCRITA
// ═════════════════════════════════════════════════════════════════════════════

/** Descrição default quando o Marcos lança o gasto sem escrever nada (AC9). */
export const DESCRICAO_GASTO_PADRAO = "Gasto lançado na precificação";

/**
 * AC9 — lança um gasto direto da aba. `descricao` é opcional na UI, mas a coluna
 * é NOT NULL no schema (008), então o default entra aqui.
 * `tipo='outro'` e `data` no default do banco (`hoje_brasilia()`, migration 028).
 */
export async function criarGastoRepasse(
  repasseId: number,
  valor: number,
  descricao?: string | null,
): Promise<GastoRepasseItem> {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0) {
    throw new Error("Informe um valor de gasto maior que zero.");
  }
  const texto = (descricao ?? "").trim();
  const sb = getSupabase();
  const { data, error } = await sb
    .from("repasse_gastos")
    .insert({
      repasse_id: repasseId,
      tipo: "outro",
      descricao: texto === "" ? DESCRICAO_GASTO_PADRAO : texto,
      valor,
    })
    .select("id, tipo, descricao, valor, data")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao lançar o gasto: ${error?.message ?? "sem dados"}`);
  }
  const row = data as {
    id: number;
    tipo: string | null;
    descricao: string | null;
    valor: number | string | null;
    data: string | null;
  };
  return {
    id: row.id,
    tipo: row.tipo ?? "outro",
    descricao: row.descricao ?? DESCRICAO_GASTO_PADRAO,
    valor: num(row.valor) ?? valor,
    data: row.data,
  };
}

/**
 * Grava os dois campos OPERACIONAIS do repasse.
 *
 * Função nova de propósito: `updateRepasseCampos` cobre só os 6 campos manuais
 * do Caminho B (`ipva_status`, `ipva_responsavel`, `documentacao_status`,
 * `cautelar_status_manual`, `valor_subir`, `observacoes`) — `valor_minimo` e
 * `valor_compre_por` não estão lá.
 *
 * ⚠️ Estes campos seguem governados pelo portal via import: o que se grava aqui
 * é INTENÇÃO, e o import substitui pela FATO quando o relatório chegar (AC23).
 */
export async function atualizarPrecosRepasse(
  repasseId: number,
  valorMinimo: number,
  valorComprePor: number,
): Promise<void> {
  if (!Number.isFinite(valorMinimo) || valorMinimo < 0) {
    throw new Error(`valor_minimo inválido: ${String(valorMinimo)}`);
  }
  if (!Number.isFinite(valorComprePor) || valorComprePor < 0) {
    throw new Error(`valor_compre_por inválido: ${String(valorComprePor)}`);
  }
  const sb = getSupabase();
  const { error } = await sb
    .from("repasses")
    .update({ valor_minimo: valorMinimo, valor_compre_por: valorComprePor })
    .eq("id", repasseId);
  if (error) throw new Error(`Falha ao gravar os preços no repasse: ${error.message}`);
}

/** 1º passo: insere o snapshot SEM carimbo. Devolve o id da linha. */
export async function inserirSnapshotPrecificacao(
  payload: SnapshotPrecificacaoInsert,
): Promise<number> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("repasse_precificacao_sugerida")
    .insert(payload)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao gravar o registro da sugestão: ${error?.message ?? "sem dados"}`);
  }
  return (data as { id: number }).id;
}

/**
 * 3º passo: carimba o aplicado NA MESMA linha.
 *
 * Seguro pra retry: `trg_rep_prec_append_only` permite a transição
 * `NULL → valor` UMA vez. Uma segunda tentativa de recarimbar estoura no
 * trigger — comportamento esperado, não bug.
 */
export async function carimbarSnapshotAplicado(
  snapshotId: number,
  carimbo: CarimboAplicado,
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("repasse_precificacao_sugerida")
    .update(carimbo)
    .eq("id", snapshotId);
  if (error) throw new Error(`Falha ao carimbar a sugestão como aplicada: ${error.message}`);
}

// ─── Orquestração do clique "Aplicar no repasse" ─────────────────────────────

export type ResultadoAplicar =
  /** Tudo gravado: snapshot + UPDATE (ou skip da AC24) + carimbo. */
  | { etapa: "ok"; snapshotId: number; updatePulado: boolean }
  /** Falhou o snapshot ⇒ NADA foi gravado. Retry é grátis. */
  | { etapa: "falha_snapshot"; mensagem: string }
  /** Snapshot gravado, UPDATE falhou ⇒ linha "sugeriu e não aplicou". É SINAL. */
  | { etapa: "falha_update"; snapshotId: number; mensagem: string }
  /** Preços aplicados, carimbo falhou ⇒ o snapshot MENTE. UI oferece retry. */
  | { etapa: "falha_carimbo"; snapshotId: number; carimbo: CarimboAplicado; mensagem: string };

function mensagemErro(e: unknown): string {
  return e instanceof Error ? e.message : "Erro inesperado.";
}

/** Centavo-perfect, mesmo critério de `margem-repasse.ts`. */
function arredondarCentavos(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * Executa a ordem de escrita do AC20. Nunca lança: devolve a etapa alcançada
 * pra UI decidir entre erro, rollback otimista ou retry do carimbo.
 *
 * AC24 — aplicar valores IDÊNTICOS aos já gravados PULA o `UPDATE` (o app
 * compara; não é "manda e aceita"), mas o snapshot é gravado E carimbado
 * normalmente: os três NULL significam "sugeriu e não aplicou", e uma decisão
 * legitimamente aplicada não pode virar indistinguível de uma falha. O evento
 * é a DECISÃO, não a mudança de valor.
 */
export async function aplicarPrecoRepasse(args: {
  insert: SnapshotPrecificacaoInsert;
  carimbo: CarimboAplicado;
  /** Valores hoje gravados no repasse — base da comparação da AC24. */
  atuais: { minimo: number | null; comprePor: number | null };
}): Promise<ResultadoAplicar> {
  const { insert, carimbo, atuais } = args;

  // 1) Snapshot. Falhou ⇒ aborta tudo, nada gravado.
  let snapshotId: number;
  try {
    snapshotId = await inserirSnapshotPrecificacao(insert);
  } catch (e) {
    return { etapa: "falha_snapshot", mensagem: mensagemErro(e) };
  }

  // 2) UPDATE dos campos operacionais — pulado se nada muda (AC24).
  const iguais =
    atuais.minimo != null &&
    atuais.comprePor != null &&
    arredondarCentavos(atuais.minimo) === carimbo.minimo_aplicado &&
    arredondarCentavos(atuais.comprePor) === carimbo.compre_por_aplicado;

  if (!iguais) {
    try {
      await atualizarPrecosRepasse(
        insert.repasse_id,
        carimbo.minimo_aplicado,
        carimbo.compre_por_aplicado,
      );
    } catch (e) {
      return { etapa: "falha_update", snapshotId, mensagem: mensagemErro(e) };
    }
  }

  // 3) Carimbo do aplicado.
  try {
    await carimbarSnapshotAplicado(snapshotId, carimbo);
  } catch (e) {
    return { etapa: "falha_carimbo", snapshotId, carimbo, mensagem: mensagemErro(e) };
  }

  return { etapa: "ok", snapshotId, updatePulado: iguais };
}
