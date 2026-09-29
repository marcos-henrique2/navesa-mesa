/**
 * Parseia o campo NBS "ANO_MODELO" no formato "AA/AA" (ex: "12/13" = fabricação
 * 2012, modelo 2013) em fabricação/modelo plenos, com pivot de século:
 * yy >= 50 → 1900+yy, senão 2000+yy.
 *
 * Compartilhado entre o parser de XLSX de vendas (`nbs-vendas-xlsx.ts`) e o
 * mapeamento Oracle → VeiculoParsed/VendaParsed (`scripts/sync-nbs/`), onde
 * `NBS.VEICULOS.ANO_MODELO` é VARCHAR2 nesse mesmo formato — tratá-lo como
 * número direto (Number()) falha silenciosamente e deixa ano_fabricacao/
 * ano_modelo sempre null.
 */
export function parseAnoModelo(value: unknown): { fab: number | null; mod: number | null } {
  if (value === null || value === undefined) return { fab: null, mod: null };
  const s = String(value).trim();
  if (!s) return { fab: null, mod: null };
  const m = s.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return { fab: null, mod: null };
  const yy = (n: number) => (n >= 50 ? 1900 + n : 2000 + n);
  return { fab: yy(parseInt(m[1], 10)), mod: yy(parseInt(m[2], 10)) };
}
