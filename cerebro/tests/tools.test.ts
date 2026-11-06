process.env.TZ = "America/Sao_Paulo";

import { test } from "node:test";
import assert from "node:assert/strict";
import { ZodError } from "zod";
import {
  compactarBundle,
  fipeAnaliseEstoque,
  margemPorLoja,
  margemPorVendedor,
  montarBundle,
  sumarioGlobal,
  vendasPorMes,
} from "@/lib/analytics/insights";
import { calcMargemVenda } from "@/lib/analytics/margem";
import { prepararDatasetsDeLinhas } from "@/lib/data/preparar-datasets";
import type { LinhasBrutas } from "@/lib/data/preparar-datasets";
import { TOOLS } from "@cerebro/tools";
import { arredondar } from "@cerebro/tools/comum";
import { AGORA, contexto, snapshotPadrao, tabelasPadrao, brt } from "./fixtures";

type Obj = Record<string, unknown>;
const run = async (nome: keyof typeof TOOLS, input: unknown, t = tabelasPadrao()) =>
  TOOLS[nome].executar(input, contexto(await snapshotPadrao(t))) as Obj;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Pipeline "da tela", independente do loader: as mesmas linhas direto no prepararDatasetsDeLinhas. */
function pipelineTela() {
  const t = tabelasPadrao();
  return prepararDatasetsDeLinhas({
    vendas: t.vendas, veiculos: t.veiculos, custos: t.custos, custosEstoque: t.custosEstoque,
    meta: t.meta[0], fipe: t.fipe, cautelares: t.cautelar,
  } as unknown as LinhasBrutas);
}

// ───── resumo_estoque ─────

test("resumo_estoque: totais sem a loja ignorada e por_loja idêntico ao estoquePorLoja das telas", async () => {
  const r = await run("resumo_estoque", {});
  const d = pipelineTela();
  assert.equal(r.total_carros, 10);
  const capital = d.veiculos.reduce((a, v) => a + (v.valor_aquisicao ?? 0), 0);
  assert.equal(r.capital_travado, r2(capital));
  const bundle = montarBundle(d.vendas, d.custosPorPlaca, d.veiculos, d.fipe, d.cautelares);
  const porLoja = (r.por_loja as Obj[]).map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => k !== "cod_empresa")));
  assert.deepEqual(porLoja, arredondar(bundle.estoquePorLoja));
  assert.deepEqual(r.por_marca, arredondar(bundle.estoquePorMarca));
});

test("resumo_estoque: faixas inclusivas 0-30/31-60/61-90/91-180/180+, sem_dias à parte", async () => {
  const r = await run("resumo_estoque", {});
  // dias: 5,45,61,90,91,200,120,31,null,75
  const faixas = Object.fromEntries((r.faixas_dias_patio as Obj[]).map((f) => [f.faixa, f.qt]));
  assert.deepEqual(faixas, { "0-30": 1, "31-60": 2, "61-90": 3, "91-180": 2, "180+": 1 });
  assert.equal(r.sem_dias_patio, 1);
  assert.equal(r.acima_60_dias, 6);
  assert.equal(r.acima_90_dias, 3);
});

test("resumo_estoque: loja por código, por nome parcial e nome ambíguo", async () => {
  const porCod = await run("resumo_estoque", { loja: 5 });
  assert.equal(porCod.total_carros, 2);
  const porNome = await run("resumo_estoque", { loja: "buriti" });
  assert.equal(porNome.total_carros, 2);
  assert.deepEqual((porNome.filtros as Obj).loja, { cod_empresa: 5, nome: "NAVESA GWM BURITI" });
  const ambiguo = await run("resumo_estoque", { loja: "aeroporto" });
  assert.equal(ambiguo.erro, "loja_ambigua");
  assert.deepEqual((ambiguo.candidatas as Obj[]).map((c) => c.cod_empresa), [2, 12]);
  const exato = await run("resumo_estoque", { loja: "navesa ford aeroporto" });
  assert.equal(exato.total_carros, 6);
  const nada = await run("resumo_estoque", { loja: "xyz" });
  assert.equal(nada.erro, "loja_nao_encontrada");
  const ignorada = await run("resumo_estoque", { loja: 29 });
  assert.equal(ignorada.erro, "loja_nao_encontrada");
});

test("resumo_estoque: situação de pátio e reservados", async () => {
  assert.equal((await run("resumo_estoque", { situacao: "preparacao" })).total_carros, 1);
  assert.equal((await run("resumo_estoque", { situacao: "oficina" })).total_carros, 1);
  const res = await run("resumo_estoque", { situacao: "reservado" });
  assert.equal(res.total_carros, 1);
  assert.deepEqual((await run("resumo_estoque", {})).reservados, { qt: 1, capital_travado: 150000 });
});

