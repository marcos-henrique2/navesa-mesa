/**
 * Backfill ÚNICO de `vendas.cliente_tipo` (PF/PJ) desde 2026-01-01.
 *
 * Por que existe: o sync antigo deduzia o tipo só pelo tamanho de
 * COD_CLIENTE (NUMBER, perde zeros à esquerda) e deixou ~1.250 vendas NULL.
 * O sync corrigido (NBS.CLIENTES.COD_CLASSE, ver resolverTipoCliente em
 * mapear-venda.ts) só relê 90 dias, e reprocessar o resto pelo pipeline
 * inteiro sobrescreveria dados do upload XLSX (margem, custo, pátio...).
 * Este script mexe SÓ em `cliente_tipo`:
 *
 * - lê do Oracle chassi + COD_CLIENTE + COD_CLASSE (mesmo filtro/JOIN do
 *   sync, ver lerTipoClienteVendas em sync-vendas.ts);
 * - UPDATE por chassi (nunca upsert/insert) apenas onde o valor muda, apenas
 *   em chassis que já existem em `vendas`;
 * - DRY-RUN por padrão. Grava só com `--escrever`.
 *
 * Uso (raiz do projeto, .env.nbs-sync.local com Oracle + Supabase):
 *   npx tsx scripts/sync-nbs/backfill-cliente-tipo.ts             # dry-run
 *   npx tsx scripts/sync-nbs/backfill-cliente-tipo.ts --escrever  # grava
 *
 * Não imprime nome/CPF/CNPJ — só contagens e, em falhas, o chassi.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chunk } from "../../src/lib/data/supabase";
import { abrirConexaoOracle } from "./conexao-oracle";
import { lerTipoClienteVendas } from "./sync-vendas";
import { mapearVenda } from "./mapear-venda";
import {
  decidirBackfillClienteTipo,
  lerOpcoesBackfill,
  type LinhaSupabaseTipo,
  type TipoCliente,
  type VendaOracleTipo,
} from "./decidir-backfill-cliente-tipo";

const DESDE = "2026-01-01";
const CONCORRENCIA = 20;

async function lerTiposSupabase(sb: SupabaseClient): Promise<Map<string, LinhaSupabaseTipo>> {
  const mapa = new Map<string, LinhaSupabaseTipo>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("vendas").select("chassi,cliente_tipo,cliente_codigo").order("chassi").range(from, from + 999);
    if (error) throw new Error(`Leitura de vendas no Supabase: ${error.message}`);
    for (const r of data ?? []) {
      mapa.set(String(r.chassi), {
        tipo: (r.cliente_tipo as TipoCliente) ?? null,
        clienteCodigo: r.cliente_codigo === null || r.cliente_codigo === undefined ? null : String(r.cliente_codigo),
      });
    }
    if (!data || data.length < 1000) break;
  }
  return mapa;
}

async function contarNulos2026(sb: SupabaseClient): Promise<number> {
  const { count, error } = await sb
    .from("vendas")
    .select("chassi", { count: "exact", head: true })
    .is("cliente_tipo", null)
    .gte("data_venda", `${DESDE}T00:00:00-03:00`);
  if (error) throw new Error(`Contagem de NULL no Supabase: ${error.message}`);
  return count ?? 0;
}

async function main() {
  const { escrever } = lerOpcoesBackfill(process.argv.slice(2));
  console.log(`=== Backfill vendas.cliente_tipo desde ${DESDE} — ${escrever ? "ESCRITA" : "DRY-RUN (só leitura)"} ===\n`);

  const conn = await abrirConexaoOracle();
  let oracle: VendaOracleTipo[];
  try {
    const rows = await lerTipoClienteVendas(conn, DESDE);
    // Mesmo mapeamento do sync (chassi via CANDIDATOS, tipo via
    // resolverTipoCliente) — não duplica regra.
    oracle = rows.map((r) => {
      const { venda } = mapearVenda(r);
      return { chassi: venda.chassi, tipo: venda.cliente_tipo, clienteCodigo: venda.cliente_codigo };
    });
  } finally {
    await conn.close();
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes em .env.nbs-sync.local.");
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { updates, contagens } = decidirBackfillClienteTipo(oracle, await lerTiposSupabase(sb));
  console.log("Contagens:", JSON.stringify(contagens, null, 2));
  console.log(`Updates necessários: ${updates.length}`);
  console.log(`cliente_tipo NULL em vendas desde ${DESDE} (antes): ${await contarNulos2026(sb)}`);

  if (!escrever) {
    console.log("\nDRY-RUN: nada foi gravado. Rode com --escrever para aplicar.");
    return;
  }

  let atualizados = 0;
  const semCorrespondencia: string[] = [];
  const falhas: { chassi: string; erro: string }[] = [];
  for (const lote of chunk(updates, CONCORRENCIA)) {
    const resultados = await Promise.all(
      lote.map(async (u) => {
        try {
          const { data, error } = await sb.from("vendas").update({ cliente_tipo: u.cliente_tipo }).eq("chassi", u.chassi).select("chassi");
          if (error) throw new Error(error.message);
          return { chassi: u.chassi, atualizou: (data?.length ?? 0) > 0, erro: null as string | null };
        } catch (err) {
          return { chassi: u.chassi, atualizou: false, erro: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    for (const r of resultados) {
      if (r.erro) falhas.push({ chassi: r.chassi, erro: r.erro });
      else if (r.atualizou) atualizados++;
      else semCorrespondencia.push(r.chassi);
    }
  }

  console.log(`\nAtualizados: ${atualizados}`);
  if (semCorrespondencia.length) console.log(`Sem correspondência (chassi sumiu entre leitura e escrita): ${semCorrespondencia.join(", ")}`);
  if (falhas.length) {
    console.log(`Falhas: ${falhas.length}`);
    for (const f of falhas) console.log(`  ${f.chassi}: ${f.erro}`);
  }
  console.log(`cliente_tipo NULL em vendas desde ${DESDE} (depois): ${await contarNulos2026(sb)}`);
  if (falhas.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
