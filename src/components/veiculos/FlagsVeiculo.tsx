"use client";
/* eslint-disable react-hooks/set-state-in-effect --
 * Sincronização assíncrona com Supabase: o componente busca as flags do chassi
 * no mount e precisa refletir o estado em vários useStates. Padrão idiomático
 * de data fetching → React state. Mesmo precedente do PrecificacaoBlock.
 */

/**
 * Editor de flags operacionais do veículo: "Em Promoção" e "Brinde em Acessórios".
 *
 * Inspirado nas checkboxes do NBS Markup de Venda. Não afeta cálculos —
 * só ajuda o comercial saber rapidamente quais carros têm condição especial.
 *
 * Persistência: tabela `veiculos_flags` (Supabase), chave por chassi.
 */

import { useEffect, useState } from "react";
import { Tag, Gift, Loader2, Save, Check } from "lucide-react";
import { getFlagsVeiculo, setFlagsVeiculo } from "@/lib/data/flags-veiculo";
import { cn } from "@/lib/utils";
import { showErrorToast, showSuccessToast } from "@/components/ui/Toast";

export function FlagsVeiculo({ chassi }: { chassi: string }) {
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [emPromocao, setEmPromocao] = useState(false);
  const [brinde, setBrinde] = useState(false);
  const [observacaoBrinde, setObservacaoBrinde] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    getFlagsVeiculo(chassi)
      .then((row) => {
        if (cancelado) return;
        if (row) {
          setEmPromocao(row.em_promocao);
          setBrinde(row.brinde_acessorios);
          setObservacaoBrinde(row.observacao_brinde ?? "");
        }
      })
      .catch((e: unknown) => {
        if (cancelado) return;
        const msg = e instanceof Error ? e.message : "Erro ao carregar flags";
        showErrorToast(`Flags: ${msg}`);
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [chassi]);

  function alternarPromocao() {
    setEmPromocao((v) => !v);
    setDirty(true);
  }

  function alternarBrinde() {
    setBrinde((v) => {
      if (v) setObservacaoBrinde(""); // desligou brinde → limpa observação
      return !v;
    });
    setDirty(true);
  }

  function onObservacaoChange(e: React.ChangeEvent<HTMLInputElement>) {
    setObservacaoBrinde(e.target.value);
    setDirty(true);
  }

  async function salvar() {
    setSalvando(true);
    try {
      await setFlagsVeiculo({
        chassi,
        emPromocao,
        brindeAcessorios: brinde,
        observacaoBrinde: brinde ? (observacaoBrinde.trim() || null) : null,
      });
      setDirty(false);
      showSuccessToast("Flags salvas");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      showErrorToast(`Não salvou: ${msg}`);
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) {
    return (
      <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] px-5 py-4 text-sm text-[var(--text-muted)]">
        <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" /> Carregando marcações…
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border-soft)] px-5 py-3">
        <Tag className="h-4 w-4 text-[var(--text-muted)]" />
        <h3 className="text-sm font-semibold text-[var(--text-strong)]">Marcações comerciais</h3>
        <span className="text-xs text-[var(--text-muted)]">— sinalizações sem impacto no cálculo</span>
        {dirty && (
          <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            alterações não salvas
          </span>
        )}
      </header>

      <div className="space-y-3 p-5">
        {/* Em promoção */}
        <ToggleLinha
          ativo={emPromocao}
          onChange={alternarPromocao}
          icone={<Tag className="h-4 w-4" />}
          titulo="Em promoção"
          descricao="Sinaliza que o veículo tem condição especial neste momento. Aparece como badge na listagem e no detalhe."
          corAtivo="bg-pink-100 text-pink-800 dark:bg-pink-950/40 dark:text-pink-300"
        />

        {/* Brinde em acessórios */}
        <ToggleLinha
          ativo={brinde}
          onChange={alternarBrinde}
          icone={<Gift className="h-4 w-4" />}
          titulo="Brinde em acessórios"
          descricao="Indica que a venda inclui acessórios cortesia. O custo dos brindes deve ser computado em Acessórios no markup."
          corAtivo="bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300"
        />

        {/* Observação do brinde (só aparece se brinde ativo) */}
        {brinde && (
          <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-app)] p-3">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Qual brinde está incluso? (opcional)
            </label>
            <input
              type="text"
              value={observacaoBrinde}
              onChange={onObservacaoChange}
              placeholder="ex: película + tapete + 1 revisão"
              maxLength={200}
              className="mt-1 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm focus:border-[var(--brand-500)] focus:outline-none"
            />
          </div>
        )}

        <button
          type="button"
          onClick={salvar}
          disabled={!dirty || salvando}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--brand-700)] px-3 py-2 text-xs font-medium text-white transition hover:bg-[var(--brand-800)] disabled:opacity-40"
        >
          {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : dirty ? <Save className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          {salvando ? "Salvando…" : dirty ? "Salvar marcações" : "Tudo salvo"}
        </button>
      </div>
    </section>
  );
}

function ToggleLinha({
  ativo,
  onChange,
  icone,
  titulo,
  descricao,
  corAtivo,
}: {
  ativo: boolean;
  onChange: () => void;
  icone: React.ReactNode;
  titulo: string;
  descricao: string;
  corAtivo: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-app)] p-3">
      <div className="flex items-start gap-2.5">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors", ativo ? corAtivo : "bg-[var(--bg-muted)] text-[var(--text-subtle)]")}>
          {icone}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-strong)]">{titulo}</p>
          <p className="text-xs text-[var(--text-muted)]">{descricao}</p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={ativo}
        onClick={onChange}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          ativo ? "bg-[var(--brand-600)]" : "bg-[var(--bg-muted)]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            ativo ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
