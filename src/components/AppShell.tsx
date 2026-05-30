"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Car, TrendingUp, Building2, Upload, Menu, X, Sparkles, MessageSquare, History, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { DataGate } from "./DataGate";

const COLLAPSED_KEY = "navesa-mesa:sidebar-collapsed";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  match?: (path: string) => boolean;
};

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" />, match: (p) => p === "/" },
  { href: "/veiculos", label: "Estoque", icon: <Car className="h-4 w-4" />, match: (p) => p.startsWith("/veiculos") },
  { href: "/vendas", label: "Análise de Vendas", icon: <TrendingUp className="h-4 w-4" />, match: (p) => p.startsWith("/vendas") },
  { href: "/insights", label: "Insights", icon: <Sparkles className="h-4 w-4" />, match: (p) => p.startsWith("/insights") },
  { href: "/historico", label: "Histórico", icon: <History className="h-4 w-4" />, match: (p) => p.startsWith("/historico") },
  { href: "/chat", label: "Chat IA", icon: <MessageSquare className="h-4 w-4" />, match: (p) => p.startsWith("/chat") },
  { href: "/upload", label: "Upload de Relatórios", icon: <Upload className="h-4 w-4" />, match: (p) => p.startsWith("/upload") },
  { href: "/lojas", label: "Cadastro de Lojas", icon: <Building2 className="h-4 w-4" />, match: (p) => p.startsWith("/lojas") },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Lazy init: lê preferência do localStorage. SSR retorna false.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem(COLLAPSED_KEY) === "true"; } catch { return false; }
  });

  // Persiste preferência
  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, String(collapsed)); } catch {}
  }, [collapsed]);

  const toggle = () => setCollapsed((c) => !c);

  return (
    <div className="flex min-h-screen bg-[var(--bg-app)]">
      {/* Sidebar desktop */}
      <aside
        suppressHydrationWarning
        className={cn(
          "hidden md:flex flex-col border-r border-[var(--border-soft)] bg-white transition-[width] duration-200 ease-out",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <SidebarContent pathname={pathname} collapsed={collapsed} onToggle={toggle} />
      </aside>

      {/* Sidebar mobile (drawer) — sempre full no mobile, sem toggle */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setOpen(false)} className="absolute right-3 top-3 rounded-md p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            <SidebarContent pathname={pathname} collapsed={false} onItemClick={() => setOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Topbar mobile */}
        <header className="flex items-center gap-3 border-b border-[var(--border-soft)] bg-white px-4 py-3 md:hidden">
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"><Menu className="h-5 w-5" /></button>
          <span className="font-semibold text-slate-900">Navesa Mesa</span>
        </header>

        <main className="flex-1 min-w-0"><DataGate>{children}</DataGate></main>
      </div>
    </div>
  );
}

function SidebarContent({
  pathname,
  collapsed,
  onItemClick,
  onToggle,
}: {
  pathname: string;
  collapsed: boolean;
  onItemClick?: () => void;
  onToggle?: () => void;
}) {
  return (
    <>
      {/* Logo + toggle */}
      <div
        className={cn(
          "flex items-center border-b border-[var(--border-soft)] py-5",
          collapsed ? "justify-center px-2" : "justify-between px-5",
        )}
      >
        <Link href="/" onClick={onItemClick} className="flex items-center gap-2.5 text-[var(--brand-900)] min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--brand-700)] to-[var(--brand-900)] text-white shadow-sm">
            <span className="text-sm font-bold tracking-tight">N</span>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-none text-slate-900">Navesa Mesa</p>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">Precificação de Seminovos</p>
            </div>
          )}
        </Link>
        {onToggle && !collapsed && (
          <button
            onClick={onToggle}
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            title="Recolher menu"
            aria-label="Recolher menu"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Botão expandir (só quando colapsado) */}
      {onToggle && collapsed && (
        <div className="flex justify-center border-b border-[var(--border-soft)] py-2">
          <button
            onClick={onToggle}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            title="Expandir menu"
            aria-label="Expandir menu"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Nav */}
      <nav className={cn("flex-1 py-4", collapsed ? "px-2" : "px-3")}>
        {!collapsed && (
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Navegação</p>
        )}
        <ul className="space-y-1">
          {NAV.map((item) => {
            const active = item.match ? item.match(pathname) : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onItemClick}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "flex items-center rounded-lg text-sm font-medium transition",
                    collapsed ? "justify-center px-2 py-2" : "gap-2.5 px-3 py-2",
                    active
                      ? "bg-gradient-to-r from-[var(--brand-50)] to-transparent text-[var(--brand-900)] shadow-sm"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                  )}
                >
                  <span className={active ? "text-[var(--brand-700)]" : "text-slate-400"}>{item.icon}</span>
                  {!collapsed && (
                    <>
                      <span className="truncate">{item.label}</span>
                      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--brand-600)]" />}
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {!collapsed && (
        <div className="border-t border-[var(--border-soft)] px-5 py-3 text-[11px] text-slate-400">
          <p>Mesa de Precificação</p>
          <p className="mt-0.5">Versão MVP · {new Date().getFullYear()}</p>
        </div>
      )}
    </>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border-soft)] bg-white px-6 py-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