// ───── carros_parados ─────

test("carros_parados: dias_patio > dias_min (90 não entra em 'mais de 90')", async () => {
  const r60 = await run("carros_parados", {});
  assert.equal(r60.total, 6);
  const r90 = await run("carros_parados", { dias_min: 90 });
  assert.equal(r90.total, 3);
  assert.deepEqual((r90.itens as Obj[]).map((i) => i.dias_patio), [200, 120, 91]);
});

test("carros_parados: truncamento mantém total e capital do filtro inteiro", async () => {
  const r = await run("carros_parados", { limite: 2 });
  const tudo = await run("carros_parados", { limite: 100 });
  assert.equal(r.total, 6);
  assert.equal(r.truncado, true);
  assert.equal((r.itens as Obj[]).length, 2);
  assert.equal(r.capital_travado_total, tudo.capital_travado_total);
  const somaItens = (tudo.itens as Obj[]).reduce((a, i) => a + (i.custo_aquisicao as number), 0);
  assert.equal(tudo.capital_travado_total, r2(somaItens));
  assert.equal(tudo.truncado, false);
});

test("carros_parados: filtros loja/modelo, ordenação por custo e campos da linha", async () => {
  const ka = await run("carros_parados", { loja: "ford aeroporto", modelo: "ka" });
  assert.equal(ka.total, 2);
  const porCusto = await run("carros_parados", { ordenar: "custo" });
  const custos = (porCusto.itens as Obj[]).map((i) => i.custo_aquisicao as number);
  assert.deepEqual(custos, [...custos].sort((a, b) => b - a));
  const oficina = (ka.itens as Obj[]).find((i) => i.dias_patio === 200) as Obj;
  assert.equal(oficina.situacao, "oficina");
  assert.equal(oficina.cautelar, "reprovado");
  assert.equal((oficina.classificacao as Obj).canal, "repasse");
  const ka91 = (ka.itens as Obj[]).find((i) => i.dias_patio === 91) as Obj;
  assert.deepEqual(ka91.fipe, { preco: 70000, referencia: "novembro/2026" });
  assert.deepEqual(ka91.desvio_fipe, { reais: -8010, pct: r2(((61990 - 70000) / 70000) * 100) });
  assert.equal(String(ka91.chassi_final).length, 8);
});

test("carros_parados: limite fora da faixa e chave desconhecida são rejeitados (Zod)", async () => {
  const snap = await snapshotPadrao();
  assert.throws(() => TOOLS.carros_parados.executar({ limite: 500 }, contexto(snap)), ZodError);
  assert.throws(() => TOOLS.carros_parados.executar({ sql: "drop table" }, contexto(snap)), ZodError);
});

// ───── buscar_veiculo ─────

test("buscar_veiculo: placa com/sem hífen e caixa diferente acha o carro com custos de estoque", async () => {
  const r = await run("buscar_veiculo", { termo: "est0001" });
  const est = r.estoque as Obj;
  assert.equal(r.busca_por, "placa_ou_chassi");
  assert.equal(est.total, 1);
  const item = (est.itens as Obj[])[0];
  assert.equal(item.placa, "EST-0001");
  assert.equal((item.custos_estoque_detalhado as Obj).custo_total, 154450);
  assert.equal(r.vendidos, null);
});

test("buscar_veiculo: por modelo com vendidos traz margem real canônica", async () => {
  const r = await run("buscar_veiculo", { termo: "kwid", incluir_vendidos: true });
  assert.equal((r.estoque as Obj).total, 1);
  const vend = r.vendidos as Obj;
  assert.equal(vend.total, 2);
  const d = pipelineTela();
  for (const it of vend.itens as Obj[]) {
    const v = d.vendas.find((x) => x.placa === it.placa)!;
    const m = calcMargemVenda(v, d.custosPorPlaca);
    assert.equal(it.margem, r2(m.margem));
    assert.equal(it.margem_fonte, m.fonte);
  }
});

test("buscar_veiculo: venda com custo oficial usa valor_vendido − custo_total (centavo)", async () => {
  const r = await run("buscar_veiculo", { termo: "AAA1A11", incluir_vendidos: true });
  const it = ((r.vendidos as Obj).itens as Obj[])[0];
  assert.equal(it.margem, 16099.74); // 150000,45 − 133900,71
  assert.equal(it.margem_fonte, "oficial");
});

// ───── vendas_periodo ─────

