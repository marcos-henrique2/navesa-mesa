"use client";

/**
 * CRUD da tabela preco_alvo.
 *
 * Cada registro representa uma decisão de preço-alvo tomada pelo operador
 * no PrecificacaoBlock. Usado pra rastrear aderência: o carro foi vendido
 * no preço-alvo definido ou desviou?
 *
 * Regra de unicidade (índice parcial uniq_preco_alvo_ativo): no máximo 1
 * registro em status 'definido' por chassi. Pra trocar o alvo, revoga o
 * atual e cria um novo.
 */

import type { EstrategiaId, FonteEstrategia } from "@/components/veiculos/StrategySelector";
import { getSupabase } from "./supabase";

export type PrecoAlvoStatus = "definido" | "aplicado" | "revogado";

export type PrecoAlvoRow = {
  id: number;
  chassi: string;
  preco_alvo: number;
  estrategia: EstrategiaId;
  preco_atual_snapshot: number | null;
  margem_pct_snapshot: number | null;
  fonte: FonteEstrategia | null;
  status: PrecoAlvoStatus;
  observacao: string | null;
  versao_formula: string;
  criado_em: string;
  atualizado_em: string;
};

export type DefinirPrecoAlvoArgs = {
  chassi: string;
  precoAlvo: number;
  estrategia: EstrategiaId;
  precoAtualSnapshot: number | null;
  margemPctSnapshot: number | null;
  fonte: FonteEstrategia | null;
  versaoFormula?: string;
  observacao?: string | null;
};

/**
 * Cria um novo preço-alvo "definido" pro chassi.
 * Se já existir um ativo, revoga ele antes (em transação client-side: best-effort,
 * se o revogar falhar o caller propaga o erro do unique constraint).
 */
export async function definirPrecoAlvo(args: DefinirPrecoAlvoArgs): Promise<PrecoAlvoRow> {
  const sb = getSupabase();

  // Revoga o ativo (se houver) antes de criar o novo — evita unique violation.
  await revogarPrecoAlvo(args.chassi).catch(() => {
    // Tudo bem se não tiver ativo (no-op no revogar).
  });

  const payload = {
    chassi: args.chassi,
    preco_alvo: args.precoAlvo,
    estrategia: args.estrategia,
    preco_atual_snapshot: args.precoAtualSnapshot,
    margem_pct_snapshot: args.margemPctSnapshot,
    fonte: args.fonte,
    status: "definido" satisfies PrecoAlvoStatus,
    observacao: args.observacao ?? null,
    versao_formula: args.versaoFormula ?? "diagnostico_v2",
  };

  const { data, error } = await sb
    .from("preco_alvo")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new Error(
        "Esse veículo já tem preço-alvo ativo. Recarregue a página e tente novamente.",
      );
    }
    if (tabelaNaoExiste(error)) {
      throw new Error(
        "Tabela preco_alvo ainda não existe — rode a migration 004_preco_alvo.sql no Supabase antes de definir preço-alvo.",
      );
    }
    throw new Error(`Falha ao definir preço-alvo: ${error.message}`);
  }
  return data as PrecoAlvoRow;
}

/**
 * Tabela ainda não foi criada no Supabase (migration 004 pendente)?
 * Detecta o erro do PostgREST e degrada silenciosamente sem quebrar a UI.
 */
function tabelaNaoExiste(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST205" || /could not find the table.*preco_alvo/i.test(error.message ?? "");
}

/** Busca o preço-alvo ativo (status='definido') do chassi. Null se não houver. */
export async function buscarPrecoAlvoAtivo(chassi: string): Promise<PrecoAlvoRow | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("preco_alvo")
    .select("*")
    .eq("chassi", chassi)
    .eq("status", "definido")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (tabelaNaoExiste(error)) {
      console.warn("Tabela preco_alvo ainda não existe — rode migration 004_preco_alvo.sql no Supabase.");
      return null;
    }
    throw new Error(`buscarPrecoAlvoAtivo: ${error.message}`);
  }
  return (data as PrecoAlvoRow | null) ?? null;
}

/**
 * Revoga o preço-alvo ativo do chassi (soft delete via status='revogado').
 * No-op se não houver ativo.
 */
export async function revogarPrecoAlvo(chassi: string): Promise<void> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("preco_alvo")
    .select("id")
    .eq("chassi", chassi)
    .eq("status", "definido")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (tabelaNaoExiste(error)) {
      console.warn("Tabela preco_alvo ainda não existe — revogar é no-op.");
      return;
    }
    throw new Error(`revogarPrecoAlvo (select): ${error.message}`);
  }
  if (!data) return;
  const { error: updErr } = await sb
    .from("preco_alvo")
    .update({ status: "revogado" satisfies PrecoAlvoStatus })
    .eq("id", data.id);
  if (updErr) throw new Error(`revogarPrecoAlvo (update): ${updErr.message}`);
}
