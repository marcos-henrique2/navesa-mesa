import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Connection } from "oracledb";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";
import { syncCustosVendidos, custoVendidoToRow } from "./sync-custos-vendidos";

export function lerOpcoesCustos(args: string[]): { somenteCustos: boolean; dryRun: boolean; dataInicio?: string } {
  const permitidos = ["--somente-custos", "--dry-run"];
  for (const arg of args) {
    if (!permitidos.includes(arg) && !arg.startsWith("--custos-desde=")) throw new Error(`Argumento desconhecido: ${arg}`);
  }
  const datas = args.filter((arg) => arg.startsWith("--custos-desde="));
  if (datas.length > 1) throw new Error("Informe --custos-desde apenas uma vez.");
  const dataInicio = datas[0]?.slice("--custos-desde=".length);
  if (dataInicio !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio) || !Number.isFinite(Date.parse(dataInicio)) || new Date(dataInicio).toISOString().slice(0, 10) !== dataInicio)) {
    throw new Error("--custos-desde exige uma data válida no formato YYYY-MM-DD.");
  }
  const somenteCustos = args.includes("--somente-custos");
  const dryRun = args.includes("--dry-run");
  if (dryRun && !somenteCustos) throw new Error("Use --dry-run com --somente-custos para garantir uma execução apenas de leitura.");
  return { somenteCustos, dryRun, dataInicio };
}

export async function gravarCustosVendidosNode(sb: SupabaseClient, custos: CustoDetalhado[]): Promise<number> {
  if (custos.length === 0) return 0;
  const porPlaca = new Map<string, CustoDetalhado>();
  for (const custo of custos) {
    if (!/^[A-Z]{3}\d[A-Z\d]\d{2}$/.test(custo.placa)) throw new Error(`Placa inválida em custos vendidos: ${custo.placa}`);
    if (!Number.isFinite(custo.custo_total) || custo.custo_total <= 0 || !Number.isFinite(custo.valor_vendido) || custo.valor_vendido <= 0) throw new Error("Custo ou venda zerado/inválido: gravação bloqueada.");
    const anterior = porPlaca.get(custo.placa);
    if (!anterior || (custo.data_venda?.getTime() ?? 0) >= (anterior.data_venda?.getTime() ?? 0)) porPlaca.set(custo.placa, custo);
  }
  const rows = [...porPlaca.values()].map(custoVendidoToRow);
  for (let inicio = 0; inicio < rows.length; inicio += 500) {
    const lote = rows.slice(inicio, inicio + 500);
    const { data, error } = await sb.from("custos_detalhados").upsert(lote, { onConflict: "placa" }).select("placa");
    if (error) throw new Error(`gravarCustosVendidosNode: ${error.message}`);
    if (data?.length !== lote.length) throw new Error("Supabase não confirmou todas as placas gravadas no lote de custos.");
  }
  return rows.length;
}

export async function executarCustosVendidos(conn: Connection, opcoes: { dryRun: boolean; dataInicio?: string }): Promise<void> {
  const iniciado = new Date();
  const disponivel = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const sb = disponivel && !opcoes.dryRun ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) : null;
  let linhasLidas: number | null = null;
  let linhasGravadas: number | null = null;
  const registrar = async (status: "sucesso" | "erro" | "parcial", erro: string | null) => {
    if (!sb) return;
    const finalizado = new Date();
    const { error } = await sb.from("sync_log").insert({ fonte: "custos", iniciado_em: iniciado.toISOString(), finalizado_em: finalizado.toISOString(), status, linhas_lidas: linhasLidas, linhas_gravadas: linhasGravadas, erro_mensagem: erro, duracao_ms: finalizado.getTime() - iniciado.getTime() });
    if (error) throw new Error(`Não foi possível registrar sync_log[custos]: ${error.message}`);
  };
  console.log("\n--- CUSTOS VENDIDOS (relatório oficial NBS) ---");
  try {
    const resultado = await syncCustosVendidos(conn, { dataInicio: opcoes.dataInicio });
    linhasLidas = resultado.contagemOrigem;
    console.log(JSON.stringify({ periodo: [resultado.dataInicio, resultado.dataFimExclusiva], linhas_lidas: linhasLidas, custos: resultado.custos.length, total_oficial: resultado.totalOficial, total_componentes: resultado.totalComponentes, divergencias: resultado.divergencias.length, valido: resultado.validoParaGravar }));
    for (const aviso of resultado.warnings) console.warn(`  ${aviso}`);
    if (resultado.divergencias.length) console.warn(JSON.stringify({placas_preservadas: resultado.divergencias}));
    if (!resultado.validoParaGravar) throw new Error("Custos vendidos não passaram na reconciliação com o NBS; dados existentes preservados.");
    if (sb) {
      linhasGravadas = await gravarCustosVendidosNode(sb, resultado.custos);
      await registrar(resultado.parcial ? "parcial" : "sucesso", resultado.parcial ? `${resultado.contagemBloqueadas} placas bloqueadas por divergência ou dados inválidos; registros anteriores preservados.` : null);
      console.log(`Custos vendidos atualizados: ${linhasGravadas} placas; ${resultado.contagemBloqueadas} bloqueadas e preservadas.`);
    } else {
      console.log(opcoes.dryRun ? "Somente leitura: nenhum dado ou log foi gravado." : "SUPABASE não configurado: nenhum custo foi gravado.");
    }
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await registrar("erro", mensagem);
    throw erro;
  }
}