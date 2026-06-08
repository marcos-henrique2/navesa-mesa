import dynamic from "next/dynamic";
import { PageHeader } from "@/components/AppShell";

// Chat usa AI SDK + providers (pacote pesado). Lazy load pra não impactar
// o bundle inicial das outras páginas — só carrega quando o usuário entra
// em /chat de fato.
const Chat = dynamic(() => import("@/components/Chat").then((m) => ({ default: m.Chat })), {
  loading: () => <p className="px-6 py-8 text-sm text-[var(--text-muted)]">Carregando chat…</p>,
});

export default function ChatPage() {
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
