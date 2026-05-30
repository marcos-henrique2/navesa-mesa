/**
 * IMPORT DE CAUTELAR de planilha externa (ex: USADOS ANALISE NAVESA.xlsx).
 *
 * Detecta automaticamente colunas PLACA e CAUTELAR em qualquer sheet do XLSX.
 * Normaliza valores soltos:
 *   "aprovado" / "OK" / "ok"                       → "aprovado"
 *   "reprovado" / "reprov."                        → "reprovado"
 *   "com restrição" / "com restricao" / "restrito" → "com_restricao"
 *   "sem laudo" / "pendente" / "n/d"               → null (não importa)
 */

import * as XLSX from "xlsx";
import type { StatusCautelar } from "./cautelar";

export type ImportResult = {
  placas: Record<string, StatusCautelar>;
  ignorados: number; // placas que não tinham cautelar mapeável
  sheetsLidas: string[];
};

function normCol(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

function normStatus(raw: unknown): StatusCautelar | null {
  if (raw == null) return null;
  const s = String(raw)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  if (!s) return null;
  if (/^(aprovado|ok|aprov)/.test(s)) return "aprovado";
  if (/^(reprovado|reprov|negado)/.test(s)) return "reprovado";
  if (/(restric|restrit|restrição|com restric)/.test(s)) return "com_restricao";
  return null;
}

/** Encontra a linha de header que tem PLACA e CAUTELAR. */
function acharHeader(rows: unknown[][]): { idx: number; placaCol: number; cautelarCol: number } | null {
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const row = rows[i] ?? [];
    let placaCol = -1, cautelarCol = -1;
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (v == null) continue;
      const n = normCol(String(v));
      if (n === "PLACA" && placaCol === -1) placaCol = c;
      if (n === "CAUTELAR" && cautelarCol === -1) cautelarCol = c;
    }
    if (placaCol >= 0 && cautelarCol >= 0) {
      return { idx: i, placaCol, cautelarCol };
    }
  }
  return null;
}

/**
 * Processa um buffer de XLSX e retorna o mapa placa → cautelar.
 * Varre TODAS as sheets do arquivo procurando colunas PLACA + CAUTELAR.
 */
export async function importarCautelaresDeXlsx(buf: ArrayBuffer): Promise<ImportResult> {
  const wb = XLSX.read(buf, { type: "array" });
  const placas: Record<string, StatusCautelar> = {};
  let ignorados = 0;
  const sheetsLidas: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, raw: true });
    const headerInfo = acharHeader(rows);
    if (!headerInfo) continue;
    sheetsLidas.push(sheetName);

    for (let i = headerInfo.idx + 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const placa = row[headerInfo.placaCol];
      const cautelar = row[headerInfo.cautelarCol];
      if (placa == null || placa === "") continue;
      const placaStr = String(placa).trim().toUpperCase();
      if (!placaStr) continue;
      const status = normStatus(cautelar);
      if (status) {
        placas[placaStr] = status;
      } else {
        ignorados++;
      }
    }
  }

  return { placas, ignorados, sheetsLidas };
}
