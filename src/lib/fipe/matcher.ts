import type { FipeMarca, FipeModelo, FipeAno } from "./types";

// Aliases para mapear o nome da marca do NBS para o nome usado na FIPE.
// Cobre tanto a coluna 445 'Marca' (nomes completos: 'Ford Autos', 'VolksWagen', 'LandRover')
// quanto a col 4 'Linha' (abreviações de 6 chars: 'CHEVRO', 'RAMPAG', 'RENEG').
// Aliases NBS → nome EXATO da FIPE. Chave em UPPERCASE.
// Os nomes FIPE foram conferidos via API: https://parallelum.com.br/fipe/api/v1/carros/marcas
const MARCA_ALIASES: Record<string, string> = {
  // === Col 445 'Marca' — nomes completos do NBS ===
  CHEVROLET: "GM - Chevrolet",
  VOLKSWAGEN: "VW - VolksWagen",
  "FORD AUTOS": "Ford",
  LANDROVER: "Land Rover",
  CHERY: "Caoa Chery",
  // (Toyota, Jeep, Fiat, Renault, Mitsubishi, Honda, Hyundai, RAM,
  //  Audi, Nissan, BMW, BYD, Peugeot, Volvo, Suzuki, GWM, GEELY,
  //  Jaecoo, Mercedes-Benz, Citroen, Kia Motors, Troller já casam direto.)

  // === Col 4 'Linha' — abreviações de 6 chars (fallback) ===
  CHEVRO: "GM - Chevrolet",
  VOLKSW: "VW - VolksWagen",
  VW: "VW - VolksWagen",
  RENAUL: "Renault",
  MITSUB: "Mitsubishi",
  HYUNDA: "Hyundai",
  CITROE: "Citroën",
  MERCED: "Mercedes-Benz",
  PEUGEO: "Peugeot",
  "LAND R": "Land Rover",

  // === Modelos que aparecem no campo 'Linha' (são modelos, não marcas) ===
  TERRIT: "Ford",
  RANGER: "Ford",
  BRONCO: "Ford",
  "F-150": "Ford",
  RAMPAG: "RAM",
  RAMPAGE: "RAM",
  RENEG: "Jeep",
  COMPASS: "Jeep",
  COMMANDER: "Jeep",
  TRACKER: "GM - Chevrolet",
  CRETA: "Hyundai",
  COROLLA: "Toyota",
  HILUX: "Toyota",
  TROLLE: "Troller",
};

const STOPWORDS = new Set([
  "1.0", "1.2", "1.3", "1.4", "1.5", "1.6", "1.8", "2.0", "2.5", "2.8", "3.0",
  "16V", "8V", "4P", "2P", "5P", "AUT", "AUTOMATICO", "AUTOMÁTICO", "AUTOMATIC",
  "MANUAL", "FLEX", "GASOLINA", "DIESEL", "HIBRIDO", "ELETRICO", "TURBO",
  "AT", "MT", "CVT", "DSG", "TIPTRONIC", "S-TRONIC", "GEARTRONIC", "STRONIC",
  "4X4", "4X2", "4WD", "AWD", "VVT", "DOHC", "DI", "MPFI", "MPI",
  "CD", "CS", "EX", "LX", "LT", "LTZ", "SE", "XEI", "GLI", "GTS", "RS",
]);

function normalize(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

export function findMarca(nbsMarca: string, fipeMarcas: FipeMarca[]): FipeMarca | null {
  const alvo = nbsMarca.trim();
  const upper = alvo.toUpperCase();
  const aliasName = MARCA_ALIASES[upper];

  const candidates = aliasName ? [aliasName, alvo] : [alvo];

  for (const cand of candidates) {
    const candN = normalize(cand);
    const direct = fipeMarcas.find((m) => normalize(m.nome) === candN);
    if (direct) return direct;

    const prefix = fipeMarcas.find((m) => {
      const mn = normalize(m.nome);
      return mn.startsWith(candN.slice(0, Math.max(3, Math.floor(candN.length * 0.7))));
    });
    if (prefix) return prefix;
  }

  return null;
}

type ModeloMatch = { modelo: FipeModelo; score: number };

export function findModelos(
  nbsModelo: string,
  fipeModelos: FipeModelo[],
  topN = 5,
): ModeloMatch[] {
  const nbsToks = tokens(nbsModelo);
  if (nbsToks.length === 0) return [];

  const scored = fipeModelos
    .map<ModeloMatch>((m) => {
      const fipeToks = tokens(m.nome);
      const intersect = nbsToks.filter((t) => fipeToks.includes(t)).length;
      const union = new Set([...nbsToks, ...fipeToks]).size;
      const jaccard = union === 0 ? 0 : intersect / union;
      const firstMatches = nbsToks[0] && fipeToks[0] === nbsToks[0] ? 0.15 : 0;
      return { modelo: m, score: jaccard + firstMatches };
    })
    .filter((x) => x.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  return scored;
}

export function findAno(
  anoModeloNbs: number | null,
  combNbs: string | null,
  fipeAnos: FipeAno[],
): FipeAno | null {
  if (!anoModeloNbs) return fipeAnos[0] ?? null;

  const combMap: Record<string, string> = {
    GASOLINA: "Gasolina",
    FLEX: "Gasolina",
    HIBRIDO: "Gasolina",
    DIESEL: "Diesel",
    ELETRICO: "Gasolina",
    ETANOL: "Álcool",
  };
  const fipeComb = combNbs ? combMap[combNbs.toUpperCase()] ?? "Gasolina" : "Gasolina";

  const exact = fipeAnos.find((a) => a.nome === `${anoModeloNbs} ${fipeComb}`);
  if (exact) return exact;

  const yearMatch = fipeAnos.find((a) => a.nome.startsWith(`${anoModeloNbs} `));
  if (yearMatch) return yearMatch;

  const sortedByDist = [...fipeAnos]
    .map((a) => {
      const y = parseInt(a.nome.split(" ")[0], 10);
      return { ano: a, dist: Number.isFinite(y) ? Math.abs(y - anoModeloNbs) : 999 };
    })
    .sort((a, b) => a.dist - b.dist);

  return sortedByDist[0]?.ano ?? null;
}
