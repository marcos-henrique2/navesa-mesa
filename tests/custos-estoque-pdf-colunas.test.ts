/**
 * Testes de `extrairDado` (nbs-custos-estoque-pdf.ts) — bug real confirmado:
 * as faixas de X usadas para separar ADM, Impostos e Comissões estavam
 * rotuladas em ordem cíclica errada desde a criação do parser (commit
 * 9d96e68), afetando todo o histórico de upload manual (4+ meses).
 *
 * Evidência: coordenadas X reais extraídas de um PDF de amostra, cruzadas
 * contra o Oracle pro carro placa SDL6D60/chassi 179794, confirmaram que o
 * x real de cada coluna é ADM=417,6, Impostos=443,6, Comissões=500,1 — mas
 * o código rotulava essas três faixas como "comissoes", "adm", "impostos"
 * respectivamente (uma rotação de 1 posição).
 *
 * ARMADILHA que deixou o bug passar 4+ meses sem detecção: o total agregado
 * (`custo_total`) é a SOMA das parcelas, e soma é invariante à ordem — ou
 * seja, qualquer permutação de ADM/Impostos/Comissões entre si ainda produz
 * o mesmo `custo_total`. Validar só o total é CEGO a essa classe de bug.
 * Por isso os testes abaixo usam valores DIFERENTES em cada uma das três
 * colunas e comparam CADA campo individualmente contra o valor esperado —
 * uma futura reintrodução da troca (de ADM↔Impostos↔Comissões, em qualquer
 * sentido) quebra pelo menos uma dessas asserções, mesmo que o total continue
 * batendo.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { agruparLinhas, extrairDado, type Item } from "@/lib/parsers/nbs-custos-estoque-pdf";

/**
 * Monta os itens de uma linha de dado típica do relatório "Custos de Veículos
 * em Estoque", com valores distintos em cada uma das 14 colunas numéricas —
 * especialmente ADM, Impostos e Comissões, que são o alvo deste teste de
 * regressão (valores iguais entre elas mascarariam uma troca de coluna).
 *
 * As posições X usadas aqui são o centro de cada faixa calibrada em FAIXAS
 * (nbs-custos-estoque-pdf.ts), replicando fielmente o layout real do PDF.
 */
function montarLinhaDeDado(y: number = 500): Item[] {
  return [
    { str: "1", x: 10, y },
    { str: "RANGER", x: 45, y },
    { str: "XLT", x: 70, y },
    { str: "ABC1D23", x: 120, y }, // placa (faixa dedicada x 108-160)
    { str: "15", x: 170, y },      // dias_patio (inteiro puro, sem vírgula)
    { str: "1.000,00", x: 200, y }, // nota_fabrica (faixa 185-215)
    { str: "50,00", x: 250, y },    // revisoes (faixa 235-270)
    { str: "300,00", x: 290, y },   // forplan (faixa 275-315)
    { str: "0,00", x: 340, y },     // holdback (faixa 330-350)
    { str: "0,00", x: 385, y },     // acessorios (faixa 375-395)
    { str: "111,11", x: 417, y },   // ADM real (faixa 410-430)
    { str: "222,22", x: 445, y },   // Impostos real (faixa 435-470)
    { str: "333,33", x: 500, y },   // Comissões real (faixa 475-515)
    { str: "444,44", x: 550, y },   // desp_gerais (faixa 530-580)
    { str: "2.461,10", x: 615, y }, // custo_total (faixa 600-630)
    { str: "5.000,00", x: 655, y }, // tabela (faixa 645-670)
    { str: "1.000,00", x: 710, y }, // lucro_bruto (faixa 695-725)
    { str: "0,00", x: 765, y },     // bonus (faixa 755-775)
    { str: "100,00", x: 795, y },   // ganhos_indiretos (faixa 780-815)
  ];
}

describe("extrairDado — mapeamento de ADM/Impostos/Comissões por faixa de X", () => {
  it("atribui ADM, Impostos e Comissões aos campos corretos (não cego a permutação)", () => {
    const linhas = agruparLinhas(montarLinhaDeDado());
    const warnings: string[] = [];
    const dado = extrairDado(linhas[0], warnings);

    assert.ok(dado, "linha deveria ser extraída com sucesso");
    // Ponto crítico: cada categoria comparada INDIVIDUALMENTE, não só o total.
    assert.equal(dado!.adm, 111.11, "ADM (x~417) deve mapear para o campo adm");
    assert.equal(dado!.impostos, 222.22, "Impostos (x~445) deve mapear para o campo impostos");
    assert.equal(dado!.comissoes, 333.33, "Comissões (x~500) deve mapear para o campo comissoes");
    assert.deepEqual(warnings, []);
  });

  it("demais colunas numéricas continuam mapeadas corretamente (sanity check ao redor da correção)", () => {
    const linhas = agruparLinhas(montarLinhaDeDado());
    const dado = extrairDado(linhas[0], []);

    assert.ok(dado);
    assert.equal(dado!.placa, "ABC1D23");
    assert.equal(dado!.modelo, "RANGER XLT");
    assert.equal(dado!.dias_patio, 15);
    assert.equal(dado!.nota_fabrica, 1000);
    assert.equal(dado!.revisoes, 50);
    assert.equal(dado!.forplan, 300);
    assert.equal(dado!.holdback, 0);
    assert.equal(dado!.acessorios, 0);
    assert.equal(dado!.desp_gerais, 444.44);
    assert.equal(dado!.custo_total, 2461.1);
    assert.equal(dado!.tabela, 5000);
    assert.equal(dado!.lucro_bruto, 1000);
    assert.equal(dado!.bonus, 0);
    assert.equal(dado!.ganhos_indiretos, 100);
  });

  it("total agregado bate mesmo que — isoladamente — isso não provaria nada sobre as colunas individuais", () => {
    // Este teste existe só para documentar a armadilha: o total é invariante
    // à ordem das parcelas ADM/Impostos/Comissões, então ele NUNCA deveria
    // ser usado como única prova de que o mapeamento de colunas está certo.
    const linhas = agruparLinhas(montarLinhaDeDado());
    const dado = extrairDado(linhas[0], []);
    assert.ok(dado);

    const somaParcelas =
      dado!.nota_fabrica + dado!.revisoes + dado!.forplan + dado!.holdback +
      dado!.acessorios + dado!.adm + dado!.impostos + dado!.comissoes + dado!.desp_gerais;
    // custo_total vem de uma coluna própria no PDF, não é recalculado pelo
    // parser — aqui só confirmamos que a soma das parcelas é consistente com
    // o fixture, não que o parser "acertou por sorte" via total.
    assert.equal(Math.round(somaParcelas * 100) / 100, 2461.1);
  });
});
