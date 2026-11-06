/**
 * Utilitários comuns das tools (puros, sem I/O).
 */
import { z } from "zod";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { Snapshot } from "@cerebro/data/loader";

/** Contexto que toda tool recebe: o snapshot em cache e se ele está velho. */
export type ContextoTool = {
  snapshot: Snapshot;
  /** A última checagem/carga do banco falhou e o cache antigo foi servido. */
  cacheDesatualizado: boolean;
  agora: Date;
};

// ───── Schemas reutilizados ─────

export const zLimite = z.number().int().min(1).max(100).default(20)
  .describe("Máximo de linhas na resposta (default 20, máx 100).");
export const zLoja = z.union([z.string().min(1).max(80), z.number().int()]).optional()
  .describe("Loja: cod_empresa (ex. 12) ou parte do nome, sem acento/caixa (ex. \"aeroporto\").");
export const zData = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
export const zTextoFiltro = z.string().min(1).max(80);

// ───── Números ─────

/**
 * Arredonda todo número não inteiro a 2 casas (centavos/pontos percentuais),
 * recursivamente. A soma é feita antes, em double, pelas mesmas funções das
 * telas; o arredondamento só tira ruído de ponto flutuante da saída.
 */
export function arredondar<T>(v: T): T {
  if (typeof v === "number") {
    return (Number.isInteger(v) || !Number.isFinite(v) ? v : Math.round(v * 100) / 100) as T;
  }
  if (Array.isArray(v)) return v.map(arredondar) as T;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = arredondar(x);
    return out as T;
  }
  return v;
}

export function limitar<T>(itens: T[], limite: number): { itens: T[]; total: number; truncado: boolean } {
  return { itens: itens.slice(0, limite), total: itens.length, truncado: itens.length > limite };
}

export function media(valores: number[]): number | null {
  return valores.length > 0 ? valores.reduce((a, b) => a + b, 0) / valores.length : null;
}

// ───── Texto ─────

