"use client";

import { getSupabase, selectAll } from "./supabase";

export type ChatPapel = "user" | "assistant";

export type ChatMessageRow = {
  id: number;
  papel: ChatPapel;
  conteudo: string;
  criada_em: string;
};

export type ChatMessage = {
  id?: number;
  role: ChatPapel;
  content: string;
  criadaEm?: string;
};

function fromRow(r: ChatMessageRow): ChatMessage {
  return { id: r.id, role: r.papel, content: r.conteudo, criadaEm: r.criada_em };
}

export async function listChatMessages(): Promise<ChatMessage[]> {
  const sb = getSupabase();
  const rows = await selectAll<ChatMessageRow>(sb, "chat_messages", { orderBy: "id" });
  return rows.map(fromRow);
}

export async function inserirMensagem(papel: ChatPapel, conteudo: string): Promise<number> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("chat_messages")
    .insert({ papel, conteudo })
    .select("id")
    .single();
  if (error) throw new Error(`inserirMensagem: ${error.message}`);
  return data.id as number;
}

export async function atualizarConteudo(id: number, conteudo: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("chat_messages").update({ conteudo }).eq("id", id);
  if (error) throw new Error(`atualizarConteudo: ${error.message}`);
}

export async function deleteMensagem(id: number): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("chat_messages").delete().eq("id", id);
  if (error) throw new Error(`deleteMensagem: ${error.message}`);
}

export async function clearChatMessages(): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("chat_messages").delete().gt("id", 0);
  if (error) throw new Error(`clearChatMessages: ${error.message}`);
}

export async function contarChatMessages(): Promise<number> {
  const sb = getSupabase();
  const { count, error } = await sb.from("chat_messages").select("*", { count: "exact", head: true });
  if (error) throw new Error(`contarChatMessages: ${error.message}`);
  return count ?? 0;
}
