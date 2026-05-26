import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseNbsXlsx } from "../src/lib/parsers/nbs-xlsx";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Uso: npm run parse-test -- <caminho-do-xlsx>");
    process.exit(1);
  }

  const absolute = resolve(path);
  console.log(`Lendo: ${absolute}\n`);

  const buf = await readFile(absolute);
  const result = await parseNbsXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path);

  console.log("=== META ===");
  console.log(JSON.stringify(result.meta, null, 2));

  console.log(`\n=== ${result.veiculos.length} VEÍCULOS PARSEADOS ===`);

  const porLoja = new Map<number, number>();
  let totalReal = 0, totalPrep = 0, qReal = 0, qPrep = 0;
  for (const v of result.veiculos) {
    porLoja.set(v.cod_empresa, (porLoja.get(v.cod_empresa) ?? 0) + 1);
    const ehPrep = v.patio.trim().toUpperCase() === "PREPARAÇÃO";
    if (ehPrep) {
      qPrep++;
      totalPrep += v.preco_venda ?? 0;
    } else {
      qReal++;
      totalReal += v.preco_venda ?? 0;
    }
  }

  console.log("\n=== ESTOQUE FINANCEIRO (a partir do parser) ===");
  const fmt = (n: number) => "R$ " + n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  console.log(`Real:      ${qReal} carros — ${fmt(totalReal)}`);
  console.log(`Preparação: ${qPrep} carros — ${fmt(totalPrep)}`);
  console.log(`Total:     ${qReal + qPrep} carros — ${fmt(totalReal + totalPrep)}`);

  console.log("\n=== POR LOJA (com nome do NBS) ===");
  const nomeByCod = new Map(result.lojas.map((l) => [l.cod_empresa, l.nome]));
  for (const [cod, qt] of [...porLoja.entries()].sort((a, b) => b[1] - a[1])) {
    const nome = nomeByCod.get(cod) || "(sem nome no XLSX)";
    console.log(`  Loja ${cod}: ${qt} carros — ${nome}`);
  }

  console.log("\n=== AMOSTRA (3 veículos) ===");
  for (const v of result.veiculos.slice(0, 3)) {
    console.log(JSON.stringify(v, null, 2));
  }

  if (result.warnings.length > 0) {
    console.log(`\n=== ${result.warnings.length} WARNINGS ===`);
    for (const w of result.warnings.slice(0, 10)) console.log(`  - ${w}`);
    if (result.warnings.length > 10) console.log(`  ... +${result.warnings.length - 10}`);
  } else {
    console.log("\nSem warnings.");
  }
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
