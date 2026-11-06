/**
 * Contrato HTTP navesa-mesa ↔ cérebro (doc §3). Validado com Zod.
 */
import { z } from "zod";
import type { Perfil } from "@cerebro/perfis";

export const LIMITE_CORPO_BYTES = 32 * 1024;
export const MAX_MENSAGENS = 30;

const dataBR = z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, "use dd/mm/aaaa");

export const PedidoChatSchema = z
  .object({
    messages: z
      .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(16_000) }).strict())
      .min(1)
      .max(MAX_MENSAGENS)
      .refine((ms) => ms.length > 0 && ms[ms.length - 1].role === "user", "a última mensagem deve ser do usuário")
      .refine((ms) => ms.length > 0 && ms[ms.length - 1].content.trim().length > 0, "a última mensagem está vazia"),
    periodo: z.object({ inicio: dataBR.nullable(), fim: dataBR.nullable() }).strict().nullable().optional(),
    contexto: z
      .object({ pagina: z.string().max(200).optional(), loja: z.number().int().optional() })
      .strict()
      .nullable()
      .optional(),
    /** Informativo. O perfil de ferramentas vem do token, nunca daqui. */
    canal: z.string().max(20).optional(),
    /** "rapido" = Haiku (default), "avancado" = Sonnet (sob demanda). */
    modelo: z.enum(["rapido", "avancado"]).optional(),
  })
  .strict();

export type PedidoChat = z.infer<typeof PedidoChatSchema>;

/** Eventos que o executor (agente) produz; o servidor os serializa em SSE. */
export type EventoAgente =
  | { tipo: "tool"; nome: string; fase: "inicio" | "fim"; ms?: number }
  | { tipo: "delta"; texto: string }
  | { tipo: "done"; turns: number; duracaoMs: number; usage?: { entrada: number; saida: number } };

export type ExecutorChat = (args: {
  pedido: PedidoChat;
  perfil: Perfil;
  requestId: string;
  signal: AbortSignal;
}) => { modelo: string; eventos: AsyncIterable<EventoAgente> };
