import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";
import type { CustoEstoqueDetalhado } from "@/lib/parsers/nbs-custos-estoque-pdf";
import type { Repasse } from "@/lib/repasses/types";
import type { LinhaVendaMatriz } from "@/lib/export/vendas-matriz/tipos";

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
    financiado: null,
    financeira: null,
    valoriza: 0,
    consignado: false,
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
    valoriza: 0,
    custo_impostos: 0,
    custo_revisoes: 0,
    custo_holdback: 0,
    custo_acessorios: 0,
    custo_forplan: 0,
    custo_comissoes: 0,
    ...over,
  } as VeiculoParsed;
}

/** Cria um CustoEstoqueDetalhado completo com defaults (registro manual do upload do PDF "Custos de Veículos em Estoque" em /upload). */
export function custoEstoqueDetalhado(over: Partial<CustoEstoqueDetalhado> = {}): CustoEstoqueDetalhado {
  return {
    placa: "ABC1D23",
    modelo: "MODELO TESTE",
    dias_patio: 20,
    nota_fabrica: 80000,
    revisoes: 500,
    forplan: 2000,
    holdback: 0,
    acessorios: 0,
    adm: 0,
    impostos: 1000,
    comissoes: 0,
    desp_gerais: 0,
    custo_total: 80000,
    tabela: 100000,
    lucro_bruto: 20000,
    bonus: 0,
    ganhos_indiretos: 0,
    ...over,
  };
}

/** Cria uma LinhaVendaMatriz completa com defaults; sobrescreva o que o teste precisar. */
export function linhaVendaMatriz(over: Partial<LinhaVendaMatriz> = {}): LinhaVendaMatriz {
  return {
    chassi: "CHASSI000000000",
    placa: "ABC1D23",
    lojaOrigemNome: "ESTOQUE AEROPORTO",
    lojaOrigemCodEmpresa: 2,
    descricaoVeiculo: "MODELO TESTE",
    cor: "PRETO",
    marca: "Ford",
    anoModelo: "22/22",
    km: 50000,
    diasEstoque: 20,
    nfEntrada: 80000,
    valoriza: 1000,
    valorFipe: 100000,
    valorVenda: 95000,
    despesaGeral: 1000,
    forplan: 2000,
    impostos: 500,
    comissao: 400,
    usadoNaTroca: false,
    financiou: null,
    clienteNome: "CLIENTE TESTE",
    lojista: false,
    vendedorNome: "VENDEDOR TESTE",
    consignado: false,
    ...over,
  };
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
    valor_maior_oferta: null,
    qtde_anuncios: null,
    data_marcado: "2026-06-01",
    data_subido: null,
    data_subido_aproximada: false,
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
