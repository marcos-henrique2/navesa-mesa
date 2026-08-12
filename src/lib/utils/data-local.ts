/**
 * Datas no fuso LOCAL do usuário — sem I/O, sem dependência, 100% testável.
 *
 * ⚠️ NUNCA use `new Date().toISOString().slice(0, 10)` pra representar "hoje".
 * `toISOString()` devolve UTC. Em Brasília (UTC−3), das 21h à meia-noite o UTC
 * já virou o dia seguinte — então um contato feito hoje às 22h era gravado como
 * amanhã. Num sistema cuja métrica principal é "dias parados", isso corrompe
 * dado em silêncio: ninguém vê o erro, ele só desloca o número.
 *
 * `toISOString()` continua correto pra TIMESTAMP técnico (criado_em,
 * atualizado_em, filtro de range em timestamptz) — ali o instante absoluto é
 * exatamente o que se quer. O problema é só quando o valor representa um DIA
 * do calendário do usuário.
 */

/** Fuso do negócio. A Navesa é em Goiânia; o calendário do Marcos é este. */
export const FUSO_BRASILIA = "America/Sao_Paulo";

const FMT_BRASILIA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_BRASILIA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Data de HOJE (ou de `d`) no calendário de BRASÍLIA, em YYYY-MM-DD.
 *
 * ⚠️ O fuso é FIXO, não o do processo. Antes esta função usava
 * `getFullYear/getMonth/getDate`, que respondem no fuso de quem está rodando.
 * Isso funcionava por acidente: todos os call sites são `"use client"`, então o
 * processo era o navegador do Marcos e o fuso do processo *era* o dele. No dia
 * em que alguém chamasse isto de um route handler, na Vercel (UTC), a data
 * sairia um dia à frente das 21h em diante — e o sintoma só apareceria à noite,
 * passando em todo teste local. Fixar `America/Sao_Paulo` fecha a armadilha
 * (Story 2.2, Risco R2).
 *
 * ⚠️ Isto NÃO autoriza gravar data de calendário calculada em TypeScript no
 * servidor: o caminho correto continua sendo `public.hoje_brasilia()` no banco
 * (AC16). Esta função é para exibição e para o cliente.
 */
export function hojeLocal(d: Date = new Date()): string {
  const partes = FMT_BRASILIA.formatToParts(d);
  const get = (tipo: Intl.DateTimeFormatPartTypes): string =>
    partes.find((p) => p.type === tipo)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Formata um DATE do Postgres (YYYY-MM-DD) como DD/MM/AAAA.
 *
 * Faz split de string em vez de `new Date(iso)` de propósito: o construtor
 * interpreta "2026-08-06" como meia-noite UTC e, ao formatar no fuso local
 * negativo, devolveria 05/08. Entrada inválida vira "—".
 */
export function formatarDataBR(iso: string | null | undefined): string {
  if (typeof iso !== "string") return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "—";
  return `${m[3]}/${m[2]}/${m[1]}`;
}
