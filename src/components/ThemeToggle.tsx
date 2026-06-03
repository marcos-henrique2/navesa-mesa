"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Sun, Moon, Monitor } from "lucide-react";

type Tema = "system" | "light" | "dark";

const TEMA_KEY = "navesa-mesa:tema";

function aplicarTema(tema: Tema) {
  const root = document.documentElement;
  const ehDark =
    tema === "dark" ||
    (tema === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", ehDark);
}

function lerTema(): Tema {
  try {
    const v = localStorage.getItem(TEMA_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
}

// Listener pro useSyncExternalStore — escuta evento "storage" + evento custom
// disparado pelo próprio toggle pra re-render imediato em outras abas/iframes.
function subscrever(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", cb);
  window.addEventListener("navesa-mesa:tema-mudou", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("navesa-mesa:tema-mudou", cb);
  };
}

/**
 * Toggle de tema com 3 estados: Sistema → Light → Dark → Sistema.
 * Persiste preferência no localStorage e sincroniza com a media query
 * `prefers-color-scheme` quando o modo "system" está ativo.
 *
 * O anti-flicker fica no script inline do layout.tsx (head). Esse componente
 * só assume controle pós-hidratação.
 *
 * Usa useSyncExternalStore pra ler localStorage como fonte da verdade externa —
 * evita anti-pattern de setState dentro de useEffect. Server snapshot retorna
 * "system" (mesmo default do script anti-flicker, então sem hydration mismatch).
 */
export function ThemeToggle() {
  // SSR retorna "system" — bate com o estado inicial assumido pelo script
  // anti-flicker no head. No client, lê localStorage de verdade.
  const tema = useSyncExternalStore<Tema>(subscrever, lerTema, () => "system");

  // Re-aplica DOM quando tema=system e o SO muda
  useEffect(() => {
    if (tema !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => aplicarTema("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [tema]);

  const ciclar = () => {
    const proximo: Tema =
      tema === "system" ? "light" : tema === "light" ? "dark" : "system";
    try {
      localStorage.setItem(TEMA_KEY, proximo);
    } catch {}
    aplicarTema(proximo);
    // Notifica useSyncExternalStore pra re-render (storage event não dispara
    // na mesma aba que escreveu).
    window.dispatchEvent(new Event("navesa-mesa:tema-mudou"));
  };

  const label =
    tema === "system" ? "Sistema" : tema === "light" ? "Claro" : "Escuro";

  return (
    <button
      type="button"
      onClick={ciclar}
      aria-label={`Tema atual: ${label}. Clique pra alternar.`}
      title={`Tema: ${label}`}
      // SSR sempre renderiza o ícone de Monitor (tema=system).
      // Após hydration, useSyncExternalStore re-renderiza com o tema real do
      // localStorage. O suppressHydrationWarning previne warning do React
      // quando o ícone difere entre SSR e client.
      suppressHydrationWarning
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--text-strong)]"
    >
      {tema === "system" && <Monitor className="h-4 w-4" />}
      {tema === "light" && <Sun className="h-4 w-4" />}
      {tema === "dark" && <Moon className="h-4 w-4" />}
    </button>
  );
}
