"use client";

/**
 * VENDAS USADOS MATRIZ — orquestrador final: monta as 9 abas (ExcelJS) e devolve o Blob
 * pronto pra download, seguindo o mesmo padrão de `analise-navesa.ts`.
 */

import ExcelJS from "exceljs";
import { nomesAbas, type ColetarVendasMatrizInput } from "./tipos";
import { renderAbaDetalhe } from "./aba-detalhe";
import { renderAbaResumo } from "./aba-resumo";
import { renderAbaMargens } from "./aba-margens";
import { renderAbaMediaVendedor2025, renderAbaMediaVendedorAtual } from "./aba-media-vendedor";
import { renderAbaPlayPlan } from "./aba-play-plan";
import { coletarVendasMatriz, type ColetarVendasMatrizResult } from "./coletar-dados";

export async function gerarVendasMatrizWorkbook(
  dados: ColetarVendasMatrizResult,
  input: ColetarVendasMatrizInput,
): Promise<Blob> {
  const { codEmpresa, mes, ano } = input;
  const nomes = nomesAbas(mes, ano);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Navesa Mesa";
  workbook.created = new Date();

  const linhasAba1 = dados.linhasMes;
  // Aba 2 = só estoque próprio: exclui repasse de outras lojas (loja de origem !== a
  // loja do relatório). Linhas com origem desconhecida também ficam de fora — não dá
  // pra afirmar "é estoque próprio" sem saber a origem.
  const linhasAba2 = linhasAba1.filter((l) => l.lojaOrigemCodEmpresa === codEmpresa);

  const ws1 = workbook.addWorksheet(nomes.aba1);
  renderAbaDetalhe(ws1, nomes.aba1, linhasAba1);

  const ws2 = workbook.addWorksheet(nomes.aba2);
  renderAbaDetalhe(ws2, nomes.aba2, linhasAba2);

  const ws3 = workbook.addWorksheet(nomes.aba3);
  renderAbaResumo(ws3, nomes.aba1, linhasAba1);

  const ws4 = workbook.addWorksheet(nomes.aba4);
  renderAbaMargens(ws4, {
    titulo: nomes.aba4,
    nomeAbaFonte: nomes.aba1,
    linhasFonte: linhasAba1,
    filtroLojista: undefined,
  });

  const ws5 = workbook.addWorksheet(nomes.aba5);
  renderAbaMargens(ws5, {
    titulo: nomes.aba5,
    nomeAbaFonte: nomes.aba2,
    linhasFonte: linhasAba2,
    filtroLojista: "sim",
  });

  const ws6 = workbook.addWorksheet(nomes.aba6);
  renderAbaMargens(ws6, {
    titulo: nomes.aba6,
    nomeAbaFonte: nomes.aba2,
    linhasFonte: linhasAba2,
    filtroLojista: "nao",
  });

  const ws7 = workbook.addWorksheet(nomes.aba7);
  renderAbaMediaVendedor2025(ws7);

  const ws8 = workbook.addWorksheet(nomes.aba8);
  renderAbaMediaVendedorAtual(ws8, dados.anoAtual, dados.mesAtualIndex, dados.vendasAnoAtual);

  const ws9 = workbook.addWorksheet(nomes.aba9);
  renderAbaPlayPlan(ws9);

  return workbookParaBlob(workbook);
}

/**
 * Busca os dados, gera o workbook e dispara o download no browser — atalho pra tela.
 */
export async function baixarVendasMatrizWorkbook(input: ColetarVendasMatrizInput): Promise<void> {
  const dados = await coletarVendasMatriz(input);
  const blob = await gerarVendasMatrizWorkbook(dados, input);
  const nomes = nomesAbas(input.mes, input.ano);

  const url = URL.createObjectURL(blob);
  const slug = nomes.aba1
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const fileName = `${slug}.xlsx`;

  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ═══════════════════════════════════════════════════════════════════════════
// Blob (mesma conversão de analise-navesa.ts — ExcelJS devolve ArrayBuffer no
// browser e Buffer/Uint8Array em Node).
// ═══════════════════════════════════════════════════════════════════════════

async function workbookParaBlob(workbook: ExcelJS.Workbook): Promise<Blob> {
  const buf = await workbook.xlsx.writeBuffer();
  const bufUnknown: unknown = buf;
  const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  if (bufUnknown instanceof ArrayBuffer) {
    return new Blob([bufUnknown], { type: MIME });
  }
  if (bufUnknown instanceof Uint8Array) {
    const copy = new ArrayBuffer(bufUnknown.byteLength);
    new Uint8Array(copy).set(bufUnknown);
    return new Blob([copy], { type: MIME });
  }
  throw new Error("ExcelJS writeBuffer não retornou ArrayBuffer/Uint8Array");
}
