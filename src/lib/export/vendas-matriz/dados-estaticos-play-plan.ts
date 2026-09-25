/**
 * VENDAS USADOS MATRIZ — aba "PLAY PLAN VENDEDOR INFLUENCER" (estática).
 *
 * Transcrito EXATO de `VENDAS USADOS MATRIZ - AGOSTO 2026.xlsx`, aba
 * "PLAY PLAN VENDEDOR INFLUENCER" — duas tabelas lado a lado: prêmio por volume de
 * carros faturados pro CLIENTE FINAL, e prêmio por total de carros faturados na loja.
 */

export type FaixaPlayPlan = {
  faixa: string;
  premio: number;
};

export type TabelaPlayPlan = {
  salarioFixo: number;
  volumeLabel: string;
  clienteLabel: string;
  faixas: FaixaPlayPlan[];
};

export const PLAY_PLAN_CLIENTE_FINAL: TabelaPlayPlan = {
  salarioFixo: 4000,
  volumeLabel: "VOLUME DE FATURADOS",
  clienteLabel: " CLIENTE FINAL ",
  faixas: [
    { faixa: "01 a 39", premio: 0 },
    { faixa: "40 a 45", premio: 1000 },
    { faixa: "46 a 50", premio: 1250 },
    { faixa: "51 a 55", premio: 1500 },
    { faixa: "56 a 60", premio: 1750 },
    { faixa: "61 a 65", premio: 2000 },
    { faixa: "66 a 70", premio: 2250 },
    { faixa: "71 a 75", premio: 2500 },
    { faixa: "76 a 80", premio: 2750 },
    { faixa: "81 ou +", premio: 3000 },
  ],
};

export const PLAY_PLAN_FATURADOS_LOJA: TabelaPlayPlan = {
  salarioFixo: 4000,
  volumeLabel: "TOTAL CARROS ",
  clienteLabel: "FATURADOS NA LOJA",
  faixas: [
    { faixa: "01 a 109", premio: 0 },
    { faixa: "110 a 115", premio: 1000 },
    { faixa: "116 a 120", premio: 1250 },
    { faixa: "121 a 125", premio: 1500 },
    { faixa: "126 a 130", premio: 1750 },
    { faixa: "131 a 135", premio: 2000 },
    { faixa: "136 a 140", premio: 2250 },
    { faixa: "141 a 145", premio: 2500 },
    { faixa: "146 a 150", premio: 2750 },
    { faixa: "151 ou +", premio: 3000 },
  ],
};
