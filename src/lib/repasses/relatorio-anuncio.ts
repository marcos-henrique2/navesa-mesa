/**
 * Relatório "Carros em anúncio" (status='subido') — Épico Inteligência de Repasse.
 * Story 1.2 (tabela/filtros/export) + Story 1.3 (semáforo/alertas).
 *
 * Camada PURA: recebe dados crus já carregados (repasses + gastos + interessados)
 * e monta os itens do relatório, os filtros e os alertas. Sem Supabase aqui —
 * tudo testável. As queries ficam em `anuncio-queries.ts`.
 *
 * Toda margem/cor delega ao núcleo canônico `margem-repasse.ts` (regra de ouro:
 * custo_real = valor_compra_repasse + Σ gastos; NUNCA valor_aquisicao).
 */

import {
  calcularCustoReal,
  calcularDiasNoRepasse,
  calcularMargemPct,
  calcularMargemValor,
  classificarBadge,
  type CorMargem,
} from "./margem-repasse";

/** Envelhecimento: carro parado há mais de 60 dias. */
export const DIAS_ENVELHECIMENTO = 60;

// ─── Entrada crua (já normalizada dos rows do banco) ─────────────────────────

export type CarroAnuncioInput = {
  id: number;
  placa: string;
  modelo: string;
  marca: string | null;
  ano_fabricacao: number | null;
  ano_modelo: number | null;
  km: number | null;
  status: string;
  data_subiu: string | null;
  data_vendido: string | null;
  /**
   * true = a data de origem dos dias em repasse veio do backfill da migration
   * 027 (inferida de um registro legado), não observada. Opcional: entradas
   * antigas sem o campo contam como data observada.
   */
  data_subido_aproximada?: boolean;
  valor_minimo: number | null;
  valor_compre_por: number | null;
  valor_compra_repasse: number | null;
  /** FIPE/Web, se houver referência; senão null (UI mostra "—"). */
  fipe: number | null;
  /** Valores de repasse_gastos desse carro (já somáveis). */
  gastos: ReadonlyArray<number | null | undefined>;
  /** COUNT de repasse_interessados. */
  interessados: number;
};

// ─── Item calculado do relatório ─────────────────────────────────────────────

export type CarroAnuncioItem = {
  id: number;
  placa: string;
  modelo: string;
  marca: string | null;
  anoFabricacao: number | null;
  anoModelo: number | null;
  /** Rótulo "fab/mod" pronto pra UI (ex.: "2020/2021", "2021", "—"). */
  anoLabel: string;
  km: number | null;
  custoReal: number | null;
  valorMinimo: number | null;
  valorComprePor: number | null;
  fipe: number | null;
  diasNoRepasse: number | null;
  /** true = `diasNoRepasse` é estimativa (registro legado). UI mostra "~34d". */
  diasAproximados: boolean;
  interessados: number;
  /** true = falta custo_real, mínimo ou compre-por → margens/cor indisponíveis. */
  incompleto: boolean;
  margemMinimoValor: number | null;
  margemMinimoPct: number | null;
  margemComPorValor: number | null;
  margemComPorPct: number | null;
  /** Cor do badge (oferta = valor_compre_por). "neutro" quando incompleto. */
  cor: CorMargem;
};

/** Rótulo de ano fab/mod tolerante a nulos. */
function anoLabel(fab: number | null, mod: number | null): string {
  if (fab != null && mod != null) return `${fab}/${mod}`;
  if (mod != null) return String(mod);
  if (fab != null) return String(fab);
  return "—";
}

