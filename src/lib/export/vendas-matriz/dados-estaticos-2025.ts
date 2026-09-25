/**
 * VENDAS USADOS MATRIZ — aba " MÉDIA VENDEDOR 2025" (estática/congelada).
 *
 * Transcrito EXATO de `VENDAS USADOS MATRIZ - AGOSTO 2026.xlsx`, aba
 * " MÉDIA VENDEDOR 2025" (AGO a DEZ/2025, média = total / 5 meses). Não recalcular,
 * não arredondar — são os números que o Marcos já fechou pra 2025.
 */

export type LinhaMediaVendedor2025 = {
  vendedor: string;
  /** Total de carros vendidos AGO a DEZ/2025. */
  agoADez: number;
  /** agoADez / 5. */
  media: number;
};

export const MEDIA_VENDEDOR_2025: LinhaMediaVendedor2025[] = [
  { vendedor: "RAFAEL LIMA", agoADez: 112, media: 22.4 },
  { vendedor: "ROQUE SILVA", agoADez: 84, media: 16.8 },
  { vendedor: "EDNEI ALCANTARA", agoADez: 76, media: 15.2 },
  { vendedor: "FELIPE OLIVEIRA", agoADez: 49, media: 9.8 },
  { vendedor: "WOLNEI RABELO", agoADez: 48, media: 9.6 },
  { vendedor: "NAYARA GONÇALVES", agoADez: 42, media: 8.4 },
  { vendedor: "MAXSUEL SOUSA", agoADez: 38, media: 7.6 },
  { vendedor: "RAIMUNDO NETO", agoADez: 31, media: 6.2 },
  { vendedor: "EDGAR FILHO", agoADez: 11, media: 2.2 },
  { vendedor: "ELIAS COSTA", agoADez: 9, media: 1.8 },
  { vendedor: "ROSA SOUZA", agoADez: 7, media: 1.4 },
  { vendedor: "ALEXANDRO OLIVEIRA", agoADez: 5, media: 1 },
  { vendedor: "ANTONIO MELO", agoADez: 4, media: 0.8 },
  { vendedor: "SAMUEL NEVES", agoADez: 4, media: 0.8 },
  { vendedor: "ALEX OLIVEIRA", agoADez: 3, media: 0.6 },
  { vendedor: "MARCELO ROSA", agoADez: 3, media: 0.6 },
  { vendedor: "THIAGO LINS", agoADez: 3, media: 0.6 },
  { vendedor: "ELOYSE MOREIRA", agoADez: 2, media: 0.4 },
  { vendedor: "FRANCISCO NETO", agoADez: 2, media: 0.4 },
  { vendedor: "ALESSANDRA SILVA", agoADez: 1, media: 0.2 },
  { vendedor: "KARIL CHAVES", agoADez: 1, media: 0.2 },
  { vendedor: "MARCIVONE NASCIMENTO", agoADez: 1, media: 0.2 },
  { vendedor: "WELMA ROCHA", agoADez: 1, media: 0.2 },
];

export const MEDIA_VENDEDOR_2025_TOTAL: LinhaMediaVendedor2025 = {
  vendedor: "TOTAL",
  agoADez: 537,
  media: 107.4,
};
