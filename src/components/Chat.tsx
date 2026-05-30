"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Send, Sparkles, Loader2, AlertCircle, RotateCcw } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import { useFipeBatch } from "@/lib/fipe/useFipeBatch";
import { useCautelares } from "@/lib/inventory/cautelar";
import { montarBundle } from "@/lib/analytics/insights";
import { cn } from "@/lib/utils";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const CHAT_KEY = "navesa-mesa:chat-v1";

/** Carrega histórico do chat do localStorage. SSR-safe (retorna [] no servidor). */
function carregarHistorico(): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function salvarHistorico(messages: ChatMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CHAT_KEY, JSON.stringify(messages));
  } catch (err) {
    console.warn("Falha ao salvar histórico do chat:", err);
  }
}

const SUGESTOES = [
  // Diagnóstico estratégico
  "Faça uma análise completa: o que está puxando nosso lucro e o que está nos prejudicando? Quais 3 ações eu deveria tomar essa semana?",
  "Quais carros estão vendendo MUITO acima da FIPE? E quais estão sendo vendidos muito abaixo?",
  "Quais 5 modelos eu não deveria mais aceitar em troca e por quê?",
  // Comparações
  "Compare as lojas: quem é a melhor, quem é a pior, e o que diferencia uma da outra?",
  "Como a margem varia por idade do veículo? Em qual faixa de ano eu ganho mais?",
  // Filtros operacionais
  "Tem algum HAVAL PHEV parado a mais de 60 dias? Quanto isso está custando?",
  "Quais carros têm KM muito acima da média do modelo no estoque?",
  // Performance equipe
  "Faça um diagnóstico dos vendedores: top 3 e bottom 3, e o que cada um precisa melhorar.",
  // Risco/finanças
  "Se a fábrica cortar os bônus, o que acontece? Detalhe por loja.",
  "Quais modelos do estoque atual têm maior risco de não vender?",
  // Tendência
  "Como evoluímos mês a mês? Tem alguma tendência preocupante?",
];

