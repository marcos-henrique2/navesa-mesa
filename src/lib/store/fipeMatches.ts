"use client";

import type { FipeMatch } from "@/lib/fipe/types";

const KEY = "navesa-mesa:fipe-matches-v1";

export function getMatch(chassi: string): FipeMatch | null {
  if (typeof window === "undefined") return null;
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, FipeMatch>;
    return all[chassi] ?? null;
  } catch {
    return null;
  }
}

export function saveMatch(chassi: string, match: FipeMatch): void {
  if (typeof window === "undefined") return;
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, FipeMatch>;
    all[chassi] = match;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (err) {
    console.warn("Falha ao salvar match FIPE:", err);
  }
}
