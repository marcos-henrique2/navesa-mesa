"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Car, TrendingUp, Building2, Upload, Menu, X, Sparkles, MessageSquare, History, ChevronLeft, ChevronRight, LogOut, Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { DataGate } from "./DataGate";
import { ThemeToggle } from "./ThemeToggle";
import { ToastContainer } from "./ui/Toast";
import { Tooltip } from "./ui/Tooltip";
import { CommandPalette } from "./CommandPalette";
import { createClient } from "@/lib/supabase/client";

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
  // Sempre começa false (igual SSR) pra evitar hydration mismatch.
  // O valor real do localStorage é aplicado após mount via useEffect.
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [hidratado, setHidratado] = useState(false);

  // Hidrata do localStorage só após mount (post-hydration)
  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSED_KEY) === "true") setCollapsed(true);
    } catch {}
    setHidratado(true);
  }, []);

  // Persiste preferência (só depois de hidratar, evita escrever o default no primeiro render)
  useEffect(() => {
    if (!hidratado) return;
    try { localStorage.setItem(COLLAPSED_KEY, String(collapsed)); } catch {}
  }, [collapsed, hidratado]);

  // /login não tem shell — renderiza children direto (sem sidebar, sem DataGate).
  // Mantido após os hooks acima pra respeitar rules-of-hooks.
  if (pathname === "/login") {
    return (
      <>
        {children}
        <ToastContainer />
      </>
    );
  }

  const toggle = () => setCollapsed((c) => !c);

  return (
    <div className="flex min-h-screen bg-[var(--bg-app)]">
      {/* Sidebar desktop */}
      <aside
        suppressHydrationWarning
        className={cn(
          "hidden md:flex flex-col border-r border-[var(--border-soft)] bg-[var(--bg-surface)] transition-[width] duration-200 ease-out",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <SidebarContent pathname={pathname} collapsed={collapsed} onToggle={toggle} />
      </aside>

      {/* Sidebar mobile (drawer) — sempre full no mobile, sem toggle */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside className="absolute inset-y-0 left-0 w-64 bg-[var(--bg-surface)] shadow-lg" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setOpen(false)} className="absolute right-3 top-3 rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-muted)]"><X className="h-5 w-5" /></button>
            <SidebarContent pathname={pathname} collapsed={false} onItemClick={() => setOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Topbar mobile (sidebar trigger + user) */}
        <header className="flex items-center gap-3 border-b border-[var(--border-soft)] bg-[var(--bg-surface)] px-4 py-3 md:hidden">
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-[var(--text-body)] hover:bg-[var(--bg-muted)]"><Menu className="h-5 w-5" /></button>
          <span className="font-semibold text-[var(--text-strong)]">Navesa Mesa</span>
          <div className="ml-auto flex items-center gap-1"><ThemeToggle /><UserMenu /></div>
        </header>

        {/* Topbar desktop (busca + theme toggle + user no canto direito) */}
        <header className="hidden md:flex items-center justify-end gap-1 border-b border-[var(--border-soft)] bg-[var(--bg-surface)] px-6 py-2">
          <SearchTrigger />
          <ThemeToggle />
          <UserMenu />
        </header>

        <main className="flex-1 min-w-0"><DataGate>{children}</DataGate></main>
      </div>

      {/* Toasts globais — montado 1x no shell, fora do <main> pra não afetar layout/scroll */}
      <ToastContainer />
      {/* Command palette global — Ctrl+K em qualquer página, montado fora do DataGate */}
      <CommandPalette />
    </div>
  );
}

function SearchTrigger() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
      className="hidden md:inline-flex items-center gap-2 rounded-md border border-[var(--border-soft)] bg-[var(--bg-muted)] px-3 py-1.5 text-xs text-[var(--text-muted)] transition hover:bg-[var(--bg-app)] mr-2"
      title="Buscar (Ctrl+K)"
    >
      <Search className="h-3.5 w-3.5" />
      <span>Buscar...</span>
      <kbd className="rounded border border-[var(--border-soft)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[10px]">Ctrl+K</kbd>
    </button>
  );
}

function UserMenu() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setEmail(data.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setEmail(session?.user.email ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    try {
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  if (!email) return null;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="hidden truncate text-[var(--text-muted)] sm:inline max-w-[200px]" title={email}>
        {email}
      </span>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-soft)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[var(--text-body)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--text-strong)] disabled:opacity-50"
        title="Sair"
      >
        {signingOut ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
        <span>Sair</span>
      </button>
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
              <p className="truncate text-sm font-bold leading-none text-[var(--text-strong)]">Navesa Mesa</p>
              <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">Precificação de Seminovos</p>
            </div>
          )}
        </Link>
        {onToggle && !collapsed && (
          <button
            onClick={onToggle}
            className="rounded-md p-1 text-[var(--text-subtle)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--text-body)]"
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
            className="rounded-md p-1.5 text-[var(--text-subtle)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--text-body)]"
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
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">Navegação</p>
        )}
        <ul className="space-y-1">
          {NAV.map((item) => {
            const active = item.match ? item.match(pathname) : pathname.startsWith(item.href);
            const link = (
              <Link
                href={item.href}
                onClick={onItemClick}
                className={cn(
                  "flex items-center rounded-lg text-sm font-medium transition",
                  collapsed ? "justify-center px-2 py-2" : "gap-2.5 px-3 py-2",
                  active
                    ? "bg-gradient-to-r from-[var(--brand-50)] to-transparent text-[var(--brand-900)] shadow-sm dark:from-[var(--brand-900)]/30 dark:text-[var(--brand-100)]"
                    : "text-[var(--text-body)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-strong)]",
                )}
              >
                <span className={active ? "text-[var(--brand-700)] dark:text-[var(--brand-300)]" : "text-[var(--text-subtle)]"}>{item.icon}</span>
                {!collapsed && (
                  <>
                    <span className="truncate">{item.label}</span>
                    {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--brand-600)]" />}
                  </>
                )}
              </Link>
            );
            return (
              <li key={item.href}>
                {collapsed ? (
                  <Tooltip content={item.label} side="right">
                    {link}
                  </Tooltip>
                ) : (
                  link
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {!collapsed && (
        <div className="border-t border-[var(--border-soft)] px-5 py-3 text-[11px] text-[var(--text-subtle)]">
          <p>Mesa de Precificação</p>
          <p className="mt-0.5">Versão MVP · {new Date().getFullYear()}</p>
        </div>
      )}
    </>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border-soft)] bg-[var(--bg-surface)] px-6 py-5">
      <div>
        <h1 className="text-xl font-bold text-[var(--text-strong)]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-[var(--text-muted)]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
