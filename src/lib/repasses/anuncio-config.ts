/**
 * Regras fixas de negócio do anúncio de repasse (B2B / Auto Avaliar).
 *
 * Todos os valores são da operação Navesa e NÃO dependem do carro — só do
 * processo. Centralizados aqui pra editar num lugar só.
 *
 * ⚠️ Os valores abaixo são EXEMPLO. O Marcos vai confirmar os reais.
 *    Cada campo com `// TODO: confirmar com Marcos` precisa ser revisado
 *    antes de ir pra produção.
 *
 * Sobre as taxas: o template atual NÃO exibe `taxaAutoAvaliar` nem
 * `taxaAdministrativa` no texto (a antiga seção de gastos virou "Liberação").
 * As constantes ficam aqui como RESERVADO — o Marcos pode querer reincluir
 * essas linhas no anúncio depois sem mexer em código novo.
 */

export const ANUNCIO_CONFIG = {
  /** Prazo em dias corridos pra retirada do veículo após aprovação. */
  prazoRetiradaDias: 10,

  // ─── RESERVADO: não usadas no texto atual (ver doc acima) ───────────────
  taxaAutoAvaliar: 999, // TODO: confirmar com Marcos — valor de exemplo
  taxaAdministrativa: 525, // TODO: confirmar com Marcos — valor de exemplo

  /** Estrutura jurídica da venda (linha fixa em SITUAÇÃO DOCUMENTAL). */
  estruturaVenda: "procuração pública outorgada (conforme regras da operação)", // TODO: confirmar com Marcos
  /** Prazo de entrega da documentação ao comprador. */
  tempoEntregaDoc: "até 20 dias após entrada no Detran-GO", // TODO: confirmar com Marcos

  /** Local de retirada exibido na seção de contato. */
  localRetirada:
    "Grupo Navesa - Goiânia/GO (endereço completo informado após aprovação da proposta)", // TODO: confirmar com Marcos

  telefone: "(62) 0000-0000", // TODO: confirmar com Marcos — valor de exemplo
  whatsapp: "(62) 90000-0000", // TODO: confirmar com Marcos — valor de exemplo
  email: "repasse@navesa.com.br", // TODO: confirmar com Marcos — valor de exemplo
} as const;

export type AnuncioConfig = typeof ANUNCIO_CONFIG;
