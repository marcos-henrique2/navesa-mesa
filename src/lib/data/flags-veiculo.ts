"use client";

/**
 * CRUD da tabela veiculos_flags — flags operacionais por veículo.
 *
 * Equivalente às checkboxes "Em Promoção" / "Brinde em Acessórios" do NBS
 * Markup de Venda. Não afeta preço/custo/classificação — é apenas sinalização
 * pra ajudar o comercial saber quais carros têm condição especial.
 *
 * Tabela por chassi (PK). Upsert seta as flags; getAll retorna o mapa
 * pra alimentar badges no estoque.
 */

import { getSupabase } from "./supabase";

export type FlagsVeiculo = {
  chassi: string;
  em_promocao: boolean;
  brinde_acessorios: boolean;
  observacao_brinde: string | null;
  atualizado_em: string;
};

export type SetFlagsArgs = {
  chassi: string;
  emPromocao: boolean;
  brindeAcessorios: boolean;
  observacaoBrinde: string | null;
};

export async function getFlagsVeiculo(chassi: string): Promise<FlagsVeiculo | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("veiculos_flags")
    .select("*")
    .eq("chassi", chassi)
    .maybeSingle();
  if (error) throw new Error(`flags-veiculo.get: ${error.message}`);
  return (data as FlagsVeiculo | null) ?? null;
}

export async function setFlagsVeiculo(args: SetFlagsArgs): Promise<FlagsVeiculo> {
  const sb = getSupabase();
  const payload = {
    chassi: args.chassi,
    em_promocao: args.emPromocao,
    brinde_acessorios: args.brindeAcessorios,
    observacao_brinde: args.observacaoBrinde,
    atualizado_em: new Date().toISOString(),
  };
  const { data, error } = await sb
    .from("veiculos_flags")
    .upsert(payload, { onConflict: "chassi" })
    .select("*")
    .single();
  if (error) throw new Error(`flags-veiculo.set: ${error.message}`);
  return data as FlagsVeiculo;
}

/** Lista TODAS as flags ativas (em_promocao OU brinde_acessorios) pra alimentar badges no estoque. */
export async function listAllFlags(): Promise<Record<string, FlagsVeiculo>> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("veiculos_flags")
    .select("*")
    .or("em_promocao.eq.true,brinde_acessorios.eq.true");
  if (error) throw new Error(`flags-veiculo.listAll: ${error.message}`);
  const out: Record<string, FlagsVeiculo> = {};
  for (const r of (data ?? []) as FlagsVeiculo[]) out[r.chassi] = r;
  return out;
}
