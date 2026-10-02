"use client";

/**
 * VENDAS USADOS MATRIZ — orquestrador final: monta as 9 abas (ExcelJS) e devolve o Blob
 * pronto pra download, seguindo o mesmo padrão de `analise-navesa.ts`.
 */

import ExcelJS from "exceljs";
import { nomesAbas, nomeMesExtenso, type ColetarVendasMatrizInput } from "./tipos";
import { renderAbaDetalhe } from "./aba-detalhe";
import { renderAbaResumo } from "./aba-resumo";
import { renderAbaMargens, type CriterioMargens } from "./aba-margens";
import { COL } from "./colunas";
import { renderAbaMediaVendedor2025, renderAbaMediaVendedorAtual } from "./aba-media-vendedor";
import { renderAbaPlayPlan } from "./aba-play-plan";
import { coletarVendasMatriz, type ColetarVendasMatrizResult } from "./coletar-dados";
import { COR_BANNER_N1_BG, COR_PROPRIO_BG, COR_REPASSE_BG } from "./estilo";

// Paleta de banners das abas 4/5/6 — convenção fixada nesta refatoração:
// navy = total sem filtro (nível 1); petróleo = estoque/origem própria (nível 2);
// terracota = outras lojas/repasse (nível 2).
const COR_BANNER_NAVY = COR_BANNER_N1_BG;
const COR_BANNER_VERDE = COR_PROPRIO_BG;
const COR_BANNER_VERMELHO = COR_REPASSE_BG;

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
  const nomeLojaPropria = dados.nomeLojaPropria;

  const ws1 = workbook.addWorksheet(nomes.aba1);
  renderAbaDetalhe(ws1, nomes.aba1, linhasAba1);

  const ws2 = workbook.addWorksheet(nomes.aba2);
  renderAbaDetalhe(ws2, nomes.aba2, linhasAba2);

  const ws3 = workbook.addWorksheet(nomes.aba3);
  renderAbaResumo(ws3, { nomeAba1: nomes.aba1, linhasAba1, nomeMes: nomeMesExtenso(mes) });

  // Critérios reutilizáveis: "origem é a loja própria" / "origem é outra loja conhecida"
  // (comparando pelo NOME da coluna C — a aba de detalhe não tem coluna de cod_empresa).
  const criteriosOrigemPropria: CriterioMargens[] = [{ col: COL.C_LOJA_ORIGEM, criterio: nomeLojaPropria }];
  const criteriosOrigemOutras: CriterioMargens[] = [
    { col: COL.C_LOJA_ORIGEM, criterio: `<>${nomeLojaPropria}` },
    { col: COL.C_LOJA_ORIGEM, criterio: "<>(origem desconhecida)" },
  ];
  const criterioLojistaSim: CriterioMargens = { col: COL.AF_LOJISTA, criterio: "SIM" };
  const criterioLojistaNao: CriterioMargens = { col: COL.AF_LOJISTA, criterio: "NÃO" };

  const linhasOrigemOutras = linhasAba1.filter(
    (l) => l.lojaOrigemCodEmpresa != null && l.lojaOrigemCodEmpresa !== codEmpresa,
  );

  // ─── Aba 4 "MARGENS" — 3 blocos sobre a aba 1 inteira (todas as origens) ───
  const ws4 = workbook.addWorksheet(nomes.aba4);
  renderAbaMargens(ws4, {
    nomeAbaFonte: nomes.aba1,
    totalLinhasFonte: linhasAba1.length,
    blocos: [
      {
        titulo: "VENDIDO TOTAL NAVESA AEROPORTO",
        nivel: 1,
        corBg: COR_BANNER_NAVY,
        linhas: linhasAba1,
        criterios: [],
      },
      {
        titulo: "VENDIDO SOMENTE ESTOQUE NAVESA AEROPORTO",
        nivel: 2,
        corBg: COR_BANNER_VERDE,
        linhas: linhasAba2,
        criterios: criteriosOrigemPropria,
      },
      {
        titulo: "VENDIDO NAVESA - ESTOQUES OUTRAS LOJAS",
        nivel: 2,
        corBg: COR_BANNER_VERMELHO,
        linhas: linhasOrigemOutras,
        criterios: criteriosOrigemOutras,
      },
    ],
  });

  // ─── Aba 5 "MARGENS VENDAS LOJISTAS" — 2 blocos, lojista=SIM sobre a aba 1 INTEIRA
  // (não o subconjunto de origem própria — diferente da versão anterior).
  //
  // NOTA IMPORTANTE: linhas com `lojista === null` (tipo de cliente desconhecido — nem PJ
  // confirmado nem PF confirmado) ficam de PROPÓSITO fora das abas 5 (LOJISTAS, filtro
  // `lojista === true`) e 6 (CLIENTES, filtro `lojista === false`) — elas não são nem uma
  // coisa nem outra, então não fazem parte de nenhum bloco de nenhuma das duas abas. Por
  // causa disso, a soma dos blocos da aba 5 + aba 6 pode NÃO bater com o total da aba 4
  // "VENDIDO TOTAL NAVESA AEROPORTO" (que soma a aba 1 inteira, incluindo `lojista=null`)
  // sempre que existirem vendas com `lojista=null` no período. Isso é esperado, não é bug
  // — essas linhas aparecem contabilizadas explicitamente no Bloco C ("NÃO INFORMADO") da
  // aba 3 RESUMO (ver aba-resumo.ts). ───
  const linhasLojistaOutras = linhasAba1.filter(
    (l) => l.lojista === true && l.lojaOrigemCodEmpresa != null && l.lojaOrigemCodEmpresa !== codEmpresa,
  );
  const linhasLojistaPropria = linhasAba1.filter((l) => l.lojista === true && l.lojaOrigemCodEmpresa === codEmpresa);

  const ws5 = workbook.addWorksheet(nomes.aba5);
  renderAbaMargens(ws5, {
    nomeAbaFonte: nomes.aba1,
    totalLinhasFonte: linhasAba1.length,
    blocos: [
      {
        titulo: "VENDIDO REPASSE OUTROS ESTOQUES",
        nivel: 2,
        corBg: COR_BANNER_VERMELHO,
        linhas: linhasLojistaOutras,
        criterios: [criterioLojistaSim, ...criteriosOrigemOutras],
      },
      {
        titulo: "VENDIDO REPASSE ESTOQUE NAVESA",
        nivel: 2,
        corBg: COR_BANNER_VERDE,
        linhas: linhasLojistaPropria,
        criterios: [criterioLojistaSim, ...criteriosOrigemPropria],
      },
    ],
  });

  // ─── Aba 6 "MARGENS VENDAS CLIENTES" — 2 blocos, lojista=NÃO sobre a aba 1 inteira.
  // Mesma nota da aba 5: `lojista=null` fica de fora daqui também, de propósito. ───
  const linhasClientePropria = linhasAba1.filter((l) => l.lojista === false && l.lojaOrigemCodEmpresa === codEmpresa);
  const linhasClienteOutras = linhasAba1.filter(
    (l) => l.lojista === false && l.lojaOrigemCodEmpresa != null && l.lojaOrigemCodEmpresa !== codEmpresa,
  );

  const ws6 = workbook.addWorksheet(nomes.aba6);
  renderAbaMargens(ws6, {
    nomeAbaFonte: nomes.aba1,
    totalLinhasFonte: linhasAba1.length,
    blocos: [
      {
        titulo: "VENDIDO CLIENTE FINAL ESTOQUE NAVESA",
        nivel: 2,
        corBg: COR_BANNER_VERDE,
        linhas: linhasClientePropria,
        criterios: [criterioLojistaNao, ...criteriosOrigemPropria],
      },
      {
        titulo: "VENDIDO CLIENTE FINAL OUTROS ESTOQUES",
        nivel: 2,
        corBg: COR_BANNER_VERMELHO,
        linhas: linhasClienteOutras,
        criterios: [criterioLojistaNao, ...criteriosOrigemOutras],
      },
    ],
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
