/**
 * Testes do parser do relatório "Vendas Concluídas" do Auto Avaliar (migration 036).
 *
 * A fixture é OFUSCADA e MONTADA AQUI, em código, com o próprio SheetJS. O
 * arquivo real do Marcos tem placa, chassi, valor e NOME DE COMPRADOR de verdade
 * e não vai pro repo — nem como binário. Montar a planilha no teste tem dois
 * ganhos além disso: o conteúdo fica legível no diff (um .xlsx é um ZIP opaco em
 * code review) e cada caso de borda vira uma linha nomeada em vez de uma célula
 * escondida dentro de um blob.
 *
 * A fixture preserva a ESTRUTURA do original, que é o que o parser depende:
 *   • linha 1 = título "Dados Vendas Concluidas", linha 2 = cabeçalho, dados na 3;
 *   • as 32 colunas na ordem real, incluindo as que o parser IGNORA de propósito
 *     (Lucro R$, Lucro %, Comprador, CNPJ/CPF, Telefones, Cidade/UF);
 *   • dinheiro como TEXTO pt-BR ("125.000,00") e TAC com prefixo ("R$ 999,00");
 *   • datas como "DD/MM/AAAA HH:MM:SS";
 *   • `Gastos Previstos` como CÉLULA NUMÉRICA (é assim no arquivo real);
 *   • uma linha de outra loja;
 *   • a LINHA DE RODAPÉ com os totais, sem placa e sem chassi.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  gastoObservado,
  dataObservada,
  mensagemErroVendas,
  montarPayloadVendas,
  parseAutoAvaliarVendasXlsx,
  LOJA_ALVO_VENDAS,
  MAX_LINHAS_VENDAS,
  type ItemPayloadVendas,
  type LinhaVendaAA,
  type VendasParseOk,
} from "@/lib/parsers/auto-avaliar-vendas-xlsx";

const NOME_ARQUIVO = "vendasAutoAvaliar.xlsx";
const OUTRA_LOJA = "NAVESA - GO/AP DE GOIÂNIA";

/** Cabeçalho real do relatório, na ordem real. Índices 0..31. */
const HEADER = [
  "Avaliação", "Anunciante", "Usuario Responsavel", "CNPJ Anunciante", "Bandeira",
  "Placa", "Veículos", "Chassi", "Ano Fab./Modelo", "Data Publicação",
  "Data Finalização", "Data Venda", "Valor Compra", "Valor Vendido", "Gastos Previstos",
  "Lucro R$", "Lucro %", "Qtde Avaliações", "Tipo Venda", "Usuario Oferta",
  "Comprador", "CNPJ/CPF", "Telefones", "Cidade/UF", "Dias Falta Pgto",
  "TAC Pago", "Valor TAC", "TED Pago", "Valor TED", "Data Avaliação 1",
  "Valor Inicial", "Valor Compre Por",
];

type CelulaFixture = string | number | null;

type Venda = {
  loja?: string;
  placa: string;
  modelo?: string;
  chassi?: string;
  publicacao?: string;
  venda?: string;
  compra?: string;
  vendido?: string;
  /** Numérico de propósito: é assim que o XLSX real guarda esta coluna. */
  gastos?: number | string;
  tac?: string;
};

function linha(v: Venda): CelulaFixture[] {
  const row: CelulaFixture[] = new Array(HEADER.length).fill(null);
  row[0] = 10000001;
  row[1] = v.loja ?? LOJA_ALVO_VENDAS;
  row[4] = "MARCA";
  row[5] = v.placa;
  row[6] = v.modelo ?? "MODELO TESTE 1.0 16V FLEX 4P";
  row[7] = v.chassi ?? null;
  row[8] = "2020/2021";
  row[9] = v.publicacao ?? "01/06/2026 10:00:00";
  row[10] = "02/06/2026 15:00:00";
  row[11] = v.venda ?? "02/06/2026 16:00:00";
  row[12] = v.compra ?? "50.000,00";
  row[13] = v.vendido ?? "60.000,00";
  row[14] = v.gastos === undefined ? 0 : v.gastos;
  // Colunas que o parser IGNORA de propósito — presentes justamente pra provar isso.
  row[15] = "10.000,00";
  row[16] = "20,00";
  row[20] = "COMPRADOR QUE NAO PODE VAZAR";
  row[21] = "12345678000199";
  row[22] = "(62) 900000000";
  row[23] = "Goiânia/GO";
  row[26] = v.tac ?? "R$ 999,00";
  return row;
}

