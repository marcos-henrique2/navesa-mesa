import type { FipeMarca, FipeModelo, FipeAno, FipeValor, FipeReferencia } from "./types";

const BASE = "https://parallelum.com.br/fipe/api/v1/carros";
/** As referências NÃO ficam sob /carros — é uma rota de primeiro nível da API. */
const REFERENCIAS_URL = "https://parallelum.com.br/fipe/api/v1/referencias";

/**
 * v2 do prefixo. A troca é intencional e obrigatória: o esquema v1 guardava o
 * valor SEM a referência na chave, então toda entrada antiga é potencialmente de
 * uma tabela FIPE diferente da corrente. Mudar o prefixo aposenta esse cache
 * inteiro de uma vez, sem precisar migrar entrada por entrada.
 */
const CACHE_PREFIX = "navesa-mesa:fipe-cache-v2:";
/** Prefixo aposentado — só existe pra `clearFipeLocalCache` conseguir varrê-lo. */
const CACHE_PREFIX_LEGADO = "navesa-mesa:fipe-cache-v1:";

/**
 * Único dado com validade: a LISTA de referências.
 *
 * Ela é a única coisa que muda sozinha (quando a FIPE publica o mês novo), e o
 * TTL curto existe só pra detectar essa virada — não pra "refrescar" preço.
 */
const REFS_TTL_MS = 6 * 60 * 60 * 1000; // 6h

/** Chave que guarda a última referência corrente conhecida (pra detectar virada de mês). */
const KEY_REF_ATUAL = "ref-atual";

// ───── Storage ──────────────────────────────────────────────────────────────

/** Subconjunto de `Storage` que o cache usa. Permite injetar um stub nos testes. */
export type CacheStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
};

let storageOverride: CacheStorageLike | null = null;

/**
 * Seam de teste: injeta um storage em memória. Passar `null` volta pro
 * `window.localStorage`. Não usar em código de produção.
 */
export function __setFipeCacheStorage(s: CacheStorageLike | null): void {
  storageOverride = s;
}

function storage(): CacheStorageLike | null {
  if (storageOverride) return storageOverride;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

// ───── Cache ────────────────────────────────────────────────────────────────

/** `exp: null` = nunca expira (valor de uma referência fechada é imutável). */
type CacheEntry<T> = { v: T; exp: number | null };

function cacheGet<T>(key: string): T | null {
  const st = storage();
  if (!st) return null;
  try {
    const raw = st.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (parsed.exp != null && Date.now() > parsed.exp) return null;
    return parsed.v;
  } catch {
    return null;
  }
}

function cacheSet<T>(key: string, value: T, ttlMs?: number): void {
  const st = storage();
  if (!st) return;
  const payload = JSON.stringify({
    v: value,
    exp: ttlMs == null ? null : Date.now() + ttlMs,
  } satisfies CacheEntry<T>);
  try {
    st.setItem(CACHE_PREFIX + key, payload);
  } catch {
    // Provável QuotaExceededError. Como as chaves passaram a acumular POR
    // REFERÊNCIA, o crescimento é previsível — e as referências antigas são
    // exatamente o lixo descartável. Poda e tenta uma vez só.
    const refAtual = cacheGet<number>(KEY_REF_ATUAL);
    if (refAtual != null) podarOutrasReferencias(refAtual);
    try {
      st.setItem(CACHE_PREFIX + key, payload);
    } catch (err) {
      console.warn("FIPE cache write falhou mesmo após poda:", err);
    }
  }
}

/** Extrai o código da referência embutido na chave, ou `null` se a chave não for por-referência. */
function refDaChave(chaveSemPrefixo: string): number | null {
  const m = /^(?:marcas|modelos|anos|valor):(\d+)(?::|$)/.exec(chaveSemPrefixo);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Remove do localStorage tudo que pertence a uma referência diferente da atual.
 *
 * Por que isso é necessário: no esquema por-referência as chaves nunca expiram,
 * então cada mês novo ADICIONA uma safra inteira (marcas + a lista de modelos de
 * cada marca tocada + anos + valores). A lista de modelos é a pesada — algumas
 * centenas de itens por marca. Deixar acumular estoura os ~5MB do localStorage
 * em poucos meses, e o modo de falha do estouro é o pior possível: o
 * `setItem` do VALOR começa a falhar silenciosamente e o batch volta a bater na
 * API pra tudo.
 *
 * Podar é seguro porque o localStorage aqui é só cache de chamada HTTP: o valor
 * que precisa sobreviver já está no Supabase (`fipe_batch.fipe_referencia`), e
 * uma referência passada nunca mais é consultada — o batch sempre roda na
 * corrente.
 *
 * Retorna quantas chaves foram removidas.
 */
export function podarOutrasReferencias(refAtual: number): number {
  const st = storage();
  if (!st) return 0;
  try {
    const alvos: string[] = [];
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i);
      if (!k || !k.startsWith(CACHE_PREFIX)) continue;
      const ref = refDaChave(k.slice(CACHE_PREFIX.length));
      if (ref != null && ref !== refAtual) alvos.push(k);
    }
    for (const k of alvos) st.removeItem(k);
    return alvos.length;
  } catch (err) {
    console.warn("Falha ao podar referências FIPE antigas:", err);
    return 0;
  }
}

