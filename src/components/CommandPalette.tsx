"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import type { ReactNode, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Search, Car, ShoppingCart, Upload, BarChart3, MessageSquare, Sparkles, History } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";

type ResultItem =
  | { tipo: "veiculo"; chassi: string; placa: string; modelo: string; marca: string; loja: string }
  | { tipo: "venda"; chassi: string; placa: string; modelo: string; cliente: string; valor: number; data: string }
  | { tipo: "atalho"; rota: string; label: string; icone: ReactNode };

const ATALHOS: ResultItem[] = [
  { tipo: "atalho", rota: "/upload", label: "Upload de relatórios", icone: <Upload className="h-4 w-4" /> },
  { tipo: "atalho", rota: "/vendas", label: "Análise de vendas", icone: <BarChart3 className="h-4 w-4" /> },
  { tipo: "atalho", rota: "/insights", label: "Insights operacionais", icone: <Sparkles className="h-4 w-4" /> },
  { tipo: "atalho", rota: "/historico", label: "Histórico de snapshots", icone: <History className="h-4 w-4" /> },
  { tipo: "atalho", rota: "/chat", label: "Chat IA", icone: <MessageSquare className="h-4 w-4" /> },
];

export function CommandPalette() {
  const router = useRouter();
  const { veiculos, vendas } = useInventory();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Abre com Ctrl+K / Cmd+K + escuta CustomEvent disparado pelo botão do header
  useEffect(() => {
    const abrir = () => {
      // Reset feito no mesmo handler que abre — evita setState dentro de effect [open]
      setQ("");
      setActiveIdx(0);
      setOpen(true);
    };
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Toggle: se aberto, fecha; senão, abre limpo
        setOpen((o) => {
          if (!o) {
            setQ("");
            setActiveIdx(0);
            return true;
          }
          return false;
        });
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("open-command-palette", abrir);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("open-command-palette", abrir);
    };
  }, []);

  // Foco no input quando abre (efeito sincroniza com DOM externo — sem setState)
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  const resultados = useMemo<ResultItem[]>(() => {
    if (!q.trim()) return ATALHOS;
    const query = q.toLowerCase();
    const items: ResultItem[] = [];

    // Veículos (top 10)
    let veicQt = 0;
    for (const v of veiculos) {
      if (veicQt >= 10) break;
      const hay = `${v.placa ?? ""} ${v.chassi} ${v.modelo} ${v.marca ?? ""}`.toLowerCase();
      if (hay.includes(query)) {
        items.push({
          tipo: "veiculo",
          chassi: v.chassi,
          placa: v.placa ?? "—",
          modelo: v.modelo,
          marca: v.marca ?? "",
          loja: `Loja ${v.cod_empresa}`,
        });
        veicQt++;
      }
    }

    // Vendas (top 10)
    let venQt = 0;
    for (const v of vendas) {
      if (venQt >= 10) break;
      const hay = `${v.placa ?? ""} ${v.chassi} ${v.modelo} ${v.cliente_nome ?? ""} ${v.vendedor_nome ?? ""}`.toLowerCase();
      if (hay.includes(query)) {
        items.push({
          tipo: "venda",
          chassi: v.chassi,
          placa: v.placa ?? "—",
          modelo: v.modelo,
          cliente: v.cliente_nome ?? "—",
          valor: v.valor_venda ?? 0,
          data: v.data_venda ? new Date(v.data_venda).toLocaleDateString("pt-BR") : "—",
        });
        venQt++;
      }
    }

    // Atalhos que casam
    for (const a of ATALHOS) {
      if (a.tipo === "atalho" && a.label.toLowerCase().includes(query)) {
        items.push(a);
      }
    }

    return items.slice(0, 25);
  }, [q, veiculos, vendas]);

  function selecionar(idx: number) {
    const r = resultados[idx];
    if (!r) return;
    setOpen(false);
    if (r.tipo === "veiculo") {
      router.push(`/veiculos/${r.chassi}`);
    } else if (r.tipo === "venda") {
      router.push(`/vendas/${r.chassi}`);
    } else {
      router.push(r.rota);
    }
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, resultados.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      selecionar(activeIdx);
    }
  }

  if (!open) return null;

  // Agrupar visualmente — mantém a ordem de `resultados` pra que o índice do teclado bata
  const atalhosRes: ResultItem[] = [];
  const veiculosRes: ResultItem[] = [];
  const vendasRes: ResultItem[] = [];
  // Mapeia cada item agrupado de volta pro índice original em `resultados`
  const idxMap = new Map<ResultItem, number>();
  resultados.forEach((r, i) => idxMap.set(r, i));
  for (const r of resultados) {
    if (r.tipo === "atalho") atalhosRes.push(r);
    else if (r.tipo === "veiculo") veiculosRes.push(r);
    else vendasRes.push(r);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[10vh]"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-label="Pesquisa global"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-lg overflow-hidden"
      >
        <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-4 py-3">
          <Search className="h-4 w-4 text-[var(--text-muted)]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActiveIdx(0); }}
            onKeyDown={onKeyDown}
            placeholder="Buscar carros, vendas, clientes, vendedores..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--text-subtle)] text-[var(--text-strong)]"
          />
          <kbd className="rounded bg-[var(--bg-muted)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">ESC</kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {resultados.length === 0 && (
            <div className="p-6 text-center text-sm text-[var(--text-muted)]">
              Nada encontrado pra &quot;{q}&quot;
            </div>
          )}

          {atalhosRes.length > 0 && (
            <Section title="Atalhos">
              {atalhosRes.map((r) => {
                if (r.tipo !== "atalho") return null;
                const idx = idxMap.get(r) ?? 0;
                return (
                  <Item
                    key={`a-${r.rota}`}
                    active={idx === activeIdx}
                    onClick={() => selecionar(idx)}
                    icone={r.icone}
                    title={r.label}
                  />
                );
              })}
            </Section>
          )}

          {veiculosRes.length > 0 && (
            <Section title={`Carros no estoque (${veiculosRes.length})`}>
              {veiculosRes.map((r) => {
                if (r.tipo !== "veiculo") return null;
                const idx = idxMap.get(r) ?? 0;
                return (
                  <Item
                    key={`v-${r.chassi}`}
                    active={idx === activeIdx}
                    onClick={() => selecionar(idx)}
                    icone={<Car className="h-4 w-4" />}
                    title={`${r.marca} ${r.modelo}`.trim()}
                    sub={`${r.placa} · ${r.loja}`}
                  />
                );
              })}
            </Section>
          )}

          {vendasRes.length > 0 && (
            <Section title={`Vendas (${vendasRes.length})`}>
              {vendasRes.map((r) => {
                if (r.tipo !== "venda") return null;
                const idx = idxMap.get(r) ?? 0;
                return (
                  <Item
                    key={`s-${r.chassi}`}
                    active={idx === activeIdx}
                    onClick={() => selecionar(idx)}
                    icone={<ShoppingCart className="h-4 w-4" />}
                    title={r.modelo}
                    sub={`${r.cliente} · ${r.data} · R$ ${r.valor.toLocaleString("pt-BR")}`}
                  />
                );
              })}
            </Section>
          )}
        </div>

        <div className="border-t border-[var(--border-soft)] px-4 py-2 text-[11px] text-[var(--text-muted)] flex gap-3">
          <span><kbd className="rounded bg-[var(--bg-muted)] px-1 py-0.5">↑↓</kbd> navegar</span>
          <span><kbd className="rounded bg-[var(--bg-muted)] px-1 py-0.5">enter</kbd> abrir</span>
          <span className="ml-auto"><kbd className="rounded bg-[var(--bg-muted)] px-1 py-0.5">ctrl+k</kbd> abre essa busca</span>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="py-1">
      <div className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{title}</div>
      {children}
    </div>
  );
}

function Item({ active, onClick, icone, title, sub }: {
  active: boolean;
  onClick: () => void;
  icone: ReactNode;
  title: string;
  sub?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={(e) => e.currentTarget.focus()}
      className={
        "flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition " +
        (active ? "bg-[var(--bg-muted)]" : "hover:bg-[var(--bg-muted)]")
      }
    >
      <span className="text-[var(--text-muted)]">{icone}</span>
      <span className="flex-1 min-w-0">
        <span className="block truncate text-[var(--text-strong)]">{title}</span>
        {sub && <span className="block truncate text-xs text-[var(--text-muted)]">{sub}</span>}
      </span>
    </button>
  );
}