/** Rodapé de totais do relatório: sem placa, sem chassi, com dinheiro nas colunas. */
function rodapeTotais(): CelulaFixture[] {
  const row: CelulaFixture[] = new Array(HEADER.length).fill(null);
  row[12] = "R$ 1.736.691,00";
  row[13] = "R$ 1.887.300,00";
  row[14] = "R$ 13.350,00";
  return row;
}

/** Índice da coluna "Gastos Previstos" no cabeçalho real. */
const COL_GASTOS = HEADER.indexOf("Gastos Previstos");

/**
 * `formatoGastos` carimba um número-formato na célula de gastos da linha de dados
 * indicada (0-based). É o que permite fazer o texto EXIBIDO divergir do valor
 * gravado, e assim provar de qual dos dois o parser lê.
 */
function planilha(
  linhas: CelulaFixture[][],
  opcoes: { titulo?: string; formatoGastos?: Record<number, string> } = {},
): ArrayBuffer {
  const aoa: CelulaFixture[][] = [[opcoes.titulo ?? "Dados Vendas Concluidas"], HEADER, ...linhas];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (const [k, z] of Object.entries(opcoes.formatoGastos ?? {})) {
    // +2: linha 0 é o título, linha 1 é o cabeçalho.
    const addr = XLSX.utils.encode_cell({ r: Number(k) + 2, c: COL_GASTOS });
    const celula: XLSX.CellObject | undefined = ws[addr];
    if (celula) celula.z = z;
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Vendas");
  const out: ArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return out;
}

/** Fixture padrão: 4 vendas da Matriz + 1 de outra loja + rodapé de totais. */
const VENDAS_MATRIZ: Venda[] = [
  { placa: "AAA1A11", chassi: "9BW11111111111111", compra: "125.000,00", vendido: "122.500,00", gastos: 0 },
  { placa: "BBB2B22", chassi: "9BW22222222222222", compra: "36.000,00", vendido: "38.950,00", gastos: 1250 },
  { placa: "CCC-3C33", chassi: "9BW33333333333333", compra: "215.000,00", vendido: "223.000,00", gastos: 8000, tac: "R$ 499,50" },
  { placa: "DDD4D44", chassi: "9BW44444444444444", compra: "61.000,00", vendido: "67.600,00", gastos: 600 },
];

const N_MATRIZ = VENDAS_MATRIZ.length;

function fixture(): ArrayBuffer {
  return planilha([
    ...VENDAS_MATRIZ.map(linha),
    linha({ loja: OUTRA_LOJA, placa: "ZZZ9Z99", chassi: "9BW99999999999999" }),
    rodapeTotais(),
  ]);
}

function ok(buf: ArrayBuffer): VendasParseOk {
  const r = parseAutoAvaliarVendasXlsx(buf, NOME_ARQUIVO);
  assert.equal(r.ok, true, "esperava parse ok");
  return r as VendasParseOk;
}

function porPlaca(linhas: LinhaVendaAA[], norm: string): LinhaVendaAA {
  const l = linhas.find((x) => x.placa_norm === norm);
  assert.ok(l, `placa ${norm} não encontrada`);
  return l;
}

/** Item do payload pelo chassi — o payload não guarda a placa normalizada. */
function itemPorChassi(linhas: LinhaVendaAA[], chassi: string): ItemPayloadVendas {
  const item = montarPayloadVendas(linhas).linhas.find((p) => p.chassi === chassi);
  assert.ok(item, `chassi ${chassi} não encontrado no payload`);
  return item;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("parseAutoAvaliarVendasXlsx — leitura da fixture", () => {
  it("acha o cabeçalho na linha 2 (linha 1 é o título) e lê todas as vendas", () => {
    const r = ok(fixture());
    assert.equal(r.meta.total_loja_alvo, N_MATRIZ);
    assert.equal(r.meta.total_outra_loja, 1);
    assert.equal(r.meta.total_linhas, N_MATRIZ + 1);
    assert.equal(r.linhas.length, N_MATRIZ);
  });

  it("reporta o nº da linha como o usuário conta no Excel (1-based)", () => {
    const r = ok(fixture());
    // título=1, cabeçalho=2, primeira venda=3
    assert.equal(r.linhas[0].linha, 3);
    assert.equal(r.linhas[N_MATRIZ - 1].linha, 3 + N_MATRIZ - 1);
  });

  it("aceita Uint8Array e ArrayBuffer com o mesmo resultado", () => {
    const buf = fixture();
    const a = ok(buf);
    const b = parseAutoAvaliarVendasXlsx(new Uint8Array(buf), NOME_ARQUIVO);
    assert.equal(b.ok, true);
    assert.deepEqual((b as VendasParseOk).linhas, a.linhas);
  });

  it("carrega o nome do arquivo no meta", () => {
    assert.equal(ok(fixture()).meta.arquivo_nome, NOME_ARQUIVO);
  });
});

describe("rodapé de totais não vira venda fantasma", () => {
  it("descarta a linha sem placa E sem chassi, e conta em meta", () => {
    const r = ok(fixture());
    assert.equal(r.meta.total_sem_identificacao, 1);
    // 1.736.691 é o total do rodapé: não pode ter virado valor_compra de ninguém.
    assert.ok(
      r.linhas.every((l) => (l.valor_compra ?? 0) < 1_000_000),
      "o total do rodapé vazou pra dentro de uma venda",
    );
  });

  it("rodapé não entra no payload", () => {
    const r = ok(fixture());
    assert.equal(montarPayloadVendas(r.linhas).linhas.length, N_MATRIZ);
  });
});

describe("filtro de loja (mesma régua do import de ofertas)", () => {
  it("só a Matriz vira linha; o resto vai pra lista visível", () => {
    const r = ok(fixture());
    assert.ok(r.linhas.every((l) => l.loja === LOJA_ALVO_VENDAS));
    assert.equal(r.outra_loja.length, 1);
    assert.equal(r.outra_loja[0].placa_norm, "ZZZ9Z99");
    assert.equal(r.outra_loja[0].loja, OUTRA_LOJA);
  });

  it("a loja de outro lugar aparece em lojas_encontradas", () => {
    const r = ok(fixture());
    assert.ok(r.meta.lojas_encontradas.includes(OUTRA_LOJA));
    assert.ok(r.meta.lojas_encontradas.includes(LOJA_ALVO_VENDAS));
  });

  it("outra loja NÃO entra no payload que vai pra RPC", () => {
    const r = ok(fixture());
    const placas = montarPayloadVendas(r.linhas).linhas.map((l) => l.placa);
    assert.ok(!placas.some((p) => p.includes("ZZZ")));
  });
});

describe("mapeamento de coluna → campo", () => {
  it("lê placa, chassi, modelo, datas e valores da linha certa", () => {
    const l = porPlaca(ok(fixture()).linhas, "BBB2B22");
    assert.equal(l.chassi, "9BW22222222222222");
    assert.equal(l.modelo, "MODELO TESTE 1.0 16V FLEX 4P");
    assert.equal(l.data_publicacao, "2026-06-01");
    assert.equal(l.data_venda, "2026-06-02");
    assert.equal(l.valor_compra, 36000);
    assert.equal(l.valor_vendido, 38950);
  });

  it("normaliza placa com hífen igual à expressão do índice SQL", () => {
    const r = ok(fixture());
    const l = porPlaca(r.linhas, "CCC3C33");
    assert.equal(l.placa_raw, "CCC-3C33");
  });

  it("placa vai CRUA no payload — quem normaliza é a RPC", () => {
    assert.equal(itemPorChassi(ok(fixture()).linhas, "9BW33333333333333").placa, "CCC-3C33");
  });
});

describe("Gastos Previstos — a armadilha que não pode voltar", () => {
  it("célula numérica 1250 vira 1250, não 12500", () => {
    const l = porPlaca(ok(fixture()).linhas, "BBB2B22");
    assert.equal(l.gastos, 1250);
  });

  it("célula numérica 600 vira 600 (o caso QTQ0226 do arquivo real)", () => {
    const l = porPlaca(ok(fixture()).linhas, "DDD4D44");
    assert.equal(l.gastos, 600);
  });

  it("gasto 0 vira null — nunca 0, pra RPC não apagar gasto existente", () => {
    const l = porPlaca(ok(fixture()).linhas, "AAA1A11");
    assert.equal(l.gastos, null);
  });

  // O núcleo do bug: "1250.0" e "600.0" são NÚMERO PURO (ponto = decimal).
  // Passar isso pelo parser pt-BR trata o ponto como milhar em alguns formatos e
  // multiplica o custo por 10.
  it("string '1250.0' vira 1250 (ponto é DECIMAL, não milhar)", () => {
    assert.equal(gastoObservado("1250.0"), 1250);
  });

  it("string '600.0' vira 600", () => {
    assert.equal(gastoObservado("600.0"), 600);
  });

  it("string '12.500' (número puro) vira 12.5, NÃO 12500", () => {
    assert.equal(gastoObservado("12.500"), 12.5);
  });

  it("string COM vírgula é pt-BR de verdade: '1.250,00' vira 1250", () => {
    assert.equal(gastoObservado("1.250,00"), 1250);
  });

  it("number puro atravessa direto", () => {
    assert.equal(gastoObservado(1250), 1250);
    assert.equal(gastoObservado(600), 600);
    assert.equal(gastoObservado(1250.5), 1250.5);
  });

  it("zero, negativo, vazio e lixo viram null", () => {
    assert.equal(gastoObservado(0), null);
    assert.equal(gastoObservado("0"), null);
    assert.equal(gastoObservado("0,00"), null);
    assert.equal(gastoObservado(-500), null);
    assert.equal(gastoObservado(""), null);
    assert.equal(gastoObservado(null), null);
    assert.equal(gastoObservado("abc"), null);
    assert.equal(gastoObservado(Number.NaN), null);
  });

  it("gasto de célula numérica chega no payload sem deformar", () => {
    assert.equal(itemPorChassi(ok(fixture()).linhas, "9BW33333333333333").gastos, 8000);
  });

  // Estes dois são a prova de que a leitura é do VALOR da célula, não do texto
  // exibido. Se o parser voltar a ler o formatado, eles quebram — que é o ponto.
  it("lê o VALOR da célula, não o texto formatado que arredonda", () => {
    // Valor 1250.5 exibido com formato inteiro vira "1251" na tela do Excel.
    const buf = planilha([linha({ placa: "HHH8H88", gastos: 1250.5 })], {
      formatoGastos: { 0: "0" },
    });
    assert.equal(ok(buf).linhas[0].gastos, 1250.5);
  });

  it("formato de moeda do exportador não consegue sumir com o gasto", () => {
    // 12500 com formato en-US exibe "12,500.00", que a heurística de string
    // recusa como ambíguo (vírgula antes do ponto) e devolveria null — o gasto
    // sumiria, o custo cairia e a margem subiria, sem nenhum sintoma na tela.
    // Lendo o valor da célula, o formato é irrelevante.
    const buf = planilha([linha({ placa: "III9I99", gastos: 12500 })], {
      formatoGastos: { 0: "#,##0.00" },
    });
    assert.equal(ok(buf).linhas[0].gastos, 12500);
  });
});

describe("dinheiro pt-BR e semântica do zero", () => {
  it("125.000,00 vira 125000 (centavo-perfect, não 125)", () => {
    const l = porPlaca(ok(fixture()).linhas, "AAA1A11");
    assert.equal(l.valor_compra, 125000);
    assert.equal(l.valor_vendido, 122500);
  });

  it("valor 0,00 vira null (ausência), nunca o número 0", () => {
    const r = ok(planilha([linha({ placa: "EEE5E55", compra: "0,00", vendido: "0,00" })]));
    assert.equal(r.linhas[0].valor_compra, null);
    assert.equal(r.linhas[0].valor_vendido, null);
  });
});

describe("datas — DD/MM/AAAA HH:MM:SS vira YYYY-MM-DD sem conversão de fuso", () => {
  it("corta o horário e mantém o dia", () => {
    assert.equal(dataObservada("24/06/2026 16:13:32"), "2026-06-24");
  });

  it("o horário da noite NÃO empurra a data pro dia seguinte", () => {
    // O ponto inteiro: o relatório é exportado em Brasília. Converter aqui é como
    // se transforma uma venda das 23h de terça numa venda de quarta.
    assert.equal(dataObservada("22/07/2026 23:59:59"), "2026-07-22");
  });

  it("aceita sem horário", () => {
    assert.equal(dataObservada("06/07/2026"), "2026-07-06");
  });

  it("data impossível vira null em vez de rolar pro mês seguinte", () => {
    assert.equal(dataObservada("31/02/2026"), null);
    assert.equal(dataObservada("32/01/2026"), null);
    assert.equal(dataObservada("01/13/2026"), null);
  });

  it("formato estranho, vazio e lixo viram null", () => {
    assert.equal(dataObservada("2026-06-24"), null);
    assert.equal(dataObservada(""), null);
    assert.equal(dataObservada(null), null);
    assert.equal(dataObservada("ontem"), null);
  });
});

describe("TAC — somado e exibido, NUNCA gravado", () => {
  it("soma o TAC das linhas da Matriz e conta quantas trouxeram", () => {
    const r = ok(fixture());
    // 999 + 999 + 499,50 + 999 = 3.496,50 (a linha de outra loja não entra)
    assert.equal(r.meta.total_tac, 3496.5);
    assert.equal(r.meta.linhas_com_tac, N_MATRIZ);
  });

  it("aceita o prefixo R$ do arquivo real", () => {
    const l = porPlaca(ok(fixture()).linhas, "CCC3C33");
    assert.equal(l.valor_tac, 499.5);
  });

  it("NÃO existe chave de TAC no payload — garantia estrutural, não regra de tela", () => {
    const r = ok(fixture());
    for (const item of montarPayloadVendas(r.linhas).linhas) {
      const chaves = Object.keys(item);
      assert.ok(!chaves.some((k) => /tac/i.test(k)), `payload vazou TAC: ${chaves.join(",")}`);
    }
  });
});

describe("o que o parser se recusa a ler", () => {
  it("lucro do relatório não vira campo nenhum", () => {
    const r = ok(fixture());
    for (const l of r.linhas) {
      assert.ok(!Object.keys(l).some((k) => /lucro/i.test(k)));
    }
    for (const item of montarPayloadVendas(r.linhas).linhas) {
      assert.ok(!Object.keys(item).some((k) => /lucro/i.test(k)));
    }
  });

  it("PII do comprador não é lida nem trafega", () => {
    const r = ok(fixture());
    const serializado = JSON.stringify({ linhas: r.linhas, payload: montarPayloadVendas(r.linhas) });
    assert.ok(!serializado.includes("COMPRADOR QUE NAO PODE VAZAR"));
    assert.ok(!serializado.includes("12345678000199"));
    assert.ok(!serializado.includes("900000000"));
  });
});

describe("payload — superfície mínima e estável", () => {
  it("tem exatamente as 9 chaves do contrato", () => {
    const r = ok(fixture());
    for (const item of montarPayloadVendas(r.linhas).linhas) {
      assert.deepEqual(Object.keys(item).sort(), [
        "chassi", "data_publicacao", "data_venda", "gastos", "linha",
        "modelo", "placa", "valor_compra", "valor_vendido",
      ]);
    }
  });

  it("carrega versão e origem", () => {
    const p = montarPayloadVendas(ok(fixture()).linhas);
    assert.equal(p.versao, 1);
    assert.equal(p.origem, "arquivo_vendas_xlsx");
  });

  it("é determinístico: o mesmo arquivo produz o MESMO payload", () => {
    const a = montarPayloadVendas(ok(fixture()).linhas);
    const b = montarPayloadVendas(ok(fixture()).linhas);
    assert.deepEqual(a, b);
  });
});

describe("erros fatais — código é contrato", () => {
  it("arquivo ilegível", () => {
    const r = parseAutoAvaliarVendasXlsx(new Uint8Array([1, 2, 3, 4, 5]), "x.xlsx");
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.erro.codigo, "ARQUIVO_ILEGIVEL");
  });

  it("coluna obrigatória ausente nomeia a coluna", () => {
    const semPlaca = HEADER.map((h) => (h === "Placa" ? "Outra Coisa" : h));
    const ws = XLSX.utils.aoa_to_sheet([["Dados Vendas Concluidas"], semPlaca, linha({ placa: "AAA1A11" })]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Vendas");
    const buf: ArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

    const r = parseAutoAvaliarVendasXlsx(buf, NOME_ARQUIVO);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.erro.codigo, "COLUNA_OBRIGATORIA_AUSENTE");
    assert.equal(r.ok === false && r.erro.coluna, "Placa");
    assert.ok(r.ok === false && mensagemErroVendas(r.erro).includes("Placa"));
  });

  it("arquivo só com título, cabeçalho e rodapé", () => {
    const r = parseAutoAvaliarVendasXlsx(planilha([rodapeTotais()]), NOME_ARQUIVO);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.erro.codigo, "ARQUIVO_SEM_LINHAS");
  });

  it("as mensagens preenchem os buracos do rótulo", () => {
    assert.ok(mensagemErroVendas({ codigo: "ARQUIVO_GRANDE_DEMAIS", linhas: 5000 }).includes("5000"));
    assert.ok(!mensagemErroVendas({ codigo: "COLUNA_OBRIGATORIA_AUSENTE", coluna: "Placa" }).includes("{nome}"));
  });

  it("o teto de linhas do cliente é o mesmo da RPC", () => {
    assert.equal(MAX_LINHAS_VENDAS, 2000);
  });
});

