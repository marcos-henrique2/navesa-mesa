import type { Connection } from "oracledb";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";

// Relatório NBS fornecido: tipos e VALOR_FINAL, chave completa da origem.
export const FILTRO_CUSTOS_VENDIDOS = `v.STATUS = 'V' AND v.NOVO_USADO = 'U' AND v.CONSIGNATO = 'N'
  AND NVL(v.EXTRA, '.') NOT IN ('0', 'F', 'X')
  AND v.DATA_VENDA >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
  AND v.DATA_VENDA < TO_DATE(:dataFimExclusiva, 'YYYY-MM-DD')`;

export const SQL_CUSTOS_VENDIDOS = `
WITH vendidos AS (
  SELECT v.* FROM NBS.VEICULOS v WHERE ${FILTRO_CUSTOS_VENDIDOS}
), chaves AS (
  SELECT DISTINCT COD_EMPRESA, COD_PRODUTO, COD_MODELO, CHASSI_RESUMIDO FROM vendidos
), custos AS (
  SELECT ce.COD_EMPRESA, ce.COD_PRODUTO, ce.COD_MODELO, ce.CHASSI_RESUMIDO,
    SUM(DECODE(ce.TIPO, 7, NVL(ce.VALOR_FINAL,0), 0)) AS OFICINA,
    SUM(DECODE(ce.TIPO, 8, NVL(ce.VALOR_FINAL,0), 0)) AS ADM,
    SUM(DECODE(ce.TIPO, 9, NVL(ce.VALOR_FINAL,0), 0)) AS GERAIS,
    SUM(DECODE(ce.TIPO, 11, NVL(ce.VALOR_FINAL,0), 0)) AS BONUS,
    SUM(DECODE(ce.TIPO, 12, NVL(ce.VALOR_FINAL,0), 15, NVL(ce.VALOR_FINAL,0), 16, NVL(ce.VALOR_FINAL,0), 0)) AS IMPOSTOS,
    SUM(DECODE(ce.TIPO, 14, NVL(ce.VALOR_FINAL,0), 0)) AS ICMS_FRETE
  FROM NBS.VEICULOS_CUSTOS_ESPECIFICOS ce
  JOIN chaves c ON c.COD_EMPRESA = ce.COD_EMPRESA AND c.COD_PRODUTO = ce.COD_PRODUTO
    AND c.COD_MODELO = ce.COD_MODELO AND c.CHASSI_RESUMIDO = ce.CHASSI_RESUMIDO
  GROUP BY ce.COD_EMPRESA, ce.COD_PRODUTO, ce.COD_MODELO, ce.CHASSI_RESUMIDO
)
SELECT v.PLACA_USADO AS PLACA, v.COD_EMPRESA, v.COD_PRODUTO, v.COD_MODELO, v.CHASSI_RESUMIDO,
  COALESCE(pm.DESCRICAO_MODELO,p.DESCRICAO_PRODUTO) AS MODELO,
  TO_CHAR(v.DATA_FATURAMENTO,'YYYY-MM-DD') AS DATA_FATURA,
  TO_CHAR(v.DATA_VENDA,'YYYY-MM-DD') AS DATA_VENDA,
  TRUNC(v.DATA_VENDA)-TRUNC(v.DATA_FATURAMENTO) AS DIAS_PATIO,
  NVL(v.TOTAL_NOTA_FABRICA,0)+NVL(v.TAXA_ALFANDEGARIA,0)-NVL(v.CREDITO_ICMS,0) AS NOTA_LIQUIDA,
  NVL(c.OFICINA,0) AS OFICINA, NVL(v.FRETE_CUSTO,0)+NVL(c.ICMS_FRETE,0) AS FRETE,
  NVL(v.CUSTO_FORPLAN_FINAL,0) AS FORPLAN, NVL(c.IMPOSTOS,0) AS IMPOSTOS,
  NVL(v.COM_FINAL_GERENTE,0)+NVL(v.COM_FINAL_VENDEDOR,0)+NVL(v.COM_FINAL_TERCEIROS,0) AS COMISSOES,
  NVL(c.BONUS,0) AS BONUS, DECODE(v.INTERNET,'N',0,NVL(v.COMISSAO_VD_BRUTA,0)) AS COMISSAO_VD,
  NVL(c.ADM,0) AS ADM, NVL(c.GERAIS,0) AS GERAIS,
  v.CUSTO_TOTAL_FINAL AS CUSTO_TOTAL,
  v.VALOR_VENDIDO-NVL(v.DESCONTO_INCONDICIONAL,0) AS VALOR_VENDIDO,
  NVL(v.DESAGIO,0) AS DESAGIO,
  v.VALOR_VENDIDO-NVL(v.DESCONTO_INCONDICIONAL,0)-v.CUSTO_TOTAL_FINAL-NVL(v.DESAGIO,0) AS MARGEM_REAL,
  v.MARGEM_FINAL AS MARGEM_PCT
FROM vendidos v
LEFT JOIN custos c ON c.COD_EMPRESA=v.COD_EMPRESA AND c.COD_PRODUTO=v.COD_PRODUTO
  AND c.COD_MODELO=v.COD_MODELO AND c.CHASSI_RESUMIDO=v.CHASSI_RESUMIDO
LEFT JOIN NBS.PRODUTOS p ON p.COD_PRODUTO=v.COD_PRODUTO
LEFT JOIN NBS.PRODUTOS_MODELOS pm ON pm.COD_PRODUTO=v.COD_PRODUTO AND pm.COD_MODELO=v.COD_MODELO
ORDER BY v.DATA_VENDA DESC, v.COD_EMPRESA, v.CHASSI_RESUMIDO
`;

