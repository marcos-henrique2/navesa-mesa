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