describe("célula estranha não derruba o lote", () => {
  it("linha com valores ilegíveis vira campo null, e as outras seguem", () => {
    const buf = planilha([
      linha({ placa: "AAA1A11", chassi: "9BW11111111111111" }),
      linha({ placa: "FFF6F66", chassi: "9BW66666666666666", compra: "R$ mil", vendido: "N/A", venda: "não sei", gastos: "???" }),
      linha({ placa: "GGG7G77", chassi: "9BW77777777777777" }),
    ]);
    const r = ok(buf);
    assert.equal(r.linhas.length, 3);
    const ruim = porPlaca(r.linhas, "FFF6F66");
    assert.equal(ruim.valor_compra, null);
    assert.equal(ruim.valor_vendido, null);
    assert.equal(ruim.data_venda, null);
    assert.equal(ruim.gastos, null);
    // As boas continuam boas.
    assert.equal(porPlaca(r.linhas, "GGG7G77").valor_vendido, 60000);
  });

  it("linha com chassi mas sem placa não é descartada como rodapé", () => {
    const r = ok(planilha([linha({ placa: "", chassi: "9BW88888888888888" })]));
    assert.equal(r.meta.total_sem_identificacao, 0);
    assert.equal(r.linhas.length, 1);
    assert.equal(r.linhas[0].placa_norm, "");
    assert.equal(r.linhas[0].chassi, "9BW88888888888888");
  });
});