export type OpcoesSyncCustosVendidos = { dataInicio?: string; dataFimExclusiva?: string; agora?: Date };
export type DivergenciaCustoVendido = { placa: string; oficial: number; componentes: number; diferenca: number };
export type ResultadoCustosVendidos = {
  custos: CustoDetalhado[]; contagemOrigem: number; warnings: string[];
  divergencias: DivergenciaCustoVendido[]; totalOficial: number;
  totalComponentes: number; diferencaTotal: number; validoParaGravar: boolean;
  dataInicio: string; dataFimExclusiva: string; parcial: boolean; contagemBloqueadas: number;
};

function centavos(value: unknown, campo: string): number {
  if (value === null || value === undefined || value === "") throw new Error(`${campo} ausente`);
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`${campo} inválido`);
  const result = Math.round((Math.abs(n) + Number.EPSILON * Math.max(1,Math.abs(n))) * 100) * Math.sign(n);
  if (!Number.isSafeInteger(result)) throw new Error(`${campo} excede precisão financeira`);
  return result;
}
function data(value: unknown): Date | null {
  const s = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s < "1900-01-01") return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0,10) !== s ? null : d;
}
export function janelaCustosVendidos(opcoes: OpcoesSyncCustosVendidos = {}): { dataInicio: string; dataFimExclusiva: string } {
  const agora = opcoes.agora ?? new Date();
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
  const base = data(hoje);
  if (!base) throw new Error("Data atual inválida");
  const dataInicio = opcoes.dataInicio ?? new Date(base.getTime()-90*86_400_000).toISOString().slice(0,10);
  const dataFimExclusiva = opcoes.dataFimExclusiva ?? new Date(base.getTime()+86_400_000).toISOString().slice(0,10);
  if (!data(dataInicio) || !data(dataFimExclusiva) || dataInicio >= dataFimExclusiva) throw new Error("Janela de custos vendidos inválida; use datas ISO e fim exclusivo posterior ao início");
  return { dataInicio, dataFimExclusiva };
}

