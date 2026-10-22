import { createClient } from "@supabase/supabase-js";
import type { Connection } from "oracledb";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import { getReferenciaAtual, __setFipeCacheStorage, type CacheStorageLike } from "@/lib/fipe/service";
import { runFipeBatch, filtrarVeiculosPendentesFipe, type FipeBatchStatusRow } from "@/lib/fipe/batch";
import { selectAll } from "@/lib/data/supabase";
import { executarCustosVendidos, lerOpcoesCustos } from "./executar-custos-vendidos";
import { abrirConexaoOracle, modoThinAtivo } from "./conexao-oracle";
import { syncVeiculos } from "./sync-veiculos";
import { syncVendas } from "./sync-vendas";
import { gravarVeiculosNode, gravarVendasNode, removerVendasFantasma } from "./gravar";
import {
  processarMarkupOficialEstoque,
  gravarMarkupPilotoDebug,
  markupPilotoAtivado,
  construirRegistroDebug,
} from "./calcular-markup-estoque";

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

/**
 * Cache HTTP do FIPE em memória, só pra rodar dentro deste processo Node.
 *
 * `src/lib/fipe/service.ts` usa `window.localStorage` como cache; em Node
 * `typeof window === "undefined"` faz `cacheGet`/`cacheSet` virarem no-op
 * silencioso. Sem isso, toda chamada do batch bate direto na API gratuita da
 * FIPE — inclusive `getModelos` repetido pra cada grupo que compartilha marca
 * na MESMA rodada (risco real de 429 com estoque grande). Só precisa viver
 * durante a rodada: a referência FIPE não muda no intervalo de 2h entre
 * execuções do script, e cada execução é um processo novo.
 */
class FipeCacheEmMemoria implements CacheStorageLike {
  private readonly dados = new Map<string, string>();
  getItem(key: string): string | null {
    return this.dados.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.dados.set(key, value);
  }
  removeItem(key: string): void {
    this.dados.delete(key);
  }
  key(index: number): string | null {
    return Array.from(this.dados.keys())[index] ?? null;
  }
  get length(): number {
    return this.dados.size;
  }
}

