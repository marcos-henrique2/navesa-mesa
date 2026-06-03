/**
 * Normaliza placa pra forma canônica: maiúsculas, sem hífens, sem espaços.
 * Tolera variações de formato (antigo "ABC-1234" ou Mercosul "ABC1D23").
 *
 * Usado em joins entre tabelas onde a mesma placa pode vir formatada de
 * formas diferentes (ex: relatório PDF do NBS salva sem hífen, mas o
 * XLSX de estoque salva com hífen).
 */
export function normalizarPlaca(p: string | null | undefined): string {
  if (!p) return "";
  return p.replace(/[\s-]/g, "").toUpperCase().trim();
}
