import type { FipeMarca, FipeModelo, FipeAno, FipeValor } from "./types";

const BASE = "https://parallelum.com.br/fipe/api/v1/carros";
const CACHE_PREFIX = "navesa-mesa:fipe-cache-v1:";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function cacheGet<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { value, expires } = JSON.parse(raw) as { value: T; expires: number };
    if (Date.now() > expires) return null;
    return value;
  } catch {
    return null;
  }
}

function cacheSet<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      CACHE_PREFIX + key,
      JSON.stringify({ value, expires: Date.now() + TTL_MS }),
    );
  } catch (err) {
    console.warn("FIPE cache write falhou:", err);
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FIPE ${res.status} em ${url}`);
  const data = await res.json();
  if (data?.error) throw new Error(`FIPE: ${data.error}`);
  return data as T;
}

export async function getMarcas(): Promise<FipeMarca[]> {
  const cached = cacheGet<FipeMarca[]>("marcas");
  if (cached) return cached;
  const data = await fetchJson<FipeMarca[]>(`${BASE}/marcas`);
  cacheSet("marcas", data);
  return data;
}

export async function getModelos(marcaCod: string): Promise<FipeModelo[]> {
  const cached = cacheGet<FipeModelo[]>(`modelos:${marcaCod}`);
  if (cached) return cached;
  const data = await fetchJson<{ modelos: FipeModelo[] }>(`${BASE}/marcas/${marcaCod}/modelos`);
  cacheSet(`modelos:${marcaCod}`, data.modelos);
  return data.modelos;
}

export async function getAnos(marcaCod: string, modeloCod: number): Promise<FipeAno[]> {
  const cached = cacheGet<FipeAno[]>(`anos:${marcaCod}:${modeloCod}`);
  if (cached) return cached;
  const data = await fetchJson<FipeAno[]>(`${BASE}/marcas/${marcaCod}/modelos/${modeloCod}/anos`);
  cacheSet(`anos:${marcaCod}:${modeloCod}`, data);
  return data;
}

export async function getValor(marcaCod: string, modeloCod: number, anoCod: string): Promise<FipeValor> {
  const key = `valor:${marcaCod}:${modeloCod}:${anoCod}`;
  const cached = cacheGet<FipeValor>(key);
  if (cached) return cached;
  const data = await fetchJson<FipeValor>(`${BASE}/marcas/${marcaCod}/modelos/${modeloCod}/anos/${anoCod}`);
  cacheSet(key, data);
  return data;
}

export function parseFipeValor(brValue: string): number {
  // "R$ 67.295,00" → 67295
  const cleaned = brValue.replace(/[R$\s.]/g, "").replace(",", ".");
  return Number.parseFloat(cleaned);
}
