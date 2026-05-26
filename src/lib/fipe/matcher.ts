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

/**
 * Pesos dos tokens — quanto maior o peso, mais o token discrimina entre versões.
 *
 * CRITICAL (peso 3): trims/versões/pacotes — diferenciam "Q3 Black 240cv" de "Q3 normal 150cv"
 * IMPORTANT (peso 2): carroceria/tração/transmissão importante
 * STOPWORDS (peso 0): ruído genérico, ignorados na conta
 * Normal (peso 1): palavras restantes que ajudam mas não são decisivas
 */
const CRITICAL_TOKENS = new Set([
  // Audi
  "TFSI", "TDI", "RS", "S-LINE", "SLINE", "QUATTRO", "SPORTBACK", "ALLROAD",
  // BMW
  "M-SPORT", "MSPORT", "XDRIVE", "ACTIVEFLEX", "GRAN", "COUPE",
  // Mercedes
  "AMG", "BLUETEC", "EQ",
  // Jeep / RAM
  "TRAILHAWK", "LIMITED", "OVERLAND", "RUBICON", "LONGITUDE", "SPORT", "LATITUDE", "RENEGADE",
  "LARAMIE", "REBEL", "BIGHORN",
  // Ford
  "WILDTRAK", "RAPTOR", "TITANIUM", "STORM", "BLACK", "XLT", "XLS", "XL", "BIG", "TREMOR",
  "ECOBOOST", "FREESTYLE", "BADLANDS",
  // Chevrolet / GM
  "PREMIER", "MIDNIGHT", "PLUS", "TRACKER", "TRAILBLAZER", "ACTIV", "ADVANTAGE",
  // VW
  "GTS", "GTI", "R-LINE", "RLINE", "HIGHLINE", "COMFORTLINE", "COMFORT", "TRENDLINE", "EXTREME",
  "PERFORMANCE", "ALLSPACE", "SAVEIRO",
  // Toyota
  "DIAMOND", "PLATINUM", "ALTITUDE", "VELOZ", "XEI", "GR-SPORT", "GR",
  // Honda
  "EXL", "TOURING", "TYPE",
  // Hyundai / Kia
  "CRDI", "GLS", "ULTIMATE", "EVOLUTION",
  // Renault / Citroen / Peugeot
  "ZEN", "ICONIC", "INTENSE", "GT-LINE", "GTLINE", "ALLURE", "GRIFFE", "FEEL", "LIVE",
  // Genérico premium/versões
  "SUPER", "PREMIUM", "ELITE", "TOP", "EVOLUTION", "TURBO", "HYBRID", "PHEV", "HEV", "BEV",
  // Padrões alfanuméricos (motores premium)
  "20TFSI", "40TFSI", "45TFSI", "55TFSI", "30TDI", "40TDI",
  "T200", "T270", "T300", "D300", "D350",
  "M40I", "M50I", "M340I",
]);

const IMPORTANT_TOKENS = new Set([
  "SEDAN", "HATCH", "HATCHBACK", "SUV", "PICK-UP", "PICKUP", "WAGON", "COUPE", "CABRIO", "CABRIOLET",
  "CD",  // cabine dupla
  "CS",  // cabine simples
  "TRACK", "BLINDADO",
]);

const STOPWORDS = new Set([
  "1.0", "1.2", "1.3", "1.4", "1.5", "1.6", "1.8", "2.0", "2.2", "2.5", "2.8", "3.0", "3.5",
  "16V", "8V", "12V", "4P", "2P", "5P",
  "AUT", "AUTOMATICO", "AUTOMÁTICO", "AUTOMATIC", "AT", "MT", "CVT", "DSG",
  "MANUAL", "TIPTRONIC", "S-TRONIC", "STRONIC", "GEARTRONIC",
  "FLEX", "GASOLINA", "DIESEL", "HIBRIDO", "ELETRICO", "ETANOL",
  "4X4", "4X2", "4WD", "AWD", "FWD", "RWD",
  "VVT", "DOHC", "SOHC", "DI", "MPFI", "MPI", "GDI", "TDI",
  "16V.", "L",
]);

/** Multi-tokens conhecidos que devem ser unidos em 1 token antes do match. */
const TOKEN_COMBINATIONS: [string, string, string][] = [
  ["20", "TFSI", "20TFSI"], ["40", "TFSI", "40TFSI"], ["45", "TFSI", "45TFSI"], ["55", "TFSI", "55TFSI"],
  ["30", "TDI", "30TDI"], ["40", "TDI", "40TDI"],
  ["S", "LINE", "SLINE"], ["R", "LINE", "RLINE"], ["GT", "LINE", "GTLINE"],
  ["M", "SPORT", "MSPORT"],
];

function tokenWeight(t: string): number {
  if (STOPWORDS.has(t)) return 0;
  if (CRITICAL_TOKENS.has(t)) return 3;
  if (IMPORTANT_TOKENS.has(t)) return 2;
  return 1;
}

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
  let toks = normalize(s).split(" ").filter((t) => t.length > 0);

  // Unir combos conhecidos (ex: ["40", "TFSI"] -> ["40TFSI"])
  for (const [a, b, joined] of TOKEN_COMBINATIONS) {
    for (let i = 0; i < toks.length - 1; i++) {
      if (toks[i] === a && toks[i + 1] === b) {
        toks.splice(i, 2, joined);
      }
    }
  }

  return toks;
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

/**
 * Match com score ponderado.
 *
 * Para cada token compartilhado entre NBS e FIPE, soma seu peso (3 crítico, 2 importante, 1 normal).
 * Penaliza tokens críticos do FIPE que NÃO estão no NBS (evita FIPE com BLACK/QUATTRO bater
 * em modelo NBS sem essas palavras).
 *
 * Score = peso_compartilhado / (peso_nbs + peso_extra_fipe_critico × 0.5)
 *
 * Bônus extra se o primeiro token significativo bater (geralmente é o nome do carro: Q3, X1, etc).
 */
export function findModelos(
  nbsModelo: string,
  fipeModelos: FipeModelo[],
  topN = 5,
): ModeloMatch[] {
  const nbsToks = tokens(nbsModelo).filter((t) => tokenWeight(t) > 0);
  if (nbsToks.length === 0) return [];

  const nbsSet = new Set(nbsToks);
  const nbsWeight = nbsToks.reduce((s, t) => s + tokenWeight(t), 0);
  const firstNbs = nbsToks[0];

  const scored = fipeModelos
    .map<ModeloMatch>((m) => {
      const fipeToks = tokens(m.nome).filter((t) => tokenWeight(t) > 0);
      const fipeSet = new Set(fipeToks);

      let intersectWeight = 0;
      for (const t of nbsSet) if (fipeSet.has(t)) intersectWeight += tokenWeight(t);

      // Penalização: tokens CRÍTICOS no FIPE que não estão no NBS = ruído
      let extraCriticalFipe = 0;
      for (const t of fipeSet) {
        if (!nbsSet.has(t) && CRITICAL_TOKENS.has(t)) extraCriticalFipe += tokenWeight(t);
      }

      const denom = Math.max(1, nbsWeight + extraCriticalFipe * 0.5);
      let score = intersectWeight / denom;

      // Bônus: primeiro token significativo do NBS bate com algum token do FIPE
      if (firstNbs && fipeSet.has(firstNbs)) score += 0.1;

      return { modelo: m, score };
    })
    .filter((x) => x.score > 0.15)
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
