/**
 * Normaliza placa pra forma canônica: maiúsculas, SÓ alfanumérico.
 * Tolera variações de formato (antigo "ABC-1234" ou Mercosul "ABC1D23").
 *
 * Usado em joins entre tabelas onde a mesma placa pode vir formatada de
 * formas diferentes (ex: relatório PDF do NBS salva sem hífen, mas o
 * XLSX de estoque salva com hífen).
 *
 * IMPORTANTE: remove TODO caractere não-alfanumérico (não só espaço/hífen)
 * pra bater byte-a-byte com a expressão SQL de placa normalizada usada nos
 * índices/joins do Postgres: `regexp_replace(upper(placa),'[^A-Z0-9]','','g')`
 * (Fatia 2 — importador Auto Avaliar).
 */
export function normalizarPlaca(p: string | null | undefined): string {
  if (!p) return "";
  return p.toUpperCase().replace(/[^A-Z0-9]/g, "");
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
