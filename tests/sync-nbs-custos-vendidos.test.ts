import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapearCustosVendidos, janelaCustosVendidos, custoVendidoToRow, SQL_CUSTOS_VENDIDOS } from "../scripts/sync-nbs/sync-custos-vendidos";

function row(overrides: Record<string,unknown> = {}): Record<string,unknown> {
  return { PLACA:"ABC1D23",MODELO:"Focus",DATA_FATURA:"2026-08-01",DATA_VENDA:"2026-10-08",DIAS_PATIO:68,
    NOTA_LIQUIDA:100000,OFICINA:350,FRETE:120,FORPLAN:500,IMPOSTOS:800,COMISSOES:250,
    BONUS:10000,COMISSAO_VD:0,ADM:75,GERAIS:200,CUSTO_TOTAL:92295,
    VALOR_VENDIDO:110000,DESAGIO:0,MARGEM_REAL:17705,MARGEM_PCT:16.09545,...overrides };
}

describe("custos vendidos oficiais",()=>{
  it("importa composição final conciliada com bônus abatido e serializer sem cliente",()=>{
    const r=mapearCustosVendidos([row()]);
    assert.equal(r.validoParaGravar,true);
    assert.equal(r.parcial,false);
    assert.equal(r.totalOficial,92295);
    assert.equal(r.totalComponentes,92295);
    assert.equal(r.custos[0].ganhos_indiretos,10000);
    assert.equal(r.custos[0].margem_pct,16.09545);
    const serializado = custoVendidoToRow(r.custos[0]).data_venda;
    assert.equal(serializado,"2026-10-08T00:00:00-03:00");
    assert.equal(new Intl.DateTimeFormat("en-CA", {timeZone:"America/Sao_Paulo"}).format(new Date(String(serializado))), "2026-10-08");
  });
  it("bloqueia divergência de um centavo apenas na placa afetada",()=>{
    const r=mapearCustosVendidos([row(),row({PLACA:"ZZZ9Z99",CUSTO_TOTAL:92295.01})]);
    assert.equal(r.validoParaGravar,true);
    assert.equal(r.parcial,true);
    assert.equal(r.contagemBloqueadas,1);
    assert.deepEqual(r.custos.map(c=>c.placa),["ABC1D23"]);
    assert.equal(r.divergencias[0].diferenca,-0.01);
    assert.equal(r.totalOficial,r.totalComponentes);
  });
  it("não trata campos desconhecidos como zero nem libera lote só inválido",()=>{
    const r=mapearCustosVendidos([row({CUSTO_TOTAL:null}),row({PLACA:"AAA1A11",IMPOSTOS:undefined})]);
    assert.equal(r.validoParaGravar,false);
    assert.equal(r.contagemBloqueadas,2);
    assert.equal(r.custos.length,0);
  });
  it("bloqueia custos ou vendas zero e negativos",()=>{
    for(const values of [{CUSTO_TOTAL:0},{CUSTO_TOTAL:-1},{VALOR_VENDIDO:0},{VALOR_VENDIDO:-1}]) {
      const r=mapearCustosVendidos([row(values)]);
      assert.equal(r.validoParaGravar,false);
      assert.equal(r.contagemBloqueadas,1);
    }
  });
  it("não adivinha comissão VD com MAX por produto",()=>{
    const r=mapearCustosVendidos([row({COMISSAO_VD:100,CUSTO_TOTAL:92195})]);
    assert.equal(r.validoParaGravar,false);
    assert.match(r.warnings[0],/MAX por produto/);
  });
  it("mantém margem oficial descontando deságio sem reconstruir margem",()=>{
    const r=mapearCustosVendidos([row({DESAGIO:15.5,MARGEM_REAL:17689.5})]);
    assert.equal(r.validoParaGravar,true);
    assert.equal(r.custos[0].margem_real,17689.5);
    assert.match(r.warnings[0],/deságio/);
  });
  it("preserva venda recente por placa e não recua para antiga inválida",()=>{
    const r=mapearCustosVendidos([row({CUSTO_TOTAL:null}),row({DATA_VENDA:"2026-10-01"})]);
    assert.equal(r.custos.length,0);
    assert.equal(r.contagemBloqueadas,1);
    assert.match(r.warnings[1],/repetida/);
  });
  it("ignora sentinela de fatura mas bloqueia data de venda inválida",()=>{
    const r=mapearCustosVendidos([row({DATA_FATURA:"1899-12-30",DIAS_PATIO:40000}),row({PLACA:"AAA1A11",DATA_VENDA:"2026-02-30"})]);
    assert.equal(r.custos[0].data_fatura,null);
    assert.equal(r.custos[0].dias_patio,null);
    assert.equal(r.contagemBloqueadas,1);
  });
  it("soma centavos inteiros para evitar falso residual de ponto flutuante",()=>{
    const r=mapearCustosVendidos([row({NOTA_LIQUIDA:0.1,OFICINA:0.2,FRETE:0,FORPLAN:0,IMPOSTOS:0,COMISSOES:0,BONUS:0,ADM:0,GERAIS:0,CUSTO_TOTAL:0.3,VALOR_VENDIDO:1,MARGEM_REAL:0.7})]);
    assert.equal(r.divergencias.length,0);
    assert.equal(r.diferencaTotal,0);
    assert.equal(r.custos[0].custo_total,0.3);
  });
  it("janela usa dia de São Paulo, aceita backfill e rejeita datas impossíveis",()=>{
    assert.deepEqual(janelaCustosVendidos({agora:new Date("2026-10-09T01:00:00Z"),dataInicio:"2026-01-01"}),{dataInicio:"2026-01-01",dataFimExclusiva:"2026-10-09"});
    assert.throws(()=>janelaCustosVendidos({dataInicio:"2026-02-30"}),/inválida/);
    assert.throws(()=>janelaCustosVendidos({dataInicio:"2026-10-09",dataFimExclusiva:"2026-10-09"}),/inválida/);
  });
  it("consulta custos apenas dos veículos alvo por empresa/produto/modelo/chassi",()=>{
    assert.match(SQL_CUSTOS_VENDIDOS,/v\.PLACA_USADO AS PLACA/);
    assert.match(SQL_CUSTOS_VENDIDOS,/JOIN chaves c ON c\.COD_EMPRESA = ce\.COD_EMPRESA AND c\.COD_PRODUTO = ce\.COD_PRODUTO/);
    assert.match(SQL_CUSTOS_VENDIDOS,/c\.COD_MODELO = ce\.COD_MODELO AND c\.CHASSI_RESUMIDO = ce\.CHASSI_RESUMIDO/);
    assert.match(SQL_CUSTOS_VENDIDOS,/ce\.TIPO, 12,.*15,.*16,/);
    assert.doesNotMatch(SQL_CUSTOS_VENDIDOS,/CODIGO_CUSTO IN/);
  });
});