test("vendas_periodo: sumário sem filtro = sumarioGlobal das telas (sem a loja ignorada)", async () => {
  const r = await run("vendas_periodo", {});
  const d = pipelineTela();
  const s = sumarioGlobal(d.vendas, d.custosPorPlaca);
  const sum = r.sumario as Obj;
  assert.equal(sum.qt, 9);
  assert.equal(sum.faturamento, r2(s.faturamento));
  assert.equal(sum.margem, r2(s.margem));
  assert.equal(sum.margem_pct, r2(s.margemPct));
  assert.equal(sum.ganhos_indiretos, r2(s.ganhosIndiretos));
  assert.equal(sum.margem_sem_bonus, r2(s.margemSemBonus));
});

test("vendas_periodo: agrupar por loja/vendedor bate com margemPorLoja/margemPorVendedor", async () => {
  const d = pipelineTela();
  const porLoja = await run("vendas_periodo", { agrupar_por: "loja" });
  const esperado = margemPorLoja(d.vendas, d.custosPorPlaca);
  assert.deepEqual(
    (porLoja.grupos as Obj[]).map((g) => [g.grupo, g.qt, g.faturamento, g.margem, g.ganhos_indiretos]),
    esperado.map((l) => [l.loja, l.qt, r2(l.faturamento), r2(l.margem), r2(l.ganhosIndiretos)]),
  );
  const porVend = await run("vendas_periodo", { agrupar_por: "vendedor" });
  const espV = margemPorVendedor(d.vendas, d.custosPorPlaca);
  assert.deepEqual(
    (porVend.grupos as Obj[]).map((g) => [g.grupo, g.qt, g.margem]),
    espV.map((v) => [v.vendedor, v.qt, r2(v.margem)]),
  );
});

test("vendas_periodo: por mês cronológico = vendasPorMes", async () => {
  const d = pipelineTela();
  const r = await run("vendas_periodo", { agrupar_por: "mes" });
  const esp = vendasPorMes(d.vendas, d.custosPorPlaca);
  assert.deepEqual(
    (r.grupos as Obj[]).map((g) => [g.grupo, g.qt, g.faturamento, g.margem]),
    esp.map((m) => [m.rotulo, m.qt, r2(m.faturamento), r2(m.margem)]),
  );
});

test("vendas_periodo: período inclusivo em hora de Brasília, igual à tela de vendas", async () => {
  const r = await run("vendas_periodo", { inicio: "2026-10-01", fim: "2026-10-31" });
  const sum = r.sumario as Obj;
  // 01/10 00:10 e 31/10 23:59 entram; 30/09 23:30 e venda sem data ficam de fora
  assert.equal(sum.qt, 4);
  assert.deepEqual(r.periodo, { inicio: "2026-10-01", fim: "2026-10-31", primeira_venda: "2026-10-01", ultima_venda: "2026-10-31" });
  const soInicio = await run("vendas_periodo", { inicio: "2026-11-01" });
  assert.equal((soInicio.sumario as Obj).qt, 1);
  const inv = await run("vendas_periodo", { inicio: "2026-11-01", fim: "2026-10-01" });
  assert.equal(inv.erro, "periodo_invalido");
});

test("vendas_periodo: filtros de marca/modelo/vendedor/loja e ordenação/truncamento", async () => {
  const gwm = await run("vendas_periodo", { marca: "gwm" });
  assert.equal((gwm.sumario as Obj).qt, 3);
  assert.equal((gwm.sumario as Obj).margem as number < 0, true);
  const maria = await run("vendas_periodo", { vendedor: "maria" });
  assert.equal((maria.sumario as Obj).qt, 1);
  assert.equal((maria.sumario as Obj).pct_com_troca, 100);
  const loja12 = await run("vendas_periodo", { loja: 12 });
  assert.equal((loja12.sumario as Obj).qt, 2);
  const top1 = await run("vendas_periodo", { agrupar_por: "modelo", ordenar: "qtd", limite: 1 });
  assert.equal(top1.total_grupos, 4);
  assert.equal(top1.truncado, true);
  assert.equal(((top1.grupos as Obj[])[0]).grupo, "RANGER XLS 2.2");
});

// ───── comparar_fipe ─────

