"use client";

/**
 * Casca de `/repasses/importar`: as DUAS formas de trazer o Auto Avaliar pro
 * sistema, lado a lado.
 *
 * Elas NÃO são intercambiáveis, e a tela existe pra deixar isso explícito:
 *   • Colar texto  → CRIA carro novo (km, cor, gastos). Único caminho que cria
 *                    repasse e único que reconcilia quem sumiu da lista.
 *   • Arquivo .xls → SÓ ATUALIZA valores de quem já existe. Único que traz
 *                    maior oferta recebida e qtde de anúncios. Nunca cria carro.
 *
 * Toda a lógica mora nas duas abas; aqui é só a escolha e o texto que explica.
 *
 * Duas decisões de implementação que não são cosméticas:
 *
 * 1. Só a aba ativa fica MONTADA (não é `hidden`), pra `ImportarPorArquivo`
 *    poder ser lazy de verdade. O preço é que trocar de aba mata o estado da
 *    outra — por isso a troca é guardada quando há colagem/preview em pé.
 * 2. `ImportarPorArquivo` entra por `next/dynamic`: ele puxa o SheetJS (~460 KB
 *    minificado), e sem isso todo carregamento de /repasses/importar pagaria
 *    esse chunk mesmo pra quem só vai colar texto.
 */

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ClipboardPaste, FileUp, Loader2 } from "lucide-react";
import { ImportarPorTexto } from "@/components/repasses/ImportarPorTexto";
import { cn } from "@/lib/utils";

const ImportarPorArquivo = dynamic(
  () =>
    import("@/components/repasses/ImportarPorArquivo").then((m) => m.ImportarPorArquivo),
  {
    ssr: false,
    loading: () => (
      <p className="flex items-center gap-2 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5 text-sm text-[var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando o leitor de planilha…
      </p>
    ),
  },
);

type Aba = "texto" | "arquivo";

type InfoAba = {
  rotulo: string;
  resumo: string;
  icone: React.ReactNode;
  detalhe: React.ReactNode;
};

/** Ordem de exibição das abas — "texto" primeiro porque é o que cria carro. */
const ORDEM: ReadonlyArray<Aba> = ["texto", "arquivo"];

const ABAS: Record<Aba, InfoAba> = {
  texto: {
    rotulo: "Colar texto",
    resumo: "cria carro novo",
    icone: <ClipboardPaste className="h-4 w-4" />,
    detalhe: (
      <>
        <strong>Use quando tem carro novo pra entrar em repasse.</strong> É o único
        caminho que <strong>cria</strong> carro no sistema — traz km, cor e gastos, e
        é o único que reconcilia quem sumiu da lista (vendido / volta pra marcado).
        Não traz maior oferta nem qtde de anúncios: pra isso é a aba do arquivo.
      </>
    ),
  },
  arquivo: {
    rotulo: "Subir arquivo .xls",
    resumo: "só atualiza valores",
    icone: <FileUp className="h-4 w-4" />,
    detalhe: (
      <>
        <strong>Use pra atualizar os valores de quem já está em repasse.</strong>{" "}
        <strong>Nunca cria</strong> carro — quem não existe no sistema é só listado e
        ignorado. É o único que traz <strong>maior oferta recebida</strong> e{" "}
        <strong>qtde de anúncios</strong>, que aparecem em /repasses. Se o carro ainda
        não existe, importe antes pela aba de colar texto.
      </>
    ),
  },
};

export function ImportarAutoAvaliar() {
  const [aba, setAba] = useState<Aba>("texto");
  /** Espelha o estado interno da aba de texto (colagem/preview em pé). */
  const [textoComTrabalhoVivo, setTextoComTrabalhoVivo] = useState(false);
  const refsAbas = useRef<Partial<Record<Aba, HTMLButtonElement | null>>>({});
  const ativa = ABAS[aba];

  /** Devolve `true` se a troca aconteceu. Sair do texto com trabalho vivo pede aval. */
  function trocarAba(destino: Aba): boolean {
    if (destino === aba) return false;
    if (
      aba === "texto" &&
      textoComTrabalhoVivo &&
      !confirm("Trocar de aba descarta a colagem e o preview. Continuar?")
    ) {
      return false;
    }
    setTextoComTrabalhoVivo(false);
    setAba(destino);
    return true;
  }

  /** Padrão ARIA de tablist: setas circulam, Home/End vão às pontas. */
  function navegarPorTeclado(e: React.KeyboardEvent<HTMLDivElement>) {
    const atual = ORDEM.indexOf(aba);
    const destino =
      e.key === "ArrowRight" ? ORDEM[(atual + 1) % ORDEM.length]
      : e.key === "ArrowLeft" ? ORDEM[(atual - 1 + ORDEM.length) % ORDEM.length]
      : e.key === "Home" ? ORDEM[0]
      : e.key === "End" ? ORDEM[ORDEM.length - 1]
      : undefined;
    if (destino === undefined) return;
    e.preventDefault();
    if (trocarAba(destino)) refsAbas.current[destino]?.focus();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div
        role="tablist"
        aria-label="Forma de importar"
        onKeyDown={navegarPorTeclado}
        className="grid gap-3 sm:grid-cols-2"
      >
        {ORDEM.map((id) => {
          const a = ABAS[id];
          const selecionada = id === aba;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`aba-${id}`}
              ref={(el) => {
                refsAbas.current[id] = el;
              }}
              aria-selected={selecionada}
              // Só o painel ATIVO existe no DOM — apontar pro outro seria um
              // aria-controls órfão.
              aria-controls={selecionada ? `painel-${id}` : undefined}
              tabIndex={selecionada ? 0 : -1}
              onClick={() => trocarAba(id)}
              className={cn(
                "rounded-xl border-2 px-4 py-3 text-left transition",
                selecionada
                  ? "border-[var(--brand-700)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]"
                  : "border-[var(--border-soft)] bg-[var(--bg-muted)] hover:border-[var(--border-base)]",
              )}
            >
              <span
                className={cn(
                  "inline-flex items-center gap-2 text-sm font-semibold",
                  selecionada ? "text-[var(--brand-700)]" : "text-[var(--text-body)]",
                )}
              >
                {a.icone} {a.rotulo}
              </span>
              <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                {a.resumo}
              </span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`painel-${aba}`}
        aria-labelledby={`aba-${aba}`}
        className="space-y-5"
      >
        <p className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-muted)] px-4 py-3 text-xs leading-relaxed text-[var(--text-body)]">
          {ativa.detalhe}
        </p>

        {aba === "texto" ? (
          <ImportarPorTexto onTrabalhoVivoChange={setTextoComTrabalhoVivo} />
        ) : (
          <ImportarPorArquivo />
        )}
      </div>
    </div>
  );
}