export function normalizarTexto(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function contem(alvo: string | null | undefined, termo: string): boolean {
  return normalizarTexto(alvo).includes(normalizarTexto(termo));
}

// ───── Datas ─────

/**
 * Data ISO de um instante, no calendário do processo. O container roda com
 * TZ=America/Sao_Paulo (o mesmo calendário do browser do Marcos), então dia e
 * mês batem com as telas, que também agrupam em hora local.
 */
export function isoDia(d: Date | null | undefined): string | null {
  if (!d) return null;
  const y = d.getFullYear(), m = d.getMonth() + 1, dia = d.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export type Periodo = { inicio?: string; fim?: string };

/**
 * Filtro de período IDÊNTICO ao da tela Análise de Vendas
 * (`src/components/vendas/useVendasAnalise.ts`): início 00:00:00.000 e fim
 * 23:59:59.999 em hora local; com qualquer limite ativo, venda sem data sai.
 */
export function filtrarPorPeriodo(vendas: VendaParsed[], p: Periodo): VendaParsed[] {
  if (!p.inicio && !p.fim) return vendas;
  const ms = (iso: string, fimDoDia: boolean) => {
    const [y, m, d] = iso.split("-").map(Number);
    return fimDoDia ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  };
  const ini = p.inicio ? ms(p.inicio, false) : null;
  const fim = p.fim ? ms(p.fim, true) : null;
  return vendas.filter((v) => {
    if (!v.data_venda) return false;
    const t = v.data_venda.getTime();
    if (ini !== null && t < ini) return false;
    if (fim !== null && t > fim) return false;
    return true;
  });
}

export function extremosDatas(vendas: VendaParsed[]): { primeira_venda: string | null; ultima_venda: string | null } {
  let a: number | null = null, b: number | null = null;
  for (const v of vendas) {
    if (!v.data_venda) continue;
    const t = v.data_venda.getTime();
    if (a === null || t < a) a = t;
    if (b === null || t > b) b = t;
  }
  return {
    primeira_venda: a === null ? null : isoDia(new Date(a)),
    ultima_venda: b === null ? null : isoDia(new Date(b)),
  };
}

// ───── Lojas ─────

export type LojaResumo = { cod_empresa: number; nome: string };

/**
 * Nome de loja por código, com a MESMA precedência do `montarBundle`
 * (última `empresa_nome` vista nas vendas), caindo no cadastro e em "Loja N".
 */
export function mapaNomesLoja(snapshot: Snapshot): Record<number, string> {
  const nomes: Record<number, string> = {};
  for (const [cod, l] of Object.entries(snapshot.datasets.lojas)) if (l.nome) nomes[Number(cod)] = l.nome;
  for (const v of snapshot.datasets.vendas) if (v.empresa_nome) nomes[v.cod_empresa] = v.empresa_nome;
  return nomes;
}

export function nomeLoja(nomes: Record<number, string>, cod: number): string {
  return nomes[cod] || `Loja ${cod}`;
}

export function todasLojas(snapshot: Snapshot): LojaResumo[] {
  const nomes = mapaNomesLoja(snapshot);
  const cods = new Set<number>(Object.keys(snapshot.datasets.lojas).map(Number));
  for (const l of snapshot.lojasCadastro) cods.add(l.cod_empresa);
  return [...cods].sort((a, b) => a - b).map((cod) => ({ cod_empresa: cod, nome: nomeLoja(nomes, cod) }));
}

export type LojaResolvida =
  | { ok: true; loja: LojaResumo }
  | { ok: false; erro: "loja_ambigua" | "loja_nao_encontrada"; termo: string; candidatas: LojaResumo[] };

/** `cod_empresa` ou nome parcial (sem acento/caixa). Ambíguo devolve as candidatas. */
export function resolverLoja(snapshot: Snapshot, entrada: string | number): LojaResolvida {
  const lojas = todasLojas(snapshot);
  const termo = String(entrada).trim();
  if (/^\d+$/.test(termo)) {
    const loja = lojas.find((l) => l.cod_empresa === Number(termo));
    return loja ? { ok: true, loja } : { ok: false, erro: "loja_nao_encontrada", termo, candidatas: lojas };
  }
  const t = normalizarTexto(termo);
  const exatas = lojas.filter((l) => normalizarTexto(l.nome) === t);
  if (exatas.length === 1) return { ok: true, loja: exatas[0] };
  const parciais = lojas.filter((l) => normalizarTexto(l.nome).includes(t));
  if (parciais.length === 1) return { ok: true, loja: parciais[0] };
  if (parciais.length > 1) return { ok: false, erro: "loja_ambigua", termo, candidatas: parciais };
  return { ok: false, erro: "loja_nao_encontrada", termo, candidatas: lojas };
}

export type ErroLoja = Extract<LojaResolvida, { ok: false }>;

/** Resolve o filtro opcional de loja: `undefined` = sem filtro. */
export function filtroLoja(
  snapshot: Snapshot,
  entrada: string | number | undefined,
): { cod: number | null; loja: LojaResumo | null } | ErroLoja {
  if (entrada === undefined || entrada === "") return { cod: null, loja: null };
  const r = resolverLoja(snapshot, entrada);
  if (!r.ok) return r;
  return { cod: r.loja.cod_empresa, loja: r.loja };
}

export function ehErroLoja(x: unknown): x is ErroLoja {
  return typeof x === "object" && x !== null && (x as { ok?: unknown }).ok === false;
}

export function filtrarVeiculos(
  veiculos: VeiculoParsed[],
  f: { cod: number | null; marca?: string; modelo?: string },
): VeiculoParsed[] {
  return veiculos.filter((v) => {
    if (f.cod !== null && v.cod_empresa !== f.cod) return false;
    if (f.marca && normalizarTexto(v.marca) !== normalizarTexto(f.marca)) return false;
    if (f.modelo && !contem(v.modelo, f.modelo)) return false;
    return true;
  });
}

// ───── Frescor dos dados ─────

/** Sync com mais de 36h sem sucesso é sinalizado (o sync NBS roda diariamente). */
export const HORAS_DADO_VELHO = 36;

export function frescorDados(ctx: ContextoTool) {
  const s = ctx.snapshot;
  const avisos: string[] = [];
  if (ctx.cacheDesatualizado) {
    avisos.push("Não foi possível consultar o banco agora; os números são da última carga em memória.");
  }
  for (const f of s.sync) {
    if (f.status === "erro") avisos.push(`Última execução do sync "${f.fonte}" terminou com erro.`);
    const ok = f.ultimo_sucesso_em ? new Date(f.ultimo_sucesso_em).getTime() : null;
    if (ok === null) avisos.push(`Sync "${f.fonte}" nunca concluiu com sucesso.`);
    else if (ctx.agora.getTime() - ok > HORAS_DADO_VELHO * 3600_000) {
      avisos.push(`Sync "${f.fonte}" sem sucesso há mais de ${HORAS_DADO_VELHO}h (último em ${f.ultimo_sucesso_em}).`);
    }
  }
  return {
    estoque_gerado_em: s.estoqueGeradoEm,
    carregado_em: s.carregadoEm,
    sync: s.sync.map((f) => ({ fonte: f.fonte, status: f.status, ultimo_sucesso_em: f.ultimo_sucesso_em })),
    desatualizado: avisos.length > 0,
    avisos,
  };
}
