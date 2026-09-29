import { ConferenciaAutoAvaliar } from "@/components/conferencia-auto-avaliar/ConferenciaAutoAvaliar";
import { PageHeader } from "@/components/AppShell";

export default function ConferenciaAutoAvaliarPage() {
  return (
    <>
      <PageHeader
        title="Conferência Auto Avaliar"
        subtitle="Suba o relatório de Veículos em Oferta e veja quem já vendeu, quem ainda está no estoque e quem não foi encontrado — sem gravar nada."
      />
      <div className="px-6 py-8">
        <ConferenciaAutoAvaliar />
      </div>
    </>
  );
}
