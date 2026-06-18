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

/**
 * Busca parcial de placa: normaliza ambos os lados (maiúsculas, sem hífen/
 * espaço) e testa substring. Tolerante a formato — "QKF2016" casa com
 * "QKF-2016" e "qkf" casa com ambos.
 *
 * Termo vazio casa com tudo (filtro inativo).
 */
export function placaCasa(placaCarro: string | null | undefined, termoBusca: string): boolean {
  const termo = normalizarPlaca(termoBusca);
  if (termo === "") return true;
  return normalizarPlaca(placaCarro).includes(termo);
}
