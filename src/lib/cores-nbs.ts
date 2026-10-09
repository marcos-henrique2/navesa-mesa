/**
 * Mapa estático COR_EXTERNA (Oracle) -> nome legível da cor.
 *
 * Origem: NBS.VEICULOS só tem COR_EXTERNA (código numérico); não existe
 * tabela de lookup "nome da cor" acessível no schema Oracle usado por esse
 * sync (usuário `comissao`) — confirmado investigando ALL_TABLES (LIKE
 * '%COR%' devolveu vazio).
 *
 * Esse mapa foi construído cruzando um export manual real do estoque (coluna
 * "Cor Externa", com o nome em texto) com os COR_EXTERNA correspondentes no
 * Oracle pros MESMOS veículos, por placa. Bateu 1.089 de 1.132 veículos
 * (96% de match) — 30 códigos distintos no estoque atual — validado em
 * 30/09/2026.
 *
 * Códigos diferentes que mapeiam pro mesmo nome (ex: 14575/1549197195/
 * 8246719 -> "CINZA") são tons específicos de fabricante que o relatório
 * manual já simplificava pro nome genérico — mesma perda de detalhe da fonte
 * original, não é erro nosso.
 */
export const MAPA_COR: Readonly<Record<string, string>> = {
  "888": "BRANCO",
  "151662": "PRETO",
  "80": "PRATA",
  "14575": "CINZA",
  "1549197195": "CINZA",
  "8246719": "CINZA",
  "89": "AZUL",
  "84": "VERMELHO",
  "66988": "VERDE",
  "151672": "MARROM",
  "79": "PRETO C/ TETO PRATA",
  "85": "CINZA STING GRAY",
  "94": "DOURADO",
  "67008": "LARANJA",
  "81": "BRANCO POLAR",
  "310": "PRATA",
  "90": "AMARELO",
  "21": "BRANCO ÁRTICO",
  "103": "BRANCA CRISTAL",
  "1549197207": "PRATA",
  "87": "BEGE",
  "88": "PRETA",
  "8246846": "PRETO",
  "8246813": "PRATA",
  "8246731": "AMARELO",
  "1549493807": "CINZA",
  "8246635": "PRATA",
  "8246714": "PRETO",
  "1549543543": "PRETO",
  "151663": "PRATA",
};

export function normalizarCorNbs(valor: unknown): string | null {
  if (typeof valor !== "string" && typeof valor !== "number") return null;
  const cor = String(valor).trim();
  if (!cor) return null;
  const codigo = cor.match(/^Cor (\d+) \(não mapeada\)$/i)?.[1] ?? cor;
  if (/^\d+$/.test(codigo)) return MAPA_COR[codigo] ?? null;
  return cor.toUpperCase();
}
