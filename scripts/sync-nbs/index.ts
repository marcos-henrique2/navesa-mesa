import { createClient } from "@supabase/supabase-js";
import { abrirConexaoOracle, modoThinAtivo } from "./conexao-oracle";
import { syncVeiculos } from "./sync-veiculos";
import { syncVendas } from "./sync-vendas";
import { gravarVeiculosNode, gravarVendasNode, removerVendasFantasma } from "./gravar";

/**
 * Orquestrador da sincronização NBS (Oracle) → Supabase.
 *
 * Conecta no Oracle, roda as queries validadas, mapeia pros tipos
 * VeiculoParsed/VendaParsed, imprime resumo + amostra, e GRAVA de verdade
 * (veículos vira um novo snapshot completo em `estoque_snapshots`/`veiculos`,
 * vendas é upsert idempotente por chassi em `vendas`) sempre que
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY estiverem configurados em
 * .env.nbs-sync.local. Sem essas credenciais, roda só como leitura (mesmo
 * comportamento de antes) e reporta a pendência no console — não trava.
 */

function supabaseDisponivel(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function criarClienteSupabaseServiceRole() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

async function gravarSyncLog(fonte: "veiculos" | "vendas", linha: {
  iniciado_em: Date;
  finalizado_em: Date;
  status: "sucesso" | "erro";
  linhas_lidas: number | null;
  linhas_gravadas: number | null;
  erro_mensagem: string | null;
}): Promise<void> {
  if (!supabaseDisponivel()) return;

  const sb = criarClienteSupabaseServiceRole();

  const duracao_ms = linha.finalizado_em.getTime() - linha.iniciado_em.getTime();

  const { error } = await sb.from("sync_log").insert({
    fonte,
    iniciado_em: linha.iniciado_em.toISOString(),
    finalizado_em: linha.finalizado_em.toISOString(),
    status: linha.status,
    linhas_lidas: linha.linhas_lidas,
    linhas_gravadas: linha.linhas_gravadas,
    erro_mensagem: linha.erro_mensagem,
    duracao_ms,
  });

  if (error) {
    console.warn(`  (aviso) falha ao gravar sync_log[${fonte}]: ${error.message}`);
  } else {
    console.log(`  sync_log[${fonte}] gravado (status=${linha.status}).`);
  }
}

async function main() {
  console.log("=== Sync NBS (Oracle) -> Supabase ===\n");

  const conn = await abrirConexaoOracle();
  console.log(`Conectado ao Oracle. Modo: ${modoThinAtivo() ? "THIN" : "THICK"}.\n`);

  // Chassis em estoque HOJE (filtro validado, ver FILTRO_ESTOQUE em
  // sync-veiculos.ts — recall 98,7% / precisão 99,9%), preenchido no bloco de
  // VEÍCULOS abaixo e reusado no bloco de VENDAS pra limpar vendas fantasma.
  let chassisEmEstoqueAtual: string[] = [];

  try {
    // ─── VEÍCULOS ─────────────────────────────────────────────────────────
    console.log("--- VEÍCULOS ---");
    const inicioVeiculos = new Date();
    let linhasGravadasVeiculos: number | null = null;
    try {
      const resultadoVeiculos = await syncVeiculos(conn);

      console.log(`Contagem filtro "em estoque" (DATA_VENDA NULL/sentinela): ${resultadoVeiculos.contagemFiltroEstoque}`);
      console.log(`Filtro plausível (esperado ~900-1.300): ${resultadoVeiculos.filtroPlausivel ? "SIM" : "NÃO"}`);
      console.log(`Veículos mapeados: ${resultadoVeiculos.veiculos.length}`);
      console.log(`Tabelas candidatas a lookup de cor/combustível: ${resultadoVeiculos.lookupsEncontrados.tabelasCombustivelOuCor.join(", ") || "(nenhuma encontrada)"}`);
      console.log(`NBS.PRODUTOS_MODELOS existe: ${resultadoVeiculos.lookupsEncontrados.produtosModelosExiste ? "SIM" : "NÃO"}`);

      if (resultadoVeiculos.warnings.length > 0) {
        console.log(`\n${resultadoVeiculos.warnings.length} warning(s):`);
        for (const w of resultadoVeiculos.warnings) console.log(`  - ${w}`);
      }

      if (resultadoVeiculos.amostra.length > 0) {
        console.log(`\nAmostra (${resultadoVeiculos.amostra.length} de ${resultadoVeiculos.veiculos.length}):`);
        console.log(JSON.stringify(resultadoVeiculos.amostra, null, 2));
      }

      if (resultadoVeiculos.filtroPlausivel) {
        chassisEmEstoqueAtual = resultadoVeiculos.veiculos.map((v) => v.chassi);
      }

      if (supabaseDisponivel() && resultadoVeiculos.filtroPlausivel && resultadoVeiculos.veiculos.length > 0) {
        const sbEscrita = criarClienteSupabaseServiceRole();
        const totalLojas = new Set(resultadoVeiculos.veiculos.map((v) => v.cod_empresa)).size;
        const gravacao = await gravarVeiculosNode(sbEscrita, resultadoVeiculos.veiculos, {
          arquivo_nome: `sync-oracle-${new Date().toISOString()}`,
          data_geracao: new Date(),
          total_veiculos: resultadoVeiculos.veiculos.length,
          total_lojas: totalLojas,
        });
        linhasGravadasVeiculos = gravacao.inseridos;
        console.log(`\nGravação real: snapshot ${gravacao.snapshotId} criado, ${gravacao.inseridos} veículo(s) inserido(s).`);
      }

      const fimVeiculos = new Date();
      await gravarSyncLog("veiculos", {
        iniciado_em: inicioVeiculos,
        finalizado_em: fimVeiculos,
        status: "sucesso",
        linhas_lidas: resultadoVeiculos.contagemFiltroEstoque,
        linhas_gravadas: linhasGravadasVeiculos,
        erro_mensagem: resultadoVeiculos.filtroPlausivel ? null : "Filtro fora da faixa plausível — ver warnings.",
      });
    } catch (err) {
      const fimVeiculos = new Date();
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`ERRO em syncVeiculos: ${msg}`);
      await gravarSyncLog("veiculos", {
        iniciado_em: inicioVeiculos,
        finalizado_em: fimVeiculos,
        status: "erro",
        linhas_lidas: null,
        linhas_gravadas: linhasGravadasVeiculos,
        erro_mensagem: msg,
      });
    }

    // ─── VENDAS ───────────────────────────────────────────────────────────
    console.log("\n--- VENDAS (últimos 90 dias) ---");
    const inicioVendas = new Date();
    let linhasGravadasVendas: number | null = null;
    try {
      const resultadoVendas = await syncVendas(conn);

      console.log(`Contagem janela 90 dias: ${resultadoVendas.contagemJanela}`);
      console.log(`Filtro plausível (esperado ~500-1.500): ${resultadoVendas.filtroPlausivel ? "SIM" : "NÃO"}`);
      console.log(`Vendas mapeadas: ${resultadoVendas.vendas.length}`);

      if (resultadoVendas.warnings.length > 0) {
        console.log(`\n${resultadoVendas.warnings.length} warning(s):`);
        for (const w of resultadoVendas.warnings) console.log(`  - ${w}`);
      }

      if (resultadoVendas.amostra.length > 0) {
        console.log(`\nAmostra (${resultadoVendas.amostra.length} de ${resultadoVendas.vendas.length}):`);
        console.log(JSON.stringify(resultadoVendas.amostra, null, 2));
      }

      if (supabaseDisponivel() && resultadoVendas.filtroPlausivel && resultadoVendas.vendas.length > 0) {
        const sbEscrita = criarClienteSupabaseServiceRole();
        const gravacao = await gravarVendasNode(sbEscrita, resultadoVendas.vendas);
        linhasGravadasVendas = gravacao.total;
        console.log(
          `\nGravação real: ${gravacao.total} venda(s) gravada(s) (upsert por chassi)` +
            (gravacao.duplicatasIgnoradas > 0 ? `, ${gravacao.duplicatasIgnoradas} duplicata(s) de chassi ignorada(s).` : "."),
        );
      }

      // Limpeza de vendas fantasma: qualquer chassi que esteja em `vendas`
      // mas que HOJE está em estoque (chassisEmEstoqueAtual, calculado no
      // bloco de VEÍCULOS acima) é um upsert antigo que nunca foi desfeito —
      // o sync normal só faz UPSERT em `vendas` (nunca DELETE), então quando
      // uma venda é desfeita no NBS (devolução, financiamento caiu, troca
      // reentra como usado etc) e o chassi volta pro estoque, o registro
      // antigo em `vendas` fica órfão pra sempre se ninguém remover. Ver
      // removerVendasFantasma() em gravar.ts.
      if (supabaseDisponivel() && chassisEmEstoqueAtual.length > 0) {
        const sbEscrita = criarClienteSupabaseServiceRole();
        const remocao = await removerVendasFantasma(sbEscrita, chassisEmEstoqueAtual);
        console.log(
          `\nLimpeza de vendas fantasma: ${remocao.removidos} chassi(s) removido(s) de \`vendas\` ` +
            `por estarem em estoque hoje (de ${chassisEmEstoqueAtual.length} chassi(s) em estoque verificados).`,
        );
      }

      const fimVendas = new Date();
      await gravarSyncLog("vendas", {
        iniciado_em: inicioVendas,
        finalizado_em: fimVendas,
        status: "sucesso",
        linhas_lidas: resultadoVendas.contagemJanela,
        linhas_gravadas: linhasGravadasVendas,
        erro_mensagem: resultadoVendas.filtroPlausivel ? null : "Filtro fora da faixa plausível — ver warnings.",
      });
    } catch (err) {
      const fimVendas = new Date();
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`ERRO em syncVendas: ${msg}`);
      await gravarSyncLog("vendas", {
        iniciado_em: inicioVendas,
        finalizado_em: fimVendas,
        status: "erro",
        linhas_lidas: null,
        linhas_gravadas: linhasGravadasVendas,
        erro_mensagem: msg,
      });
    }

    if (!supabaseDisponivel()) {
      console.log(
        "\n(pendência) SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados em .env.nbs-sync.local — " +
          "sync_log e a gravação real de veículos/vendas NÃO rodaram nesta rodada (só leitura do Oracle).",
      );
    }
  } finally {
    await conn.close();
  }

  console.log("\n=== Fim. ===");
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
