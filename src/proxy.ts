import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Proxy (file convention do Next 16, antigo middleware.ts).
 *
 * - Atualiza a sessão Supabase em todo request (refresh de token via cookies).
 * - Bloqueia rotas privadas quando não há usuário autenticado, redirecionando
 *   pra /login com ?next= preservando a rota original.
 *
 * Rotas públicas (não exigem auth):
 *   - /login
 *   - /api/auth/*  (callback OAuth/magic link futuro)
 *
 * Demais rotas (UI + APIs internas) exigem usuário autenticado.
 */
const PUBLIC_PATHS = ["/login"];
const PUBLIC_PREFIXES = ["/api/auth/"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);

  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    // Se já está logado e tenta abrir /login, manda pra home.
    if (user && pathname === "/login") {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return response;
  }

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Preserva destino original pra redirecionar de volta após login.
    // Valida que o path é relativo e não protocol-relative (// → domínio externo).
    const next = pathname + (search || "");
    const isSafeNext = next.startsWith("/") && !next.startsWith("//");
    if (isSafeNext) {
      url.searchParams.set("next", next);
    }
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Exclui assets estáticos e otimização de imagem. Inclui APIs (exceto /api/auth).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff|woff2|ttf|otf|eot|pdf|txt|json|webmanifest|xml)$).*)",
  ],
};
