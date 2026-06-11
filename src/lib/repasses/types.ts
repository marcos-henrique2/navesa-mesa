/**
 * Tipos compartilhados do módulo de Repasses.
 *
 * Datas vêm do Supabase como string (ISO ou YYYY-MM-DD pra `date`). Mantemos
 * elas como string aqui — quem precisa de objeto Date converte no ponto de uso.
 *
 * Modelo novo (Sprint 1 refactor):
 *   - Marcos marca carros pra subir → status="marcado"
 *   - Exporta XLSX, preenche IPVA/Doc/Cautelar/Observação no Excel
 *   - Sobe no Auto Avaliar (fora do sistema) e volta marcando como "subido"
 *
 * Status "vendido" e "nao_vendido" são legacy do schema original — não são
 * mais usados pela UI (venda fica no Auto Avaliar). Ainda existem no banco
 * por compatibilidade com o CHECK constraint histórico.
 */

export type RepasseStatus = "marcado" | "subido" | "cancelado";

/** Inclui status legacy ainda permitidos no banco (não usados pela UI nova). */
export type RepasseStatusBanco = RepasseStatus | "vendido" | "nao_vendido";

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

  criado_em: string; // ISO
  atualizado_em: string; // ISO
};

// ─── Labels pt-BR ────────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<RepasseStatus, string> = {
  marcado: "Marcado",
  subido: "Subido",
  cancelado: "Cancelado",
};

export const CANAL_LABEL: Record<string, string> = {
  auto_avaliar: "Auto Avaliar",
};

/** Opções de canal pro select. */
export const CANAIS_DISPONIVEIS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "auto_avaliar", label: "Auto Avaliar" },
] as const;
