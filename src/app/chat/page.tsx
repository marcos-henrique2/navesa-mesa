import { Chat } from "@/components/Chat";
import { PageHeader } from "@/components/AppShell";

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