/** Monta um item do relatório a partir da entrada crua. `hoje` em YYYY-MM-DD. */
export function montarItemAnuncio(input: CarroAnuncioInput, hoje: string): CarroAnuncioItem {
  const custoReal = calcularCustoReal(input.valor_compra_repasse, input.gastos);
  const { valor_minimo: minimo, valor_compre_por: comprePor } = input;

  // Incompleto = qualquer um dos 3 pilares ausente. Aqui NÃO se cai pra
  // valor_aquisicao — dado incompleto fica incompleto (margens indisponíveis).
  const incompleto = custoReal == null || minimo == null || comprePor == null;

  const cor = incompleto ? "neutro" : classificarBadge(custoReal, minimo, comprePor).cor;

  return {
    id: input.id,
    placa: input.placa,
    modelo: input.modelo,
    marca: input.marca,
    anoFabricacao: input.ano_fabricacao,
    anoModelo: input.ano_modelo,
    anoLabel: anoLabel(input.ano_fabricacao, input.ano_modelo),
    km: input.km,
    custoReal,
    valorMinimo: minimo,
    valorComprePor: comprePor,
    fipe: input.fipe,
    diasNoRepasse: calcularDiasNoRepasse(input.data_subiu, input.data_vendido, hoje),
    diasAproximados: input.data_subido_aproximada === true,
    interessados: input.interessados,
    incompleto,
    margemMinimoValor: incompleto ? null : calcularMargemValor(minimo, custoReal),
    margemMinimoPct: incompleto ? null : calcularMargemPct(minimo, custoReal),
    margemComPorValor: incompleto ? null : calcularMargemValor(comprePor, custoReal),
    margemComPorPct: incompleto ? null : calcularMargemPct(comprePor, custoReal),
    cor,
  };
}

/** Monta o relatório inteiro. */
export function montarRelatorioAnuncio(
  inputs: ReadonlyArray<CarroAnuncioInput>,
  hoje: string,
): CarroAnuncioItem[] {
  return inputs.map((i) => montarItemAnuncio(i, hoje));
}

// ─── Filtros (Story 1.2) ─────────────────────────────────────────────────────

export type FiltroAnuncio = {
  /** dias_no_repasse mínimo (inclusive). Carros sem data_subiu ("—") são excluídos. */
  diasMin?: number | null;
  /** substring case-insensitive no modelo. */
  modelo?: string | null;
  /** casa com ano de fabricação OU ano de modelo. */
  ano?: number | null;
};

export function filtrarAnuncio(
  items: ReadonlyArray<CarroAnuncioItem>,
  filtro: FiltroAnuncio,
): CarroAnuncioItem[] {
  const modeloBusca = filtro.modelo?.trim().toLowerCase() ?? "";
  return items.filter((it) => {
    if (filtro.diasMin != null) {
      if (it.diasNoRepasse == null || it.diasNoRepasse < filtro.diasMin) return false;
    }
    if (modeloBusca && !it.modelo.toLowerCase().includes(modeloBusca)) return false;
    if (filtro.ano != null) {
      if (it.anoFabricacao !== filtro.ano && it.anoModelo !== filtro.ano) return false;
    }
    return true;
  });
}

// ─── Alertas (Story 1.3) — só in-app ─────────────────────────────────────────

export type Alertas = {
  /** Prejuízo latente: valor_minimo < custo_real (carros incompletos NÃO entram). */
  prejuizoLatente: CarroAnuncioItem[];
  /** Os piores: valor_compre_por < custo_real (anúncio já sai no prejuízo). */
  prejuizoNoAnuncio: CarroAnuncioItem[];
  /** Envelhecimento: dias_no_repasse > 60. */
  envelhecimento: CarroAnuncioItem[];
};

export function calcularAlertas(items: ReadonlyArray<CarroAnuncioItem>): Alertas {
  const prejuizoLatente: CarroAnuncioItem[] = [];
  const prejuizoNoAnuncio: CarroAnuncioItem[] = [];
  const envelhecimento: CarroAnuncioItem[] = [];

  for (const it of items) {
    if (!it.incompleto && it.custoReal != null) {
      if (it.valorMinimo != null && it.valorMinimo < it.custoReal) {
        prejuizoLatente.push(it);
      }
      if (it.valorComprePor != null && it.valorComprePor < it.custoReal) {
        prejuizoNoAnuncio.push(it);
      }
    }
    if (it.diasNoRepasse != null && it.diasNoRepasse > DIAS_ENVELHECIMENTO) {
      envelhecimento.push(it);
    }
  }

  return { prejuizoLatente, prejuizoNoAnuncio, envelhecimento };
}
