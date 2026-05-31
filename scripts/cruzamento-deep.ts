import * as fs from "fs";
import { parseNbsXlsx } from "../src/lib/parsers/nbs-xlsx";
import { parseNbsVendasXlsx } from "../src/lib/parsers/nbs-vendas-xlsx";
import { parseNbsCustosXls } from "../src/lib/parsers/nbs-custos-xls";
import { calcMargemVenda, type MargemFonte } from "../src/lib/analytics/margem";

const fmt = (n: number) =>
  "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

async function main() {
  const BASE = "C:/Users/Marcos Henrique/Documents/Mesa de Precificaçao";
  const estoqueBuf = fs.readFileSync(`${BASE}/Estoque 1.xlsx`);
  const vendasBuf = fs.readFileSync(`${BASE}/Relatorio 1.xlsx`);
  const custosBuf = fs.readFileSync(`${BASE}/Relatorio 2.xls`);

  const estoque = await parseNbsXlsx(
    estoqueBuf.buffer.slice(estoqueBuf.byteOffset, estoqueBuf.byteOffset + estoqueBuf.byteLength),
    "Estoque 1.xlsx"
  );
  const vendas = await parseNbsVendasXlsx(
    vendasBuf.buffer.slice(vendasBuf.byteOffset, vendasBuf.byteOffset + vendasBuf.byteLength),
    "Relatorio 1.xlsx"
  );
  const custos = await parseNbsCustosXls(
    custosBuf.buffer.slice(custosBuf.byteOffset, custosBuf.byteOffset + custosBuf.byteLength),
    "Relatorio 2.xls"
  );

  const custosPorPlaca: Record<string, (typeof custos.custos)[number]> = {};
  for (const c of custos.custos) if (c.placa) custosPorPlaca[c.placa] = c;

  // Enriquecer cada venda com margem oficial
  type V = (typeof vendas.vendas)[number] & {
    margem: number;
    margemPct: number;
    custoOficial: number;
    fonte: MargemFonte;
    ganhosIndiretos: number;
  };
  const enriched: V[] = vendas.vendas.map((v) => {
    const m = calcMargemVenda(v, custosPorPlaca);
    const c = v.placa ? custosPorPlaca[v.placa] : undefined;
    return {
      ...v,
      margem: m.margem,
      margemPct: m.margemPct,
      custoOficial: m.custo,
      fonte: m.fonte,
      ganhosIndiretos: c?.ganhos_indiretos ?? 0,
    };
  });

  // ────────────────────────────────────────────────────────────────────────────
  // A) Margem por LOJA
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(" A) MARGEM POR LOJA");
  console.log("══════════════════════════════════════════════════════════");
  const porLoja = new Map<
    string,
    { qt: number; valor: number; custo: number; margem: number; ganhos: number; dias: number; comDias: number }
  >();
  for (const v of enriched) {
    const k = v.empresa_nome || "—";
    if (!porLoja.has(k))
      porLoja.set(k, { qt: 0, valor: 0, custo: 0, margem: 0, ganhos: 0, dias: 0, comDias: 0 });
    const r = porLoja.get(k)!;
    r.qt++;
    r.valor += v.valor_venda ?? 0;
    r.custo += v.custoOficial;
    r.margem += v.margem;
    r.ganhos += v.ganhosIndiretos;
    if (v.dias_estoque != null) {
      r.dias += v.dias_estoque;
      r.comDias++;
    }
  }
  const lojas = [...porLoja.entries()].sort((a, b) => b[1].margem - a[1].margem);
  console.log("Loja                                              | Qt   | Faturamento     | Margem            | Mg%    | Bônus (Ganhos Ind.) | Giro");
  console.log("─".repeat(150));
  for (const [k, r] of lojas) {
    const mgPct = r.valor > 0 ? r.margem / r.valor : 0;
    const giro = r.comDias > 0 ? r.dias / r.comDias : 0;
    console.log(
      `${k.padEnd(50)}| ${String(r.qt).padStart(4)} | ${fmt(r.valor).padStart(15)} | ${(r.margem >= 0 ? "" : "") + fmt(r.margem).padStart(17)} | ${pct(mgPct).padStart(6)} | ${fmt(r.ganhos).padStart(18)} | ${giro.toFixed(0).padStart(3)}d`
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // B) Margem por MARCA
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(" B) MARGEM POR MARCA");
  console.log("══════════════════════════════════════════════════════════");
  const porMarca = new Map<
    string,
    { qt: number; valor: number; custo: number; margem: number; ganhos: number }
  >();
  for (const v of enriched) {
    const k = v.marca || "—";
    if (!porMarca.has(k))
      porMarca.set(k, { qt: 0, valor: 0, custo: 0, margem: 0, ganhos: 0 });
    const r = porMarca.get(k)!;
    r.qt++;
    r.valor += v.valor_venda ?? 0;
    r.custo += v.custoOficial;
    r.margem += v.margem;
    r.ganhos += v.ganhosIndiretos;
  }
  const marcas = [...porMarca.entries()].sort((a, b) => b[1].qt - a[1].qt);
  console.log("Marca                | Qt   | Faturamento     | Margem            | Mg%    | Bônus");
  console.log("─".repeat(110));
  for (const [k, r] of marcas) {
    const mgPct = r.valor > 0 ? r.margem / r.valor : 0;
    console.log(
      `${k.padEnd(20)} | ${String(r.qt).padStart(4)} | ${fmt(r.valor).padStart(15)} | ${fmt(r.margem).padStart(17)} | ${pct(mgPct).padStart(6)} | ${fmt(r.ganhos)}`
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // C) TROCAS vs SEM TROCAS
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(" C) TROCAS vs SEM TROCAS");
  console.log("══════════════════════════════════════════════════════════");
  const grupos = { troca: { qt: 0, valor: 0, margem: 0, ganhos: 0 }, sem: { qt: 0, valor: 0, margem: 0, ganhos: 0 } };
  for (const v of enriched) {
    const g = v.placa_troca ? grupos.troca : grupos.sem;
    g.qt++;
    g.valor += v.valor_venda ?? 0;
    g.margem += v.margem;
    g.ganhos += v.ganhosIndiretos;
  }
  for (const [k, g] of Object.entries(grupos)) {
    const ticket = g.qt > 0 ? g.valor / g.qt : 0;
    const mgMed = g.qt > 0 ? g.margem / g.qt : 0;
    const mgPct = g.valor > 0 ? g.margem / g.valor : 0;
    console.log(`  ${k.padEnd(6)}: ${g.qt} vendas | Fat ${fmt(g.valor)} | Ticket ${fmt(ticket)} | Margem ${fmt(g.margem)} (${pct(mgPct)}) | Margem/un ${fmt(mgMed)} | Bônus ${fmt(g.ganhos)}`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // D) TOP MODELOS — pior e melhor margem
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(" D) MODELOS COM PIOR MARGEM ABSOLUTA (R$)");
  console.log("══════════════════════════════════════════════════════════");
  const porModelo = new Map<string, { qt: number; valor: number; margem: number }>();
  for (const v of enriched) {
    const k = (v.modelo || "—").slice(0, 50);
    if (!porModelo.has(k)) porModelo.set(k, { qt: 0, valor: 0, margem: 0 });
    const r = porModelo.get(k)!;
    r.qt++;
    r.valor += v.valor_venda ?? 0;
    r.margem += v.margem;
  }
  const modelosFiltrados = [...porModelo.entries()].filter(([, r]) => r.qt >= 3);
  const piores = [...modelosFiltrados].sort((a, b) => a[1].margem - b[1].margem).slice(0, 15);
  console.log("Modelo                                            | Qt  | Faturamento     | Margem            | Mg%");
  console.log("─".repeat(120));
  for (const [k, r] of piores) {
    const mgPct = r.valor > 0 ? r.margem / r.valor : 0;
    console.log(`${k.padEnd(50)}| ${String(r.qt).padStart(3)} | ${fmt(r.valor).padStart(15)} | ${fmt(r.margem).padStart(17)} | ${pct(mgPct).padStart(6)}`);
  }

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(" E) MODELOS COM MELHOR MARGEM ABSOLUTA (R$)");
  console.log("══════════════════════════════════════════════════════════");
  const melhores = [...modelosFiltrados].sort((a, b) => b[1].margem - a[1].margem).slice(0, 15);
  console.log("Modelo                                            | Qt  | Faturamento     | Margem            | Mg%");
  console.log("─".repeat(120));
  for (const [k, r] of melhores) {
    const mgPct = r.valor > 0 ? r.margem / r.valor : 0;
    console.log(`${k.padEnd(50)}| ${String(r.qt).padStart(3)} | ${fmt(r.valor).padStart(15)} | ${fmt(r.margem).padStart(17)} | ${pct(mgPct).padStart(6)}`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // F) VENDEDORES — top 10 por margem e piores 10
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(" F) TOP 10 VENDEDORES POR MARGEM TOTAL");
  console.log("══════════════════════════════════════════════════════════");
  const porVend = new Map<
    string,
    { qt: number; valor: number; margem: number; comissao: number }
  >();
  for (const v of enriched) {
    const k = v.vendedor_nome || v.vendedor_codigo || "—";
    if (!porVend.has(k)) porVend.set(k, { qt: 0, valor: 0, margem: 0, comissao: 0 });
    const r = porVend.get(k)!;
    r.qt++;
    r.valor += v.valor_venda ?? 0;
    r.margem += v.margem;
    r.comissao += v.comissao_vendedor ?? 0;
  }
  const vendedores = [...porVend.entries()];
  const topVend = [...vendedores].sort((a, b) => b[1].margem - a[1].margem).slice(0, 10);
  const piorVend = [...vendedores].filter(([, r]) => r.qt >= 5).sort((a, b) => a[1].margem - b[1].margem).slice(0, 10);
  console.log("Vendedor                                  | Qt  | Faturamento     | Margem            | Mg%    | Comissão");
  console.log("─".repeat(130));
  for (const [k, r] of topVend) {
    const mgPct = r.valor > 0 ? r.margem / r.valor : 0;
    console.log(`${k.padEnd(42)}| ${String(r.qt).padStart(3)} | ${fmt(r.valor).padStart(15)} | ${fmt(r.margem).padStart(17)} | ${pct(mgPct).padStart(6)} | ${fmt(r.comissao)}`);
  }
  console.log("\n PIORES 10 VENDEDORES (≥5 vendas)");
  console.log("─".repeat(130));
  for (const [k, r] of piorVend) {
    const mgPct = r.valor > 0 ? r.margem / r.valor : 0;
    console.log(`${k.padEnd(42)}| ${String(r.qt).padStart(3)} | ${fmt(r.valor).padStart(15)} | ${fmt(r.margem).padStart(17)} | ${pct(mgPct).padStart(6)} | ${fmt(r.comissao)}`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // G) GIRO (dias de pátio) vs MARGEM
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(" G) GIRO (dias_estoque) vs MARGEM");
  console.log("══════════════════════════════════════════════════════════");
  const buckets = [
    { label: "0-15 dias", min: 0, max: 15, qt: 0, valor: 0, margem: 0 },
    { label: "16-30 dias", min: 16, max: 30, qt: 0, valor: 0, margem: 0 },
    { label: "31-60 dias", min: 31, max: 60, qt: 0, valor: 0, margem: 0 },
    { label: "61-90 dias", min: 61, max: 90, qt: 0, valor: 0, margem: 0 },
    { label: "91-180 dias", min: 91, max: 180, qt: 0, valor: 0, margem: 0 },
    { label: "180+ dias", min: 181, max: Infinity, qt: 0, valor: 0, margem: 0 },
  ];
  let semDias = 0;
  for (const v of enriched) {
    if (v.dias_estoque == null) {
      semDias++;
      continue;
    }
    for (const b of buckets) {
      if (v.dias_estoque >= b.min && v.dias_estoque <= b.max) {
        b.qt++;
        b.valor += v.valor_venda ?? 0;
        b.margem += v.margem;
        break;
      }
    }
  }
  console.log(`(sem dias_estoque: ${semDias})`);
  console.log("Faixa            | Qt   | Faturamento     | Margem            | Mg%    | Margem/un");
  console.log("─".repeat(110));
  for (const b of buckets) {
    const mgPct = b.valor > 0 ? b.margem / b.valor : 0;
    const mgUn = b.qt > 0 ? b.margem / b.qt : 0;
    console.log(`${b.label.padEnd(16)} | ${String(b.qt).padStart(4)} | ${fmt(b.valor).padStart(15)} | ${fmt(b.margem).padStart(17)} | ${pct(mgPct).padStart(6)} | ${fmt(mgUn)}`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // H) ESTOQUE ATUAL — risco baseado em margem histórica do modelo
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(" H) ESTOQUE ATUAL — risco por histórico de margem do modelo");
  console.log("══════════════════════════════════════════════════════════");
  // Mapa modelo (normalizado) → margem média no histórico
  const histPorModelo = new Map<string, { qt: number; somaMargem: number; somaValor: number }>();
  for (const v of enriched) {
    const k = (v.modelo || "—").trim().toUpperCase();
    if (!histPorModelo.has(k)) histPorModelo.set(k, { qt: 0, somaMargem: 0, somaValor: 0 });
    const r = histPorModelo.get(k)!;
    r.qt++;
    r.somaMargem += v.margem;
    r.somaValor += v.valor_venda ?? 0;
  }

  let estoqueComHist = 0, estoqueSemHist = 0;
  let valorEstoqueRisco = 0, qtRisco = 0;
  let valorEstoqueBom = 0, qtBom = 0;
  const riscoTop: { modelo: string; placa: string; preco: number; mgHist: number; qtHist: number }[] = [];
  for (const veh of estoque.veiculos) {
    const k = (veh.modelo || "—").trim().toUpperCase();
    const h = histPorModelo.get(k);
    if (!h || h.qt === 0) {
      estoqueSemHist++;
      continue;
    }
    estoqueComHist++;
    const mgMed = h.somaMargem / h.qt;
    if (mgMed < 0) {
      qtRisco++;
      valorEstoqueRisco += veh.preco_venda ?? 0;
      riscoTop.push({ modelo: veh.modelo ?? "—", placa: veh.placa ?? "—", preco: veh.preco_venda ?? 0, mgHist: mgMed, qtHist: h.qt });
    } else {
      qtBom++;
      valorEstoqueBom += veh.preco_venda ?? 0;
    }
  }
  console.log(`Estoque atual: ${estoque.veiculos.length} carros`);
  console.log(`  Com histórico no período: ${estoqueComHist}`);
  console.log(`  Sem histórico (modelos novos no estoque): ${estoqueSemHist}`);
  console.log(`  🟢 Modelos com margem histórica positiva: ${qtBom} (${fmt(valorEstoqueBom)} parado)`);
  console.log(`  🔴 Modelos com margem histórica NEGATIVA: ${qtRisco} (${fmt(valorEstoqueRisco)} parado)`);

  const riscoSort = riscoTop.sort((a, b) => a.mgHist - b.mgHist).slice(0, 15);
  console.log("\n TOP 15 RISCOS NO ESTOQUE (modelo c/ pior margem média histórica):");
  console.log("Modelo                                        | Placa    | Preço          | Margem méd  | N vendas hist");
  console.log("─".repeat(130));
  for (const r of riscoSort) {
    console.log(`${r.modelo.slice(0, 45).padEnd(45)} | ${r.placa.padEnd(8)} | ${fmt(r.preco).padStart(14)} | ${fmt(r.mgHist).padStart(11)} | ${r.qtHist}`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // I) OUTLIERS — maior lucro e maior prejuízo individuais
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(" I) OUTLIERS — top 10 maior lucro e maior prejuízo");
  console.log("══════════════════════════════════════════════════════════");
  const sortedLucro = [...enriched].sort((a, b) => b.margem - a.margem).slice(0, 10);
  const sortedPrej = [...enriched].sort((a, b) => a.margem - b.margem).slice(0, 10);
  console.log("\n MAIOR LUCRO:");
  for (const v of sortedLucro) {
    console.log(`  ${(v.placa ?? "—").padEnd(8)} ${v.modelo?.slice(0, 40).padEnd(40)} | venda ${fmt(v.valor_venda ?? 0)} | margem ${fmt(v.margem)} (${pct(v.margemPct / 100)})`);
  }
  console.log("\n MAIOR PREJUÍZO:");
  for (const v of sortedPrej) {
    console.log(`  ${(v.placa ?? "—").padEnd(8)} ${v.modelo?.slice(0, 40).padEnd(40)} | venda ${fmt(v.valor_venda ?? 0)} | margem ${fmt(v.margem)} (${pct(v.margemPct / 100)})`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // J) CLIENTES recorrentes
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(" J) CLIENTES — recorrência (PF e PJ)");
  console.log("══════════════════════════════════════════════════════════");
  const porCliente = new Map<string, { nome: string; tipo: "PF" | "PJ" | "?"; qt: number; valor: number; margem: number }>();
  for (const v of enriched) {
    const k = v.cliente_codigo?.trim() || `__sem_doc__${v.cliente_nome ?? ""}`;
    if (!porCliente.has(k)) {
      const tipo: "PF" | "PJ" | "?" = v.cliente_tipo ?? "?";
      porCliente.set(k, { nome: v.cliente_nome ?? "?", tipo, qt: 0, valor: 0, margem: 0 });
    }
    const r = porCliente.get(k)!;
    r.qt++;
    r.valor += v.valor_venda ?? 0;
    r.margem += v.margem;
  }
  const recorrentes = [...porCliente.values()].filter((c) => c.qt >= 2).sort((a, b) => b.qt - a.qt);
  console.log(`Total de clientes: ${porCliente.size}`);
  console.log(`Recorrentes (≥2 compras): ${recorrentes.length}`);
  console.log("\nTop 15 recorrentes:");
  console.log("Cliente                                  | Tp | Qt | Faturamento     | Margem");
  console.log("─".repeat(110));
  for (const c of recorrentes.slice(0, 15)) {
    console.log(`${c.nome.slice(0, 40).padEnd(40)} | ${c.tipo.padEnd(2)} | ${String(c.qt).padStart(2)} | ${fmt(c.valor).padStart(15)} | ${fmt(c.margem)}`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // K) Sumário — quem segura a operação?
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(" K) SUMÁRIO — quem segura o resultado?");
  console.log("══════════════════════════════════════════════════════════");
  const totalGanhos = enriched.reduce((s, v) => s + v.ganhosIndiretos, 0);
  const totalMargem = enriched.reduce((s, v) => s + v.margem, 0);
  const semGanhos = totalMargem - totalGanhos;
  console.log(`Margem REAL (com Ganhos Indiretos): ${fmt(totalMargem)}`);
  console.log(`Ganhos Indiretos (Bônus Fábrica + Valorização): ${fmt(totalGanhos)}`);
  console.log(`Margem SEM Ganhos Indiretos: ${fmt(semGanhos)}`);
  console.log(`→ ${totalGanhos > totalMargem ? "✋ Sem os bônus, a operação estaria no PREJUÍZO" : "✓ Operação positiva mesmo sem bônus"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
