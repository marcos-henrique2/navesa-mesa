import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { InventoryProvider } from "@/lib/store/inventory";
import { AppShell } from "@/components/AppShell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Navesa Mesa · Precificação de Seminovos",
  description: "Plataforma interna de precificação e análise de vendas de seminovos do Grupo Navesa.",
};

// Script inline que aplica o tema ANTES do React montar — evita flash light → dark.
// Lê localStorage e media query; se resultado for dark, adiciona .dark no <html>.
// Em try/catch porque localStorage pode lançar em modo privado.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('navesa-mesa:tema')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full bg-[var(--bg-app)] text-[var(--text-body)]">
        <InventoryProvider>
          <AppShell>{children}</AppShell>
        </InventoryProvider>
      </body>
    </html>
  );
}