async function gravarSyncLog(fonte: "veiculos" | "vendas" | "fipe" | "markup_piloto", linha: {
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

/**
 * Bloco MARKUP OFICIAL extraído pra função própria — reusado tanto no fluxo
 * completo (atrás da flag --markup-piloto) quanto no modo isolado
 * (--somente-markup-piloto), que pula VEÍCULOS/VENDAS/CUSTOS/FIPE pra não
 * precisar esperar o sync inteiro só pra testar esta parte. Ver
 * docs/sync-custos-markup-acesso.md, mapear-markup-oficial.ts e
 * calcular-markup-estoque.ts.
 *
 * ESCALADO em 22/10/2026 (piloto validado em 4 carros, batendo ao centavo):
 * sem `--markup-piloto-limite=N`, processa TODO o estoque do filtro (não só
 * 1 carro) e GRAVA de verdade as 8 categorias oficiais + custo_total no
 * snapshot desta rodada (`snapshotId`), quando a reconciliação confirmar o
 * valor (ver processarMarkupOficialEstoque). Continua atrás da flag
 * `--markup-piloto` — decisão deliberada (risco financeiro alto, ~1089
 * veículos): NÃO foi ligado por padrão no ciclo automático de 2h só porque
 * esta rodada escalou; Marcos decide quando ativar em produção.
 *
 * `snapshotId` null (bloco VEÍCULOS falhou ou filtro não plausível nesta
 * rodada, ou modo `--somente-markup-piloto` que nunca roda VEÍCULOS) faz a
 * gravação real ser pulada inteiramente — processarMarkupOficialEstoque só
 * lê/diagnostica (ver aviso que ele mesmo gera nesse caso).
 *
 * Gravação em `markup_piloto_debug` (jsonb bruto, só inspeção manual) agora
 * só acontece no modo `placaAlvo` (debug de 1 carro específico) — decisão
 * de 22/10/2026: gravar 1 linha de debug por veículo em TODA rodada de
 * ~1089 carros faria a tabela crescer sem limite (ela nunca é podada); o
 * resumo em `sync_log` + as próprias colunas gravadas em `veiculos` já são o
 * rastro de auditoria da rodada em escala.
 */
async function executarBlocoMarkupPiloto(
  conn: Connection,
  placaAlvo?: string,
  snapshotId?: number | null,
  limite?: number,
): Promise<void> {
  console.log("\n--- MARKUP OFICIAL (NBS.PKG_MARKUP_VEIC.CALCULAR_MARKUP_ESTOQUE) ---");
  if (placaAlvo) console.log(`Mirando placa específica: ${placaAlvo} (ignora limite).`);
  else console.log(limite != null ? `Limite manual: ${limite} veículo(s) (rollout gradual).` : "Processando TODO o estoque do filtro (sem limite).");
  if (!placaAlvo && snapshotId == null) {
    console.warn(
      "  (aviso) snapshot de veículos desta rodada indisponível (bloco VEÍCULOS falhou/filtro não plausível, " +
        "ou modo --somente-markup-piloto) — gravação real será pulada, só leitura/diagnóstico.",
    );
  }
  const inicioMarkupPiloto = new Date();
  let linhasGravadasMarkupPiloto: number | null = null;
  try {
    const sbEscrita = supabaseDisponivel() ? criarClienteSupabaseServiceRole() : null;
    const resumo = await processarMarkupOficialEstoque(conn, sbEscrita, snapshotId ?? null, { placaAlvo, limite });

    console.log(
      JSON.stringify({
        candidatos: resumo.candidatosAvaliados,
        sucesso_oracle: resumo.sucessosOracle,
        falha_oracle: resumo.falhasOracle,
        divergentes: resumo.divergentes,
        gravados: resumo.gravados,
        sem_chassi: resumo.semChassiParaGravar,
        sem_correspondencia_no_snapshot: resumo.semCorrespondenciaNoSnapshot,
        falha_gravacao: resumo.falhasGravacao.length,
      }),
    );
    for (const aviso of resumo.avisos) console.warn(`  ${aviso}`);

    // Debug bruto (jsonb) só no modo 1-carro — ver nota no topo da função.
    if (sbEscrita && placaAlvo && resumo.sucessos.length > 0) {
      const registros = resumo.sucessos.map((s) =>
        construirRegistroDebug(s.candidato, s.linhas, s.resultado, s.parametrosFinais),
      );
      await gravarMarkupPilotoDebug(sbEscrita, registros);
      console.log(`Debug bruto: ${registros.length} registro(s) em markup_piloto_debug.`);
    }

    linhasGravadasMarkupPiloto = resumo.gravados;
    const fimMarkupPiloto = new Date();
    await gravarSyncLog("markup_piloto", {
      iniciado_em: inicioMarkupPiloto,
      finalizado_em: fimMarkupPiloto,
      status: resumo.falhasOracle > 0 && resumo.sucessosOracle === 0 ? "erro" : "sucesso",
      linhas_lidas: resumo.candidatosAvaliados,
      linhas_gravadas: linhasGravadasMarkupPiloto,
      erro_mensagem: resumo.avisos.length > 0 ? resumo.avisos.slice(0, 20).join("; ") : null,
    });
  } catch (err) {
    const fimMarkupPiloto = new Date();
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`ERRO no bloco MARKUP OFICIAL: ${msg}`);
    await gravarSyncLog("markup_piloto", {
      iniciado_em: inicioMarkupPiloto,
      finalizado_em: fimMarkupPiloto,
      status: "erro",
      linhas_lidas: null,
      linhas_gravadas: linhasGravadasMarkupPiloto,
      erro_mensagem: msg,
    });
  }
}

async function main() {
  const opcoesCustos = lerOpcoesCustos(process.argv.slice(2));
  console.log("=== Sync NBS (Oracle) -> Supabase ===\n");

  const conn = await abrirConexaoOracle();
  console.log(`Conectado ao Oracle. Modo: ${modoThinAtivo() ? "THIN" : "THICK"}.\n`);

  // Chassis em estoque HOJE (filtro validado, ver FILTRO_ESTOQUE em
  // sync-veiculos.ts — recall 98,7% / precisão 99,9%), preenchido no bloco de
  // VEÍCULOS abaixo e reusado no bloco de VENDAS pra limpar vendas fantasma.
  let chassisEmEstoqueAtual: string[] = [];
  // Veículos em estoque mapeados (mesmo filtro acima), reusados no bloco FIPE
  // pra não reconsultar o Supabase — já estão em memória.
  let veiculosEmEstoqueAtual: VeiculoParsed[] = [];
  let filtroVeiculosPlausivel = false;
  // snapshot_id criado pelo bloco VEÍCULOS desta rodada — o bloco MARKUP
  // OFICIAL grava em cima dele (ver executarBlocoMarkupPiloto). null quando
  // a gravação de veículos não rodou (SUPABASE indisponível, filtro não
  // plausível, ou o bloco falhou) — nesse caso o markup fica só leitura.
  let snapshotIdAtual: number | null = null;

  try {
    if (opcoesCustos.somenteCustos) {
      await executarCustosVendidos(conn, opcoesCustos);
      return;
    }
    if (opcoesCustos.somenteMarkupPiloto) {
      // --somente-markup-piloto nunca roda o bloco VEÍCULOS -> não há
      // snapshot desta rodada pra gravar em cima; passa null de propósito
      // (ver aviso em executarBlocoMarkupPiloto) — modo fica só leitura/
      // diagnóstico, igual já era antes de escalar.
      await executarBlocoMarkupPiloto(conn, opcoesCustos.placaAlvo, null, opcoesCustos.markupPilotoLimite);
      return;
    }
    // ─── VEÍCULOS ─────────────────────────────────────────────────────────
    console.log("--- VEÍCULOS ---");
    const inicioVeiculos = new Date();
    let linhasGravadasVeiculos: number | null = null;
    try {
      const resultadoVeiculos = await syncVeiculos(conn);

      console.log(`Contagem filtro "em estoque" (DATA_VENDA NULL/sentinela): ${resultadoVeiculos.contagemFiltroEstoque}`);
      console.log(`Filtro plausível (esperado ~900-1.300): ${resultadoVeiculos.filtroPlausivel ? "SIM" : "NÃO"}`);
      console.log(`Veículos mapeados: ${resultadoVeiculos.veiculos.length}`);
      console.log(`Tempo da query de valoriza/bônus (NBS.VEICULOS_CUSTOS_ESPECIFICOS, sem JOIN): ${resultadoVeiculos.tempoMsMapaValoriza}ms`);
      console.log(`Tempo das 6 queries sequenciais de custos detalhados: ${resultadoVeiculos.tempoMsCustosDetalhados}ms`);
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
        veiculosEmEstoqueAtual = resultadoVeiculos.veiculos;
        filtroVeiculosPlausivel = true;
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
        snapshotIdAtual = gravacao.snapshotId;
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
      console.log(`Tempo da query de valoriza/bônus (NBS.VEICULOS_CUSTOS_ESPECIFICOS, sem JOIN): ${resultadoVendas.tempoMsMapaValoriza}ms`);

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

    await executarCustosVendidos(conn, opcoesCustos);

    // ─── MARKUP PILOTO (opcional, flag --markup-piloto) ──────────────────────
    // SEM a flag, este bloco não roda — o ciclo automático de 2h continua
    // exatamente igual a hoje. Ver scripts/sync-nbs/calcular-markup-estoque.ts
    // e docs/sync-custos-markup-acesso.md pro contexto completo (piloto de
    // 1 carro, chamada real a NBS.PKG_MARKUP_VEIC.CALCULAR_MARKUP_ESTOQUE).
    if (markupPilotoAtivado(process.argv.slice(2))) {
      await executarBlocoMarkupPiloto(conn, opcoesCustos.placaAlvo, snapshotIdAtual, opcoesCustos.markupPilotoLimite);
    }

    // ─── FIPE ───────────────────────────────────────────────────────────────
    console.log("\n--- FIPE ---");
    const inicioFipe = new Date();
    let linhasGravadasFipe: number | null = null;
    if (supabaseDisponivel() && filtroVeiculosPlausivel) {
      try {
        const sbEscrita = criarClienteSupabaseServiceRole();

        // Restaura cache HTTP (inexistente por padrão em Node) pelo menos
        // DENTRO desta rodada — ver `FipeCacheEmMemoria` acima.
        __setFipeCacheStorage(new FipeCacheEmMemoria());

        // Preço FIPE só muda uma vez por mês — rodar o batch inteiro pra todo
        // o estoque a cada 2h é desperdício e martela a API gratuita sem
        // necessidade. Descobre a referência corrente primeiro e pula quem já
        // está confirmado NELA (já rodou com sucesso este mês); carros nunca
        // tentados, de mês anterior, que falharam na plausibilidade ou com
        // score baixo (match de modelo não confiável, mesmo com preço
        // plausível) entram de novo (o matcher pode ter melhorado ou o custo
        // pode ter sido corrigido).
        const ref = await getReferenciaAtual();
        console.log(`Referência FIPE corrente: ${ref.mes} (cod ${ref.codigo}).`);

        const batchExistente = await selectAll<FipeBatchStatusRow>(sbEscrita, "fipe_batch", { orderBy: "chassi" });
        const veiculosPendentes = filtrarVeiculosPendentesFipe(veiculosEmEstoqueAtual, batchExistente, ref.codigo);
        const confirmados = veiculosEmEstoqueAtual.length - veiculosPendentes.length;
        console.log(
          `${veiculosEmEstoqueAtual.length} veículo(s) em estoque, ${confirmados} já confirmado(s) ` +
            `nesta referência, ${veiculosPendentes.length} a processar.`,
        );

        const resultado = await runFipeBatch(
          veiculosPendentes,
          (p) => console.log(`  [FIPE ${p.fase}] ${p.atual}/${p.total} — ${p.mensagem}`),
          sbEscrita,
        );
        linhasGravadasFipe = Object.keys(resultado.items).length;
        console.log(`FIPE: ${linhasGravadasFipe} carro(s) com match, ${resultado.erros.length} erro(s)/pendência(s).`);

        const fimFipe = new Date();
        await gravarSyncLog("fipe", {
          iniciado_em: inicioFipe,
          finalizado_em: fimFipe,
          status: resultado.persistenciaErro ? "erro" : "sucesso",
          linhas_lidas: veiculosPendentes.length,
          linhas_gravadas: linhasGravadasFipe,
          erro_mensagem: resultado.persistenciaErro,
        });
      } catch (err) {
        const fimFipe = new Date();
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`ERRO no bloco FIPE: ${msg}`);
        await gravarSyncLog("fipe", {
          iniciado_em: inicioFipe,
          finalizado_em: fimFipe,
          status: "erro",
          linhas_lidas: null,
          linhas_gravadas: linhasGravadasFipe,
          erro_mensagem: msg,
        });
      }
    } else {
      console.log(
        supabaseDisponivel()
          ? "Filtro de veículos fora da faixa plausível — bloco FIPE pulado (não processa estoque suspeito)."
          : "(pendência) SUPABASE não configurado — bloco FIPE pulado.",
      );
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
