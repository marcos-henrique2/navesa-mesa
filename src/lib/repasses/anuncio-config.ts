/**
 * Regras fixas de negócio do anúncio de repasse (B2B / Auto Avaliar).
 *
 * Todos os valores são da operação Navesa e NÃO dependem do carro — só do
 * processo. Centralizados aqui pra editar num lugar só.
 *
 * Os valores abaixo são REAIS, confirmados pelo Marcos.
 *
 * Sobre as taxas: o template atual NÃO exibe `taxaAutoAvaliar` nem
 * `taxaAdministrativa` no texto (a antiga seção de gastos virou "Liberação").
 * As constantes ficam aqui como RESERVADO — o Marcos pode querer reincluir
 * essas linhas no anúncio depois sem mexer em código novo.
 */

export const ANUNCIO_CONFIG = {
  /** Prazo em dias corridos pra retirada do veículo após aprovação. */
  prazoRetiradaDias: 10,

  /**
   * Custo de ATPV-e + comunicado de venda (R$), valor fixo informado no anúncio.
   * As taxas de transferência (Detran/cartório) NÃO entram aqui — variam e são
   * citadas como "à parte", sem valor exato.
   */
  custoAtpvComunicado: 500,

  // ─── RESERVADO: não usadas no texto atual (ver doc acima) ───────────────
  taxaAutoAvaliar: 999,
  taxaAdministrativa: 525,

  /** Prazo de entrega da documentação ao comprador. */
  tempoEntregaDoc: "de 10 a 15 dias",

  /** Local de retirada exibido na seção de contato. */
  localRetirada:
    "Grupo Navesa - Goiânia/GO (endereço completo informado após aprovação da proposta)",

  whatsapp: "(62) 98226-2543",
  email: "marcos.jesus@navesa.com.br",
} as const;

export type AnuncioConfig = typeof ANUNCIO_CONFIG;

/**
 * Mensagem exibida quando IPVA ou documentação estão como `nao_verificado`/null.
 * Em vez de omitir a linha, direciona o comprador a confirmar com a Mesa —
 * pra nunca ficar campo faltando no anúncio.
 */
export const MSG_CONFIRME_MESA = "confirme com a Mesa de Repasse antes do lance";
