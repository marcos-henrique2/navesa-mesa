"use client";

import { useState, type FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LogIn, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setSubmitting(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setSubmitting(false);
      // Mensagens em pt-BR — não exponha detalhes técnicos.
      if (error.message.toLowerCase().includes("invalid")) {
        setErro("E-mail ou senha incorretos.");
      } else if (error.message.toLowerCase().includes("email not confirmed")) {
        setErro("E-mail ainda não confirmado. Procure o administrador.");
      } else {
        setErro("Não foi possível entrar. Tente novamente em instantes.");
      }
      return;
    }

    // Sucesso — usa replace pra não voltar pro /login no histórico.
    const next = searchParams.get("next");
    const destino = next && next.startsWith("/") ? next : "/";
    router.replace(destino);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-app)] px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Logo + título */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--brand-700)] to-[var(--brand-900)] text-white shadow-sm">
            <span className="text-lg font-bold tracking-tight">N</span>
          </div>
          <h1 className="text-lg font-bold text-slate-900">Navesa Mesa</h1>
          <p className="mt-0.5 text-sm text-slate-500">Precificação de Seminovos</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-[var(--border-soft)] bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Entrar</h2>
          <p className="mt-1 text-xs text-slate-500">
            Use suas credenciais Navesa. Contas são criadas pelos administradores.
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-slate-700">
                E-mail
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-[var(--brand-600)] focus:ring-2 focus:ring-[var(--brand-100)] disabled:bg-slate-50"
                placeholder="seu.email@navesa.com.br"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-slate-700">
                Senha
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-[var(--brand-600)] focus:ring-2 focus:ring-[var(--brand-100)] disabled:bg-slate-50"
                placeholder="••••••••"
              />
            </div>

            {erro && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{erro}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !email || !password}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[var(--brand-700)] to-[var(--brand-900)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Entrando...
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  Entrar
                </>
              )}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-[11px] text-slate-400">
          Mesa de Precificação · Versão MVP · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
