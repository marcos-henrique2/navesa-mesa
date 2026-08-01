import { RelatorioAnuncio } from "@/components/repasses/RelatorioAnuncio";
import { PageHeader } from "@/components/AppShell";

export default function RepassesAnuncioPage() {
  return (
    <>
      <PageHeader
        title="Carros em anúncio"
        subtitle="Inteligência de repasse — custo real, margem, semáforo, simulador de lance e alertas"
      />
      <div className="px-6 py-8">
        <RelatorioAnuncio />
      </div>
    </>
  );
}