export function mapearCustosVendidos(rows: readonly Record<string, unknown>[]): Omit<ResultadoCustosVendidos, "dataInicio" | "dataFimExclusiva"> {
  const custos: CustoDetalhado[] = [];
  const warnings: string[] = [];
  const divergencias: DivergenciaCustoVendido[] = [];
  const placas = new Set<string>();
  let oficialTotal = 0, componentesTotal = 0, contagemBloqueadas = 0;
  for (const row of rows) {
    const placa = String(row.PLACA ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^[A-Z]{3}\d[A-Z\d]\d{2}$/.test(placa)) { warnings.push("Custo vendido sem placa válida: linha bloqueada"); contagemBloqueadas++; continue; }
    if (placas.has(placa)) { warnings.push(`Placa ${placa} repetida: preservada a venda mais recente`); continue; }
    placas.add(placa);
    try {
      const money = (campo: string) => centavos(row[campo],campo);
      const oficial = money("CUSTO_TOTAL"), nota = money("NOTA_LIQUIDA"), oficina = money("OFICINA");
      const frete = money("FRETE"), forplan = money("FORPLAN"), impostos = money("IMPOSTOS");
      const comissoes = money("COMISSOES"), vd = money("COMISSAO_VD"), bonus = money("BONUS")+vd;
      const adm = money("ADM"), gerais = money("GERAIS");
      const componentes = nota+oficina+frete+forplan+impostos+comissoes+adm+gerais-bonus;
      const dataFatura = data(row.DATA_FATURA), dataVenda = data(row.DATA_VENDA);
      if (!dataVenda) throw new Error("DATA_VENDA inválida");
      const pct = Number(row.MARGEM_PCT);
      if (row.MARGEM_PCT === null || row.MARGEM_PCT === undefined || !Number.isFinite(pct)) throw new Error("MARGEM_PCT ausente ou inválida");
      const dias = Number(row.DIAS_PATIO);
      const custo: CustoDetalhado = {
        placa, modelo: String(row.MODELO ?? "").trim(), data_fatura: dataFatura, data_venda: dataVenda,
        dias_patio: dataFatura && row.DIAS_PATIO !== null && row.DIAS_PATIO !== undefined && Number.isFinite(dias) && dias >= 0 ? Math.trunc(dias) : null,
        nota_fabrica_taxa_icms: nota/100, despesas_oficina: oficina/100, frete_icms_frete: frete/100,
        forplan: forplan/100, impostos: impostos/100, comissoes: comissoes/100,
        ganhos_indiretos: bonus/100, adm: adm/100, despesas_gerais: gerais/100,
        custo_total: oficial/100, valor_vendido: money("VALOR_VENDIDO")/100,
        margem_real: money("MARGEM_REAL")/100, margem_pct: pct,
      };
      if (!custo.modelo) throw new Error("MODELO ausente");
      if (oficial <= 0 || custo.valor_vendido <= 0) throw new Error("Custo total e valor vendido devem ser positivos");
      if (vd !== 0) {
        warnings.push(`Placa ${placa}: comissão VD não zero, relatório usa MAX por produto; linha bloqueada até validar relatório individual`);
        contagemBloqueadas++;
        continue;
      }
      if (money("DESAGIO") !== 0) warnings.push(`Placa ${placa}: margem oficial inclui deságio, preservado na margem`);
      if (componentes !== oficial) {
        divergencias.push({ placa, oficial: oficial/100, componentes: componentes/100, diferenca: (componentes-oficial)/100 });
        contagemBloqueadas++;
        continue;
      }
      custos.push(custo);
      oficialTotal += oficial; componentesTotal += componentes;
    } catch (err) {
      contagemBloqueadas++;
      warnings.push(`Placa ${placa}: ${err instanceof Error ? err.message : String(err)}; linha bloqueada para preservar dados anteriores`);
    }
  }
  if (divergencias.length) warnings.push(`${divergencias.length} custos vendidos divergem dos componentes em R$ 0,01 ou mais; linhas bloqueadas; preservados valores anteriores`);
  return { custos, warnings, divergencias, contagemOrigem: rows.length, totalOficial: oficialTotal/100,
    totalComponentes: componentesTotal/100, diferencaTotal: (componentesTotal-oficialTotal)/100, validoParaGravar: custos.length > 0,
    parcial: contagemBloqueadas > 0, contagemBloqueadas };
}

export function custoVendidoToRow(c: CustoDetalhado): Record<string, unknown> {
  return { ...c, data_fatura: c.data_fatura ? `${c.data_fatura.toISOString().slice(0,10)}T00:00:00-03:00` : null, data_venda: c.data_venda ? `${c.data_venda.toISOString().slice(0,10)}T00:00:00-03:00` : null };
}
export async function syncCustosVendidos(conn: Connection, opcoes: OpcoesSyncCustosVendidos = {}): Promise<ResultadoCustosVendidos> {
  const janela = janelaCustosVendidos(opcoes);
  const result = await conn.execute(SQL_CUSTOS_VENDIDOS, janela);
  const rows = (result.rows ?? []) as Record<string, unknown>[];
  return { ...mapearCustosVendidos(rows), ...janela };
}
