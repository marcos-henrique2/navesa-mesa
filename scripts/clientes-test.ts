import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseNbsVendasXlsx } from "../src/lib/parsers/nbs-vendas-xlsx";
import { indexarClientes, tierRecorrencia, TIER_LABEL } from "../src/lib/analytics/clientes";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Uso: npx tsx scripts/clientes-test.ts <xlsx>");
    process.exit(1);
  }

  const buf = await readFile(resolve(path));
  const result = await parseNbsVendasXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path);
  const idx = indexarClientes(result.vendas);

  console.log(`Total vendas: ${result.vendas.length}`);
  console.log(`Clientes únicos: ${idx.size}`);
  console.log();

  const buckets = { unica: 0, ocasional: 0, recorrente: 0, "lojista-suspeito": 0 };
  for (const c of idx.values()) buckets[tierRecorrencia(c.totalCompras)]++;

  console.log("=== Distribuição de recorrência ===");
  for (const [tier, n] of Object.entries(buckets)) {
    console.log(`  ${TIER_LABEL[tier as keyof typeof TIER_LABEL]}: ${n} clientes`);
  }

  const ordenados = [...idx.values()].sort((a, b) => b.totalCompras - a.totalCompras);
  console.log("\n=== TOP 15 CLIENTES POR QUANTIDADE DE COMPRAS ===");
  ordenados.slice(0, 15).forEach((c, i) => {
    const fmtBR = (n: number) => "R$ " + n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
    console.log(`  ${i + 1}. ${c.nome} (${c.tipo ?? "?"}, ${c.cidade ?? "?"}-${c.uf ?? "?"})`);
    console.log(`     ${c.totalCompras} compras · ${fmtBR(c.totalValor)} · ${c.diasEntrePrimeiraUltima ?? 0} dias entre primeira e última`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