test("comparar_fipe: só FIPE confiável; desvio mínimo, direção e faixas = fipeAnaliseEstoque", async () => {
  const r = await run("comparar_fipe", {});
  assert.equal(r.analisados, 10);
  assert.equal(r.sem_fipe, 6); // score baixo e sem referência contam como sem FIPE
  assert.equal(r.total, 2);
  assert.deepEqual((r.itens as Obj[]).map((i) => i.desvio_pct), [r2(((61990 - 70000) / 70000) * 100), r2((20000 / 180000) * 100)]);
  const acima = await run("comparar_fipe", { direcao: "acima" });
  assert.equal(acima.total, 1);
  const todos = await run("comparar_fipe", { desvio_min_pct: 0 });
  assert.equal(todos.total, 4);
  const d = pipelineTela();
  const f = fipeAnaliseEstoque(d.veiculos, d.fipe)!;
  assert.deepEqual(r.faixas, arredondar({
    acima_10_pct: f.acima10Pct, acima_5_a_10_pct: f.acima5a10Pct, proximo_fipe: f.proximoFipe,
    abaixo_5_a_10_pct: f.abaixo5a10Pct, abaixo_10_pct: f.abaixo10Pct,
  }));
});

test("comparar_fipe: escopo vendas responde nao_disponivel com a cobertura medida", async () => {
  const r = await run("comparar_fipe", { escopo: "vendas" });
  assert.equal(r.erro, "nao_disponivel");
  assert.deepEqual(r.cobertura, { vendas_total: 9, vendas_com_fipe_confiavel: 0 });
});

// ───── resumo_executivo ─────

test("resumo_executivo: idêntico a compactarBundle(montarBundle(...)) do client sobre os mesmos dados", async () => {
  const r = await run("resumo_executivo", {});
  const d = pipelineTela();
  const esperado = compactarBundle(montarBundle(d.vendas, d.custosPorPlaca, d.veiculos, d.fipe, d.cautelares));
  assert.deepEqual(r.bundle, arredondar(JSON.parse(JSON.stringify(esperado))));
});

test("resumo_executivo: período filtra só as vendas", async () => {
  const r = await run("resumo_executivo", { inicio: "2026-10-01", fim: "2026-10-31" });
  const b = r.bundle as Obj;
  assert.equal((b.sumario as Obj).qt, 4);
  assert.equal((b.estoquePorLoja as Obj[]).reduce((a, l) => a + (l.qt as number), 0), 10);
});

// ───── listar_lojas ─────

test("listar_lojas: tabela lojas vazia → deriva de vendas/estoque; ignorada some; contagens", async () => {
  const r = await run("listar_lojas", {});
  assert.deepEqual(
    (r.lojas as Obj[]).map((l) => [l.cod_empresa, l.nome, l.qt_estoque, l.qt_vendas]),
    [[2, "NAVESA FORD AEROPORTO", 6, 4], [5, "NAVESA GWM BURITI", 2, 3], [8, "Loja 8", 1, 0], [12, "NAVESA RENAULT AEROPORTO", 1, 2]],
  );
});

test("listar_lojas: cadastro da tabela lojas tem cidade/ativo e a ignorada continua fora", async () => {
  const t = tabelasPadrao();
  t.lojas = [
    { cod_empresa: 8, nome: "NAVESA FORD ANAPOLIS", cidade: "ANAPOLIS", ativo: true },
    { cod_empresa: 29, nome: "NAVESA FORD CAMPO GRANDE", cidade: "CAMPO GRANDE", ativo: false },
  ];
  const r = await run("listar_lojas", {}, t);
  const l8 = (r.lojas as Obj[]).find((l) => l.cod_empresa === 8)!;
  assert.deepEqual([l8.nome, l8.cidade, l8.ativo], ["NAVESA FORD ANAPOLIS", "ANAPOLIS", true]);
  assert.equal((r.lojas as Obj[]).some((l) => l.cod_empresa === 29), false);
});

// ───── frescor ─────

test("dados: sync velho, com erro ou cache desatualizado viram aviso", async () => {
  const t = tabelasPadrao();
  t.syncLog[1] = { ...t.syncLog[1], status: "erro", iniciado_em: brt("2026-11-06", "07:00") };
  t.syncLogSucesso[1] = { ...t.syncLogSucesso[1], finalizado_em: brt("2026-11-03", "06:04") };
  const snap = await snapshotPadrao(t);
  const r = TOOLS.listar_lojas.executar({}, contexto(snap, { cacheDesatualizado: true })) as Obj;
  const dados = r.dados as Obj;
  assert.equal(dados.desatualizado, true);
  assert.equal((dados.avisos as string[]).length, 3);
  const ok = TOOLS.listar_lojas.executar({}, contexto(await snapshotPadrao(), { agora: AGORA })) as Obj;
  assert.equal((ok.dados as Obj).desatualizado, false);
  assert.equal((ok.dados as Obj).estoque_gerado_em, brt("2026-11-06", "06:00"));
});