// ───── HTTP ─────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FIPE ${res.status} em ${url}`);
  const data: unknown = await res.json();
  if (isRecord(data) && typeof data.error === "string") {
    throw new Error(`FIPE: ${data.error}`);
  }
  return data as T;
}

/**
 * Monta a URL já com a referência fixada.
 *
 * ATENÇÃO — o parâmetro é `referencia` (português), NÃO `reference`.
 * Verificado contra a API em 20/07/2026:
 *
 *   ?referencia=334 → R$ 84.317,00  "junho de 2026"   ✅ fixou
 *   ?reference=334  → R$ 83.627,00  "julho de 2026"   ❌ ignorado, devolve a corrente
 *
 * O nome errado NÃO dá erro: a API descarta o parâmetro e responde com o mês
 * corrente. É exatamente o tipo de falha que reintroduz o bug de defasagem sem
 * nenhum sintoma — por isso `getValor` confere o `MesReferencia` da resposta.
 */
function comReferencia(path: string, ref: number): string {
  return `${BASE}${path}?referencia=${ref}`;
}

// ───── Referências ──────────────────────────────────────────────────────────

function parseReferencias(data: unknown): FipeReferencia[] {
  if (!Array.isArray(data)) return [];
  const out: FipeReferencia[] = [];
  for (const item of data) {
    if (!isRecord(item)) continue;
    const codigo = item.Codigo;
    const mes = item.Mes;
    if (typeof codigo !== "number" || typeof mes !== "string") continue;
    out.push({ codigo, mes: mes.trim() });
  }
  return out;
}

/**
 * Lista de referências FIPE, da mais recente pra mais antiga.
 *
 * Só o plano gratuito: a corrente + 2 meses anteriores respondem; além disso a
 * API devolve `error` de assinatura paga. A lista em si vem completa.
 */
export async function getReferencias(): Promise<FipeReferencia[]> {
  const cached = cacheGet<FipeReferencia[]>("refs");
  if (cached && cached.length > 0) return cached;
  const refs = parseReferencias(await fetchJson<unknown>(REFERENCIAS_URL));
  if (refs.length === 0) {
    throw new Error("FIPE: lista de referências veio vazia ou em formato inesperado.");
  }
  cacheSet("refs", refs, REFS_TTL_MS);
  return refs;
}

/**
 * Referência corrente da tabela FIPE (ex.: `{ codigo: 335, mes: "julho/2026" }`).
 *
 * É o pivô de todo o cache: sem ela não se busca nem se grava preço nenhum.
 * Quando detecta virada de mês, poda a safra da referência anterior.
 */
export async function getReferenciaAtual(): Promise<FipeReferencia> {
  const refs = await getReferencias();
  // A API já devolve ordenado desc, mas não dependemos disso.
  const atual = refs.reduce((a, b) => (b.codigo > a.codigo ? b : a));
  const anterior = cacheGet<number>(KEY_REF_ATUAL);
  if (anterior !== atual.codigo) {
    podarOutrasReferencias(atual.codigo);
    cacheSet(KEY_REF_ATUAL, atual.codigo);
  }
  return atual;
}

/**
 * Compara dois rótulos de mês FIPE ignorando as diferenças de formatação entre
 * endpoints: `/referencias` devolve `"julho/2026"`, o endpoint de valor devolve
 * `"julho de 2026 "` (com " de " e às vezes espaço à direita).
 */
export function mesmoMesReferencia(a: string, b: string): boolean {
  return normalizarMes(a) === normalizarMes(b);
}

function normalizarMes(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+de\s+/g, "/")
    .replace(/\s+/g, "");
}

const MESES_CURTOS: Record<string, string> = {
  janeiro: "jan",
  fevereiro: "fev",
  março: "mar",
  marco: "mar",
  abril: "abr",
  maio: "mai",
  junho: "jun",
  julho: "jul",
  agosto: "ago",
  setembro: "set",
  outubro: "out",
  novembro: "nov",
  dezembro: "dez",
};

/**
 * `"julho/2026"` → `"jul/2026"`. Para exibição discreta ao lado do valor.
 * Devolve a entrada normalizada quando não reconhece o mês (nunca quebra a UI).
 */
