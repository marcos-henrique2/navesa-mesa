/**
 * Tipos compartilhados do módulo de Repasses.
 *
 * Datas vêm do Supabase como string (ISO ou YYYY-MM-DD pra `date`). Mantemos
 * elas como string aqui — quem precisa de objeto Date converte no ponto de uso.
 *
 * Modelo novo (ciclo completo do repasse):
 *   - Marcos marca carros pra subir → status="marcado"
 *   - Exporta XLSX, preenche IPVA/Doc/Cautelar/Observação no Excel
 *   - Sobe no Auto Avaliar (fora do sistema) e volta marcando como "subido"
 *   - Registra o desfecho: "vendido" (valor + data + comprador) ou "nao_vendido"
 *
 * Ciclo de status: marcado → subido → vendido | nao_vendido. "cancelado" é o
 * soft-delete (via remover). Todos esses fazem parte do CHECK constraint do banco.
 */

export type RepasseStatus =
  | "marcado"
  | "subido"
  | "vendido"
  | "nao_vendido"
  | "cancelado";

/** Alias histórico — hoje idêntico a RepasseStatus (todos os status são usados). */
export type RepasseStatusBanco = RepasseStatus;

/** Canal de repasse. String aberta — `auto_avaliar` é o default. */
export type RepasseCanal = "auto_avaliar" | (string & {});

export type Repasse = {
  id: number;

  chassi: string;
  placa: string;
  modelo: string;
  marca: string | null;
  cor: string | null;
  ano_modelo: number | null;
  ano_fabricacao: number | null;
  km: number | null;
  loja_origem: number | null;
  patio_origem: string | null;

  /** Custo de VAREJO (NBS). Referência do sistema — NUNCA entra na margem de repasse. */
  valor_aquisicao: number | null;
  preco_atual: number | null;

  // ─── Valores do repasse (Épico Inteligência de Repasse — Story 1.1) ────
  /** Custo-base do repasse ("R$ Compra" do Auto Avaliar). Base da margem, junto com Σ repasse_gastos. */
  valor_compra_repasse: number | null;
  /** Piso de negociação do anúncio. */
  valor_minimo: number | null;
  /** Teto/preço de tabela do anúncio ("Compre por"). */
  valor_compre_por: number | null;

  data_marcado: string; // YYYY-MM-DD — alias de data_subiu legacy
  data_subido: string | null; // YYYY-MM-DD | null — quando virou "subido"
  canal: RepasseCanal;

  status: RepasseStatus;

  // ─── Desfecho da venda (status="vendido") ─────────────────────────────
  valor_vendido: number | null;
  data_vendido: string | null; // YYYY-MM-DD | null
  comprador: string | null;

  // ─── Campos manuais (Caminho B — inline edit no /repasses) ────────────
  ipva_status: IpvaStatus | null;
  ipva_responsavel: IpvaResponsavel | null;
  documentacao_status: DocStatus | null;
  cautelar_status_manual: CautelarStatus | null;
  valor_subir: number | null;
  observacoes: string | null;

  criado_em: string; // ISO
  atualizado_em: string; // ISO
};

// ─── Status manuais (Caminho B) ──────────────────────────────────────────────

export type IpvaStatus = "pago" | "em_aberto" | "nao_verificado";

/**
 * Quem paga o IPVA quando está "em aberto" no anúncio de repasse.
 * Default de negócio = "comprador" (quando `ipva_responsavel` é null, o anúncio
 * assume por conta do comprador). "navesa" é a exceção marcada caso a caso.
 */
export type IpvaResponsavel = "comprador" | "navesa";
export type DocStatus = "ok" | "pendente" | "irregular" | "nao_verificado";
export type CautelarStatus = "conforme" | "nao_conforme" | "nao_verificado";

export const IPVA_VALUES: ReadonlyArray<IpvaStatus> = ["pago", "em_aberto", "nao_verificado"];
export const IPVA_RESPONSAVEL_VALUES: ReadonlyArray<IpvaResponsavel> = ["comprador", "navesa"];
export const DOC_VALUES: ReadonlyArray<DocStatus> = ["ok", "pendente", "irregular", "nao_verificado"];
export const CAUTELAR_VALUES: ReadonlyArray<CautelarStatus> = ["conforme", "nao_conforme", "nao_verificado"];

export const IPVA_LABEL: Record<IpvaStatus, string> = {
  pago: "Pago",
  em_aberto: "Em aberto",
  nao_verificado: "Não verificado",
};

export const IPVA_RESPONSAVEL_LABEL: Record<IpvaResponsavel, string> = {
  comprador: "Por conta do comprador",
  navesa: "Navesa quita antes da entrega",
};

export const DOC_LABEL: Record<DocStatus, string> = {
  ok: "OK",
  pendente: "Pendente",
  irregular: "Irregular",
  nao_verificado: "Não verificado",
};

export const CAUTELAR_LABEL: Record<CautelarStatus, string> = {
  conforme: "Conforme",
  nao_conforme: "Não conforme",
  nao_verificado: "Não verificado",
};

export function isIpvaStatus(v: unknown): v is IpvaStatus {
  return typeof v === "string" && (IPVA_VALUES as ReadonlyArray<string>).includes(v);
}
export function isIpvaResponsavel(v: unknown): v is IpvaResponsavel {
  return typeof v === "string" && (IPVA_RESPONSAVEL_VALUES as ReadonlyArray<string>).includes(v);
}
export function isDocStatus(v: unknown): v is DocStatus {
  return typeof v === "string" && (DOC_VALUES as ReadonlyArray<string>).includes(v);
}
export function isCautelarStatus(v: unknown): v is CautelarStatus {
  return typeof v === "string" && (CAUTELAR_VALUES as ReadonlyArray<string>).includes(v);
}

// ─── Labels pt-BR ────────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<RepasseStatus, string> = {
  marcado: "Marcado",
  subido: "Subido",
  vendido: "Vendido",
  nao_vendido: "Não vendido",
  cancelado: "Cancelado",
};

export const CANAL_LABEL: Record<string, string> = {
  auto_avaliar: "Auto Avaliar",
};

/** Opções de canal pro select. */
export const CANAIS_DISPONIVEIS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "auto_avaliar", label: "Auto Avaliar" },
] as const;
