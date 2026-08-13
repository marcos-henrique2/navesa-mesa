"use client";

/**
 * Casca de `/repasses/importar`: as TRÊS formas de trazer o Auto Avaliar pro
 * sistema, lado a lado.
 *
 * Elas NÃO são intercambiáveis, e a tela existe pra deixar isso explícito:
 *   • Colar texto       → CRIA carro novo no ar (km, cor, gastos). Único que
 *                         reconcilia quem sumiu da lista.
 *   • Arquivo .xls      → SÓ ATUALIZA valores de quem já existe. Único que traz
 *                         maior oferta recebida e qtde de anúncios. Nunca cria.
 *   • Vendas concluídas → REGISTRA A VENDA (marca vendido, data e valor) e cria
 *                         o carro que nunca passou pelo sistema, já como vendido.
 *
 * Toda a lógica mora nas três abas; aqui é só a escolha e o texto que explica.
 *
 * Duas decisões de implementação que não são cosméticas:
 *
 * 1. Só a aba ativa fica MONTADA (não é `hidden`), pras abas de planilha
 *    poderem ser lazy de verdade. O preço é que trocar de aba mata o estado da
 *    outra — por isso a troca é guardada quando há colagem/preview em pé.
 * 2. `ImportarPorArquivo` e `ImportarVendasConcluidas` entram por
 *    `next/dynamic`: as duas puxam o SheetJS (~460 KB minificado), e sem isso
 *    todo carregamento de /repasses/importar pagaria esse chunk mesmo pra quem
 *    só vai colar texto.
 */

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ClipboardPaste, FileUp, Loader2, ReceiptText } from "lucide-react";
import { ImportarPorTexto } from "@/components/repasses/ImportarPorTexto";
import { cn } from "@/lib/utils";

const CarregandoPlanilha = () => (
  <p className="flex items-center gap-2 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5 text-sm text-[var(--text-muted)]">
    <Loader2 className="h-4 w-4 animate-spin" /> Carregando o leitor de planilha…
  </p>
);

const ImportarPorArquivo = dynamic(
  () =>
    import("@/components/repasses/ImportarPorArquivo").then((m) => m.ImportarPorArquivo),
  { ssr: false, loading: CarregandoPlanilha },
);

const ImportarVendasConcluidas = dynamic(
  () =>
    import("@/components/repasses/ImportarVendasConcluidas").then(
      (m) => m.ImportarVendasConcluidas,
    ),
  { ssr: false, loading: CarregandoPlanilha },
);

type Aba = "texto" | "arquivo" | "vendas";

type InfoAba = {
  rotulo: string;
  resumo: string;
  icone: React.ReactNode;
  detalhe: React.ReactNode;
};

/**
 * Ordem de exibição — "texto" primeiro porque é o que cria carro no ar, que é a
 * operação do dia a dia. "vendas" por último porque é a de fim de ciclo.
 */
const ORDEM: ReadonlyArray<Aba> = ["texto", "arquivo", "vendas"];

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
  vendas: {
    rotulo: "Vendas concluídas",
    resumo: "registra as vendas fechadas",
    icone: <ReceiptText className="h-4 w-4" />,
    detalhe: (
      <>
        <strong>Use quando o Auto Avaliar fechar vendas.</strong> Marca{" "}
        <strong>vendido</strong> com data e valor da venda, e lança os gastos previstos.
        É a <strong>única aba que cria carro já vendido</strong>: venda é fato
        consumado, e o carro pode ter subido e vendido sem nunca passar pelo sistema —
        não criar seria perder a venda e a margem junto. Nunca sobrescreve valor de
        compra que já existe. O TAC aparece na conferência, mas não vira custo do carro.
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
        className="grid gap-3 sm:grid-cols-3"
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
        ) : aba === "arquivo" ? (
          <ImportarPorArquivo />
        ) : (
          <ImportarVendasConcluidas />
        )}
      </div>
    </div>
  );
}
