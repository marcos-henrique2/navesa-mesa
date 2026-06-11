/**
 * Parse de valor monetário no formato BR (e variantes tolerantes).
 *
 * Por que existe:
 *   Marcos digita valores como "1.000" (mil reais) e "1.500,50". A heurística
 *   ingênua de "tira pontos, troca vírgula por ponto" quebra em "1.000" porque
 *   `Number("1.000")` retorna 1, perdendo 3 ordens de magnitude — bug crítico
 *   pra precisão financeira centavo-perfect (regra transversal do projeto).
 *
 * Heurística:
 *   - Strip de prefixo "R$" e espaços.
 *   - Rejeita notação científica ("12e10") → null. Não é entrada humana
 *     legítima nesse contexto e abre brecha pra valores absurdos.
 *   - Rejeita string vazia, NaN, infinito, negativo → null.
 *   - Caso A: contém `.` E `,` → padrão BR estrito: `.` é milhar, `,` é
 *     decimal. Exige que a vírgula apareça DEPOIS do último ponto, senão
 *     ambíguo → null. Ex: "1.234.567,89" → 1234567.89.
 *   - Caso B: contém apenas um tipo de separador (só `.` OU só `,`):
 *       - Mais de 1 separador → todos são milhar. Cada grupo após o primeiro
 *         deve ter exatamente 3 dígitos. Ex: "1.234.567" → 1234567.
 *         "12,34,56" → null (ambíguo).
 *       - Exatamente 1 separador:
 *           - Parte depois com 3 dígitos E parte antes ≤ 3 dígitos
 *             → trata como milhar. Ex: "1.000" → 1000, "12,000" → 12000.
 *           - Caso contrário → trata como decimal. Ex: "1.5" → 1.5,
 *             "1,5" → 1.5, "12.34" → 12.34, "1234.56" → 1234.56.
 *   - Caso C: sem separador → parse direto. Ex: "138500" → 138500.
 *
 * Sempre fail-safe: qualquer ambiguidade retorna null em vez de adivinhar.
 *
 * @param raw String crua digitada pelo usuário.
 * @returns Número >= 0 finito, ou null se inválido/ambíguo.
 */
export function parseValorBR(raw: string): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/^R\$\s*/i, "").replace(/\s+/g, "");
  if (s === "") return null;

  // Rejeita notação científica — não é entrada humana legítima aqui.
  if (/[eE]/.test(s)) return null;

  // Só dígitos, separadores e sinal de menos opcional no início.
  if (!/^-?[\d.,]+$/.test(s)) return null;
  // Negativo não faz sentido pra "valor pra subir".
  if (s.startsWith("-")) return null;

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  let normalizado: string;

  if (hasDot && hasComma) {
    // Padrão BR estrito: vírgula é decimal e deve vir depois do último ponto.
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastComma < lastDot) return null; // formato us "1,234.56" — ambíguo aqui
    // Só pode haver UMA vírgula (decimal).
    if (s.indexOf(",") !== lastComma) return null;
    const intPart = s.slice(0, lastComma);
    const decPart = s.slice(lastComma + 1);
    // Decimal tem que ter 1-2 dígitos (centavos), milhares 3 em cada grupo.
    if (!/^\d{1,2}$/.test(decPart)) return null;
    const intGroups = intPart.split(".");
    // Primeiro grupo 1-3 dígitos, demais exatamente 3.
    if (intGroups.length < 2) return null;
    if (!/^\d{1,3}$/.test(intGroups[0])) return null;
    for (let i = 1; i < intGroups.length; i++) {
      if (!/^\d{3}$/.test(intGroups[i])) return null;
    }
    normalizado = intGroups.join("") + "." + decPart;
  } else if (hasDot || hasComma) {
    const sep = hasDot ? "." : ",";
    const partes = s.split(sep);
    if (partes.length === 2) {
      const [antes, depois] = partes;
      if (antes === "" || depois === "") return null;
      if (!/^\d+$/.test(antes) || !/^\d+$/.test(depois)) return null;
      // Milhar: ".000" tem que vir depois de até 3 dígitos.
      if (depois.length === 3 && antes.length >= 1 && antes.length <= 3) {
        normalizado = antes + depois;
      } else {
        // Decimal: até 2 casas pra centavos é o esperado, mas aceitamos
        // até 4 pra ser tolerante (ex: cotação). Mais que isso é suspeito.
        if (depois.length > 4) return null;
        normalizado = antes + "." + depois;
      }
    } else {
      // 3+ grupos: todos devem ser milhar.
      // Primeiro grupo 1-3 dígitos, demais exatamente 3.
      if (!/^\d{1,3}$/.test(partes[0])) return null;
      for (let i = 1; i < partes.length; i++) {
        if (!/^\d{3}$/.test(partes[i])) return null;
      }
      normalizado = partes.join("");
    }
  } else {
    // Sem separador.
    if (!/^\d+$/.test(s)) return null;
    normalizado = s;
  }

  const n = Number(normalizado);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
