import { findModelos } from "../src/lib/fipe/matcher";
import type { FipeModelo } from "../src/lib/fipe/types";

// Casos reais que vimos no seu estoque
const CASOS: { nbsModelo: string; fipeModelosFake: string[] }[] = [
  {
    nbsModelo: "Q3 2.0 40 TFSI GASOLINA SPORTBACK ANNIVERSARY EDIT",
    fipeModelosFake: [
      "Q3 1.4 TFSI 150cv S-tronic",
      "Q3 2.0 TFSI Attraction Quattro 16V 170cv",
      "Q3 2.0 TFSI Ambiente Quattro 16V 170cv",
      "Q3 2.0 TFSI Ambition Quattro 16V 170cv",
      "Q3 2.0 TFSI Quattro S-tronic Black 5p",
      "Q3 1.4 TFSI 150cv S-tronic Black 5p",
      "Q3 Sportback Performance Black 2.0 40 TFSI quattro 5p S-tronic",
      "Q3 Sportback Performance 2.0 40 TFSI quattro 5p S-tronic",
      "Q3 Sportback 2.0 40 TFSI quattro Anniversary Edition 5p",
    ],
  },
  {
    nbsModelo: "RANGER 3.2 XLS 4X4 CD 20V DIESEL 4P AUTOMATICO",
    fipeModelosFake: [
      "Ranger XLT 3.2 20V 4x4 CD Diesel Aut.",
      "Ranger XLS 3.2 20V 4x4 CD Diesel Aut.",
      "Ranger Limited 3.2 20V 4x4 CD Diesel Aut.",
      "Ranger 2.2 20V 4x4 CD Diesel XLS Manual",
      "Ranger 2.5 Flex 4x2 CS XL",
    ],
  },
  {
    nbsModelo: "S10 2.5 LT 4X4 CD 16V FLEX 4P MANUAL",
    fipeModelosFake: [
      "S10 LT 2.5 16V FLEX 4P Manual",
      "S10 LT 2.5 16V FLEX 4X4 CD Manual",
      "S10 LTZ 2.5 16V FLEX 4X4 CD Aut.",
      "S10 LS 2.5 16V FLEX 4X4 CD Manual",
      "S10 Premier 2.8 Turbo Diesel 4X4 CD AT",
    ],
  },
  {
    nbsModelo: "COMPASS 2.0 16V DIESEL TRAILHAWK 4X4 AUTOMATICO",
    fipeModelosFake: [
      "Compass Sport 2.0 16V Flex 4x2 Aut.",
      "Compass Limited 2.0 16V Flex 4x2 Aut.",
      "Compass Longitude 2.0 16V Diesel 4x4 Aut.",
      "Compass Trailhawk 2.0 16V Diesel 4x4 Aut.",
      "Compass Limited 2.0 16V Diesel 4x4 Aut.",
    ],
  },
];

console.log("=" .repeat(75));
console.log("TESTE DO MATCHER FIPE — Verifica se acerta no top-1");
console.log("=" .repeat(75));

for (const caso of CASOS) {
  console.log(`\n📥 NBS: ${caso.nbsModelo}`);
  const fipeModelos: FipeModelo[] = caso.fipeModelosFake.map((nome, i) => ({ codigo: i + 1, nome }));
  const matches = findModelos(caso.nbsModelo, fipeModelos, 5);
  if (matches.length === 0) {
    console.log("   ❌ Nenhum match encontrado");
    continue;
  }
  matches.forEach((m, i) => {
    const marker = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "  ";
    console.log(`   ${marker} (${m.score.toFixed(3)}) ${m.modelo.nome}`);
  });
}
