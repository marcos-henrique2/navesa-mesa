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

/** Data de HOJE (ou de `d`) no fuso local, em YYYY-MM-DD. */
export function hojeLocal(d: Date = new Date()): string {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
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
