import { ImportarAutoAvaliar } from "@/components/repasses/ImportarAutoAvaliar";
import { PageHeader } from "@/components/AppShell";

export default function ImportarAutoAvaliarPage() {
  return (
    <>
      <PageHeader
        title="Importar do Auto Avaliar"
        subtitle="Cole a lista do Auto Avaliar → confira o preview → grave. Cria, atualiza e reconcilia repasses."
      />
      <div className="px-6 py-8">
        <ImportarAutoAvaliar />
      </div>
    </>
  );
}