export function formatReferenciaCurta(mes: string | null | undefined): string | null {
  if (!mes) return null;
  const norm = normalizarMes(mes);
  const [nome, ano] = norm.split("/");
  const curto = MESES_CURTOS[nome];
  if (!curto || !ano) return norm || null;
  return `${curto}/${ano}`;
}

// ───── Endpoints de dados (todos fixados numa referência) ───────────────────

export async function getMarcas(ref: number): Promise<FipeMarca[]> {
  const key = `marcas:${ref}`;
  const cached = cacheGet<FipeMarca[]>(key);
  if (cached) return cached;
  const data = await fetchJson<FipeMarca[]>(comReferencia("/marcas", ref));
  cacheSet(key, data);
  return data;
}

export async function getModelos(ref: number, marcaCod: string): Promise<FipeModelo[]> {
  const key = `modelos:${ref}:${marcaCod}`;
  const cached = cacheGet<FipeModelo[]>(key);
  if (cached) return cached;
  const data = await fetchJson<{ modelos: FipeModelo[] }>(
    comReferencia(`/marcas/${marcaCod}/modelos`, ref),
  );
  cacheSet(key, data.modelos);
  return data.modelos;
}

export async function getAnos(
  ref: number,
  marcaCod: string,
  modeloCod: number,
): Promise<FipeAno[]> {
  const key = `anos:${ref}:${marcaCod}:${modeloCod}`;
  const cached = cacheGet<FipeAno[]>(key);
  if (cached) return cached;
  const data = await fetchJson<FipeAno[]>(
    comReferencia(`/marcas/${marcaCod}/modelos/${modeloCod}/anos`, ref),
  );
  cacheSet(key, data);
  return data;
}

/**
 * Valor FIPE de um veículo numa referência específica.
 *
 * Recebe a referência inteira (e não só o código) porque CONFERE o
 * `MesReferencia` da resposta contra o mês esperado antes de cachear. Sem essa
 * conferência, qualquer regressão no parâmetro de query (nome trocado, typo,
 * mudança na API) volta a gravar valor da tabela corrente sob a chave de outra
 * referência — silenciosamente, que é como o bug original passou despercebido.
 *
 * O valor nunca expira: preço de uma referência fechada é imutável por definição.
 */
export async function getValor(
  ref: FipeReferencia,
  marcaCod: string,
  modeloCod: number,
  anoCod: string,
): Promise<FipeValor> {
  const key = `valor:${ref.codigo}:${marcaCod}:${modeloCod}:${anoCod}`;
  const cached = cacheGet<FipeValor>(key);
  if (cached) return cached;

  const data = await fetchJson<FipeValor>(
    comReferencia(`/marcas/${marcaCod}/modelos/${modeloCod}/anos/${anoCod}`, ref.codigo),
  );

  if (typeof data.MesReferencia !== "string" || !data.MesReferencia.trim()) {
    throw new Error(
      `FIPE devolveu valor sem MesReferencia (esperado ${ref.mes}). Preço descartado: sem referência não há como auditar.`,
    );
  }
  if (!mesmoMesReferencia(data.MesReferencia, ref.mes)) {
    throw new Error(
      `FIPE respondeu com a referência "${data.MesReferencia.trim()}" para uma consulta fixada em "${ref.mes}". ` +
        `Preço descartado pra não misturar tabelas.`,
    );
  }

  cacheSet(key, data);
  return data;
}

/**
 * Apaga TODO o cache FIPE do localStorage (referências, marcas, modelos, anos e
 * valores), incluindo o prefixo v1 aposentado.
 *
 * Com o cache por referência isso deixou de ser remédio de rotina: valores de
 * referências fechadas são imutáveis, então re-buscar devolve exatamente os
 * mesmos números — a limpeza custa milhares de requisições e não compra
 * correção nenhuma. Ficou como ferramenta de exceção (resposta corrompida da
 * API, depuração), não como parte do fluxo de "rodar o batch de novo".
 *
 * Retorna quantas chaves foram removidas.
 */
export function clearFipeLocalCache(): number {
  const st = storage();
  if (!st) return 0;
  try {
    const alvos: string[] = [];
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i);
      if (k && (k.startsWith(CACHE_PREFIX) || k.startsWith(CACHE_PREFIX_LEGADO))) alvos.push(k);
    }
    for (const k of alvos) st.removeItem(k);
    return alvos.length;
  } catch (err) {
    console.warn("Falha ao limpar cache FIPE local:", err);
    return 0;
  }
}

export function parseFipeValor(brValue: string): number {
  // "R$ 67.295,00" → 67295
  const cleaned = brValue.replace(/[R$\s.]/g, "").replace(",", ".");
  return Number.parseFloat(cleaned);
}
