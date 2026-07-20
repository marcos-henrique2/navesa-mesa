/**
 * Uma tabela de referência mensal da FIPE.
 *
 * `codigo` é o identificador numérico que a API aceita em `?referencia=`;
 * `mes` é o rótulo humano (`"julho/2026"`) — o que vai pra UI e pro banco,
 * porque é o que dá pra conferir contra o Auto Avaliar.
 */
export type FipeReferencia = { codigo: number; mes: string };

export type FipeMarca = { codigo: string; nome: string };
export type FipeModelo = { codigo: number; nome: string };
export type FipeAno = { codigo: string; nome: string };
export type FipeValor = {
  TipoVeiculo: number;
  Valor: string;
  Marca: string;
  Modelo: string;
  AnoModelo: number;
  Combustivel: string;
  CodigoFipe: string;
  MesReferencia: string;
  SiglaCombustivel: string;
};

export type FipeMatch = {
  marcaCod: string;
  marcaNome: string;
  modeloCod: number;
  modeloNome: string;
  anoCod: string;
  anoNome: string;
};
