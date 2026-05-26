import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";

export type ClienteAgregado = {
  id: string;
  codigo: string | null;
  nome: string;
  tipo: "PF" | "PJ" | null;
  cidade: string | null;
  uf: string | null;
  totalCompras: number;
  totalValor: number;
  primeiraCompra: Date | null;
  ultimaCompra: Date | null;
  diasEntrePrimeiraUltima: number | null;
  vendas: VendaParsed[];
};

export type RecorrenciaTier = "unica" | "ocasional" | "recorrente" | "lojista-suspeito";

/** Limites configuráveis para classificação de recorrência. */
export const RECORRENCIA_LIMITS = {
  ocasionalMin: 2,         // 2 compras = ocasional
  recorrenteMin: 3,        // 3+ compras = recorrente
  lojistaSuspeitoMin: 5,   // 5+ compras = padrão de revenda
} as const;

export function tierRecorrencia(totalCompras: number): RecorrenciaTier {
  if (totalCompras >= RECORRENCIA_LIMITS.lojistaSuspeitoMin) return "lojista-suspeito";
  if (totalCompras >= RECORRENCIA_LIMITS.recorrenteMin) return "recorrente";
  if (totalCompras >= RECORRENCIA_LIMITS.ocasionalMin) return "ocasional";
  return "unica";
}

function normalizeNome(nome: string): string {
  return nome
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

/** Devolve uma chave única estável para identificar o cliente entre vendas. */
export function chaveCliente(venda: { cliente_codigo: string | null; cliente_nome: string }): string {
  const cod = venda.cliente_codigo?.replace(/\D/g, "");
  if (cod && cod.length >= 5) return `cod:${cod}`;
  return `nome:${normalizeNome(venda.cliente_nome)}`;
}

/** Indexa todas as vendas por chaveCliente, agregando métricas. */
export function indexarClientes(vendas: VendaParsed[]): Map<string, ClienteAgregado> {
  const map = new Map<string, ClienteAgregado>();

  for (const v of vendas) {
    const id = chaveCliente(v);
    const ex = map.get(id);
    if (ex) {
      ex.totalCompras++;
      ex.totalValor += v.valor_venda ?? 0;
      if (v.data_venda) {
        if (!ex.primeiraCompra || v.data_venda < ex.primeiraCompra) ex.primeiraCompra = v.data_venda;
        if (!ex.ultimaCompra || v.data_venda > ex.ultimaCompra) ex.ultimaCompra = v.data_venda;
      }
      ex.vendas.push(v);
      // Manter cidade/UF/codigo se ainda não tinha
      if (!ex.cidade && v.cliente_cidade) ex.cidade = v.cliente_cidade;
      if (!ex.uf && v.cliente_uf) ex.uf = v.cliente_uf;
      if (!ex.codigo && v.cliente_codigo) ex.codigo = v.cliente_codigo;
    } else {
      map.set(id, {
        id,
        codigo: v.cliente_codigo,
        nome: v.cliente_nome,
        tipo: v.cliente_tipo,
        cidade: v.cliente_cidade,
        uf: v.cliente_uf,
        totalCompras: 1,
        totalValor: v.valor_venda ?? 0,
        primeiraCompra: v.data_venda,
        ultimaCompra: v.data_venda,
        diasEntrePrimeiraUltima: null,
        vendas: [v],
      });
    }
  }

  // Calcular dias entre primeira e última compra
  for (const c of map.values()) {
    if (c.primeiraCompra && c.ultimaCompra) {
      const diff = c.ultimaCompra.getTime() - c.primeiraCompra.getTime();
      c.diasEntrePrimeiraUltima = Math.round(diff / (1000 * 60 * 60 * 24));
    }
    // Ordenar vendas do cliente cronologicamente
    c.vendas.sort((a, b) => {
      if (!a.data_venda) return 1;
      if (!b.data_venda) return -1;
      return a.data_venda.getTime() - b.data_venda.getTime();
    });
  }

  return map;
}

/** Retorna o agregado de um cliente específico a partir de uma venda. */
export function getCliente(
  index: Map<string, ClienteAgregado>,
  venda: { cliente_codigo: string | null; cliente_nome: string },
): ClienteAgregado | null {
  return index.get(chaveCliente(venda)) ?? null;
}

export const TIER_LABEL: Record<RecorrenciaTier, string> = {
  unica: "Cliente único",
  ocasional: "Cliente ocasional",
  recorrente: "Cliente recorrente",
  "lojista-suspeito": "Padrão de revenda (possível lojista)",
};
