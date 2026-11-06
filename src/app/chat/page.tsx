import dynamic from "next/dynamic";
import { PageHeader } from "@/components/AppShell";
import { chatHabilitado } from "@/lib/chat/cerebro-client";

// Chat usa AI SDK + providers (pacote pesado). Lazy load pra não impactar
// o bundle inicial das outras páginas — só carrega quando o usuário entra
// em /chat de fato.
const Chat = dynamic(() => import("@/components/Chat").then((m) => ({ default: m.Chat })), {
  loading: () => <p className="px-6 py-8 text-sm text-[var(--text-muted)]">Carregando chat…</p>,
});

export default function ChatPage() {
  // Sem CHAT_BACKEND=cerebro|auto o Chat IA segue desativado (providers desligados
  // por custo): acesso direto pela URL mostra o aviso em vez do chat.
  if (!chatHabilitado()) {
    return (
      <>
        <PageHeader title="Chat IA" />
        <div className="px-6 py-8">
          <div className="max-w-xl rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5 text-sm text-[var(--text-body)]">
            <p className="font-semibold text-[var(--text-strong)]">Chat IA desativado no momento</p>
            <p className="mt-1 text-[var(--text-muted)]">
              O assistente está fora do ar neste ambiente. Use os painéis de Análise e Insights enquanto isso.
            </p>
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Chat IA"
        subtitle="Pergunte em linguagem natural sobre vendas, estoque, margem, vendedores, modelos"
      />
      <Chat />
    </>
  );
}
