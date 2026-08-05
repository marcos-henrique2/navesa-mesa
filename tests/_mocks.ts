import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";
import type { Repasse } from "@/lib/repasses/types";

/** Cria uma VendaParsed completa com defaults; sobrescreva o que o teste precisar. */
export function venda(over: Partial<VendaParsed> = {}): VendaParsed {
  return {
    chassi: "CHASSI000000000",
    placa: "ABC1D23",
    modelo: "MODELO TESTE",
    marca: "Ford",
    ano_fabricacao: 2022,
    ano_modelo: 2022,
    cor_externa: "PRETO",
    renavam: null,
    km: 50000,
    cod_empresa: 2,
    empresa_nome: "LOJA TESTE",
    patio: "AEROPORTO",
    vendedor_codigo: "V1",
    vendedor_nome: "VENDEDOR TESTE",
    vendedor_cpf: null,
    vendedor_recebeu: null,
    cliente_codigo: "C1",
    cliente_nome: "CLIENTE TESTE",
    cliente_tipo: "PF",
    cliente_cidade: "GOIANIA",
    cliente_uf: "GO",
    data_venda: new Date("2026-05-10"),
    data_faturamento: null,
    data_entrada: null,
    valor_venda: 100000,
    preco_venda_tabela: 100000,
    total_nota_fabrica: 90000,
    custo_floor_plan: 2000,
    custo_total_final: 95000,
    despesas_gerais: 1000,
    margem_pct: 5,
    comissao_vendedor: 500,
    dias_estoque: 20,
    placa_troca: null,
    ...over,
  } as VendaParsed;
}

/** Cria um CustoDetalhado completo com defaults. */
export function custo(over: Partial<CustoDetalhado> = {}): CustoDetalhado {
  return {
    modelo: "MODELO TESTE",
    placa: "ABC1D23",
    data_fatura: null,
    data_venda: new Date("2026-05-10"),
    dias_patio: 20,
    nota_fabrica_taxa_icms: 80000,
    despesas_oficina: 0,
    frete_icms_frete: 0,
    forplan: 3000,
    impostos: 1000,
    comissoes: 500,
    ganhos_indiretos: 5000,
    adm: 0,
    despesas_gerais: 1000,
    custo_total: 80500, // 80000+3000+1000+500+1000 - 5000
    valor_vendido: 100000,
    margem_real: 19500,
    margem_pct: 19.5,
    ...over,
  };
}

/** Cria um VeiculoParsed completo com defaults. */
export function veiculo(over: Partial<VeiculoParsed> = {}): VeiculoParsed {
  return {
    cod_empresa: 2,
    chassi: "CHASSI000000000",
    placa: "ABC1D23",
    marca: "Ford",
    modelo: "MODELO TESTE",
    ano_fabricacao: 2024,
    ano_modelo: 2024,
    cor_externa: "PRETO",
    combustivel: "FLEX",
    km: 10000,
    patio: "AEROPORTO",
    descricao_situacao: "DISPONIVEL",
    preco_venda: 110000,
    valor_aquisicao: 90000,
    custo_total: 95000,
    dias_patio: 10,
    data_entrada: null,
    vendedor_recebeu: null,
    cod_proposta: null,
    ...over,
  } as VeiculoParsed;
}

/** Cria um Repasse completo com defaults; sobrescreva o que o teste precisar. */
export function repasse(over: Partial<Repasse> = {}): Repasse {
  return {
    id: 1,
    chassi: "CHASSI000000000",
    placa: "ABC1D23",
    modelo: "MODELO TESTE",
    marca: "Ford",
    cor: "PRETO",
    ano_modelo: 2021,
    ano_fabricacao: 2020,
    km: 134694,
    loja_origem: 2,
    patio_origem: "AEROPORTO",
    valor_aquisicao: 90000,
    preco_atual: 110000,
    valor_compra_repasse: null,
    valor_minimo: null,
    valor_compre_por: null,
    data_marcado: "2026-06-01",
    data_subido: null,
    canal: "auto_avaliar",
    status: "marcado",
    valor_vendido: null,
    data_vendido: null,
    comprador: null,
    ipva_status: null,
    ipva_responsavel: null,
    documentacao_status: null,
    cautelar_status_manual: null,
    valor_subir: null,
    observacoes: null,
    criado_em: "2026-06-01T00:00:00.000Z",
    atualizado_em: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}
