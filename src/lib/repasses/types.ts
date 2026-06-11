/**
 * Tipos compartilhados do módulo de Repasses.
 *
 * Datas vêm do Supabase como string (ISO ou YYYY-MM-DD pra `date`). Mantemos
 * elas como string aqui — quem precisa de objeto Date converte no ponto de uso.
 */

export type RepasseStatus = "subido" | "vendido" | "nao_vendido" | "cancelado";

export type DocStatus = "ok" | "pendente" | "irregular";

export type GastoTipo =
  | "documentacao"
  | "vistoria"
  | "pintura"
  | "mecanica"
  | "multas"
  | "outro";

export type DocumentoTipo =
  | "crv"
  | "ipva"
  | "licenciamento"
  | "multas"
  | "transferencia"
  | "outro";

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
  valor_subiu: number | null;
  valor_minimo: number | null;
  valor_vendido: number | null;

  data_subiu: string; // YYYY-MM-DD
  data_vendido: string | null; // YYYY-MM-DD | null
  canal: RepasseCanal;

  status: RepasseStatus;
  documentacao_status: DocStatus;

  descricao: string | null;
  opcionais: string | null;
  comprador: string | null;
  observacoes: string | null;

  criado_em: string; // ISO
  atualizado_em: string; // ISO
};

export type RepasseGasto = {
  id: number;
  repasse_id: number;
  tipo: GastoTipo;
  descricao: string;
  valor: number;
  data: string; // YYYY-MM-DD
  observacao: string | null;
  criado_em: string;
};

export type RepasseDocumento = {
  id: number;
  repasse_id: number;
  tipo: DocumentoTipo;
  status: DocStatus;
  observacao: string | null;
  data_verificacao: string | null; // YYYY-MM-DD | null
  criado_em: string;
  atualizado_em: string;
};

export type RepasseFoto = {
  id: number;
  repasse_id: number;
  url: string;
  ordem: number;
  legenda: string | null;
  criado_em: string;
};

// ─── Labels pt-BR ────────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<RepasseStatus, string> = {
  subido: "Subido",
  vendido: "Vendido",
  nao_vendido: "Não vendido",
  cancelado: "Cancelado",
};

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  ok: "OK",
  pendente: "Pendente",
  irregular: "Irregular",
};

export const DOC_STATUS_ICON: Record<DocStatus, string> = {
  ok: "✅",
  pendente: "⏳",
  irregular: "❌",
};

export const GASTO_TIPO_LABEL: Record<GastoTipo, string> = {
  documentacao: "Documentação",
  vistoria: "Vistoria",
  pintura: "Pintura",
  mecanica: "Mecânica",
  multas: "Multas",
  outro: "Outro",
};

export const DOCUMENTO_TIPO_LABEL: Record<DocumentoTipo, string> = {
  crv: "CRV",
  ipva: "IPVA",
  licenciamento: "Licenciamento",
  multas: "Multas",
  transferencia: "Transferência",
  outro: "Outro",
};

/** Itens fixos no checklist (ordem importa pra exibição). */
export const DOCUMENTOS_PADRAO: ReadonlyArray<DocumentoTipo> = [
  "crv",
  "ipva",
  "licenciamento",
  "multas",
  "transferencia",
] as const;

export const CANAL_LABEL: Record<string, string> = {
  auto_avaliar: "Auto Avaliar",
};

/** Opções de canal pro select. */
export const CANAIS_DISPONIVEIS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "auto_avaliar", label: "Auto Avaliar" },
] as const;
