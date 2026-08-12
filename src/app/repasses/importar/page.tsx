import { ImportarAutoAvaliar } from "@/components/repasses/ImportarAutoAvaliar";
import { PageHeader } from "@/components/AppShell";

export default function ImportarAutoAvaliarPage() {
  return (
    <>
      <PageHeader
        title="Importar do Auto Avaliar"
        subtitle="Colar texto cria os carros novos; subir o .xls só atualiza os valores de quem já existe. Nos dois casos você confere antes de gravar."
      />
      <div className="px-6 py-8">
        <ImportarAutoAvaliar />
      </div>
    </>
  );
}