export function Chat() {
  const { vendas, veiculos, custosPorPlaca, vendasMeta, isHydrated } = useInventory();
  const fipeBatch = useFipeBatch();
  const cautelares = useCautelares();
  // Lazy init lê o histórico salvo (só roda no client; conteúdo só renderiza após isHydrated)
  const [messages, setMessages] = useState<ChatMessage[]>(carregarHistorico);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Persiste o histórico sempre que mudar (sobrevive reload)
  useEffect(() => {
    salvarHistorico(messages);
  }, [messages]);

  const bundle = useMemo(() => {
    if (vendas.length === 0) return null;
    return montarBundle(vendas, custosPorPlaca, veiculos, fipeBatch, cautelares);
  }, [vendas, veiculos, custosPorPlaca, fipeBatch, cautelares]);

  const periodo = useMemo(
    () => ({
      inicio: vendasMeta?.periodo_inicio ? new Date(vendasMeta.periodo_inicio).toLocaleDateString("pt-BR") : null,
      fim: vendasMeta?.periodo_fim ? new Date(vendasMeta.periodo_fim).toLocaleDateString("pt-BR") : null,
    }),
    [vendasMeta],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  async function send(prompt: string) {
    if (!prompt.trim() || streaming) return;

    const userMsg: ChatMessage = { role: "user", content: prompt };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setStreaming(true);
    setError(null);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({ messages: next, bundle, periodo }),
      });

      if (!resp.ok) {
        let errMsg = `HTTP ${resp.status}`;
        try {
          const j = (await resp.json()) as { error?: string };
          if (j.error) errMsg = j.error;
        } catch {
          /* ignore */
        }
        throw new Error(errMsg);
      }
      if (!resp.body) throw new Error("Resposta sem corpo");

      // Cria mensagem do assistente vazia e vai preenchendo
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setMessages((prev) => prev.filter((_, i) => !(i === prev.length - 1 && prev[i].role === "assistant" && prev[i].content === "")));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function reset() {
    if (messages.length > 0 && !confirm("Limpar toda a conversa? O histórico salvo será apagado.")) return;
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
  }

  if (!isHydrated) return <div className="p-6 text-sm text-slate-500">Carregando…</div>;

  return (
    <div className="mx-auto flex h-[calc(100vh-9rem)] max-w-4xl flex-col">
      {/* Header de status */}
      <div className="flex items-center justify-between border-b border-[var(--border-soft)] bg-white px-4 py-2 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-[var(--brand-700)]" />
          {bundle ? (
            <span>
              <strong className="text-slate-900">{bundle.sumario.qt}</strong> vendas · período{" "}
              <strong className="text-slate-900">{periodo.inicio}</strong> →{" "}
              <strong className="text-slate-900">{periodo.fim}</strong>
            </span>
          ) : (
            <span className="text-amber-700">
              Sem dados — suba os relatórios em{" "}
              <Link href="/upload" className="underline">
                /upload
              </Link>
            </span>
          )}
        </div>
        {messages.length > 0 && (
          <button
            onClick={reset}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            <RotateCcw className="h-3 w-3" /> Limpar
          </button>
        )}
      </div>

      {/* Mensagens */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-[var(--bg-app)] px-4 py-6">
        {messages.length === 0 ? (
          <EmptyState onPick={(q) => send(q)} disabled={!bundle} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((m, i) => (
              <MessageBubble key={i} role={m.role} content={m.content} streaming={streaming && i === messages.length - 1 && m.role === "assistant"} />
            ))}
            {streaming && messages[messages.length - 1]?.role === "user" && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="h-3 w-3 animate-spin" /> Claude está pensando…
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mx-auto mt-4 max-w-3xl rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <p className="flex items-center gap-2 font-semibold">
              <AlertCircle className="h-4 w-4" /> Erro
            </p>
            <p className="mt-1">{error}</p>
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="border-t border-[var(--border-soft)] bg-white p-3"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            disabled={!bundle || streaming}
            placeholder={bundle ? "Pergunte sobre vendas, estoque, lojas, modelos…" : "Suba os relatórios primeiro"}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-[var(--border-soft)] bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-[var(--brand-500)] focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
          />
          <button
            type="submit"
            disabled={!bundle || streaming || !input.trim()}
            className="inline-flex h-9 items-center gap-1 rounded-lg bg-[var(--brand-700)] px-3 text-sm font-medium text-white shadow-sm transition hover:bg-[var(--brand-800)] disabled:bg-slate-300 disabled:text-slate-500"
          >
            <Send className="h-4 w-4" /> Enviar
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ role, content, streaming }: { role: "user" | "assistant"; content: string; streaming: boolean }) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[var(--brand-700)] px-4 py-2 text-sm text-white shadow-sm">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-[var(--border-soft)] bg-white px-4 py-3 text-sm text-slate-800 shadow-sm">
        <FormattedMarkdown content={content} />
        {streaming && content && <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-slate-400" />}
      </div>
    </div>
  );
}

/**
 * Renderizador markdown bem leve — só negrito, listas, tabelas, código inline e parágrafos.
 * Suficiente pra respostas do Claude sem precisar puxar react-markdown.
 */
function FormattedMarkdown({ content }: { content: string }) {
  const blocks = useMemo(() => parseBlocks(content), [content]);
  return (
    <div className="space-y-2 leading-relaxed">
      {blocks.map((b, i) => {
        if (b.type === "table") return <MdTable key={i} rows={b.rows} />;
        if (b.type === "list")
          return (
            <ul key={i} className="ml-5 list-disc space-y-1">
              {b.items.map((it, j) => (
                <li key={j} dangerouslySetInnerHTML={{ __html: inline(it) }} />
              ))}
            </ul>
          );
        if (b.type === "heading") {
          const Tag = (b.level === 1 ? "h2" : b.level === 2 ? "h3" : "h4") as keyof React.JSX.IntrinsicElements;
          return (
            <Tag key={i} className={cn("font-bold text-slate-900", b.level === 1 ? "text-base" : "text-sm")}
                 dangerouslySetInnerHTML={{ __html: inline(b.text) }} />
          );
        }
        return <p key={i} dangerouslySetInnerHTML={{ __html: inline(b.text) }} />;
      })}
    </div>
  );
}

type Block =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "heading"; level: number; text: string }
  | { type: "table"; rows: string[][] };

function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (!ln.trim()) {
      i++;
      continue;
    }
    // Tabela markdown (precisa de pelo menos cabeçalho + separador)
    if (ln.includes("|") && lines[i + 1]?.match(/^\s*\|?\s*[:\- |]+\s*\|?\s*$/)) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|")) {
        const r = lines[i].split("|").map((c) => c.trim());
        if (r[0] === "") r.shift();
        if (r[r.length - 1] === "") r.pop();
        if (r.some((c) => c.match(/^[:\- ]+$/))) {
          i++;
          continue;
        }
        rows.push(r);
        i++;
      }
      out.push({ type: "table", rows });
      continue;
    }
    // Heading
    const h = ln.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      out.push({ type: "heading", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    // Lista
    if (ln.match(/^\s*[-*•]\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\s*[-*•]\s+/)) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i++;
      }
      out.push({ type: "list", items });
      continue;
    }
    // Parágrafo (junta múltiplas linhas até linha vazia)
    let para = ln;
    i++;
    while (i < lines.length && lines[i].trim() && !lines[i].match(/^\s*[-*•]\s+/) && !lines[i].match(/^#{1,6}\s/) && !lines[i].includes("|")) {
      para += " " + lines[i];
      i++;
    }
    out.push({ type: "p", text: para });
  }
  return out;
}

function inline(text: string): string {
  // escape HTML primeiro
  let s = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // **bold**
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // *italic*
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  // `code`
  s = s.replace(/`([^`]+)`/g, '<code class="rounded bg-slate-100 px-1 py-0.5 text-xs font-mono text-slate-700">$1</code>');
  return s;
}

function MdTable({ rows }: { rows: string[][] }) {
  if (rows.length === 0) return null;
  const [header, ...body] = rows;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-300">
            {header.map((h, i) => (
              <th key={i} className="px-2 py-1.5 text-left font-semibold text-slate-700" dangerouslySetInnerHTML={{ __html: inline(h) }} />
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="border-b border-slate-200">
              {r.map((c, j) => (
                <td key={j} className="px-2 py-1.5 text-slate-700" dangerouslySetInnerHTML={{ __html: inline(c) }} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ onPick, disabled }: { onPick: (q: string) => void; disabled: boolean }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--brand-100)] to-[var(--brand-50)] text-[var(--brand-700)]">
        <Sparkles className="h-6 w-6" />
      </div>
      <h2 className="text-xl font-bold text-slate-900">Pergunte sobre seus dados</h2>
      <p className="mt-2 text-sm text-slate-500">
        Eu uso os 3 relatórios que você já subiu (estoque, vendas, custos) pra responder em linguagem natural.
      </p>
      {!disabled && (
        <div className="mt-6 grid gap-2 text-left sm:grid-cols-2">
          {SUGESTOES.map((s) => (
            <button
              key={s}
              onClick={() => onPick(s)}
              className="rounded-lg border border-[var(--border-soft)] bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition hover:border-[var(--brand-300)] hover:bg-[var(--brand-50)]"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
