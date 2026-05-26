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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-[var(--bg-app)] text-slate-700">
        <InventoryProvider>
          <AppShell>{children}</AppShell>
        </InventoryProvider>
      </body>
    </html>
  );
}
