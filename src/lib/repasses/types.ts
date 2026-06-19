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

  valor_aquisicao: number | null;
  preco_atual: number | null;

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
  documentacao_status: DocStatus | null;
  cautelar_status_manual: CautelarStatus | null;
  valor_subir: number | null;
  observacoes: string | null;

  criado_em: string; // ISO
  atualizado_em: string; // ISO
};

// ─── Status manuais (Caminho B) ──────────────────────────────────────────────

export type IpvaStatus = "pago" | "em_aberto" | "nao_verificado";
export type DocStatus = "ok" | "pendente" | "irregular" | "nao_verificado";
export type CautelarStatus = "limpa" | "com_restricao" | "nao_verificada";

export const IPVA_VALUES: ReadonlyArray<IpvaStatus> = ["pago", "em_aberto", "nao_verificado"];
export const DOC_VALUES: ReadonlyArray<DocStatus> = ["ok", "pendente", "irregular", "nao_verificado"];
export const CAUTELAR_VALUES: ReadonlyArray<CautelarStatus> = ["limpa", "com_restricao", "nao_verificada"];

export const IPVA_LABEL: Record<IpvaStatus, string> = {
  pago: "Pago",
  em_aberto: "Em aberto",
  nao_verificado: "Não verificado",
};

export const DOC_LABEL: Record<DocStatus, string> = {
  ok: "OK",
  pendente: "Pendente",
  irregular: "Irregular",
  nao_verificado: "Não verificado",
};

export const CAUTELAR_LABEL: Record<CautelarStatus, string> = {
  limpa: "Limpa",
  com_restricao: "Com restrição",
  nao_verificada: "Não verificada",
};

export function isIpvaStatus(v: unknown): v is IpvaStatus {
  return typeof v === "string" && (IPVA_VALUES as ReadonlyArray<string>).includes(v);
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
